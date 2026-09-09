import { fetchAllRows } from './ckan';
import { buildIdentity } from './identity';
import { sourcesForCity } from './jurisdictions';
import { SAM_FIELDS, SAM_RESOURCE_ID, indexSamByParcel } from './seed/sam';
import type { SamRow } from './seed/types';
import { resolveParcel } from './sources/boston/assessor';
import type {
  AssessmentPayload,
  BuildingIdentity,
  EnforcementTicketPayload,
  FetchLike,
  RecordRow,
  ServiceRequestPayload,
} from './types';

export interface FixtureCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export interface FixtureResult {
  checks: FixtureCheck[];
  failures: number;
  /** Sources whose run() threw, by label. A thrown source is a failure in its own right. */
  sourceErrors: Array<{ label: string; message: string }>;
  parcelId: string | null;
}

/** 23-27 Lanark Rd, Brighton: the one address every Boston adapter is verified against. */
export const LANARK_FIXTURE = {
  address: '23-27 Lanark Rd, Boston, MA 02135',
  parcelId: '2102098000',
} as const;

function assessmentRows(rows: RecordRow[]): AssessmentPayload[] {
  return rows.filter((r) => r.kind === 'assessment').map((r) => r.payload);
}

function enforcementRows(rows: RecordRow[]): EnforcementTicketPayload[] {
  return rows.filter((r) => r.kind === 'enforcement_ticket').map((r) => r.payload);
}

function serviceRequestRows(rows: RecordRow[]): ServiceRequestPayload[] {
  return rows.filter((r) => r.kind === 'service_request').map((r) => r.payload);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Runs every Boston source for the Lanark fixture and compares the results to values
 * recorded in September 2026. Never throws: a source that fails becomes a failed check.
 * Used by `npm run records:check` (prints) and by the scheduler's daily circuit breaker.
 *
 * Every check is recorded unconditionally. A check whose prerequisite is missing is a
 * recorded failure carrying the reason, never a skipped check, so two runs compare label
 * for label.
 */
export async function runLanarkFixture(fetchImpl: FetchLike): Promise<FixtureResult> {
  const checks: FixtureCheck[] = [];
  const sourceErrors: FixtureResult['sourceErrors'] = [];
  const check = (label: string, ok: boolean, detail: string): void => {
    checks.push({ label, ok, detail });
  };

  const identity: BuildingIdentity = buildIdentity({
    id: 'fixture',
    address: LANARK_FIXTURE.address,
    city: 'Boston',
    state: 'MA',
    zip_code: '02135',
    parcel_id: null,
    sam_id: null,
  });

  // A thrown resolution is reported as the failed "parcel resolves" check below; the rest
  // of the checks still run, against an identity that never got a parcel id.
  let resolutionError: string | null = null;
  try {
    const resolution = await resolveParcel(identity, fetchImpl);
    identity.parcelId = resolution.parcelId;
    identity.parcelNumeric = resolution.parcelId ? String(Number.parseInt(resolution.parcelId, 10)) : null;
    identity.condominium = resolution.condominium;
  } catch (err) {
    resolutionError = messageOf(err);
  }

  const rowsBySourceLabel = new Map<string, RecordRow[]>();
  const failedSourceLabels = new Map<string, string>();
  const allRows: RecordRow[] = [];

  for (const source of sourcesForCity('Boston')) {
    try {
      const result = await source.run(identity, fetchImpl);
      rowsBySourceLabel.set(source.label, result.rows);
      allRows.push(...result.rows);
    } catch (err) {
      const message = messageOf(err);
      failedSourceLabels.set(source.label, message);
      sourceErrors.push({ label: source.label, message });
    }
  }

  /**
   * Rows for a source that returned successfully — 0 rows for a source that never ran
   * would be a false pass for a "zero/none present" check, so callers that assert a
   * count of exactly zero must use this, not a bare `?? []` off rowsBySourceLabel.
   */
  function rowsForOrFail(label: string, checkLabel: string): RecordRow[] | null {
    const failure = failedSourceLabels.get(label);
    if (failure) {
      check(checkLabel, false, `"${label}" source failed to fetch: ${failure}`);
      return null;
    }
    return rowsBySourceLabel.get(label) ?? [];
  }

  // --- Parcel resolution ---
  check(
    'parcel resolves to 2102098000',
    resolutionError === null && identity.parcelId === LANARK_FIXTURE.parcelId,
    resolutionError === null ? `got ${identity.parcelId}` : `parcel resolution failed: ${resolutionError}`,
  );

  // --- Assessment (FY2026 + history) ---
  const assessments = assessmentRows(allRows);
  const fy2026 = assessments.find((a) => a.fiscalYear === 'FY2026') ?? null;

  check(
    'FY2026 owner matches /LANARK ROAD LLC/',
    fy2026 !== null && fy2026.owner !== null && /LANARK ROAD LLC/.test(fy2026.owner),
    `got owner=${JSON.stringify(fy2026?.owner ?? null)}`,
  );
  check(
    'FY2026 mailStreet is PO BOX 35006',
    fy2026?.mailStreet === 'PO BOX 35006',
    `got mailStreet=${JSON.stringify(fy2026?.mailStreet ?? null)}`,
  );
  check('FY2026 landUse is A', fy2026?.landUse === 'A', `got landUse=${JSON.stringify(fy2026?.landUse ?? null)}`);
  check(
    'FY2026 yearRemodel is 1980',
    fy2026?.yearRemodel === 1980,
    `got yearRemodel=${JSON.stringify(fy2026?.yearRemodel ?? null)}`,
  );
  check(
    'FY2026 totalValue is 6720200',
    fy2026?.totalValue === 6720200,
    `got totalValue=${JSON.stringify(fy2026?.totalValue ?? null)}`,
  );

  const fiscalYearsPresent = new Set(assessments.map((a) => a.fiscalYear));
  const allHaveTotalValue = assessments.length > 0 && assessments.every((a) => a.totalValue != null);
  check(
    'six assessment years present, each with a non-null totalValue',
    fiscalYearsPresent.size === 6 && assessments.length === 6 && allHaveTotalValue,
    `got ${assessments.length} rows across years [${Array.from(fiscalYearsPresent).sort().join(', ')}]`,
  );

  // --- Permits ---
  const permitRows = rowsForOrFail('Approved Building Permits', 'zero permits');
  if (permitRows !== null) {
    check('zero permits', permitRows.length === 0, `got ${permitRows.length} rows`);
  }

  // --- Violations ---
  const violationRows = rowsForOrFail('Building and Property Violations', 'no ISD violations');
  if (violationRows !== null) {
    check('no ISD violations', violationRows.length === 0, `got ${violationRows.length} rows`);
  }

  // --- Enforcement ---
  const enforcement = enforcementRows(allRows);
  const distinctCaseNumbers = new Set(enforcement.map((e) => e.caseNumber));
  const allStatusDate2008 = enforcement.length > 0 && enforcement.every((e) => e.statusDate?.startsWith('2008') === true);
  const allContact1505 = enforcement.length > 0 && enforcement.every((e) => e.contactAddress !== null && /1505 COMMONWEALTH/.test(e.contactAddress));

  check(
    'enforcement: two distinct case numbers',
    distinctCaseNumbers.size === 2,
    `got ${distinctCaseNumbers.size} distinct case numbers (${Array.from(distinctCaseNumbers).join(', ')}), ${enforcement.length} rows`,
  );
  check(
    'enforcement: every row statusDate starts with 2008',
    allStatusDate2008,
    `got statusDates=${JSON.stringify(enforcement.map((e) => e.statusDate))}`,
  );
  check(
    'enforcement: every row contactAddress matches /1505 COMMONWEALTH/',
    allContact1505,
    `got contactAddresses=${JSON.stringify(enforcement.map((e) => e.contactAddress))}`,
  );

  // --- 311 service requests ---
  const serviceRequestsFailure = failedSourceLabels.get('311 Service Requests');
  const serviceRequests = serviceRequestRows(allRows);
  const housingCount = serviceRequests.filter((r) => r.classification === 'housing').length;
  const serviceRequestsSuffix = serviceRequestsFailure ? ` ("311 Service Requests" source failed to fetch: ${serviceRequestsFailure})` : '';
  check(
    '311 total >= 90',
    serviceRequests.length >= 90,
    `got ${serviceRequests.length} rows${serviceRequestsSuffix}`,
  );
  check(
    '311 housing count between 3 and 8',
    housingCount >= 3 && housingCount <= 8,
    `got ${housingCount} housing rows out of ${serviceRequests.length}${serviceRequestsSuffix}`,
  );

  // --- RentSmart ---
  const rentsmartRows = rowsBySourceLabel.get('RentSmart') ?? [];
  check('RentSmart rows present', rentsmartRows.length > 0, `got ${rentsmartRows.length} rows`);

  // --- SAM address points ---
  // SAM is the seed's coordinate, neighborhood, and zip source (src/lib/records/seed/sam.ts).
  // It is not one of the sourcesForCity adapters, so it is fetched here directly, filtered to
  // the fixture parcel so this is one request rather than the 400,000-row bulk download.
  // Having no source entry to fail into, a throw here becomes this check's detail rather
  // than a sourceErrors row — counted once either way.
  let samOk = false;
  let samDetail: string;
  try {
    const samRows = await fetchAllRows<SamRow>(
      SAM_RESOURCE_ID,
      { fields: [...SAM_FIELDS], filters: { PARCEL_ID: LANARK_FIXTURE.parcelId } },
      fetchImpl,
    );
    const samPoint = indexSamByParcel(samRows).get(LANARK_FIXTURE.parcelId);
    samOk = samPoint?.samId === '83763'
      && samPoint.neighborhood === 'Brighton'
      && samPoint.latitude > 42.2
      && samPoint.latitude < 42.4
      && samPoint.longitude > -71.2
      && samPoint.longitude < -70.9;
    samDetail = `got ${JSON.stringify(samPoint ?? null)} from ${samRows.length} SAM rows`;
  } catch (err) {
    samDetail = `SAM fetch failed: ${messageOf(err)}`;
  }
  check('SAM primary point for Lanark: id 83763, Brighton, inside Boston', samOk, samDetail);

  const failures = checks.filter((c) => !c.ok).length + sourceErrors.length;
  return { checks, failures, sourceErrors, parcelId: identity.parcelId };
}
