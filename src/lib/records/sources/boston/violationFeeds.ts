// CKAN's SQL endpoint has no parameter binding, so this module is the repo's documented
// exception to "parameterized queries always" (see AGENTS.md). The invariant that keeps
// it safe: every interpolated value passes through `sqlLiteral`, and every identifier
// (table/column name) is a code constant, never user input.
//
// Boston's violation and code-enforcement feeds store the street name with no directional
// and no suffix (`violation_street` "Newton", `violation_suffix` "ST" for "W Newton St";
// "Union" / "PK" for "Union Park"). Matching therefore strips a leading directional off the
// street name before comparing, and matches suffix separately when the identity has one.
// Stripping the directional means `84 E Newton St` and `84 W Newton St` both resolve to the
// same `NEWTON` + `84` match; the zip predicate below narrows this but cannot eliminate it.
// That is a known, accepted residual — the correction workflow exists for exactly this case.
//
// Ranges are stored split (`violation_stno`/`violation_sthigh`) rather than hyphenated, so
// matching goes through `identity.numbers` against both columns; `identity.rangeForm` is
// never sent to this feed.
import { ckanSql, ROW_CAP, sqlLiteral } from '../../ckan';
import type { BuildingIdentity, EnforcementTicketPayload, RecordSource, SourceResult, ViolationPayload } from '../../types';

type Row = Record<string, string | number | null>;

// violation_zip and violation_city are used only in the WHERE clause / not surfaced in the
// payload, so (matching the permits.ts convention for parcel_id) they are not selected.
const BASE_COLUMNS = [
  'case_no', 'code', 'value', 'description', 'status', 'status_dttm',
  'violation_stno', 'violation_sthigh', 'violation_street', 'violation_suffix',
  'contact_addr1', 'sam_id',
];

function str(v: string | number | null | undefined): string | null {
  return v == null || String(v).trim() === '' ? null : String(v).trim();
}

/**
 * The bare street name these feeds key on: `identity.streetBase` with a leading
 * directional token removed, but only when at least one word follows it — a directional
 * standing alone (e.g. "NORTH" as the whole name, its suffix already split off) is the
 * street name and stays.
 */
export function bareStreetName(identity: Pick<BuildingIdentity, 'streetBase'>): string {
  return identity.streetBase.replace(/^[NSEW] (?=\S)/, '');
}

/**
 * Every suffix spelling known for this street's suffix, e.g. "COMMONWEALTH AV" plus
 * "COMMONWEALTH AVE"/"COMMONWEALTH AVENUE" on `streetForms` yields `['AV','AVE','AVENUE']`.
 * Empty when the street has no suffix (`streetForms` is just the bare base).
 */
export function suffixSpellings(identity: Pick<BuildingIdentity, 'streetBase' | 'streetForms'>): string[] {
  const spellings = identity.streetForms
    .map((f) => f.slice(identity.streetBase.length).trim())
    .filter((s) => s !== '');
  return Array.from(new Set(spellings));
}

function buildAddress(row: Row): string | null {
  const stno = str(row.violation_stno);
  const sthigh = str(row.violation_sthigh);
  const street = str(row.violation_street);
  const suffix = str(row.violation_suffix);
  const numberPart = stno ? `${stno}${sthigh ? `-${sthigh}` : ''}` : null;
  const address = [numberPart, street, suffix].filter((p): p is string => Boolean(p)).join(' ');
  return address === '' ? null : address;
}

/** The ViolationPayload fields both feeds share; enforcement adds `ticketNumber` on top. */
export function baseViolationPayload(row: Row): ViolationPayload {
  return {
    caseNumber: str(row.case_no) ?? '',
    code: str(row.code),
    value: str(row.value),
    description: str(row.description),
    status: str(row.status),
    statusDate: str(row.status_dttm),
    address: buildAddress(row),
    contactAddress: str(row.contact_addr1),
    samId: str(row.sam_id),
  };
}

export interface ViolationFeedConfig {
  resourceId: string;
  pageUrl: string;
  label: string;
  kind: 'violation' | 'enforcement_ticket';
  /** Enforcement tickets carry a `ticket_no` column the plain violations feed lacks. */
  withTicketNumber?: boolean;
}

export function violationFeedSource(config: ViolationFeedConfig): RecordSource {
  const columns = config.withTicketNumber ? [...BASE_COLUMNS, 'ticket_no'] : BASE_COLUMNS;

  return {
    id: config.resourceId,
    label: config.label,
    pageUrl: config.pageUrl,
    kinds: [config.kind],
    async run(identity, fetchImpl): Promise<SourceResult> {
      const bareStreet = bareStreetName(identity);
      const numbersSql = identity.numbers.map(sqlLiteral).join(',');
      const clauses = [
        `upper("violation_street") = ${sqlLiteral(bareStreet)}`,
        `("violation_stno" IN (${numbersSql}) OR "violation_sthigh" IN (${numbersSql}))`,
      ];
      const spellings = suffixSpellings(identity);
      if (spellings.length > 0) {
        clauses.push(`upper("violation_suffix") IN (${spellings.map(sqlLiteral).join(',')})`);
      }
      if (identity.zip && /^\d{5}$/.test(identity.zip)) {
        clauses.push(`("violation_zip" IS NULL OR "violation_zip" = ${sqlLiteral(identity.zip)})`);
      }
      const sql =
        `SELECT ${columns.map((c) => `"${c}"`).join(',')} FROM "${config.resourceId}" ` +
        // The cap is applied (by ckanSql, via ROW_CAP) before dedupe below, so the tiebreak
        // order here determines which rows survive the cap and which duplicate survives dedupe.
        `WHERE ${clauses.join(' AND ')} ORDER BY "status_dttm" DESC, "case_no", "code", "_id" LIMIT ${ROW_CAP}`;
      const rows = await ckanSql<Row>(sql, fetchImpl);
      const seen = new Set<string>();
      const out: SourceResult['rows'] = [];
      for (const row of rows) {
        const caseNumber = str(row.case_no);
        if (!caseNumber) continue;
        const code = str(row.code);
        const sourceKey = `${caseNumber}:${code ?? ''}`;
        if (seen.has(sourceKey)) continue;
        seen.add(sourceKey);
        const base = baseViolationPayload(row);
        if (config.withTicketNumber) {
          const payload: EnforcementTicketPayload = { ...base, ticketNumber: str(row.ticket_no) };
          out.push({ kind: 'enforcement_ticket', sourceKey, payload, sourceUrl: config.pageUrl });
        } else {
          out.push({ kind: 'violation', sourceKey, payload: base, sourceUrl: config.pageUrl });
        }
      }
      return { query: sql, rows: out };
    },
  };
}
