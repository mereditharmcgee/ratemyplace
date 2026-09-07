// Read side for the building records panel. `pull.ts` writes provenance (`record_pulls`)
// and rows (`building_records`); this module turns that storage back into a typed,
// validated view. A payload is only as trustworthy as the JSON parse and shape check
// below, so nothing here assumes a stored row still matches its current TypeScript type
// (a source's mapping can change after rows were written).
import { logError } from '../logger';
import { sourcesForCity, type Jurisdiction } from './jurisdictions';
import type {
  AssessmentPayload,
  EnforcementTicketPayload,
  PayloadByKind,
  PermitPayload,
  RecordKind,
  RecordsDb,
  RentSmartPayload,
  ServiceRequestPayload,
  ViolationPayload,
} from './types';

export interface SourceStatus {
  sourceId: string;
  label: string;
  /** null when the stored source id is not one this build knows about, so no link is rendered. */
  pageUrl: string | null;
  status: 'ok' | 'empty' | 'error';
  retrievedAt: number;
  /**
   * NEVER RENDER THIS. It is upstream text — a CKAN error envelope, an HTTP body fragment —
   * carried here only so `recordsQuery.test.ts` can assert that the newest pull row wins per
   * source (a later `ok` must clear an earlier `error`'s message). The panel says
   * "Record unavailable" and the date of the last attempt; the raw message is for the admin
   * queue and the logs, which read `record_pulls.error_message` directly.
   * `buildingRecordsRender.test.ts` holds the panel to that.
   */
  errorMessage: string | null;
}

export interface CorrectionNote {
  recordKind: string | null;
  resolvedAt: number;
  notes: string;
}

export interface BuildingRecordsView {
  /** Max retrieved_at across every pull row for the building. */
  pulledAt: number;
  /** Keyed by source id; the latest pull per source wins. */
  sources: Record<string, SourceStatus>;
  assessments: AssessmentPayload[];
  permits: PermitPayload[];
  violations: ViolationPayload[];
  enforcement: EnforcementTicketPayload[];
  serviceRequests: ServiceRequestPayload[];
  rentsmart: RentSmartPayload[];
  /** Kinds with at least one payload that failed validation, sorted. */
  invalidKinds: RecordKind[];
  corrections: CorrectionNote[];
}

/** Dataset pages keyed by source id (CKAN resource id), one map per jurisdiction. Built lazily, once each. */
const pageUrlsByJurisdiction = new Map<Jurisdiction, Map<string, string>>();

function pageUrlForSource(jurisdiction: Jurisdiction, sourceId: string): string | null {
  let byId = pageUrlsByJurisdiction.get(jurisdiction);
  if (!byId) {
    byId = new Map(sourcesForCity(jurisdiction).map((source) => [source.id, source.pageUrl]));
    pageUrlsByJurisdiction.set(jurisdiction, byId);
  }
  // No fallback: citing the assessor's dataset page for a permits row would be a wrong citation.
  return byId.get(sourceId) ?? null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An absent key and an explicit null both mean "not recorded"; anything else must be a string. */
function nullableString(value: unknown): boolean {
  return value === null || value === undefined || typeof value === 'string';
}

/** Same, for the numbers the panel formats: NaN or Infinity would render as garbage. */
function nullableNumber(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function all(value: Record<string, unknown>, keys: string[], check: (v: unknown) => boolean): boolean {
  return keys.every((key) => check(value[key]));
}

/**
 * The only gate between whatever JSON landed in `building_records.payload` and a typed
 * payload the panel renders. Every field the panel sorts on, formats, or keys logic on is
 * checked here; purely decorative strings stay whatever shape they were stored as.
 * Generic in the kind, so a caller gets the concrete payload type back without a cast.
 */
export function validatePayload<K extends RecordKind>(kind: K, value: unknown): PayloadByKind[K] | null {
  if (!isPlainObject(value)) return null;

  switch (kind) {
    case 'assessment':
      if (typeof value.fiscalYear !== 'string' || typeof value.condominium !== 'boolean') return null;
      if (!all(value, ['owner', 'mailAddressee', 'mailStreet', 'mailCity', 'mailState', 'mailZip'], nullableString)) return null;
      if (
        !all(
          value,
          ['totalValue', 'landValue', 'buildingValue', 'yearBuilt', 'yearRemodel', 'residentialUnits', 'grossArea', 'livingArea'],
          nullableNumber,
        )
      ) {
        return null;
      }
      return value as unknown as PayloadByKind[K];
    case 'permit':
      if (typeof value.permitNumber !== 'string' || !nullableString(value.issuedDate)) return null;
      if (!all(value, ['declaredValuation', 'totalFees'], nullableNumber)) return null;
      return value as unknown as PayloadByKind[K];
    case 'violation':
    case 'enforcement_ticket':
      if (typeof value.caseNumber !== 'string' || !nullableString(value.statusDate)) return null;
      return value as unknown as PayloadByKind[K];
    case 'service_request':
      if (
        typeof value.caseId !== 'string' ||
        (value.system !== 'legacy' && value.system !== 'new') ||
        (value.classification !== 'housing' && value.classification !== 'other') ||
        !all(value, ['openedAt', 'closedAt'], nullableString)
      ) {
        return null;
      }
      return value as unknown as PayloadByKind[K];
    case 'rentsmart':
      if (typeof value.rowId !== 'string' || !all(value, ['date', 'violationType'], nullableString)) return null;
      return value as unknown as PayloadByKind[K];
    default:
      return null;
  }
}

/**
 * Descending on an ISO-ish date column, nulls last, ties broken ascending on the record's
 * natural key so two rows sharing a date always come out in the same order. Plain string
 * comparison, not localeCompare: locale collation would make the order depend on the
 * runtime's ICU data.
 */
function byDateDesc<T>(dateOf: (row: T) => string | null, keyOf: (row: T) => string): (a: T, b: T) => number {
  return (a, b) => {
    const left = dateOf(a) ?? '';
    const right = dateOf(b) ?? '';
    if (left !== right) return left < right ? 1 : -1;
    const leftKey = keyOf(a);
    const rightKey = keyOf(b);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  };
}

interface PullRow {
  source_id: string;
  source_label: string;
  status: 'ok' | 'empty' | 'error';
  error_message: string | null;
  retrieved_at: number;
}

interface RecordRowStorage {
  kind: RecordKind;
  payload: string;
}

interface CorrectionRow {
  record_kind: string | null;
  resolved_at: number;
  resolution_notes: string;
}

export async function getBuildingRecords(db: RecordsDb, buildingId: string): Promise<BuildingRecordsView | null> {
  // Oldest first, rowid breaking a retrieved_at tie, so "later row wins" below is decided
  // by storage order rather than by whatever order the engine happened to return.
  const pulls = await db
    .prepare(
      'SELECT source_id, source_label, status, error_message, retrieved_at FROM record_pulls WHERE building_id = ? ' +
        'ORDER BY retrieved_at ASC, rowid ASC',
    )
    .bind(buildingId)
    .all<PullRow>();

  if (pulls.results.length === 0) return null;

  let pulledAt = 0;
  const sources: Record<string, SourceStatus> = {};
  for (const row of pulls.results) {
    if (row.retrieved_at > pulledAt) pulledAt = row.retrieved_at;
    const existing = sources[row.source_id];
    if (!existing || row.retrieved_at >= existing.retrievedAt) {
      sources[row.source_id] = {
        sourceId: row.source_id,
        label: row.source_label,
        // Boston is the only jurisdiction with sources, so every record_pulls row is 'boston'.
        pageUrl: pageUrlForSource('boston', row.source_id),
        status: row.status,
        retrievedAt: row.retrieved_at,
        errorMessage: row.error_message ?? null,
      };
    }
  }

  const assessments: AssessmentPayload[] = [];
  const permits: PermitPayload[] = [];
  const violations: ViolationPayload[] = [];
  const enforcement: EnforcementTicketPayload[] = [];
  const serviceRequests: ServiceRequestPayload[] = [];
  const rentsmart: RentSmartPayload[] = [];
  const invalidKinds = new Set<RecordKind>();

  const recordRows = await db
    .prepare('SELECT kind, payload FROM building_records WHERE building_id = ? ORDER BY kind, source_key')
    .bind(buildingId)
    .all<RecordRowStorage>();

  for (const row of recordRows.results) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payload);
    } catch {
      invalidKinds.add(row.kind);
      continue;
    }
    // Switching on the kind before validating keeps the payload type concrete on each
    // branch, so nothing here needs a cast to land in its bucket.
    switch (row.kind) {
      case 'assessment': {
        const payload = validatePayload('assessment', parsed);
        if (payload === null) invalidKinds.add('assessment');
        else assessments.push(payload);
        break;
      }
      case 'permit': {
        const payload = validatePayload('permit', parsed);
        if (payload === null) invalidKinds.add('permit');
        else permits.push(payload);
        break;
      }
      case 'violation': {
        const payload = validatePayload('violation', parsed);
        if (payload === null) invalidKinds.add('violation');
        else violations.push(payload);
        break;
      }
      case 'enforcement_ticket': {
        const payload = validatePayload('enforcement_ticket', parsed);
        if (payload === null) invalidKinds.add('enforcement_ticket');
        else enforcement.push(payload);
        break;
      }
      case 'service_request': {
        const payload = validatePayload('service_request', parsed);
        if (payload === null) invalidKinds.add('service_request');
        else serviceRequests.push(payload);
        break;
      }
      case 'rentsmart': {
        const payload = validatePayload('rentsmart', parsed);
        if (payload === null) invalidKinds.add('rentsmart');
        else rentsmart.push(payload);
        break;
      }
      default:
        // A kind written by an older build that this one no longer knows about.
        invalidKinds.add(row.kind);
    }
  }

  const invalid = Array.from(invalidKinds).sort();
  // One line per kind, not per row: a stale mapping invalidates every row of its kind at once.
  for (const kind of invalid) {
    logError('building_record_invalid_payload', { buildingId, kind });
  }

  // Two assessor rows can share a fiscal year (a condo parcel and its master parcel);
  // the parcel id breaks that tie so the panel's 'current' row is not engine-order luck.
  assessments.sort(byDateDesc((r) => r.fiscalYear, (r) => r.parcelId ?? ''));
  permits.sort(byDateDesc((r) => r.issuedDate, (r) => r.permitNumber));
  violations.sort(byDateDesc((r) => r.statusDate, (r) => r.caseNumber));
  enforcement.sort(byDateDesc((r) => r.statusDate, (r) => r.caseNumber));
  serviceRequests.sort(byDateDesc((r) => r.openedAt, (r) => r.caseId));
  rentsmart.sort(byDateDesc((r) => r.date, (r) => r.rowId));

  const correctionRows = await db
    .prepare(
      "SELECT record_kind, resolved_at, resolution_notes FROM record_corrections " +
        "WHERE building_id = ? AND status = 'resolved' AND resolution = 'source_mismatch_noted' AND resolution_notes IS NOT NULL " +
        'ORDER BY resolved_at DESC, rowid DESC',
    )
    .bind(buildingId)
    .all<CorrectionRow>();

  const corrections: CorrectionNote[] = correctionRows.results.map((row) => ({
    recordKind: row.record_kind,
    resolvedAt: row.resolved_at,
    notes: row.resolution_notes,
  }));

  return {
    pulledAt,
    sources,
    assessments,
    permits,
    violations,
    enforcement,
    serviceRequests,
    rentsmart,
    invalidKinds: invalid,
    corrections,
  };
}
