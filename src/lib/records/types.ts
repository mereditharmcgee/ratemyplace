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
  /** The exact SQL (or JSON array of SQL strings) sent. Stored verbatim as provenance. */
  query: string;
  rows: RecordRow[];
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface BuildingIdentity {
  buildingId: string;
  /** Individual street numbers, e.g. ['23','27'] for '23-27'. */
  numbers: string[];
  /** The hyphenated range as written, e.g. '23-27', or null. */
  rangeForm: string | null;
  /** Uppercase street with short suffix, e.g. 'LANARK RD'. */
  streetShort: string;
  /** Uppercase street with long suffix, e.g. 'LANARK ROAD'. Equal to streetShort when no suffix. */
  streetLong: string;
  /** Uppercase street name without suffix, e.g. 'LANARK'. */
  streetBase: string;
  /** Every '<number> <streetShort>' form, uppercase. */
  addressFormsShort: string[];
  /** Every '<number> <streetLong>' form, uppercase. */
  addressFormsLong: string[];
  /** 10-digit parcel id with leading zero, or null. */
  parcelId: string | null;
  /** Parcel id with leading zero stripped, or null. */
  parcelNumeric: string | null;
  condominium: boolean;
  zip: string | null;
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
  constructor(message: string, public readonly query: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SourceError';
  }
}

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
  run(): Promise<unknown>;
}
export interface RecordsPreparedStatement extends RecordsStatement {
  bind(...values: unknown[]): RecordsPreparedStatement;
}
export interface RecordsDb {
  prepare(sql: string): RecordsPreparedStatement;
  batch(statements: RecordsPreparedStatement[]): Promise<unknown>;
}
