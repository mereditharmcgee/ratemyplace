// Shape helpers for the records panel's bars, category lists, and assessed-value sparkline.
//
// Every one of these is a counting function. They turn stored rows into counts, spans, and
// coordinates; none of them reads a value and decides what it means. A bar is tall because
// the city recorded more rows that year, and for no other reason.
//
// Split out of `display.ts`, which keeps the panel's copy and its string formatters. Nothing
// here touches the database or the network.
import { NOT_RECORDED } from './display';
import type { AssessmentPayload } from './types';

export interface YearCount {
  year: number;
  count: number;
}

/**
 * The years a calendar-year series will accept at all. The city feeds carry typos
 * (`0201-01-01`) and a `1900-01-01` sentinel for "no date", and an unbounded span turns one
 * of those into eighteen centuries of bars. A year outside this window is not a year the
 * city meant, so it is dropped the same way an unparseable date is.
 */
const EARLIEST_SANE_YEAR = 1800;
const LATEST_SANE_YEAR = 2100;

/**
 * Rows bucketed by the calendar year of `getDate`, dense across the span so a year with
 * nothing in it still gets a bar. Reads only the leading `YYYY` the way `formatRecordDate`
 * reads the leading `YYYY-MM-DD` — never through `Date`, whose timezone handling could move
 * a December 31st record into the next year.
 *
 * A row whose date will not parse is skipped rather than bucketed anywhere: inventing a year
 * for it would put a count under a year the city never recorded.
 *
 * `from` and `to` bound the rendered span on top of the sane window. Callers that know the
 * real coverage of a feed should pass them — a source with a documented start year has no
 * business drawing a bar before it.
 */
export function countByYear<T>(
  rows: readonly T[],
  getDate: (row: T) => string | null | undefined,
  opts?: { from?: number; to?: number },
): YearCount[] {
  const counts = new Map<number, number>();
  let observedMin: number | null = null;
  let observedMax: number | null = null;

  for (const row of rows) {
    const value = getDate(row);
    if (!value) continue;
    const match = /^(\d{4})-\d{2}-\d{2}/.exec(value);
    if (!match) continue;
    const year = Number(match[1]);
    if (year < EARLIEST_SANE_YEAR || year > LATEST_SANE_YEAR) continue;
    if (opts?.from !== undefined && year < opts.from) continue;
    if (opts?.to !== undefined && year > opts.to) continue;
    counts.set(year, (counts.get(year) ?? 0) + 1);
    if (observedMin === null || year < observedMin) observedMin = year;
    if (observedMax === null || year > observedMax) observedMax = year;
  }

  const from = opts?.from ?? observedMin;
  const to = opts?.to ?? observedMax;
  if (from === null || to === null || from === undefined || to === undefined || to < from) return [];

  const series: YearCount[] = [];
  for (let year = from; year <= to; year += 1) {
    series.push({ year, count: counts.get(year) ?? 0 });
  }
  return series;
}

export interface KeyCount {
  key: string;
  count: number;
}

export interface KeyBreakdown {
  /** At most `topN` categories, most rows first. */
  top: KeyCount[];
  /** How many categories fell outside `top`. */
  restTypes: number;
  /** How many rows those categories hold between them. */
  restCount: number;
}

/**
 * Rows grouped by `getKey`, largest group first. Ties break on the key ascending so the
 * same data always renders in the same order — an unstable list would look like the records
 * changed when only the sort did.
 */
export function countByKey<T>(
  rows: readonly T[],
  getKey: (row: T) => string | null | undefined,
  topN: number,
): KeyBreakdown {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = getKey(row);
    const key = raw === null || raw === undefined || raw.trim() === '' ? NOT_RECORDED : raw.trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const ordered = Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const limit = Math.max(0, topN);
  const top = ordered.slice(0, limit);
  const rest = ordered.slice(limit);
  return {
    top,
    restTypes: rest.length,
    restCount: rest.reduce((sum, entry) => sum + entry.count, 0),
  };
}

export interface AssessmentSeries {
  /** Totals ordered by fiscal year ascending. */
  values: number[];
  min: number;
  max: number;
  /** Fiscal year labels as the assessor writes them, e.g. `FY2021`. */
  firstYear: string;
  lastYear: string;
}

/** An assessment that carries a usable total, narrowed so the series needs no cast. */
type ValuedAssessment = AssessmentPayload & { totalValue: number };

function hasTotalValue(row: AssessmentPayload): row is ValuedAssessment {
  return typeof row.totalValue === 'number' && Number.isFinite(row.totalValue);
}

/**
 * The four digits inside a fiscal year label, so `FY2026` and a bare `2026` order together.
 * Sorting the raw strings puts every digit-first label ahead of every `FY`-prefixed one,
 * which would silently reverse a mixed series.
 */
function fiscalYearNumber(label: string): number {
  const match = /\d{4}/.exec(label);
  return match ? Number(match[0]) : Number.NEGATIVE_INFINITY;
}

/**
 * The assessed-value series behind the sparkline. Years with no recorded total drop out of
 * `values` — a missing figure is not a zero, and plotting it as one would draw a collapse
 * the records do not show. The first and last labels are the first and last *recorded*
 * years, so the axis label and the line describe the same span.
 */
export function assessmentSeries(assessments: readonly AssessmentPayload[]): AssessmentSeries | null {
  const usable = assessments
    .filter(hasTotalValue)
    .slice()
    .sort((a, b) => fiscalYearNumber(a.fiscalYear) - fiscalYearNumber(b.fiscalYear));
  if (usable.length === 0) return null;

  const values = usable.map((row) => row.totalValue);
  return {
    values,
    min: Math.min(...values),
    max: Math.max(...values),
    firstYear: usable[0].fiscalYear,
    lastYear: usable[usable.length - 1].fiscalYear,
  };
}

/**
 * An SVG `points` string for the assessed-value line: every value on one linear scale
 * between the series low and high, so the slope between two years is proportional to the
 * change the records show. A constant series (including a single year) draws flat through
 * the middle rather than pinned to the top, which would read as a maximum.
 */
export function sparklinePoints(values: readonly number[], width: number, height: number, pad: number): string {
  if (values.length === 0) return '';
  const midY = height / 2;
  if (values.length === 1) return `${pad},${midY} ${width - pad},${midY}`;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const innerWidth = width - pad * 2;
  const innerHeight = height - pad * 2;
  const span = max - min;

  return values
    .map((value, index) => {
      const x = pad + (innerWidth * index) / (values.length - 1);
      const y = span === 0 ? midY : pad + innerHeight * (1 - (value - min) / span);
      return `${x},${y}`;
    })
    .join(' ');
}
