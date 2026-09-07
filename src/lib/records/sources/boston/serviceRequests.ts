// CKAN's SQL endpoint has no parameter binding, so this module is the repo's documented
// exception to "parameterized queries always" (see AGENTS.md). The invariant that keeps
// it safe: every interpolated value passes through `sqlLiteral`/`addressLikeClauses`, and
// every identifier (table/column name) is a code constant, never user input.
//
// Boston's 311 data ships as two incompatible systems glued together on the dataset page:
// sixteen year-sliced "legacy" resources (2011-2026, one schema, address stored as free
// text in `location`) and one "new" resource (`case_id` like `BCS-00243666`, address split
// into `street_number`/`street_name`/`zip_code`). This source runs one query per legacy
// year plus one new-system query - 17 queries total - and unions the results. Any single
// query failing throws (via ckanSql's SourceError) and fails the whole source, so a failed
// query -- a transient CKAN outage, but also a legacy resource id CKAN has retired, which
// is permanent, not transient -- leaves the building's stored rows untouched rather than
// replacing them with a partial 311 history. A retired resource id surfaces as an error on
// every pull until someone fixes it by updating LEGACY_311_RESOURCES; it will not clear on
// its own.
import { addressLikeClauses, ckanSql, ROW_CAP, sqlLiteral, textOrNull } from '../../ckan';
import type { RecordRow, RecordSource, ServiceRequestClassification, ServiceRequestPayload, SourceResult } from '../../types';

export const NEW_311_RESOURCE_ID = '254adca6-64ab-4c5c-9fc0-a6da622be185';
export const SERVICE_REQUESTS_PAGE_URL = 'https://data.boston.gov/dataset/311-service-requests';

export interface Legacy311Resource {
  year: number;
  resourceId: string;
}

/** Newest first. One resource per calendar year, all sharing the same schema. */
export const LEGACY_311_RESOURCES: Legacy311Resource[] = [
  { year: 2026, resourceId: '1a0b420d-99f1-4887-9851-990b2a5a6e17' },
  { year: 2025, resourceId: '9d7c2214-4709-478a-a2e8-fb2020a5bb94' },
  { year: 2024, resourceId: 'dff4d804-5031-443a-8409-8344efd0e5c8' },
  { year: 2023, resourceId: 'e6013a93-1321-4f2a-bf91-8d8a02f1e62f' },
  { year: 2022, resourceId: '81a7b022-f8fc-4da5-80e4-b160058ca207' },
  { year: 2021, resourceId: 'f53ebccd-bc61-49f9-83db-625f209c95f5' },
  { year: 2020, resourceId: '6ff6a6fd-3141-4440-a880-6f60a37fe789' },
  { year: 2019, resourceId: 'ea2e4696-4a2d-429c-9807-d02eb92e0222' },
  { year: 2018, resourceId: '2be28d90-3a90-4af1-a3f6-f28c1e25880a' },
  { year: 2017, resourceId: '30022137-709d-465e-baae-ca155b51927d' },
  { year: 2016, resourceId: 'b7ea6b1b-3ca4-4c5b-9713-6dc1db52379a' },
  { year: 2015, resourceId: 'c9509ab4-6f6d-4b97-979a-0cf2a10c922b' },
  { year: 2014, resourceId: 'bdae89c8-d4ce-40e9-a6e1-a5203953a2e0' },
  { year: 2013, resourceId: '407c5cd0-f764-4a41-adf8-054ff535049e' },
  { year: 2012, resourceId: '382e10d9-1864-40ba-bef6-4eea3c75463c' },
  { year: 2011, resourceId: '94b499d9-712a-4d2a-b790-7ceec5c9c4b1' },
];

/**
 * Legacy `reason` values that classify a case as "housing" (about the building itself)
 * rather than "other" (the street or public realm). Verified live 2026-09-06/07 against
 * each reason's `type` breakdown:
 *  - "Housing" -> Unsatisfactory Living Conditions, Pest Infestation, Heat, Maintenance
 *    Complaint, Mice, Short Term Rental, Chronic Dampness/Mold, Unsatisfactory Utilities.
 *  - "Building" -> Work w/out Permit, Contractors Complaint, Working Beyond Hours, Building
 *    Inspection Request, Electrical, Unsafe Dangerous Conditions, Protection of Adjoining
 *    Property, Maintenance - Homeowner.
 *  - "Code Enforcement" -> by 2024 volume, dominated by Improper Storage of Trash
 *    (Barrels) (20,460), Poor Conditions of Property (8,776), Unshoveled Sidewalk (3,801)
 *    and Illegal Dumping (3,007), plus Illegal Vending, Parking on Front/Back Yards,
 *    Construction Debris, and Illegal Posting of Signs. So most "Code Enforcement" rows
 *    are trash-barrel and sidewalk complaints about the property's exterior, not the
 *    interior conditions "Housing"/"Building" describe. Including it here anyway is a
 *    published product decision, not an oversight -- revisit in sub-project D.
 */
export const HOUSING_REASONS: readonly string[] = ['Housing', 'Building', 'Code Enforcement'];

/** New-system `assigned_department` prefix that means the same thing for that schema. */
export const HOUSING_DEPARTMENT_PREFIX = 'Inspectional Services';

export function classifyLegacy(reason: string | null): ServiceRequestClassification {
  return reason != null && HOUSING_REASONS.includes(reason) ? 'housing' : 'other';
}

export function classifyNew(department: string | null): ServiceRequestClassification {
  return department != null && department.startsWith(HOUSING_DEPARTMENT_PREFIX) ? 'housing' : 'other';
}

type Row = Record<string, string | number | null>;

const LEGACY_COLUMNS = [
  'case_enquiry_id', 'open_dt', 'closed_dt', 'case_status', 'closure_reason',
  'case_title', 'subject', 'reason', 'type', 'location', 'source',
];

// street_name, street_number, and zip_code drive the WHERE clause only; ServiceRequestPayload
// has no field for them (mirrors permits.ts not selecting parcel_id for the same reason).
const NEW_COLUMNS = [
  'case_id', 'open_date', 'close_date', 'case_status', 'closure_reason',
  'case_topic', 'assigned_department', 'service_name', 'full_address', 'report_source',
];

function mapLegacyRow(row: Row): ServiceRequestPayload | null {
  const caseId = textOrNull(row.case_enquiry_id);
  if (!caseId) return null;
  const reason = textOrNull(row.reason);
  return {
    caseId,
    system: 'legacy',
    openedAt: textOrNull(row.open_dt),
    closedAt: textOrNull(row.closed_dt),
    status: textOrNull(row.case_status),
    closureReason: textOrNull(row.closure_reason),
    title: textOrNull(row.case_title),
    subject: textOrNull(row.subject),
    reason,
    type: textOrNull(row.type),
    location: textOrNull(row.location),
    source: textOrNull(row.source),
    classification: classifyLegacy(reason),
  };
}

function mapNewRow(row: Row): ServiceRequestPayload | null {
  const caseId = textOrNull(row.case_id);
  if (!caseId) return null;
  const department = textOrNull(row.assigned_department);
  return {
    caseId,
    system: 'new',
    openedAt: textOrNull(row.open_date),
    closedAt: textOrNull(row.close_date),
    status: textOrNull(row.case_status),
    closureReason: textOrNull(row.closure_reason),
    title: textOrNull(row.case_topic),
    subject: department,
    reason: department,
    type: textOrNull(row.service_name),
    location: textOrNull(row.full_address),
    source: textOrNull(row.report_source),
    classification: classifyNew(department),
  };
}

export const serviceRequestsSource: RecordSource = {
  id: NEW_311_RESOURCE_ID,
  label: '311 Service Requests',
  pageUrl: SERVICE_REQUESTS_PAGE_URL,
  kinds: ['service_request'],
  async run(identity, fetchImpl): Promise<SourceResult> {
    const zip = identity.zip;
    const zipOk = zip != null && /^\d{5}$/.test(zip);
    const addressClauses = addressLikeClauses('location', identity);
    // Qualifying by zip is why a same-named street in one neighborhood does not attach
    // 311 cases filed against a same-named street elsewhere in the city (see permits.ts).
    const legacyWhere = zipOk
      ? `(("location_zipcode" IS NULL OR "location_zipcode" = ${sqlLiteral(zip)}) AND (${addressClauses.join(' OR ')}))`
      : `(${addressClauses.join(' OR ')})`;

    const numberForms = identity.rangeForm ? [...identity.numbers, identity.rangeForm] : identity.numbers;
    // upper() on street_number matches the upper() on street_name above; the new-system
    // street_number and zip_code columns are both text (verified live 2026-09-06/07).
    const newWhere =
      `upper("street_name") IN (${identity.streetForms.map(sqlLiteral).join(',')}) ` +
      `AND upper("street_number") IN (${numberForms.map(sqlLiteral).join(',')})` +
      (zipOk ? ` AND ("zip_code" IS NULL OR "zip_code" = ${sqlLiteral(zip)})` : '');

    const queries: string[] = [];
    const seen = new Set<string>();
    const rows: RecordRow[] = [];

    for (const { resourceId } of LEGACY_311_RESOURCES) {
      const sql =
        `SELECT ${LEGACY_COLUMNS.map((c) => `"${c}"`).join(',')} FROM "${resourceId}" ` +
        // This LIMIT is ckanSql's per-query cap on this one year's result set, applied
        // before dedupe below -- it is not the per-source cap applied to the unioned,
        // deduped, sorted rows at the end of run() (see the comment there). The ORDER BY
        // here only matters if a single year alone returns more than ROW_CAP rows.
        `WHERE ${legacyWhere} ORDER BY "open_dt" DESC, "case_enquiry_id" LIMIT ${ROW_CAP}`;
      queries.push(sql);
      const legacyRows = await ckanSql<Row>(sql, fetchImpl);
      for (const row of legacyRows) {
        const payload = mapLegacyRow(row);
        if (!payload || seen.has(payload.caseId)) continue;
        seen.add(payload.caseId);
        rows.push({ kind: 'service_request', sourceKey: payload.caseId, payload, sourceUrl: SERVICE_REQUESTS_PAGE_URL });
      }
    }

    const newSql =
      `SELECT ${NEW_COLUMNS.map((c) => `"${c}"`).join(',')} FROM "${NEW_311_RESOURCE_ID}" ` +
      `WHERE ${newWhere} ORDER BY "open_date" DESC, "case_id" LIMIT ${ROW_CAP}`;
    queries.push(newSql);
    const newRows = await ckanSql<Row>(newSql, fetchImpl);
    for (const row of newRows) {
      const payload = mapNewRow(row);
      if (!payload || seen.has(payload.caseId)) continue;
      seen.add(payload.caseId);
      rows.push({ kind: 'service_request', sourceKey: payload.caseId, payload, sourceUrl: SERVICE_REQUESTS_PAGE_URL });
    }

    // Per-source cap applied after cross-query dedupe, on top of each query's own ROW_CAP
    // limit above. Sort newest-first by openedAt (string compare; rows with no openedAt
    // sort last) before slicing so that, when dedupe still leaves more than ROW_CAP distinct
    // rows, the ones truncated are the oldest rather than whichever a query happened to
    // return first. The truncation itself is invisible downstream: a rowCount of exactly
    // ROW_CAP looks identical to a building that happens to have exactly 500 rows. The
    // admin panel is expected to render "500+" whenever rowCount === ROW_CAP.
    rows.sort((a, b) => {
      const openedA = (a.payload as ServiceRequestPayload).openedAt;
      const openedB = (b.payload as ServiceRequestPayload).openedAt;
      if (openedA === openedB) return 0;
      if (openedA == null) return 1;
      if (openedB == null) return -1;
      return openedA < openedB ? 1 : -1;
    });
    return { query: JSON.stringify(queries), rows: rows.slice(0, ROW_CAP) };
  },
};
