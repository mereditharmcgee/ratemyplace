// Read side for the building records panel. `pull.ts` writes provenance (`record_pulls`)
// and rows (`building_records`); this module turns that storage back into a typed,
// validated view. A payload is only as trustworthy as the JSON parse and shape check
// below, so nothing here assumes a stored row still matches its current TypeScript type
// (a source's mapping can change after rows were written).
import { logError } from '../logger';
import { sourcesForCity } from './jurisdictions';
import { ASSESSOR_PAGE_URL } from './sources/boston/assessor';
import type {
  AssessmentPayload,
  EnforcementTicketPayload,
  PermitPayload,
  RecordKind,
  RecordPayload,
  RecordsDb,
  RentSmartPayload,
  ServiceRequestPayload,
  ViolationPayload,
} from './types';

export interface SourceStatus {
  sourceId: string;
  label: string;
  pageUrl: string;
  status: 'ok' | 'empty' | 'error';
  retrievedAt: number;
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

/** Every source's dataset page, keyed by source id (CKAN resource id). Built lazily, once. */
let pageUrlBySourceId: Map<string, string> | null = null;

function pageUrlForSource(sourceId: string): string {
  if (!pageUrlBySourceId) {
    pageUrlBySourceId = new Map(sourcesForCity('Boston').map((source) => [source.id, source.pageUrl]));
  }
  return pageUrlBySourceId.get(sourceId) ?? ASSESSOR_PAGE_URL;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The only gate between whatever JSON landed in `building_records.payload` and a typed
 * payload the panel renders. Checks the fields a caller is likely to read without a null
 * guard (the ones the display layer keys logic on); everything else stays whatever shape
 * it was stored as, nullable fields included.
 */
export function validatePayload(kind: RecordKind, value: unknown): RecordPayload | null {
  if (!isPlainObject(value)) return null;

  switch (kind) {
    case 'assessment':
      if (typeof value.fiscalYear !== 'string' || typeof value.condominium !== 'boolean') return null;
      return value as unknown as AssessmentPayload;
    case 'permit':
      if (typeof value.permitNumber !== 'string') return null;
      return value as unknown as PermitPayload;
    case 'violation':
      if (typeof value.caseNumber !== 'string') return null;
      return value as unknown as ViolationPayload;
    case 'enforcement_ticket':
      if (typeof value.caseNumber !== 'string') return null;
      return value as unknown as EnforcementTicketPayload;
    case 'service_request':
      if (
        typeof value.caseId !== 'string' ||
        typeof value.system !== 'string' ||
        (value.classification !== 'housing' && value.classification !== 'other')
      ) {
        return null;
      }
      return value as unknown as ServiceRequestPayload;
    case 'rentsmart':
      if (typeof value.rowId !== 'string') return null;
      return value as unknown as RentSmartPayload;
    default:
      return null;
  }
}

/** Descending string sort on an ISO-ish date column, nulls sorted last. */
function byDateDesc<T>(dateOf: (row: T) => string | null): (a: T, b: T) => number {
  return (a, b) => (dateOf(b) ?? '').localeCompare(dateOf(a) ?? '');
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
  const pulls = await db
    .prepare('SELECT source_id, source_label, status, error_message, retrieved_at FROM record_pulls WHERE building_id = ?')
    .bind(buildingId)
    .all<PullRow>();

  if (pulls.results.length === 0) return null;

  let pulledAt = 0;
  const sources: Record<string, SourceStatus> = {};
  for (const row of pulls.results) {
    if (row.retrieved_at > pulledAt) pulledAt = row.retrieved_at;
    const existing = sources[row.source_id];
    if (!existing || row.retrieved_at > existing.retrievedAt) {
      sources[row.source_id] = {
        sourceId: row.source_id,
        label: row.source_label,
        pageUrl: pageUrlForSource(row.source_id),
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
    .prepare('SELECT kind, payload FROM building_records WHERE building_id = ?')
    .bind(buildingId)
    .all<RecordRowStorage>();

  for (const row of recordRows.results) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payload);
    } catch {
      invalidKinds.add(row.kind);
      logError('building_record_invalid_payload', { buildingId, kind: row.kind });
      continue;
    }
    const payload = validatePayload(row.kind, parsed);
    if (payload === null) {
      invalidKinds.add(row.kind);
      logError('building_record_invalid_payload', { buildingId, kind: row.kind });
      continue;
    }
    switch (row.kind) {
      case 'assessment':
        assessments.push(payload as AssessmentPayload);
        break;
      case 'permit':
        permits.push(payload as PermitPayload);
        break;
      case 'violation':
        violations.push(payload as ViolationPayload);
        break;
      case 'enforcement_ticket':
        enforcement.push(payload as EnforcementTicketPayload);
        break;
      case 'service_request':
        serviceRequests.push(payload as ServiceRequestPayload);
        break;
      case 'rentsmart':
        rentsmart.push(payload as RentSmartPayload);
        break;
    }
  }

  assessments.sort(byDateDesc((r) => r.fiscalYear));
  permits.sort(byDateDesc((r) => r.issuedDate));
  violations.sort(byDateDesc((r) => r.statusDate));
  enforcement.sort(byDateDesc((r) => r.statusDate));
  serviceRequests.sort(byDateDesc((r) => r.openedAt));
  rentsmart.sort(byDateDesc((r) => r.date));

  const correctionRows = await db
    .prepare(
      "SELECT record_kind, resolved_at, resolution_notes FROM record_corrections " +
        "WHERE building_id = ? AND status = 'resolved' AND resolution = 'source_mismatch_noted' AND resolution_notes IS NOT NULL " +
        'ORDER BY resolved_at DESC',
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
    invalidKinds: Array.from(invalidKinds).sort(),
    corrections,
  };
}
