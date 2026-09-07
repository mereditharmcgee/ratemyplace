// CKAN's SQL endpoint has no parameter binding, so this module is the repo's documented
// exception to "parameterized queries always" (see AGENTS.md). The invariant that keeps
// it safe: every interpolated value passes through `sqlLiteral`/`addressLikeClauses` or a
// digits-only guard, and every identifier (table/column name) is a code constant, never
// user input.
import { addressLikeClauses, ckanSql, parseMoney, ROW_CAP, sqlLiteral } from '../../ckan';
import type { PermitPayload, RecordSource, SourceResult } from '../../types';

export const PERMITS_RESOURCE_ID = '6ddcd912-32a0-43df-9908-63574f8c7e77';
export const PERMITS_PAGE_URL = 'https://data.boston.gov/dataset/approved-building-permits';
/** Earliest issued_date in the dataset (metadata says 2009; the data goes back to 2006). */
export const PERMIT_COVERAGE_START = 'September 2006';

type Row = Record<string, string | number | null>;

// parcel_id is not selected: it is used only in the WHERE clause filter, and PermitPayload
// has no field for it, so selecting it would make the "no parcel" query always mention it.
const COLUMNS = ['permitnumber', 'worktype', 'permittypedescr', 'description', 'comments', 'applicant', 'declared_valuation', 'total_fees', 'issued_date', 'expiration_date', 'status', 'occupancytype', 'address'];

function str(v: string | number | null | undefined): string | null {
  return v == null || String(v).trim() === '' ? null : String(v).trim();
}

export const permitsSource: RecordSource = {
  id: PERMITS_RESOURCE_ID,
  label: 'Approved Building Permits',
  pageUrl: PERMITS_PAGE_URL,
  kinds: ['permit'],
  async run(identity, fetchImpl): Promise<SourceResult> {
    const addressClauses = addressLikeClauses('address', identity);
    // Qualifying the address arm by zip is why a Center St in one Boston neighborhood
    // does not attach permits filed against a same-named Center St in another.
    const addressArm =
      identity.zip && /^\d{5}$/.test(identity.zip)
        ? `(("zip" IS NULL OR "zip" = ${sqlLiteral(identity.zip)}) AND (${addressClauses.join(' OR ')}))`
        : `(${addressClauses.join(' OR ')})`;
    const clauses = [addressArm];
    if (identity.parcelNumeric && /^\d+$/.test(identity.parcelNumeric)) {
      // parcel_id is a numeric column in this resource (verified live), unlike the
      // assessor's text PID column, so it is interpolated unquoted after the digits-only guard.
      clauses.unshift(`"parcel_id" = ${identity.parcelNumeric}`);
    }
    const sql =
      `SELECT ${COLUMNS.map((c) => `"${c}"`).join(',')} FROM "${PERMITS_RESOURCE_ID}" ` +
      // The cap is applied (by ckanSql, via ROW_CAP) before dedupe below, so the tiebreak
      // order here determines which rows survive the cap and which duplicate survives dedupe.
      `WHERE ${clauses.join(' OR ')} ORDER BY "issued_date" DESC, "permitnumber", "_id" LIMIT ${ROW_CAP}`;
    const rows = await ckanSql<Row>(sql, fetchImpl);
    const seen = new Set<string>();
    const out: SourceResult['rows'] = [];
    for (const row of rows) {
      const permitNumber = str(row.permitnumber);
      if (!permitNumber || seen.has(permitNumber)) continue;
      seen.add(permitNumber);
      const payload: PermitPayload = {
        permitNumber,
        workType: str(row.worktype),
        permitType: str(row.permittypedescr),
        description: str(row.description),
        comments: str(row.comments),
        applicant: str(row.applicant),
        declaredValuation: parseMoney(row.declared_valuation),
        totalFees: parseMoney(row.total_fees),
        issuedDate: str(row.issued_date),
        expirationDate: str(row.expiration_date),
        status: str(row.status),
        occupancyType: str(row.occupancytype),
        address: str(row.address),
      };
      out.push({ kind: 'permit', sourceKey: permitNumber, payload, sourceUrl: PERMITS_PAGE_URL });
    }
    return { query: sql, rows: out };
  },
};
