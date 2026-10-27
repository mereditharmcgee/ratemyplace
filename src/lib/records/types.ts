export const RECORD_KINDS = [
  'assessment', 'permit', 'violation', 'enforcement_ticket', 'service_request', 'rentsmart',
] as const;

export type RecordKind = (typeof RECORD_KINDS)[number];

export interface AssessmentPayload {
  fiscalYear: string;
  parcelId: string | null;
  owner: string | null;
  mailAddressee: string | null;
  mailStreet: string | null;
  mailCity: string | null;
  mailState: string | null;
  mailZip: string | null;
  landUse: string | null;
  landUseDescription: string | null;
  yearBuilt: number | null;
  yearRemodel: number | null;
  grossArea: number | null;
  livingArea: number | null;
  residentialUnits: number | null;
  commercialUnits: number | null;
  totalValue: number | null;
  landValue: number | null;
  buildingValue: number | null;
  condominium: boolean;
  /**
   * The parcel's own house numbers and ZIP as the current-year assessor records them
   * (`ST_NUM`, `ST_NUM2`, `ZIP_CODE`). Current fiscal year only; absent on other years and on
   * rows stored before October 2026. Read to tell whether the parcel covers house numbers the
   * page's address does not, which makes an address-keyed zero uncertain.
   */
  parcelStreetNumber?: string | null;
  parcelStreetNumberHigh?: string | null;
  parcelZip?: string | null;
}

export interface PermitPayload {
  permitNumber: string;
  workType: string | null;
  permitType: string | null;
  description: string | null;
  comments: string | null;
  applicant: string | null;
  declaredValuation: number | null;
  totalFees: number | null;
  issuedDate: string | null;
  expirationDate: string | null;
  status: string | null;
  occupancyType: string | null;
  address: string | null;
}

export interface ViolationPayload {
  caseNumber: string;
  code: string | null;
  value: string | null;
  description: string | null;
  status: string | null;
  statusDate: string | null;
  address: string | null;
  contactAddress: string | null;
  samId: string | null;
}

export interface EnforcementTicketPayload extends ViolationPayload {
  ticketNumber: string | null;
}

export type ServiceRequestClassification = 'housing' | 'other';

export interface ServiceRequestPayload {
  caseId: string;
  system: 'legacy' | 'new';
  openedAt: string | null;
  closedAt: string | null;
  status: string | null;
  closureReason: string | null;
  title: string | null;
  subject: string | null;
  reason: string | null;
  type: string | null;
  location: string | null;
  source: string | null;
  classification: ServiceRequestClassification;
}

export interface RentSmartPayload {
  rowId: string;
  date: string | null;
  violationType: string | null;
  description: string | null;
  address: string | null;
  parcel: string | null;
}

export interface PayloadByKind {
  assessment: AssessmentPayload;
  permit: PermitPayload;
  violation: ViolationPayload;
  enforcement_ticket: EnforcementTicketPayload;
  service_request: ServiceRequestPayload;
  rentsmart: RentSmartPayload;
}

export type RecordPayload = PayloadByKind[RecordKind];

// Compile-time guard: keeps PayloadByKind's keys and RECORD_KINDS/RecordKind in lockstep.
type _AssertAllKinds = keyof PayloadByKind extends RecordKind ? (RecordKind extends keyof PayloadByKind ? true : never) : never;
const _assertAllKinds: _AssertAllKinds = true;
void _assertAllKinds;

/** Discriminated on kind: a permit row cannot carry an assessment payload. */
export type RecordRow = {
  [K in RecordKind]: { kind: K; sourceKey: string; payload: PayloadByKind[K]; sourceUrl?: string };
}[RecordKind];

export interface SourceResult {
  /**
   * The exact SQL (or JSON array of SQL strings) sent, stored verbatim as provenance.
   * When no query ran, a short literal note saying why instead.
   */
  query: string;
  rows: RecordRow[];
}

/** A pull row's `query` when no query ran: a resolution failure, or a source that opted out. */
export const NO_QUERY = 'no query';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Why an address's house numbers could not all be listed for the address-keyed feeds:
 * `wide_range` spans more numbers than `MAX_RANGE_NUMBERS`, so only its endpoints are searched;
 * `mixed_parity` has one odd and one even endpoint, so there is no single side of the street to
 * expand along.
 */
export type AddressMatchUncertainty = 'wide_range' | 'mixed_parity';

export interface BuildingIdentity {
  buildingId: string;
  /**
   * Individual street numbers as written, e.g. ['23','27'] for '23-27'. Parcel resolution keys
   * on these, so an expanded middle number can never pull a neighbouring parcel into it.
   */
  numbers: string[];
  /**
   * Every house number the address-keyed feeds match exactly: `numbers` plus each same-parity
   * number between a numeric range's endpoints, ascending ('31-35' -> ['31','33','35']). Equal
   * to `numbers` for a single number, a lettered range, or a range left unexpanded (see
   * `matchUncertainty`).
   */
  matchNumbers: string[];
  /** The address's lowest and highest house number as integers (a lettered number counts as its digits), or null. */
  span: { low: number; high: number } | null;
  /**
   * Same-parity house numbers below `span.low` and above `span.high`, nearest first, within
   * `ENCLOSING_RANGE_WINDOW`: where a city record filed under a wider range that contains this
   * address would start and end ('501-507' contains 503). Empty when there is no span.
   */
  enclosingLows: string[];
  enclosingHighs: string[];
  /** Why the address's house numbers could not all be listed for matching, or null when they were. */
  matchUncertainty: AddressMatchUncertainty | null;
  /** The hyphenated range as written, e.g. '23-27', or null. */
  rangeForm: string | null;
  /** Uppercase street with short suffix, e.g. 'LANARK RD'. */
  streetShort: string;
  /** Uppercase street with long suffix, e.g. 'LANARK ROAD'. Equal to streetShort when no suffix. */
  streetLong: string;
  /** Uppercase street name without suffix, e.g. 'LANARK'. */
  streetBase: string;
  /** Every known uppercase spelling of the street across Boston datasets, unique, assessor form first (e.g. ['COMMONWEALTH AV','COMMONWEALTH AVE','COMMONWEALTH AVENUE']). Use for exact matches outside the assessor. */
  streetForms: string[];
  /** Every '<number> <streetShort>' form, uppercase. */
  addressFormsShort: string[];
  /** Every '<number> <streetLong>' form, uppercase. */
  addressFormsLong: string[];
  /** 10-digit parcel id with leading zero, or null. */
  parcelId: string | null;
  /** Parcel id with leading zero stripped, or null. */
  parcelNumeric: string | null;
  condominium: boolean;
  /** The building page's ZIP as stored, e.g. '02135'. */
  zip: string | null;
  /**
   * The current-year parcel's ZIP (the assessor's `ZIP_CODE`, five digits), set by the pull once
   * that assessor row is stored; null before then and for a building with no parcel. Matching
   * only: the address-keyed feeds accept it beside `zip` (`recordZips`), and the building row is
   * never changed.
   */
  parcelZip: string | null;
  /** Boston SAM id when the building already has one. */
  samId: string | null;
}

export interface RecordSource {
  /** CKAN resource id (later: other stable identifiers). Stored as record_pulls.source_id. */
  id: string;
  label: string;
  /** Human-readable dataset page, rendered as the "Source" link. */
  pageUrl: string;
  /** Kinds this source owns. A successful run replaces these rows for the building. */
  kinds: RecordKind[];
  /** When set, the source owns only rows with this source_key (assessor fiscal years). */
  ownsSourceKey?: string;
  run(identity: BuildingIdentity, fetchImpl: FetchLike): Promise<SourceResult>;
}

export class SourceError extends Error {
  /** `detail` carries the upstream error object verbatim; `message` is a truncated summary of it. */
  constructor(message: string, public readonly query: string, options?: ErrorOptions, public readonly detail?: unknown) {
    super(message, options);
    this.name = 'SourceError';
  }
}

/** Why a queue row exists. Mirrors 0031's CHECK on records_queue.reason. */
export type QueueReason = 'button' | 'follower' | 'refresh' | 'fill';

/**
 * Why a pull ran, written verbatim to `record_pulls.trigger_reason`. It lives here, not in
 * queue.ts, so `pull.ts` can name the union without importing the queue — and so a new queue
 * reason cannot reach the column without first appearing in `QueueReason` above.
 */
export type TriggerReason = 'admin' | 'correction' | 'seed' | `queue:${QueueReason}`;

export interface PullSourceSummary {
  sourceId: string;
  label: string;
  status: 'ok' | 'empty' | 'error';
  rowCount: number;
  error?: string;
}

export interface PullSummary {
  buildingId: string;
  jurisdiction: string;
  parcelId: string | null;
  condominium: boolean;
  sources: PullSourceSummary[];
}

/** The subset of D1Database the records module uses. TestD1Database satisfies it too. */
export interface RecordsStatement {
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  /**
   * D1's `D1Response` shape, narrowed to the two fields this codebase reads. Both are
   * optional so a conditional UPDATE that reports no count reads as zero — fail closed,
   * the way the correction-resolve endpoint treats it. Real `D1Database` and the
   * `TestD1Database` double both satisfy this.
   */
  run(): Promise<{ success?: boolean; meta?: { changes?: number } }>;
}
export interface RecordsPreparedStatement extends RecordsStatement {
  bind(...values: unknown[]): RecordsPreparedStatement;
}
export interface RecordsDb {
  prepare(sql: string): RecordsPreparedStatement;
  batch(statements: RecordsPreparedStatement[]): Promise<unknown>;
}
