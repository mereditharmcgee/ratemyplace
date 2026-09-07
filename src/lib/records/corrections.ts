import { RECORD_KINDS, type RecordKind } from './types';
import { isValidEmail, type ValidationError } from '../validation';

/** Sentinel kind for a report against the whole records panel (no single record). */
export const PANEL_KIND = 'panel' as const;

/** Every record kind a correction can point at, plus 'panel' for a report against the whole records panel (no single kind). */
export type CorrectionKind = RecordKind | typeof PANEL_KIND;

export const CORRECTION_KINDS: readonly CorrectionKind[] = [...RECORD_KINDS, PANEL_KIND];

/**
 * Map a correction's UI-facing kind to the value stored in
 * `record_corrections.record_kind` — 'panel' has no single record, so it is
 * stored as `null`. Keep the panel<->null mapping here only; callers should
 * never inline `=== 'panel' ? null : kind` themselves.
 */
export function toStoredKind(kind: CorrectionKind): RecordKind | null {
  return kind === PANEL_KIND ? null : kind;
}

/** Inverse of {@link toStoredKind}: a null `record_kind` column means the correction was filed against the whole panel. */
export function fromStoredKind(kind: RecordKind | null): CorrectionKind {
  return kind === null ? PANEL_KIND : kind;
}

export type CorrectionResolution = 'repulled_unchanged' | 'repulled_updated' | 'source_mismatch_noted';

export const CORRECTION_RESOLUTIONS: readonly CorrectionResolution[] = [
  'repulled_unchanged',
  'repulled_updated',
  'source_mismatch_noted',
];

export const CLAIM_MIN = 20;
export const CLAIM_MAX = 1000;

/**
 * Validate a public POST /api/records/corrections body.
 *
 * Field order matters for the `{}` case: buildingId, recordKind, claim — tests
 * assert that order.
 */
export function validateCorrectionBody(body: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];
  const { buildingId, recordKind, claim, contactEmail } = body;

  if (!buildingId || typeof buildingId !== 'string' || !buildingId.trim()) {
    errors.push({ field: 'buildingId', message: 'Building is required.' });
  }

  if (typeof recordKind !== 'string' || !(CORRECTION_KINDS as readonly string[]).includes(recordKind)) {
    errors.push({ field: 'recordKind', message: 'Choose which record is wrong.' });
  }

  if (typeof claim !== 'string' || claim.trim().length < CLAIM_MIN) {
    errors.push({ field: 'claim', message: `Tell us what is wrong in at least ${CLAIM_MIN} characters.` });
  } else if (claim.trim().length > CLAIM_MAX) {
    errors.push({ field: 'claim', message: `Keep it under ${CLAIM_MAX} characters.` });
  }

  if (contactEmail !== undefined && contactEmail !== null && contactEmail !== '') {
    if (typeof contactEmail !== 'string' || !isValidEmail(contactEmail.trim())) {
      errors.push({ field: 'contactEmail', message: 'Email format is invalid.' });
    }
  }

  return errors;
}

export interface RecordSnapshot {
  kind: string;
  source_key: string;
  payload: string;
}

export interface RecordKey {
  kind: string;
  source_key: string;
}

export interface RecordDiff {
  added: RecordKey[];
  removed: RecordKey[];
  changed: RecordKey[];
}

/**
 * Content key for a rentsmart row: the payload's fields with `rowId` dropped
 * (rentsmart payloads embed the CKAN `_id` as `rowId`, and CKAN reassigns
 * `_id` on dataset reloads), re-stringified with sorted keys so two payloads
 * with the same content but different key order still compare equal. Falls
 * back to the raw payload string if it isn't valid JSON.
 *
 * The sort is shallow by design: rentsmart payloads are flat (string/number/
 * boolean leaf values only), so sorting the top-level keys is enough to make
 * key order irrelevant. Any nested object or array value is compared by its
 * own (unsorted) `JSON.stringify` output, which is fine as long as it isn't
 * itself reordered between pulls — `JSON.stringify(rest, Object.keys(rest).sort())`
 * would apply that same top-level allowlist recursively to every nested
 * object, silently dropping any nested key not present at the top level.
 */
function rentsmartContentKey(payload: string): string {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return payload;
    }
    const { rowId: _rowId, ...rest } = parsed as Record<string, unknown>;
    const sortedEntries = Object.entries(rest).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return JSON.stringify(Object.fromEntries(sortedEntries));
  } catch {
    return payload;
  }
}

/**
 * Diff two snapshots of a building's records (typically before/after a re-pull
 * triggered by a correction).
 *
 * A row is keyed by `${kind}:${source_key}`. Added/removed/changed are computed
 * against that key — except for 'rentsmart': CKAN reassigns the `_id` (our
 * source_key) on dataset reloads, so a rentsmart row with a new id but the same
 * payload content is not a real change. Rentsmart rows are instead compared by
 * {@link rentsmartContentKey}: a rentsmart row counts as added/removed only
 * when no row on the other side has an identical content key, and rentsmart
 * rows are never reported as 'changed' (a changed row would require matching
 * an old row to a new one, which the id reassignment makes unreliable).
 */
export function diffRecordSnapshots(before: RecordSnapshot[], after: RecordSnapshot[]): RecordDiff {
  const key = (row: RecordSnapshot): string => `${row.kind}:${row.source_key}`;

  const beforeNonRentsmart = before.filter((r) => r.kind !== 'rentsmart');
  const afterNonRentsmart = after.filter((r) => r.kind !== 'rentsmart');
  const beforeRentsmart = before.filter((r) => r.kind === 'rentsmart');
  const afterRentsmart = after.filter((r) => r.kind === 'rentsmart');

  const beforeByKey = new Map(beforeNonRentsmart.map((r) => [key(r), r]));
  const afterByKey = new Map(afterNonRentsmart.map((r) => [key(r), r]));

  const added: RecordKey[] = [];
  const removed: RecordKey[] = [];
  const changed: RecordKey[] = [];

  for (const [k, row] of afterByKey) {
    const beforeRow = beforeByKey.get(k);
    if (!beforeRow) {
      added.push({ kind: row.kind, source_key: row.source_key });
    } else if (beforeRow.payload !== row.payload) {
      // Raw string comparison — assumes the same serializer produced both
      // sides' payloads (so identical content always produces identical
      // strings). Only safe for non-rentsmart kinds; rentsmart uses
      // rentsmartContentKey below because of the CKAN `_id` reassignment.
      changed.push({ kind: row.kind, source_key: row.source_key });
    }
  }
  for (const [k, row] of beforeByKey) {
    if (!afterByKey.has(k)) {
      removed.push({ kind: row.kind, source_key: row.source_key });
    }
  }

  // Rentsmart: compare by payload content key, ignoring source_key and the
  // embedded `rowId` (both are the CKAN `_id`, which is reassigned on reload).
  // Compute each row's content key once and reuse it for both the Set build
  // and the membership check below, rather than re-deriving it per lookup.
  const beforeKeyed = beforeRentsmart.map((row) => ({ row, contentKey: rentsmartContentKey(row.payload) }));
  const afterKeyed = afterRentsmart.map((row) => ({ row, contentKey: rentsmartContentKey(row.payload) }));

  const beforeContentKeys = new Set(beforeKeyed.map((r) => r.contentKey));
  const afterContentKeys = new Set(afterKeyed.map((r) => r.contentKey));

  for (const { row, contentKey } of afterKeyed) {
    if (!beforeContentKeys.has(contentKey)) {
      added.push({ kind: row.kind, source_key: row.source_key });
    }
  }
  for (const { row, contentKey } of beforeKeyed) {
    if (!afterContentKeys.has(contentKey)) {
      removed.push({ kind: row.kind, source_key: row.source_key });
    }
  }

  return { added, removed, changed };
}
