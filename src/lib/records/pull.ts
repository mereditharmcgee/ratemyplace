// Runs every source for one building and writes the results with their provenance.
//
// This module knows nothing about HTTP: an admin API route and (sub-project C) a
// scheduled Worker both call `pullBuildingRecords` directly. It never throws for a
// source failure — a failing source gets an `error` pull row, keeps whatever rows it
// wrote last time, and the sources after it still run. A failed *write* is treated the
// same way: the batch below is all-or-nothing, so a rejected batch leaves that source's
// prior rows exactly as they were (its deletes rolled back with everything else) and all
// that changes is one added error pull row. That is what makes a re-pull safe to trigger
// from anywhere: the worst case is a stale source, never a building whose records were
// half-replaced.
import { buildIdentity, toNumericParcel, type BuildingRowForIdentity } from './identity';
import { jurisdictionForCity, sourcesForCity } from './jurisdictions';
import { ASSESSOR_YEARS, resolveParcel, type ParcelResolution } from './sources/boston/assessor';
import {
  NO_QUERY,
  SourceError,
  type BuildingIdentity,
  type FetchLike,
  type PullSourceSummary,
  type PullSummary,
  type RecordRow,
  type RecordSource,
  type RecordsDb,
  type RecordsPreparedStatement,
  type SourceResult,
} from './types';

export interface PullOptions {
  /** Admin user id, or null when no admin is behind the pull (seed, queue). */
  triggeredBy: string | null;
  /**
   * Why the pull ran, stored in record_pulls.trigger_reason: 'admin', 'correction',
   * 'seed', or 'queue:<reason>'. Defaults to 'admin' when triggeredBy is set.
   */
  triggerReason?: string | null;
  correctionId?: string | null;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: FetchLike;
}

/** error_message is provenance, not a log: enough to diagnose, short enough not to bloat the row. */
const MAX_ERROR_LENGTH = 500;

const PULL_INSERT_SQL =
  'INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, row_count, error_message, triggered_by, correction_id, trigger_reason) ' +
  'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

const RECORD_INSERT_SQL =
  'INSERT INTO building_records (id, building_id, pull_id, kind, source_key, payload, source_url) VALUES (?, ?, ?, ?, ?, ?, ?)';

interface PullRowValues {
  pullId: string;
  buildingId: string;
  jurisdiction: string;
  source: RecordSource;
  query: string;
  status: PullSourceSummary['status'];
  rowCount: number;
  errorMessage: string | null;
  triggeredBy: string | null;
  correctionId: string | null;
  triggerReason: string | null;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The ellipsis is part of the budget, so a truncated message is still MAX_ERROR_LENGTH characters. */
function truncate(message: string): string {
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH - 1)}…` : message;
}

function pullRowStatement(db: RecordsDb, values: PullRowValues): RecordsPreparedStatement {
  return db
    .prepare(PULL_INSERT_SQL)
    .bind(
      values.pullId,
      values.buildingId,
      values.jurisdiction,
      values.source.id,
      values.source.label,
      values.query,
      values.status,
      values.rowCount,
      values.errorMessage,
      values.triggeredBy,
      values.correctionId,
      values.triggerReason,
    );
}

/**
 * Delete-then-insert for everything this source owns. An `empty` result runs the deletes
 * too, so a fiscal year that no longer returns a row clears that year — and, because an
 * assessor source narrows its delete by `ownsSourceKey`, only that year.
 *
 * Rows are deduped on (kind, source_key) — the same tuple as building_records' UNIQUE
 * constraint — before the inserts are built. Every source already dedupes its own rows;
 * this is belt and braces, so that one that forgets cannot fail the whole batch and take
 * the source's existing rows down with it.
 */
function replaceStatements(
  db: RecordsDb,
  buildingId: string,
  pullId: string,
  source: RecordSource,
  rows: RecordRow[],
): RecordsPreparedStatement[] {
  const statements: RecordsPreparedStatement[] = [];
  for (const kind of source.kinds) {
    statements.push(
      source.ownsSourceKey
        ? db
            .prepare('DELETE FROM building_records WHERE building_id = ? AND kind = ? AND source_key = ?')
            .bind(buildingId, kind, source.ownsSourceKey)
        : db.prepare('DELETE FROM building_records WHERE building_id = ? AND kind = ?').bind(buildingId, kind),
    );
  }
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.kind}:${row.sourceKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    statements.push(
      db
        .prepare(RECORD_INSERT_SQL)
        .bind(crypto.randomUUID(), buildingId, pullId, row.kind, row.sourceKey, JSON.stringify(row.payload), row.sourceUrl ?? null),
    );
  }
  return statements;
}

/** The first non-empty SAM id in a source's rows. Only the violation feeds carry one. */
function samIdFrom(rows: RecordRow[]): string | null {
  for (const row of rows) {
    if (row.kind !== 'violation' && row.kind !== 'enforcement_ticket') continue;
    const samId = row.payload.samId?.trim();
    if (samId) return samId;
  }
  return null;
}

/**
 * Fill in the parcel (and the condominium flag) the rest of the sources key on.
 * Returns null when the identity is usable, or the message explaining why it is not:
 * an unresolved parcel is not a per-source failure, it fails the whole pull.
 */
async function resolveIdentityParcel(db: RecordsDb, identity: BuildingIdentity, fetchImpl: FetchLike): Promise<string | null> {
  let resolution: ParcelResolution;
  try {
    resolution = await resolveParcel(identity, fetchImpl);
  } catch (err) {
    return `Parcel resolution failed: ${messageOf(err)}`;
  }
  if (resolution.parcelId) {
    try {
      // updated_at is deliberately not bumped: on buildings it means "an admin edited
      // this", and record_pulls.retrieved_at already dates the resolution.
      await db.prepare('UPDATE buildings SET parcel_id = ? WHERE id = ?').bind(resolution.parcelId, identity.buildingId).run();
    } catch (err) {
      return `Parcel write failed: ${messageOf(err)}`;
    }
    // Assigned only after the write succeeds, so the identity the sources key on and the
    // buildings row never disagree about the parcel.
    identity.parcelId = resolution.parcelId;
    identity.parcelNumeric = toNumericParcel(resolution.parcelId);
    return null;
  }
  if (resolution.condominium) {
    // No whole-building parcel exists to store; the assessor source reports the fact instead.
    identity.condominium = true;
    return null;
  }
  if (resolution.wholeBuildingParcels > 1) {
    return `${resolution.wholeBuildingParcels} parcels match this address; set the parcel id by hand and pull again`;
  }
  return 'No assessor parcel matches this address';
}

export async function pullBuildingRecords(
  db: RecordsDb,
  building: BuildingRowForIdentity,
  options: PullOptions,
): Promise<PullSummary> {
  const jurisdiction = jurisdictionForCity(building.city);
  if (!jurisdiction) {
    return { buildingId: building.id, jurisdiction: 'none', parcelId: null, condominium: false, sources: [] };
  }

  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const correctionId = options.correctionId ?? null;
  const triggeredBy = options.triggeredBy;
  // An admin pull that names no reason is still an admin pull. A pull with nobody behind it
  // (seed, queue) has to say why it ran, because triggered_by is a users(id) FK and cannot.
  const triggerReason = options.triggerReason ?? (options.triggeredBy ? 'admin' : null);
  const sources = sourcesForCity(building.city);

  let identity: BuildingIdentity | null = null;
  let resolutionError: string | null = null;
  try {
    identity = buildIdentity(building);
  } catch (err) {
    // An address we cannot parse is a resolution failure like any other: every source
    // gets an error row saying so, and the caller still gets a summary back.
    resolutionError = truncate(messageOf(err));
  }
  if (identity && !identity.parcelId) {
    const failure = await resolveIdentityParcel(db, identity, fetchImpl);
    if (failure) resolutionError = truncate(failure);
  }

  const summaries: PullSourceSummary[] = [];
  let samIdKnown = Boolean(building.sam_id?.trim());

  for (const source of sources) {
    const pullId = crypto.randomUUID();
    const base = { pullId, buildingId: building.id, jurisdiction, source, triggeredBy, correctionId, triggerReason };

    if (!identity || resolutionError) {
      // Belt and braces: a null identity always comes with a resolutionError set above,
      // so the fallback text is unreachable unless that pairing is broken later.
      const errorMessage = resolutionError ?? 'Building identity could not be resolved';
      await pullRowStatement(db, { ...base, query: NO_QUERY, status: 'error', rowCount: 0, errorMessage }).run();
      summaries.push({ sourceId: source.id, label: source.label, status: 'error', rowCount: 0, error: errorMessage });
      continue;
    }

    let result: SourceResult;
    try {
      result = await source.run(identity, fetchImpl);
    } catch (err) {
      const errorMessage = truncate(messageOf(err));
      const query = err instanceof SourceError ? err.query : NO_QUERY;
      await pullRowStatement(db, { ...base, query, status: 'error', rowCount: 0, errorMessage }).run();
      summaries.push({ sourceId: source.id, label: source.label, status: 'error', rowCount: 0, error: errorMessage });
      continue;
    }

    const status: PullSourceSummary['status'] = result.rows.length > 0 ? 'ok' : 'empty';
    // One batch: the provenance row and the rows it vouches for land together or not at all.
    try {
      await db.batch([
        pullRowStatement(db, { ...base, query: result.query, status, rowCount: result.rows.length, errorMessage: null }),
        ...replaceStatements(db, building.id, pullId, source, result.rows),
      ]);
    } catch (err) {
      // The batch rolled back, so `pullId` was never persisted and this source's previous
      // rows survive untouched — the deletes rolled back with the inserts. Record the
      // failure as its own pull row (same query, so the provenance still says what ran)
      // and keep going: a write failure must not cost the sources after this one.
      const errorMessage = truncate(`Write failed: ${messageOf(err)}`);
      await pullRowStatement(db, { ...base, query: result.query, status: 'error', rowCount: 0, errorMessage }).run();
      summaries.push({ sourceId: source.id, label: source.label, status: 'error', rowCount: 0, error: errorMessage });
      continue;
    }
    summaries.push({ sourceId: source.id, label: source.label, status, rowCount: result.rows.length });

    if (!samIdKnown) {
      const samId = samIdFrom(result.rows);
      if (samId) {
        // The guard matches `samIdKnown` above, which treats a blank sam_id as unknown.
        await db
          .prepare("UPDATE buildings SET sam_id = ? WHERE id = ? AND (sam_id IS NULL OR trim(sam_id) = '')")
          .bind(samId, building.id)
          .run();
        samIdKnown = true;
      }
    }
  }

  if (jurisdiction === 'boston' && !resolutionError) {
    // Assessor years roll over: FY2027 joins ASSESSOR_YEARS and FY2021 drops off. Each
    // assessor source only ever deletes its own `ownsSourceKey`, so the year that fell off
    // the list has nothing left to clear it and would sit in building_records forever. The
    // spec promises six fiscal years; storage must not quietly accumulate a seventh.
    const fiscalYears = ASSESSOR_YEARS.map((y) => y.fiscalYear);
    await db
      .prepare(
        `DELETE FROM building_records WHERE building_id = ? AND kind = 'assessment' AND source_key NOT IN (${fiscalYears.map(() => '?').join(',')})`,
      )
      .bind(building.id, ...fiscalYears)
      .run();
  }

  return {
    buildingId: building.id,
    jurisdiction,
    parcelId: identity?.parcelId ?? null,
    condominium: identity?.condominium ?? false,
    sources: summaries,
  };
}
