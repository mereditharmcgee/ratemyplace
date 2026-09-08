import { describe, it, expect } from 'vitest';
import { countByYear, countByKey, observedYears, assessmentSeries, sparklinePoints } from '../records/charts';
import { NOT_RECORDED } from '../records/display';
import type { AssessmentPayload } from '../records/types';

/**
 * The shape helpers behind the records panel's bars, category lists, and sparkline.
 * They are counting functions, not judgement functions: every one of them turns a list of
 * stored rows into a count, a span, or a coordinate. Nothing here reads a value and decides
 * what it means.
 *
 * The panel's copy and caveats (`formatDollarsCompact`, `NO_VIOLATIONS_CAVEAT`,
 * `isOpenStatus`, `openSubCount`, `yearSpanLabel`) live in `display.ts` and are covered by
 * `recordsDisplay.test.ts` instead — this file is only the shape helpers in `charts.ts`.
 */

interface Row {
  date: string | null;
  key?: string | null;
}

function row(date: string | null, key?: string | null): Row {
  return { date, key };
}

function assessment(fiscalYear: string, totalValue: number | null): AssessmentPayload {
  return {
    fiscalYear,
    parcelId: null,
    owner: null,
    mailAddressee: null,
    mailStreet: null,
    mailCity: null,
    mailState: null,
    mailZip: null,
    landUse: null,
    landUseDescription: null,
    yearBuilt: null,
    yearRemodel: null,
    grossArea: null,
    livingArea: null,
    residentialUnits: null,
    commercialUnits: null,
    totalValue,
    landValue: null,
    buildingValue: null,
    condominium: false,
  };
}

describe('countByYear', () => {
  it('returns an empty series for no rows', () => {
    expect(countByYear([], (r: Row) => r.date)).toEqual([]);
  });

  it('returns a single year for rows that all land in one year', () => {
    const rows = [row('2021-03-04'), row('2021-11-30')];
    expect(countByYear(rows, (r) => r.date)).toEqual([{ year: 2021, count: 2 }]);
  });

  it('fills the gap years between the first and last observed year with zeroes', () => {
    const rows = [row('2019-01-01'), row('2022-06-01'), row('2022-07-01')];
    expect(countByYear(rows, (r) => r.date)).toEqual([
      { year: 2019, count: 1 },
      { year: 2020, count: 0 },
      { year: 2021, count: 0 },
      { year: 2022, count: 2 },
    ]);
  });

  it('skips rows whose date cannot be read rather than bucketing them somewhere', () => {
    const rows = [row('2020-05-05'), row(null), row('not a date'), row('20-05-2021')];
    expect(countByYear(rows, (r) => r.date)).toEqual([{ year: 2020, count: 1 }]);
  });

  it('returns an empty series when no row carries a readable date', () => {
    expect(countByYear([row(null), row('')], (r: Row) => r.date)).toEqual([]);
  });

  it('honours an explicit span wider than the observed rows', () => {
    const rows = [row('2021-02-02')];
    expect(countByYear(rows, (r) => r.date, { from: 2020, to: 2022 })).toEqual([
      { year: 2020, count: 0 },
      { year: 2021, count: 1 },
      { year: 2022, count: 0 },
    ]);
  });

  it('drops rows outside an explicit span', () => {
    const rows = [row('2018-01-01'), row('2021-01-01')];
    expect(countByYear(rows, (r) => r.date, { from: 2020, to: 2021 })).toEqual([
      { year: 2020, count: 0 },
      { year: 2021, count: 1 },
    ]);
  });

  it('ignores a year outside the sane window rather than drawing a bar for it', () => {
    // `0201-01-01` is a real typo in the city feeds; unbounded it draws eighteen centuries of bars.
    const rows = [row('0201-01-01'), row('2021-06-01'), row('9999-01-01')];
    expect(countByYear(rows, (r) => r.date)).toEqual([{ year: 2021, count: 1 }]);
  });

  it('drops the 1900-01-01 "no date" sentinel the same way it drops an unparseable date', () => {
    const rows = [row('1900-01-01'), row('2021-06-01')];
    expect(countByYear(rows, (r) => r.date)).toEqual([{ year: 2021, count: 1 }]);
  });

  it('reads the year off each of the timestamp shapes the feeds use', () => {
    const rows = [row('2008-08-30 09:42:00'), row('2021-01-28T16:29:26'), row('2026-07-17 13:56:00+00')];
    const series = countByYear(rows, (r) => r.date);
    expect(series[0]).toEqual({ year: 2008, count: 1 });
    expect(series[series.length - 1]).toEqual({ year: 2026, count: 1 });
    expect(series).toHaveLength(19);
  });
});

describe('countByKey', () => {
  it('returns nothing for no rows', () => {
    expect(countByKey([], (r: Row) => r.key, 6)).toEqual({ top: [], restTypes: 0, restCount: 0 });
  });

  it('sorts by count descending', () => {
    const rows = [row(null, 'Heat'), row(null, 'Pests'), row(null, 'Heat'), row(null, 'Heat'), row(null, 'Pests')];
    expect(countByKey(rows, (r) => r.key, 6).top).toEqual([
      { key: 'Heat', count: 3 },
      { key: 'Pests', count: 2 },
    ]);
  });

  it('breaks a tie on the key, ascending', () => {
    const rows = [row(null, 'Zebra'), row(null, 'Apple')];
    expect(countByKey(rows, (r) => r.key, 6).top).toEqual([
      { key: 'Apple', count: 1 },
      { key: 'Zebra', count: 1 },
    ]);
  });

  it('groups null and empty keys under the not-recorded label', () => {
    const rows = [row(null, null), row(null, ''), row(null, '   '), row(null, undefined)];
    expect(countByKey(rows, (r) => r.key, 6).top).toEqual([{ key: NOT_RECORDED, count: 4 }]);
  });

  it('caps the list at topN and reports what is left over', () => {
    const rows = [
      ...Array.from({ length: 5 }, () => row(null, 'A')),
      ...Array.from({ length: 4 }, () => row(null, 'B')),
      row(null, 'C'),
      row(null, 'D'),
      row(null, 'E'),
    ];
    const result = countByKey(rows, (r) => r.key, 2);
    expect(result.top).toEqual([
      { key: 'A', count: 5 },
      { key: 'B', count: 4 },
    ]);
    expect(result.restTypes).toBe(3);
    expect(result.restCount).toBe(3);
  });

  it('reports no leftovers when every type fits', () => {
    const result = countByKey([row(null, 'A'), row(null, 'B')], (r) => r.key, 6);
    expect(result.restTypes).toBe(0);
    expect(result.restCount).toBe(0);
  });

  it('trims surrounding whitespace so one type is not counted twice', () => {
    const result = countByKey([row(null, 'Heat '), row(null, ' Heat')], (r) => r.key, 6);
    expect(result.top).toEqual([{ key: 'Heat', count: 2 }]);
  });
});

describe('assessmentSeries', () => {
  it('returns null when no assessment carries a total', () => {
    expect(assessmentSeries([])).toBeNull();
    expect(assessmentSeries([assessment('FY2026', null)])).toBeNull();
  });

  it('orders values by fiscal year ascending whatever order they arrive in', () => {
    const series = assessmentSeries([
      assessment('FY2026', 900),
      assessment('FY2024', 700),
      assessment('FY2025', 800),
    ]);
    expect(series?.values).toEqual([700, 800, 900]);
    expect(series?.firstYear).toBe('FY2024');
    expect(series?.lastYear).toBe('FY2026');
  });

  it('reports the low and the high of the series', () => {
    const series = assessmentSeries([assessment('FY2025', 300), assessment('FY2026', 100)]);
    expect(series?.min).toBe(100);
    expect(series?.max).toBe(300);
  });

  it('skips years with no recorded total without shifting the labels', () => {
    const series = assessmentSeries([
      assessment('FY2024', 100),
      assessment('FY2025', null),
      assessment('FY2026', 300),
    ]);
    expect(series?.values).toEqual([100, 300]);
    expect(series?.firstYear).toBe('FY2024');
    expect(series?.lastYear).toBe('FY2026');
  });

  it('orders by the fiscal year number rather than by the raw label', () => {
    // A bare `2026` sorts before `FY2025` as a string; as a year it does not.
    const series = assessmentSeries([assessment('2026', 900), assessment('FY2025', 800)]);
    expect(series?.values).toEqual([800, 900]);
    expect(series?.firstYear).toBe('FY2025');
    expect(series?.lastYear).toBe('2026');
  });

  it('handles a single fiscal year', () => {
    const series = assessmentSeries([assessment('FY2026', 500)]);
    expect(series).toEqual({ values: [500], min: 500, max: 500, firstYear: 'FY2026', lastYear: 'FY2026' });
  });
});

describe('sparklinePoints', () => {
  it('returns an empty string for no values', () => {
    expect(sparklinePoints([], 100, 20, 2)).toBe('');
  });

  it('spans the full width between the padding', () => {
    const points = sparklinePoints([0, 10], 100, 20, 2).split(' ');
    expect(points).toHaveLength(2);
    expect(points[0].split(',')[0]).toBe('2');
    expect(points[1].split(',')[0]).toBe('98');
  });

  it('puts the highest value at the top and the lowest at the bottom', () => {
    const [low, high] = sparklinePoints([0, 10], 100, 20, 2).split(' ');
    expect(Number(low.split(',')[1])).toBe(18);
    expect(Number(high.split(',')[1])).toBe(2);
  });

  it('places a mid value on one linear scale, not rank order', () => {
    const ys = sparklinePoints([0, 2, 10], 100, 20, 2)
      .split(' ')
      .map((point) => Number(point.split(',')[1]));
    // 2 of 10 is a fifth of the way up a 16px inner height: 18 - 3.2 = 14.8.
    expect(ys[1]).toBeCloseTo(14.8, 5);
  });

  it('draws a constant series as a flat line through the middle', () => {
    const ys = sparklinePoints([5, 5, 5], 100, 20, 2)
      .split(' ')
      .map((point) => Number(point.split(',')[1]));
    expect(ys).toEqual([10, 10, 10]);
  });

  it('draws a single value as a flat line rather than an invisible point', () => {
    expect(sparklinePoints([5], 100, 20, 2)).toBe('2,10 98,10');
  });
});

describe('observedYears', () => {
  it('returns an empty series when nothing was ever recorded', () => {
    expect(observedYears([])).toEqual([]);
    expect(
      observedYears([
        { year: 2019, count: 0 },
        { year: 2020, count: 0 },
      ]),
    ).toEqual([]);
  });

  it('trims the leading and trailing zero years off a dense window', () => {
    const series = [
      { year: 2006, count: 0 },
      { year: 2007, count: 0 },
      { year: 2019, count: 3 },
      { year: 2020, count: 0 },
      { year: 2021, count: 1 },
      { year: 2022, count: 0 },
      { year: 2026, count: 0 },
    ];
    expect(observedYears(series)).toEqual([
      { year: 2019, count: 3 },
      { year: 2020, count: 0 },
      { year: 2021, count: 1 },
    ]);
  });

  it('keeps a run with no trailing zeroes to trim', () => {
    const series = [
      { year: 2024, count: 1 },
      { year: 2025, count: 0 },
      { year: 2026, count: 2 },
    ];
    expect(observedYears(series)).toEqual(series);
  });

  it('returns the single observed year for a series with one non-zero entry', () => {
    const series = [
      { year: 2006, count: 0 },
      { year: 2019, count: 1 },
      { year: 2026, count: 0 },
    ];
    expect(observedYears(series)).toEqual([{ year: 2019, count: 1 }]);
  });
});
