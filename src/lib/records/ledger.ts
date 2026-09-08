// The view model behind the public records ledger: four sources, each reduced to a count, a
// span, a breakdown, and a list of rows the template prints without deciding anything.
//
// Product rule, non-negotiable: the panel has no opinion. Everything below is a count of
// stored rows, a field off one of them, or a span of the years they cover. Nothing here
// reads a figure and decides what it means, and no ordering encodes a judgement — violations
// are grouped by the city's own status word, which is a fact about the record.
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
  formatDollarsCompact,
  formatRecordDate,
  isOpenStatus,
  openSubCount,
  orNotRecorded,
  permitSummary,
  rentSmartDisagreement,
  splitServiceRequests,
  yearSpanLabel,
  type PermitSummary,
} from './display';
import { PERMITS_RESOURCE_ID } from './sources/boston/permits';
import { VIOLATIONS_RESOURCE_ID } from './sources/boston/violations';
import { ENFORCEMENT_RESOURCE_ID } from './sources/boston/enforcement';
import { NEW_311_RESOURCE_ID } from './sources/boston/serviceRequests';
import type { BuildingRecordsView, SourceStatus } from './query';

/** The figure a source with nothing to count shows. Not a zero, which would be a finding. */
const NO_COUNT = '—';

/** One line of a record list: the city's date, the city's words for it, the city's status. */
export interface RecordRow {
  /** As stored. `formatRecordDate` runs at render so the raw string stays inspectable here. */
  date: string | null;
  label: string;
  status: string | null;
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
}

export interface RequestsSection extends LedgerSection {
  /** The open rows on their own, listed above the full disclosure. */
  openRows: RecordRow[];
  /** Requests at this address the city did not file as housing. Counted, never listed. */
  otherCount: number;
  years: YearCount[];
  types: KeyBreakdown;
  rentSmartNote: string | null;
}

export interface PermitsSection extends LedgerSection {
  summary: PermitSummary;
  years: YearCount[];
  types: KeyBreakdown;
}

export interface EnforcementSection extends LedgerSection {
  types: KeyBreakdown;
}

export interface ViolationsSection extends LedgerSection {
  years: YearCount[];
}

export interface LedgerModel {
  requests: RequestsSection;
  permits: PermitsSection;
  enforcement: EnforcementSection;
  violations: ViolationsSection;
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

/** Open rows first, then everything else, each group keeping the query's date order. */
function openFirst<T extends { status: string | null }>(rows: readonly T[]): T[] {
  return [...rows.filter((row) => isOpenStatus(row.status)), ...rows.filter((row) => !isOpenStatus(row.status))];
}

function closedTrailing(closedAt: string | null): string | null {
  return closedAt ? ` · closed ${formatRecordDate(closedAt)}` : null;
}

export function ledgerModel(view: BuildingRecordsView, now: Date): LedgerModel {
  const currentYear = now.getFullYear();

  // --- 311 housing requests -------------------------------------------------
  const requestStatus = statusFor(view, NEW_311_RESOURCE_ID);
  const { housing, otherCount } = splitServiceRequests(view.serviceRequests);
  // `hasRows` is about the source, not the section: a pull that returned only non-housing
  // requests still answered, so a later failure is a stale answer rather than no answer.
  const requestsCountable = isCountable(requestStatus, view.serviceRequests.length > 0);
  const openRequests = housing.filter((row) => isOpenStatus(row.status));
  const requestYears = countByYear(housing, (row) => row.openedAt, { to: currentYear });
  const requestRow = (row: (typeof housing)[number], trailing: string | null): RecordRow => ({
    date: row.openedAt,
    label: row.type ?? row.title ?? 'Request',
    status: row.status,
    trailing,
  });

  const requests: RequestsSection = {
    status: requestStatus,
    hasRows: view.serviceRequests.length > 0,
    count: requestsCountable ? String(housing.length) : NO_COUNT,
    subCount: requestsCountable ? openSubCount(openRequests.length, housing.length) : '',
    span: requestsCountable ? yearSpanLabel(observedYears(requestYears)) : null,
    note:
      requestsCountable && otherCount > 0
        ? `${otherCount} other request${otherCount === 1 ? '' : 's'} not shown`
        : null,
    cappedNote: cappedNote(view.serviceRequests.length, CAPPED_REQUESTS_COPY),
    rows: housing.map((row) => requestRow(row, closedTrailing(row.closedAt))),
    openRows: openRequests.map((row) => requestRow(row, null)),
    otherCount,
    years: requestYears,
    types: countByKey(housing, (row) => row.type ?? row.title, 6),
    rentSmartNote: rentSmartDisagreement(view.rentsmart, housing.length),
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
      trailing: null,
    })),
    summary,
    years: permitYears,
    types: countByKey(view.permits, (row) => row.description ?? row.permitType ?? row.workType, 6),
  };

  // --- Code enforcement tickets ---------------------------------------------
  const enforcementStatus = statusFor(view, ENFORCEMENT_RESOURCE_ID);
  const enforcementCountable = isCountable(enforcementStatus, view.enforcement.length > 0);
  const openEnforcement = view.enforcement.filter((row) => isOpenStatus(row.status));
  const enforcementYears = countByYear(view.enforcement, (row) => row.statusDate, { to: currentYear });

  const enforcement: EnforcementSection = {
    status: enforcementStatus,
    hasRows: view.enforcement.length > 0,
    count: enforcementCountable ? String(view.enforcement.length) : NO_COUNT,
    subCount: enforcementCountable ? openSubCount(openEnforcement.length, view.enforcement.length) : '',
    span: enforcementCountable ? yearSpanLabel(observedYears(enforcementYears)) : null,
    note: null,
    cappedNote: cappedNote(view.enforcement.length, CAPPED_ROWS_COPY),
    rows: view.enforcement.map((row) => ({
      date: row.statusDate,
      label: orNotRecorded(row.description),
      status: row.status,
      trailing: null,
    })),
    types: countByKey(view.enforcement, (row) => row.description, 6),
  };

  // --- ISD violations -------------------------------------------------------
  const violationStatus = statusFor(view, VIOLATIONS_RESOURCE_ID);
  const violationsCountable = isCountable(violationStatus, view.violations.length > 0);
  const openViolations = view.violations.filter((row) => isOpenStatus(row.status));
  const violationYears = countByYear(view.violations, (row) => row.statusDate, { to: currentYear });

  const violations: ViolationsSection = {
    status: violationStatus,
    hasRows: view.violations.length > 0,
    count: violationsCountable ? String(view.violations.length) : NO_COUNT,
    subCount: violationsCountable ? openSubCount(openViolations.length, view.violations.length) : '',
    span: violationsCountable ? yearSpanLabel(observedYears(violationYears)) : null,
    note: null,
    cappedNote: cappedNote(view.violations.length, CAPPED_ROWS_COPY),
    rows: openFirst(view.violations).map((row) => ({
      date: row.statusDate,
      label: [row.code, row.description].filter(Boolean).join(' · ') || 'Violation',
      status: row.status,
      trailing: null,
    })),
    years: violationYears,
  };

  return { requests, permits, enforcement, violations };
}
