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
// never sent to this feed. `violation_sthigh` has a second, unrelated meaning: for a
// lettered number like "120A" the feed stores `violation_stno` "120" and `violation_sthigh`
// "A" — `buildAddress` below tells the two apart by whether `sthigh` is purely alphabetic.
//
// Matching on `violation_sthigh` against `identity.numbers` also means a stored range row
// can attach to a building whose own address is a different (overlapping) range: a
// `21-23` row matches a `23-27` building because `23` is shared, and that row genuinely
// does cover number 23 — it is not a false match. The correction workflow is the escape
// hatch for the cases where that overlap is unwanted.
//
// The suffix and zip predicates below tolerate a NULL or empty-string value in the feed
// rather than requiring an exact match: unknown suffix/zip data is common enough in these
// feeds that requiring a match would lose real records (a false negative), whereas
// tolerating it only risks attaching a record with a genuinely different suffix or zip (a
// false positive) — a risk already accepted elsewhere in this module and covered by the
// same correction workflow.
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
 *
 * Relies on `identity.ts` building every `streetForms` entry as `${streetBase} ${spelling}`
 * (stripping `streetBase` off the front here is what recovers the bare spelling below).
 */
export function suffixSpellings(identity: Pick<BuildingIdentity, 'streetBase' | 'streetForms'>): string[] {
  const spellings = identity.streetForms
    .map((f) => f.slice(identity.streetBase.length).trim())
    .filter((s) => s !== '');
  return Array.from(new Set(spellings));
}

/**
 * `violation_sthigh` is either half of a stored range ("21-23" -> stno "21", sthigh "23")
 * or the letter of a lettered number ("120A" -> stno "120", sthigh "A") — see the header
 * note. A purely alphabetic `sthigh` is the latter and is appended with no separator
 * ("120A"); anything else is the former and keeps the hyphen ("21-23").
 */
function buildAddress(row: Row): string | null {
  const stno = str(row.violation_stno);
  const sthigh = str(row.violation_sthigh);
  const street = str(row.violation_street);
  const suffix = str(row.violation_suffix);
  const isLetter = sthigh != null && /^[A-Za-z]+$/.test(sthigh);
  const numberPart = stno ? `${stno}${sthigh ? (isLetter ? sthigh : `-${sthigh}`) : ''}` : null;
  const address = [numberPart, street, suffix].filter((p): p is string => Boolean(p)).join(' ');
  return address === '' ? null : address;
}

/**
 * The ViolationPayload fields both feeds share; enforcement adds `ticketNumber` on top.
 * `caseNumber` is taken as a parameter rather than re-derived from `row.case_no` because
 * every caller has already validated it is non-null before reaching here.
 */
function baseViolationPayload(row: Row, caseNumber: string): ViolationPayload {
  return {
    caseNumber,
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
  /** Enforcement tickets carry a `ticket_no` column the plain violations feed lacks. */
  kind: 'violation' | 'enforcement_ticket';
}

export function violationFeedSource(config: ViolationFeedConfig): RecordSource {
  const columns = config.kind === 'enforcement_ticket' ? [...BASE_COLUMNS, 'ticket_no'] : BASE_COLUMNS;

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
        clauses.push(
          `("violation_suffix" IS NULL OR "violation_suffix" = '' OR upper("violation_suffix") IN (${spellings.map(sqlLiteral).join(',')}))`,
        );
      }
      if (identity.zip && /^\d{5}$/.test(identity.zip)) {
        clauses.push(`("violation_zip" IS NULL OR "violation_zip" = '' OR "violation_zip" = ${sqlLiteral(identity.zip)})`);
      }
      const sql =
        `SELECT ${columns.map((c) => `"${c}"`).join(',')} FROM "${config.resourceId}" ` +
        // The cap is applied (by ckanSql, via ROW_CAP) before dedupe below, so the tiebreak
        // order here determines which rows survive the cap and which duplicate survives dedupe.
        // Postgres (CKAN's datastore) sorts NULL last of all values in ASC order but FIRST in
        // DESC order, so a plain "status_dttm" DESC would put every NULL-status_dttm row ahead
        // of every dated one; NULLS LAST keeps the intended most-recent-first ordering.
        `WHERE ${clauses.join(' AND ')} ORDER BY "status_dttm" DESC NULLS LAST, "case_no", "code", "_id" LIMIT ${ROW_CAP}`;
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
        const base = baseViolationPayload(row, caseNumber);
        if (config.kind === 'enforcement_ticket') {
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
