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
 * (`0201-01-01`), and Boston's open-data feeds do not carry records from before 1990 — they
 * do carry `1900-01-01` as a "no date" sentinel, which this floor also catches. A year outside
 * this window is not a year the city meant, so it is dropped the same way an unparseable date
 * is.
 */
const MIN_RECORD_YEAR = 1990;
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
    if (year < MIN_RECORD_YEAR || year > LATEST_SANE_YEAR) continue;
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

/**
 * The years a series actually holds rows for, inside whatever window it was drawn across. The
 * chart may span a feed's documented coverage; the coverage label must not claim years the
 * records do not reach into.
 */
export function observedYears(series: readonly YearCount[]): YearCount[] {
  const first = series.findIndex((e) => e.count > 0);
  if (first === -1) return [];
  let last = series.length - 1;
  while (series[last].count === 0) last -= 1;
  return series.slice(first, last + 1);
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

/** Plain code-unit order, so the same strings sort the same way on every runtime. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The key a category is counted under. The city's feeds spell some types more than one way at
 * the end (`... - snow` and `... - snow:` are one Public Works ticket type), and two lines for
 * one type read as two different things. So trailing punctuation and whitespace, and runs of
 * whitespace inside, do not split a category. Nothing else is folded: case and inner
 * punctuation stay as recorded. A value that is nothing but punctuation keeps its own key.
 */
export function categoryKey(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, ' ');
  const stripped = collapsed.replace(/[\s.,:;\-–—]+$/u, '');
  return stripped === '' ? collapsed : stripped;
}

/**
 * Rows grouped by `getKey`, largest group first. Ties break on the key ascending so the
 * same data always renders in the same order — an unstable list would look like the records
 * changed when only the sort did.
 *
 * Spellings that share a `categoryKey` are one category, and every row still counts once. The
 * label is the spelling the city used most in the group (the shorter on a tie, then code-unit
 * order), so what the chart prints is always a string the city recorded.
 */
export function countByKey<T>(
  rows: readonly T[],
  getKey: (row: T) => string | null | undefined,
  topN: number,
): KeyBreakdown {
  const groups = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const row of rows) {
    const raw = getKey(row);
    const spelling = raw === null || raw === undefined || raw.trim() === '' ? NOT_RECORDED : raw.trim();
    const groupKey = categoryKey(spelling);
    const group = groups.get(groupKey) ?? { count: 0, spellings: new Map<string, number>() };
    group.count += 1;
    group.spellings.set(spelling, (group.spellings.get(spelling) ?? 0) + 1);
    groups.set(groupKey, group);
  }

  const ordered = Array.from(groups.values())
    .map(({ count, spellings }) => {
      const [label] = Array.from(spellings.entries()).sort(
        ([a, aCount], [b, bCount]) => bCount - aCount || a.length - b.length || compareText(a, b),
      )[0];
      return { key: label, count };
    })
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : compareText(a.key, b.key)));

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
