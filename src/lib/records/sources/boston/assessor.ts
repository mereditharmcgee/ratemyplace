import { ckanSql, parseIntOrNull, parseMoney, sqlLiteral } from '../../ckan';
import { toCanonicalParcel } from '../../identity';
import { NO_QUERY, SourceError, type AssessmentPayload, type BuildingIdentity, type FetchLike, type RecordSource, type SourceResult } from '../../types';

export const FY2026_RESOURCE_ID = 'ee73430d-96c0-423e-ad21-c4cfb54c8961';
export const ASSESSOR_PAGE_URL = 'https://data.boston.gov/dataset/property-assessment';

/** Owner-mail column names, the only ones that drift between fiscal years. Fixed columns are referenced directly. */
export interface MailColumnMap {
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
  columns: MailColumnMap;
}

const MODERN_COLUMNS: MailColumnMap = {
  mailAddressee: 'MAIL_ADDRESSEE', mailStreet: 'MAIL_STREET_ADDRESS', mailCombined: null,
  mailCity: 'MAIL_CITY', mailState: 'MAIL_STATE', mailZip: 'MAIL_ZIP_CODE',
};
const FY2023_COLUMNS: MailColumnMap = {
  mailAddressee: null, mailStreet: null, mailCombined: 'OWNER MAIL ADDRESS',
  mailCity: null, mailState: null, mailZip: null,
};
const LEGACY_COLUMNS: MailColumnMap = {
  mailAddressee: 'MAIL_ADDRESSEE', mailStreet: 'MAIL_ADDRESS', mailCombined: null,
  mailCity: 'MAIL_CITY', mailState: 'MAIL_STATE', mailZip: 'MAIL_ZIPCODE',
};

/** Newest first. The first entry is the current year and resolves parcels. */
export const ASSESSOR_YEARS: AssessorYear[] = [
  { fiscalYear: 'FY2026', resourceId: FY2026_RESOURCE_ID, columns: MODERN_COLUMNS },
  { fiscalYear: 'FY2025', resourceId: '6b7e460e-33f6-4e61-80bc-1bef2e73ac54', columns: MODERN_COLUMNS },
  { fiscalYear: 'FY2024', resourceId: 'a9eb19ad-da79-4f7b-9e3b-6b13e66f8285', columns: MODERN_COLUMNS },
  { fiscalYear: 'FY2023', resourceId: '1000d81c-5bb5-49e8-a9ab-44cd042f1db2', columns: FY2023_COLUMNS },
  { fiscalYear: 'FY2022', resourceId: '4b99718b-d064-471b-9b24-517ae5effecc', columns: LEGACY_COLUMNS },
  { fiscalYear: 'FY2021', resourceId: 'c4b7331e-e213-45a5-adda-052e4dd31d41', columns: LEGACY_COLUMNS },
];

/** CKAN returns strings for most columns but numbers for some; nothing here may assume which. */
type Row = Record<string, unknown>;

const FIXED_COLUMNS = ['PID', 'OWNER', 'LU', 'LU_DESC', 'YR_BUILT', 'YR_REMODEL', 'GROSS_AREA', 'LIVING_AREA', 'RES_UNITS', 'COM_UNITS', 'TOTAL_VALUE', 'LAND_VALUE', 'BLDG_VALUE'];

function selectList(columns: MailColumnMap): string {
  const names = [...FIXED_COLUMNS, ...Object.values(columns).filter((c): c is string => Boolean(c))];
  return names.map((c) => `"${c}"`).join(',');
}

function parcelLiterals(identity: BuildingIdentity): string {
  const forms = Array.from(new Set([identity.parcelId, identity.parcelNumeric].filter((p): p is string => Boolean(p))));
  return forms.map(sqlLiteral).join(',');
}

function inList(values: string[]): string {
  return values.map(sqlLiteral).join(',');
}

/** Trim to a non-empty string, or null. Accepts whatever CKAN put in the column. */
function text(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

export interface ParcelResolution {
  parcelId: string | null;
  condominium: boolean;
  /** Distinct whole-building parcels that matched (LU not CD/CM). */
  wholeBuildingParcels: number;
  /** Condominium unit/master rows at the address. */
  condoRows: number;
}

/** upper("ST_NAME") against every known spelling, and the number on either street-number column. */
function addressPredicate(identity: BuildingIdentity): string {
  const numberForms = identity.rangeForm ? [...identity.numbers, identity.rangeForm] : identity.numbers;
  return (
    `upper("ST_NAME") IN (${inList(identity.streetForms)}) ` +
    `AND ("ST_NUM" IN (${inList(numberForms)}) OR "ST_NUM2" IN (${inList(identity.numbers)}))`
  );
}

/**
 * Resolve a street address to a parcel using the current fiscal year.
 * One distinct whole-building parcel wins — several rows for one parcel (a BLDG_SEQ
 * per building on the lot) is still one parcel. Several distinct parcels is ambiguous:
 * no parcel, caller reports the count. Only when nothing whole-building matched do we
 * pay for a second query to see whether the address is a condominium.
 */
export async function resolveParcel(identity: BuildingIdentity, fetchImpl: FetchLike): Promise<ParcelResolution> {
  const resourceId = ASSESSOR_YEARS[0].resourceId;
  const where = addressPredicate(identity);

  const sql = `SELECT "PID" FROM "${resourceId}" WHERE ${where} AND "LU" NOT IN ('CD','CM') LIMIT 10`;
  const rows = await ckanSql<Row>(sql, fetchImpl);
  const parcels = Array.from(
    new Set(rows.map((r) => toCanonicalParcel(text(r.PID))).filter((p): p is string => p !== null)),
  );
  if (parcels.length === 1) {
    return { parcelId: parcels[0], condominium: false, wholeBuildingParcels: 1, condoRows: 0 };
  }
  if (parcels.length > 1) {
    return { parcelId: null, condominium: false, wholeBuildingParcels: parcels.length, condoRows: 0 };
  }

  const condoSql = `SELECT count(*) AS n FROM "${resourceId}" WHERE ${where} AND "LU" IN ('CD','CM')`;
  const condoResult = await ckanSql<Row>(condoSql, fetchImpl);
  const condoRows = parseIntOrNull(text(condoResult[0]?.n)) ?? 0;
  if (condoRows > 0) {
    return { parcelId: null, condominium: true, wholeBuildingParcels: 0, condoRows };
  }
  return { parcelId: null, condominium: false, wholeBuildingParcels: 0, condoRows: 0 };
}

/**
 * A condominium address has no whole-building assessor row, so there is nothing to
 * report but the fact itself. Land use stays null rather than inventing 'CD' values
 * the assessor never returned for this building — the `condominium` flag carries it.
 */
function condominiumPayload(fiscalYear: string): AssessmentPayload {
  return {
    fiscalYear, parcelId: null, owner: null, mailAddressee: null, mailStreet: null, mailCity: null, mailState: null, mailZip: null,
    landUse: null, landUseDescription: null, yearBuilt: null, yearRemodel: null, grossArea: null, livingArea: null,
    residentialUnits: null, commercialUnits: null, totalValue: null, landValue: null, buildingValue: null, condominium: true,
  };
}

function mapRow(row: Row, year: AssessorYear): AssessmentPayload {
  const c = year.columns;
  const pick = (col: string | null): string | null => (col ? text(row[col]) : null);
  let mailStreet = pick(c.mailStreet);
  let mailCity = pick(c.mailCity);
  let mailState = pick(c.mailState);
  let mailZip = pick(c.mailZip);
  if (c.mailCombined) {
    // "PO BOX 35006 C/O ATT DENNIS CLAIR, BOSTON, MA 02135" -> street, city, state, zip.
    // Parsed from the end: the street half can itself contain commas, the tail cannot.
    const combined = pick(c.mailCombined) ?? '';
    const parts = combined.split(',').map((p) => p.trim()).filter(Boolean);
    const tail = /^([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/.exec(parts[parts.length - 1] ?? '');
    if (tail) {
      mailState = tail[1];
      mailZip = tail[2];
      mailCity = parts[parts.length - 2] ?? null;
      mailStreet = parts.slice(0, -2).join(', ') || null;
    } else {
      mailStreet = parts.join(', ') || null;
      mailCity = null;
      mailState = null;
      mailZip = null;
    }
  }
  return {
    fiscalYear: year.fiscalYear,
    parcelId: toCanonicalParcel(pick('PID')),
    owner: pick('OWNER'),
    mailAddressee: pick(c.mailAddressee),
    mailStreet, mailCity, mailState, mailZip,
    landUse: pick('LU'),
    landUseDescription: pick('LU_DESC'),
    yearBuilt: parseIntOrNull(pick('YR_BUILT')),
    yearRemodel: parseIntOrNull(pick('YR_REMODEL')),
    grossArea: parseIntOrNull(pick('GROSS_AREA')),
    livingArea: parseIntOrNull(pick('LIVING_AREA')),
    residentialUnits: parseIntOrNull(pick('RES_UNITS')),
    commercialUnits: parseIntOrNull(pick('COM_UNITS')),
    totalValue: parseMoney(pick('TOTAL_VALUE')),
    landValue: parseMoney(pick('LAND_VALUE')),
    buildingValue: parseMoney(pick('BLDG_VALUE')),
    condominium: false,
  };
}

const MISSING_COLUMN_PATTERN = /column\s+"([^"]+)"\s+does not exist/i;

/** `"ee73430d-96c0-423e-ad21-c4cfb54c8961.ZIPCODE"` -> `"ZIPCODE"`. CKAN qualifies a column name this way in some error variants. */
function stripResourcePrefix(columnName: string): string {
  const dot = columnName.lastIndexOf('.');
  return dot === -1 ? columnName : columnName.slice(dot + 1);
}

function extractMissingColumn(text: string): string | null {
  const match = MISSING_COLUMN_PATTERN.exec(text);
  return match ? stripResourcePrefix(match[1]) : null;
}

/**
 * A year whose resource dropped or renamed a column we asked for. CKAN's structured
 * error puts the psycopg2 message in `detail.query[0]` and again (usually cleaner)
 * in `detail.info.orig[0]`; `err.message` is only a truncated summary of that, so it
 * is used as a fallback for callers that never got a structured `detail` at all.
 */
function missingColumnName(err: unknown): string | null {
  if (!(err instanceof SourceError)) return null;
  const detail = err.detail;
  if (detail !== undefined) {
    const d = detail as { query?: unknown; info?: { orig?: unknown } } | null;
    const candidates = [
      Array.isArray(d?.query) ? d?.query[0] : undefined,
      Array.isArray(d?.info?.orig) ? d?.info?.orig[0] : undefined,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        const name = extractMissingColumn(candidate);
        if (name) return name;
      }
    }
    return null;
  }
  return extractMissingColumn(err.message);
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
        throw new SourceError('Parcel not resolved for this building', NO_QUERY);
      }
      // A parcel with several buildings returns a row per BLDG_SEQ; ordering makes the
      // one row we keep the same one on every pull instead of whatever CKAN returns first.
      const sql = `SELECT ${selectList(year.columns)} FROM "${year.resourceId}" WHERE "PID" IN (${parcelLiterals(identity)}) ORDER BY "BLDG_SEQ" LIMIT 5`;
      let rows: Row[];
      try {
        rows = await ckanSql<Row>(sql, fetchImpl);
      } catch (err) {
        const missingColumn = missingColumnName(err);
        const mailColumnNames = Object.values(year.columns).filter((c): c is string => Boolean(c));
        if (missingColumn && mailColumnNames.includes(missingColumn)) {
          return {
            query: `${sql} -- skipped: column "${missingColumn}" does not exist in ${year.fiscalYear}`,
            rows: [],
          };
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
