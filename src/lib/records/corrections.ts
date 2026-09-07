import { RECORD_KINDS } from './types';
import { isValidEmail, type ValidationError } from '../validation';

/** Every record kind a correction can point at, plus 'panel' for a report against the whole records panel (no single kind). */
export const CORRECTION_KINDS: readonly string[] = [...RECORD_KINDS, 'panel'];

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

  if (typeof recordKind !== 'string' || !CORRECTION_KINDS.includes(recordKind)) {
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
 * Diff two snapshots of a building's records (typically before/after a re-pull
 * triggered by a correction).
 *
 * A row is keyed by `${kind}:${source_key}`. Added/removed/changed are computed
 * against that key — except for 'rentsmart': CKAN reassigns the `_id` (our
 * source_key) on dataset reloads, so a rentsmart row with a new id but the same
 * payload content is not a real change. Rentsmart rows are instead compared by
 * payload string: a rentsmart row counts as added/removed only when no row on
 * the other side has an identical payload, and rentsmart rows are never
 * reported as 'changed' (a changed row would require matching an old row to a
 * new one, which the id reassignment makes unreliable).
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
      changed.push({ kind: row.kind, source_key: row.source_key });
    }
  }
  for (const [k, row] of beforeByKey) {
    if (!afterByKey.has(k)) {
      removed.push({ kind: row.kind, source_key: row.source_key });
    }
  }

  // Rentsmart: compare by payload content, ignoring source_key.
  const beforePayloads = new Set(beforeRentsmart.map((r) => r.payload));
  const afterPayloads = new Set(afterRentsmart.map((r) => r.payload));

  for (const row of afterRentsmart) {
    if (!beforePayloads.has(row.payload)) {
      added.push({ kind: row.kind, source_key: row.source_key });
    }
  }
  for (const row of beforeRentsmart) {
    if (!afterPayloads.has(row.payload)) {
      removed.push({ kind: row.kind, source_key: row.source_key });
    }
  }

  return { added, removed, changed };
}
