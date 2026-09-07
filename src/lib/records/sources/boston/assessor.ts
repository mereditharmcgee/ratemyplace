import { ckanSql, parseIntOrNull, parseMoney, sqlLiteral } from '../../ckan';
import { toCanonicalParcel } from '../../identity';
import { SourceError, type AssessmentPayload, type BuildingIdentity, type FetchLike, type RecordSource, type SourceResult } from '../../types';

export const FY2026_RESOURCE_ID = 'ee73430d-96c0-423e-ad21-c4cfb54c8961';
export const ASSESSOR_PAGE_URL = 'https://data.boston.gov/dataset/property-assessment';

/** Column names that drift between fiscal years. Fixed columns are referenced directly. */
export interface AssessorColumns {
  mailAddressee: string | null;
  mailStreet: string | null;
  /** FY2023 only: one combined "OWNER MAIL ADDRESS" column. */
  mailCombined: string | null;
  mailCity: string | null;
  mailState: string | null;
  mailZip: string | null;
}

export interface AssessorYear {
  fiscalYear: string;
  resourceId: string;
  columns: AssessorColumns;
}

const MODERN: AssessorColumns = {
  mailAddressee: 'MAIL_ADDRESSEE', mailStreet: 'MAIL_STREET_ADDRESS', mailCombined: null,
  mailCity: 'MAIL_CITY', mailState: 'MAIL_STATE', mailZip: 'MAIL_ZIP_CODE',
};
const FY2023: AssessorColumns = {
  mailAddressee: null, mailStreet: null, mailCombined: 'OWNER MAIL ADDRESS',
  mailCity: null, mailState: null, mailZip: null,
};
const LEGACY: AssessorColumns = {
  mailAddressee: 'MAIL_ADDRESSEE', mailStreet: 'MAIL_ADDRESS', mailCombined: null,
  mailCity: 'MAIL_CITY', mailState: 'MAIL_STATE', mailZip: 'MAIL_ZIPCODE',
};

/** Newest first. The first entry is the current year and resolves parcels. */
export const ASSESSOR_YEARS: AssessorYear[] = [
  { fiscalYear: 'FY2026', resourceId: FY2026_RESOURCE_ID, columns: MODERN },
  { fiscalYear: 'FY2025', resourceId: '6b7e460e-33f6-4e61-80bc-1bef2e73ac54', columns: MODERN },
  { fiscalYear: 'FY2024', resourceId: 'a9eb19ad-da79-4f7b-9e3b-6b13e66f8285', columns: MODERN },
  { fiscalYear: 'FY2023', resourceId: '1000d81c-5bb5-49e8-a9ab-44cd042f1db2', columns: FY2023 },
  { fiscalYear: 'FY2022', resourceId: '4b99718b-d064-471b-9b24-517ae5effecc', columns: LEGACY },
  { fiscalYear: 'FY2021', resourceId: 'c4b7331e-e213-45a5-adda-052e4dd31d41', columns: LEGACY },
];

type Row = Record<string, string | null>;

const FIXED_COLUMNS = ['PID', 'OWNER', 'LU', 'LU_DESC', 'YR_BUILT', 'YR_REMODEL', 'GROSS_AREA', 'LIVING_AREA', 'RES_UNITS', 'COM_UNITS', 'TOTAL_VALUE', 'LAND_VALUE', 'BLDG_VALUE'];

function selectList(columns: AssessorColumns): string {
  const names = [...FIXED_COLUMNS, ...Object.values(columns).filter((c): c is string => Boolean(c))];
  return names.map((c) => `"${c}"`).join(',');
}

function parcelInList(identity: BuildingIdentity): string {
  const forms = Array.from(new Set([identity.parcelId, identity.parcelNumeric].filter((p): p is string => Boolean(p))));
  return forms.map(sqlLiteral).join(',');
}

function inList(values: string[]): string {
  return values.map(sqlLiteral).join(',');
}

export interface ParcelResolution {
  parcelId: string | null;
  condominium: boolean;
  candidates: number;
}

/**
 * Resolve a street address to a parcel using the current fiscal year.
 * One whole-building row (LU not CD/CM) wins. Only CD/CM rows means a condominium.
 * Several whole-building rows is ambiguous: no parcel, caller reports the count.
 */
export async function resolveParcel(identity: BuildingIdentity, fetchImpl: FetchLike): Promise<ParcelResolution> {
  const numberForms = identity.rangeForm ? [...identity.numbers, identity.rangeForm] : identity.numbers;
  const sql =
    `SELECT "PID","ST_NUM","ST_NUM2","ST_NAME","LU","OWNER" FROM "${FY2026_RESOURCE_ID}" ` +
    `WHERE upper("ST_NAME") = ${sqlLiteral(identity.streetShort)} ` +
    `AND ("ST_NUM" IN (${inList(numberForms)}) OR "ST_NUM2" IN (${inList(identity.numbers)})) LIMIT 100`;
  const rows = await ckanSql<Row>(sql, fetchImpl);
  const whole = rows.filter((r) => r.LU !== 'CD' && r.LU !== 'CM');
  if (whole.length === 1) {
    return { parcelId: toCanonicalParcel(whole[0].PID), condominium: false, candidates: 1 };
  }
  if (whole.length === 0 && rows.length > 0) {
    return { parcelId: null, condominium: true, candidates: rows.length };
  }
  return { parcelId: null, condominium: false, candidates: whole.length };
}

function condominiumPayload(fiscalYear: string): AssessmentPayload {
  return {
    fiscalYear, parcelId: null, owner: null, mailAddressee: null, mailStreet: null, mailCity: null, mailState: null, mailZip: null,
    landUse: 'CD', landUseDescription: 'CONDOMINIUM', yearBuilt: null, yearRemodel: null, grossArea: null, livingArea: null,
    residentialUnits: null, commercialUnits: null, totalValue: null, landValue: null, buildingValue: null, condominium: true,
  };
}

function mapRow(row: Row, year: AssessorYear): AssessmentPayload {
  const c = year.columns;
  const pick = (col: string | null): string | null => (col && row[col] != null && String(row[col]).trim() !== '' ? String(row[col]).trim() : null);
  let mailStreet = pick(c.mailStreet);
  let mailCity = pick(c.mailCity);
  let mailState = pick(c.mailState);
  let mailZip = pick(c.mailZip);
  if (c.mailCombined) {
    // "PO BOX 35006 C/O ATT DENNIS CLAIR, BOSTON, MA 02135"
    const combined = pick(c.mailCombined) ?? '';
    const parts = combined.split(',').map((p) => p.trim());
    mailStreet = parts[0] || null;
    mailCity = parts[1] || null;
    const stateZip = (parts[2] ?? '').split(/\s+/);
    mailState = stateZip[0] || null;
    mailZip = stateZip[1] || null;
  }
  return {
    fiscalYear: year.fiscalYear,
    parcelId: toCanonicalParcel(row.PID),
    owner: pick('OWNER'),
    mailAddressee: pick(c.mailAddressee),
    mailStreet, mailCity, mailState, mailZip,
    landUse: pick('LU'),
    landUseDescription: pick('LU_DESC'),
    yearBuilt: parseIntOrNull(row.YR_BUILT),
    yearRemodel: parseIntOrNull(row.YR_REMODEL),
    grossArea: parseIntOrNull(row.GROSS_AREA),
    livingArea: parseIntOrNull(row.LIVING_AREA),
    residentialUnits: parseIntOrNull(row.RES_UNITS),
    commercialUnits: parseIntOrNull(row.COM_UNITS),
    totalValue: parseMoney(row.TOTAL_VALUE),
    landValue: parseMoney(row.LAND_VALUE),
    buildingValue: parseMoney(row.BLDG_VALUE),
    condominium: false,
  };
}

export function assessorSource(year: AssessorYear): RecordSource {
  const isCurrent = year.fiscalYear === ASSESSOR_YEARS[0].fiscalYear;
  return {
    id: year.resourceId,
    label: `Property Assessment ${year.fiscalYear}`,
    pageUrl: ASSESSOR_PAGE_URL,
    kinds: ['assessment'],
    ownsSourceKey: year.fiscalYear,
    async run(identity, fetchImpl): Promise<SourceResult> {
      if (!identity.parcelId) {
        if (identity.condominium) {
          return isCurrent
            ? { query: 'condominium: no parcel query', rows: [{ kind: 'assessment', sourceKey: year.fiscalYear, payload: condominiumPayload(year.fiscalYear), sourceUrl: ASSESSOR_PAGE_URL }] }
            : { query: 'condominium: history skipped', rows: [] };
        }
        throw new SourceError('Parcel not resolved for this building', 'no query');
      }
      const sql = `SELECT ${selectList(year.columns)} FROM "${year.resourceId}" WHERE "PID" IN (${parcelInList(identity)}) LIMIT 5`;
      let rows: Row[];
      try {
        rows = await ckanSql<Row>(sql, fetchImpl);
      } catch (err) {
        if (err instanceof SourceError && /column .* does not exist/i.test(err.message)) {
          return { query: sql, rows: [] };
        }
        throw err;
      }
      return {
        query: sql,
        rows: rows.slice(0, 1).map((row) => ({
          kind: 'assessment' as const,
          sourceKey: year.fiscalYear,
          payload: mapRow(row, year),
          sourceUrl: ASSESSOR_PAGE_URL,
        })),
      };
    },
  };
}
