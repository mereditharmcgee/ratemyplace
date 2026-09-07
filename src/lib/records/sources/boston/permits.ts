import { ckanSql, parseMoney, sqlLiteral } from '../../ckan';
import { escapeLikePattern } from '../../../validation';
import type { BuildingIdentity, PermitPayload, RecordSource, SourceResult } from '../../types';

export const PERMITS_RESOURCE_ID = '6ddcd912-32a0-43df-9908-63574f8c7e77';
export const PERMITS_PAGE_URL = 'https://data.boston.gov/dataset/approved-building-permits';
/** Earliest issued_date in the dataset (metadata says 2009; the data goes back to 2006). */
export const PERMIT_COVERAGE_START = 'September 2006';

type Row = Record<string, string | number | null>;

// parcel_id is not selected: it is used only in the WHERE clause filter, and PermitPayload
// has no field for it, so selecting it would make the "no parcel" query always mention it.
const COLUMNS = ['permitnumber', 'worktype', 'permittypedescr', 'description', 'comments', 'applicant', 'declared_valuation', 'total_fees', 'issued_date', 'expiration_date', 'status', 'occupancytype', 'address'];

/** `upper("col") LIKE '<form>%' ESCAPE '\'` for every short and long address form. */
export function addressLikeClauses(column: string, identity: BuildingIdentity): string[] {
  const forms = Array.from(new Set([...identity.addressFormsShort, ...identity.addressFormsLong]));
  return forms.map((f) => `upper("${column}") LIKE ${sqlLiteral(`${escapeLikePattern(f)}%`)} ESCAPE '\\'`);
}

function str(v: string | number | null | undefined): string | null {
  return v == null || String(v).trim() === '' ? null : String(v).trim();
}

export const permitsSource: RecordSource = {
  id: PERMITS_RESOURCE_ID,
  label: 'Approved Building Permits',
  pageUrl: PERMITS_PAGE_URL,
  kinds: ['permit'],
  async run(identity, fetchImpl): Promise<SourceResult> {
    const clauses = addressLikeClauses('address', identity);
    if (identity.parcelNumeric && /^\d+$/.test(identity.parcelNumeric)) {
      clauses.unshift(`"parcel_id" = ${identity.parcelNumeric}`);
    }
    const sql =
      `SELECT ${COLUMNS.map((c) => `"${c}"`).join(',')} FROM "${PERMITS_RESOURCE_ID}" ` +
      `WHERE ${clauses.join(' OR ')} ORDER BY "issued_date" DESC LIMIT 500`;
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
        declaredValuation: parseMoney(str(row.declared_valuation)),
        totalFees: parseMoney(str(row.total_fees)),
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
