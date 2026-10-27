// The view model behind the public records ledger: the city's records in three groups
// (living conditions, building safety and code, property upkeep), each source reduced to a
// count, a span, a breakdown, and a list of rows the template prints without deciding anything.
//
// Product rule, non-negotiable: the panel has no opinion. Everything below is a count of
// stored rows, a field off one of them, or a span of the years they cover. Nothing here
// reads a figure and decides what it means, and no ordering encodes a judgement — ISD and
// Public Works lines are grouped under the city's own case or ticket number and listed by the
// city's own status word, which are facts about the record. Which group a 311 request sits in
// comes from the request type the city recorded (`recordGroups.ts`).
//
// This exists so the counts can be tested without rendering a page. It lived in
// `BuildingRecords.astro`'s frontmatter, where "does a never-pulled source show a dash"
// could only be answered by parsing HTML.
import { ROW_CAP } from './ckan';
import { countByKey, countByYear, observedYears, type KeyBreakdown, type YearCount } from './charts';
import {
  CAPPED_REQUESTS_COPY,
  CAPPED_ROWS_COPY,
  PERMIT_COVERAGE_YEAR_NUMBER,
  STILL_OPEN_NOTE,
  caseLinesNote,
  formatDollarsCompact,
  formatRecordDate,
  isOpenStatus,
  openSubCount,
  orNotRecorded,
  otherRequestsLine,
  permitSummary,
  rentSmartDisagreement,
  showAllLabel,
  statusText,
  stillOpenLabel,
  ticketLinesNote,
  yearSpanLabel,
  type PermitSummary,
} from './display';
import { groupServiceRequests } from './recordGroups';
import { PERMITS_RESOURCE_ID } from './sources/boston/permits';
import { VIOLATIONS_RESOURCE_ID } from './sources/boston/violations';
import { ENFORCEMENT_RESOURCE_ID } from './sources/boston/enforcement';
import { NEW_311_RESOURCE_ID } from './sources/boston/serviceRequests';
import type { BuildingRecordsView, SourceStatus } from './query';
import type { EnforcementTicketPayload, ServiceRequestPayload, ViolationPayload } from './types';

/** The figure a source with nothing to count shows. Not a zero, which would be a finding. */
const NO_COUNT = '—';

/** One line of a record list: the city's date, the city's words for it, the city's status. */
export interface RecordRow {
  /** As stored. `formatRecordDate` runs at render so the raw string stays inspectable here. */
  date: string | null;
  label: string;
  /** The city's own status word, as stored. */
  status: string | null;
  /**
   * The status as the panel prints it. The city's word as recorded, except an open 311, ISD
   * or Public Works case, which reads "Still open in city records" (see `stillOpenLabel`).
   */
  statusLabel: string;
  /** Muted text after the status token, already formatted. Null when there is none. */
  trailing: string | null;
}

/** What every ledger row needs, whatever source it is showing. */
export interface LedgerSection {
  /** null when this source has never been pulled for this building. */
  status: SourceStatus | null;
  /** Whether the source has stored rows, which decides how a failed pull is described. */
  hasRows: boolean;
  /** The large figure, or `—` when there is nothing to count. */
  count: string;
  /** The small line under the figure. Empty when there is no count to qualify. */
  subCount: string;
  /** The years the rows cover. Null when there is no count for a span to describe. */
  span: string | null;
  /** A second muted line under the coverage line. */
  note: string | null;
  /** The row-cap note when the stored rows filled a CKAN page, else null. */
  cappedNote: string | null;
  /** The rows behind the count, in the order the section lists them. */
  rows: RecordRow[];
  /**
   * The line that says what an open case means, when this section words one as still open in
   * city records. Null when it lists none, and always null for permits, whose status is kept.
   */
  openNote: string | null;
  /** The label on the disclosure over the full list. */
  showAll: string;
}

export interface RequestsSection extends LedgerSection {
  /** The open rows on their own, listed above the full disclosure. */
  openRows: RecordRow[];
  years: YearCount[];
  types: KeyBreakdown;
}

/**
 * One ISD case or one Public Works ticket: the number the city files it under and the code
 * lines it holds. Nobody can ask the city about a record without its number, and six lines
 * from one inspection are one case, not six.
 */
export interface RecordCase {
  /** The case or ticket number as the city recorded it. */
  id: string;
  /** `Case V100001` / `Ticket T1`, as printed. */
  label: string;
  /** The most recent status date among its lines, as stored. */
  date: string | null;
  /** Whether any of its lines is still open in the city's records. */
  open: boolean;
  /** Its lines, open first. A line's date shows in `trailing` only where it differs from the case's. */
  lines: RecordRow[];
}

export interface CaseSection extends LedgerSection {
  /** The rows grouped under their case or ticket number. `rows` keeps the flat lines. */
  cases: RecordCase[];
}

export interface PermitsSection extends LedgerSection {
  summary: PermitSummary;
  years: YearCount[];
  types: KeyBreakdown;
}

export interface EnforcementSection extends CaseSection {
  types: KeyBreakdown;
}

export interface ViolationsSection extends CaseSection {
  years: YearCount[];
}

/** What sits under the three groups: the 311 requests in none of them, and the RentSmart cross-check. */
export interface OtherRequests {
  count: number;
  /** The sentence that counts them. Null when there are none, or when 311 has no count to give. */
  line: string | null;
  rentSmartNote: string | null;
}

export interface LedgerModel {
  /** Group 1, living conditions. */
  living: RequestsSection;
  /** Group 2, building safety and code. */
  violations: ViolationsSection;
  buildingRequests: RequestsSection;
  permits: PermitsSection;
  /** Group 3, property upkeep. */
  enforcement: EnforcementSection;
  upkeepRequests: RequestsSection;
  other: OtherRequests;
}

function statusFor(view: BuildingRecordsView, sourceId: string): SourceStatus | null {
  return view.sources[sourceId] ?? null;
}

/**
 * A source that failed its most recent attempt and left no rows behind has nothing to show,
 * and one nobody has queried has nothing either. Both render `—` rather than a number a
 * reader would take as a finding.
 */
function isCountable(status: SourceStatus | null, hasRows: boolean): boolean {
  if (status === null) return false;
  return !(status.status === 'error' && !hasRows);
}

/**
 * The CKAN row cap is a hard slice, so a full page means there may be more upstream.
 * Counts validated rows only: a row rejected by `validatePayload` never reaches this count, so
 * a capped pull whose rows partly failed validation undercounts and the note stays off. That
 * undercount is the safe direction — the kind is already flagged as unreadable on the panel.
 */
function cappedNote(rowCount: number, note: string): string | null {
  return rowCount >= ROW_CAP ? note : null;
}

function closedTrailing(closedAt: string | null): string | null {
  return closedAt ? ` · closed ${formatRecordDate(closedAt)}` : null;
}

/**
 * The status a 311, ISD or Public Works row prints. Every case is kept; an open one says it is
 * open in the city's records, with the year it was filed when the feed has one, and every
 * other status prints as recorded. Building permits do not come through here.
 */
function caseStatusLabel(status: string | null, filedAt: string | null): string {
  return isOpenStatus(status) ? stillOpenLabel(filedAt) : statusText(status);
}

function openNoteFor(openCount: number): string | null {
  return openCount > 0 ? STILL_OPEN_NOTE : null;
}

const REQUEST_NOUN = { one: 'request', many: 'requests' };

/**
 * One 311 group's section. Every group reads the same source, so whether there is a count at
 * all, and whether the cap bit, is the source's answer rather than the group's: a pull that
 * returned only other requests still answered, so a later failure is a stale answer rather
 * than no answer.
 */
function requestsSection(
  view: BuildingRecordsView,
  rows: readonly ServiceRequestPayload[],
  currentYear: number,
): RequestsSection {
  const status = statusFor(view, NEW_311_RESOURCE_ID);
  const hasRows = view.serviceRequests.length > 0;
  const countable = isCountable(status, hasRows);
  const open = rows.filter((row) => isOpenStatus(row.status));
  const years = countByYear(rows, (row) => row.openedAt, { to: currentYear });
  const toRow = (row: ServiceRequestPayload, trailing: string | null): RecordRow => ({
    date: row.openedAt,
    label: row.type ?? row.title ?? 'Request',
    status: row.status,
    statusLabel: caseStatusLabel(row.status, row.openedAt),
    trailing,
  });
  return {
    status,
    hasRows,
    count: countable ? String(rows.length) : NO_COUNT,
    subCount: countable ? openSubCount(open.length, rows.length) : '',
    span: countable ? yearSpanLabel(observedYears(years)) : null,
    note: null,
    // 311's cap applies before grouping, so every group carries the note when it bites.
    cappedNote: cappedNote(view.serviceRequests.length, CAPPED_REQUESTS_COPY),
    rows: rows.map((row) => toRow(row, closedTrailing(row.closedAt))),
    openNote: openNoteFor(open.length),
    openRows: open.map((row) => toRow(row, null)),
    years,
    types: countByKey(rows, (row) => row.type ?? row.title, 6),
    showAll: showAllLabel(rows.length, REQUEST_NOUN),
  };
}

/** A line's own date beside it, only where it differs from the date its case shows. */
function lineDateTrailing(lineDate: string | null, caseDate: string | null): string | null {
  if (!lineDate || lineDate.slice(0, 10) === (caseDate ?? '').slice(0, 10)) return null;
  return ` · ${formatRecordDate(lineDate)}`;
}

/**
 * Rows grouped under the number the city files them by. Open cases first, then the rest, each
 * keeping the query's own order (the feeds are fetched newest status date first). A case's date
 * is the most recent status date among its lines; inside a case, open lines come first.
 */
export function groupIntoCases<T extends ViolationPayload>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  caseLabel: (key: string, row: T) => string,
  lineLabel: (row: T) => string,
): RecordCase[] {
  const byKey = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  }
  const cases: RecordCase[] = Array.from(byKey.entries()).map(([key, lines]) => {
    // Plain string comparison on the stored timestamps, never `Date` (see formatRecordDate).
    const date = lines.reduce<string | null>(
      (latest, line) => (line.statusDate && (latest === null || line.statusDate > latest) ? line.statusDate : latest),
      null,
    );
    const ordered = [
      ...lines.filter((line) => isOpenStatus(line.status)),
      ...lines.filter((line) => !isOpenStatus(line.status)),
    ];
    return {
      id: key,
      label: caseLabel(key, lines[0]),
      date,
      open: lines.some((line) => isOpenStatus(line.status)),
      lines: ordered.map((line) => ({
        date: line.statusDate,
        label: lineLabel(line),
        status: line.status,
        // The feed has a status date, not a filing date, so no filing year is claimed.
        statusLabel: caseStatusLabel(line.status, null),
        trailing: lineDateTrailing(line.statusDate, date),
      })),
    };
  });
  return [...cases.filter((entry) => entry.open), ...cases.filter((entry) => !entry.open)];
}

/** A Public Works ticket's number, or its case number when the feed left the ticket number blank. */
export function ticketKey(row: Pick<EnforcementTicketPayload, 'ticketNumber' | 'caseNumber'>): string {
  const ticket = row.ticketNumber?.trim() ?? '';
  return ticket !== '' ? ticket : row.caseNumber;
}

function violationLineLabel(row: ViolationPayload): string {
  return [row.code, row.description].filter(Boolean).join(' · ') || 'Violation';
}

export function ledgerModel(view: BuildingRecordsView, now: Date): LedgerModel {
  const currentYear = now.getFullYear();

  // --- 311, split across the three groups -----------------------------------
  const grouped = groupServiceRequests(view.serviceRequests);
  const living = requestsSection(view, grouped.living, currentYear);
  const buildingRequests = requestsSection(view, grouped.building, currentYear);
  const upkeepRequests = requestsSection(view, grouped.upkeep, currentYear);
  const requestsCountable = isCountable(statusFor(view, NEW_311_RESOURCE_ID), view.serviceRequests.length > 0);
  const listedRequestCount = grouped.living.length + grouped.building.length + grouped.upkeep.length;
  const other: OtherRequests = {
    count: grouped.otherCount,
    line: requestsCountable ? otherRequestsLine(grouped.otherCount) : null,
    // Against every listed 311 request, as before the split into groups. The note only speaks
    // when the roll-up claims more than the panel lists, so a wider comparison can only keep
    // it quieter, never make it claim a gap the old panel did not.
    // Only alongside counts it can disagree with: under "Record unavailable" or "Not retrieved
    // yet" there is nothing listed for it to disagree with.
    rentSmartNote: requestsCountable ? rentSmartDisagreement(view.rentsmart, listedRequestCount) : null,
  };

  // --- Building permits -----------------------------------------------------
  const permitStatus = statusFor(view, PERMITS_RESOURCE_ID);
  const permitsCountable = isCountable(permitStatus, view.permits.length > 0);
  const summary = permitSummary(view.permits);
  const openPermits = view.permits.filter((row) => isOpenStatus(row.status));
  // The feed carries dates the city cannot have meant — a `1900-01-01` sentinel, the odd
  // four-digit typo. Permits are on record from a known year, so the axis starts there.
  const permitYears = countByYear(view.permits, (row) => row.issuedDate, {
    from: PERMIT_COVERAGE_YEAR_NUMBER ?? undefined,
    to: currentYear,
  });

  const permits: PermitsSection = {
    status: permitStatus,
    hasRows: view.permits.length > 0,
    count: permitsCountable ? String(summary.count) : NO_COUNT,
    subCount: permitsCountable
      ? openSubCount(openPermits.length, summary.count) +
        (summary.declaredTotal === null ? '' : ` · ${formatDollarsCompact(summary.declaredTotal)} declared`)
      : '',
    span: permitsCountable ? yearSpanLabel(observedYears(permitYears)) : null,
    note: null,
    cappedNote: cappedNote(view.permits.length, CAPPED_ROWS_COPY),
    rows: view.permits.map((row) => ({
      date: row.issuedDate,
      label: `${row.permitType ?? row.workType ?? 'Permit'}${row.description ? ` · ${row.description}` : ''}`,
      status: row.status,
      // An open permit is an active permit: the city's word stays as recorded.
      statusLabel: statusText(row.status),
      trailing: null,
    })),
    openNote: null,
    showAll: showAllLabel(summary.count, { one: 'permit', many: 'permits' }),
    summary,
    years: permitYears,
    types: countByKey(view.permits, (row) => row.description ?? row.permitType ?? row.workType, 6),
  };

  // --- Public Works code enforcement tickets --------------------------------
  // Counted by ticket, not by row: one ticket can carry several violation lines.
  const enforcementStatus = statusFor(view, ENFORCEMENT_RESOURCE_ID);
  const enforcementCountable = isCountable(enforcementStatus, view.enforcement.length > 0);
  const tickets = groupIntoCases(
    view.enforcement,
    ticketKey,
    (key, row) => ((row.ticketNumber?.trim() ?? '') !== '' ? `Ticket ${key}` : `Case ${key}`),
    (row) => orNotRecorded(row.description),
  );
  const openTickets = tickets.filter((entry) => entry.open).length;
  const enforcementYears = countByYear(tickets, (entry) => entry.date, { to: currentYear });

  const enforcement: EnforcementSection = {
    status: enforcementStatus,
    hasRows: view.enforcement.length > 0,
    count: enforcementCountable ? String(tickets.length) : NO_COUNT,
    subCount: enforcementCountable ? openSubCount(openTickets, tickets.length) : '',
    span: enforcementCountable ? yearSpanLabel(observedYears(enforcementYears)) : null,
    note: enforcementCountable ? ticketLinesNote(view.enforcement.length, tickets.length) : null,
    cappedNote: cappedNote(view.enforcement.length, CAPPED_ROWS_COPY),
    rows: tickets.flatMap((entry) => entry.lines),
    openNote: openNoteFor(openTickets),
    showAll: showAllLabel(tickets.length, { one: 'ticket', many: 'tickets' }),
    cases: tickets,
    // What was ticketed, by violation line: the city's description of each line, counted.
    types: countByKey(view.enforcement, (row) => row.description, 6),
  };

  // --- ISD violations -------------------------------------------------------
  // Counted by case, not by code line: one inspection can cite several codes on one case.
  const violationStatus = statusFor(view, VIOLATIONS_RESOURCE_ID);
  const violationsCountable = isCountable(violationStatus, view.violations.length > 0);
  const cases = groupIntoCases(
    view.violations,
    (row) => row.caseNumber,
    (key) => `Case ${key}`,
    violationLineLabel,
  );
  const openCases = cases.filter((entry) => entry.open).length;
  const violationYears = countByYear(cases, (entry) => entry.date, { to: currentYear });

  const violations: ViolationsSection = {
    status: violationStatus,
    hasRows: view.violations.length > 0,
    count: violationsCountable ? String(cases.length) : NO_COUNT,
    subCount: violationsCountable ? openSubCount(openCases, cases.length) : '',
    span: violationsCountable ? yearSpanLabel(observedYears(violationYears)) : null,
    note: violationsCountable ? caseLinesNote(view.violations.length, cases.length) : null,
    cappedNote: cappedNote(view.violations.length, CAPPED_ROWS_COPY),
    rows: cases.flatMap((entry) => entry.lines),
    openNote: openNoteFor(openCases),
    showAll: showAllLabel(cases.length, { one: 'case', many: 'cases' }),
    cases,
    years: violationYears,
  };

  return { living, violations, buildingRequests, permits, enforcement, upkeepRequests, other };
}
