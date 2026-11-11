import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { adjustedPerUnit, buildingRows, cellMask, cityPerUnit, csvEscape, defaultFilters, fullYears, summarize, toCsv, trend, yearsInRange, type Core } from './compute';

// A tiny hand-made dataset: two cells, three buildings, 2023-01 through 2024-02 (data ends Feb 14, 2024).
const months: string[] = [];
for (let y = 2023, m = 1; `${y}-${String(m).padStart(2, '0')}` <= '2024-02'; m === 12 ? (y++, (m = 1)) : m++) months.push(`${y}-${String(m).padStart(2, '0')}`);
const core: Core = {
  meta: { pulled: '2024-02-15', dataThrough: '2024-02-14', windowStart: '2023-01-01', months, groups: ['pests', 'general', 'heat', 'other'], ownerPolicy: 'ordinance',
    sources: {}, recordShards: 1, ownerShards: 1, universeBuildings: 30, rentalBuildings: 20, buildingsWithRecords: 3, universeUnits: 60 },
  districts: ['1', '2'], neighborhoods: ['A', 'B'], zips: ['02111', '02112'],
  cells: [[0, 0, 0, 10, 8, 100], [1, 1, 1, 20, 12, 400]],
  bCell: [0, 0, 1], bRental: [1, 0, 1],
  complaints: { b: [0, 0, 1, 2, 2, 2], m: [0, 5, 5, 0, 12, 13], g: [0, 2, 1, 0, 0, 3] },
  citations: { b: [0, 2, 2], m: [1, 3, 12], n: [2, 1, 1] },
};

describe('compute', () => {
  it('sums the selection and leaves non-rental buildings out of the rate', () => {
    const f = { ...defaultFilters(core), district: 0, m0: 0, m1: 11 };
    const s = summarize(core, f, cellMask(core, f));
    expect(s.complaints).toBe(3);
    expect(s.rentalComplaints).toBe(2);
    expect(s.rentalUnits).toBe(100);
    expect(s.ratePerYear).toBeCloseTo(20, 6);       // 2 complaints / 100 units * 1000, one full year
    expect(s.citedRental).toBe(1);
    expect(s.citedShare).toBeCloseTo(1 / 8, 6);
  });
  it('combines place filters and returns nothing for an impossible combination', () => {
    const f = { ...defaultFilters(core), district: 0, zip: 1 };
    const s = summarize(core, f, cellMask(core, f));
    expect(s.buildings).toBe(0);
    expect(s.ratePerYear).toBeNull();
  });
  it('filters by issue', () => {
    const f = { ...defaultFilters(core), issues: [true, false, false, false] };
    expect(summarize(core, f, cellMask(core, f)).complaints).toBe(3);
  });
  it('counts the last month as a fraction of a month', () => {
    expect(yearsInRange(core, 0, 11)).toBeCloseTo(1, 6);
    expect(yearsInRange(core, 13, 13)).toBeCloseTo(14 / 29 / 12, 6);
  });
  it('knows which years are complete', () => {
    expect(fullYears(core)).toEqual(['2023']);
  });
  it('builds yearly and monthly trends against Boston', () => {
    const f = { ...defaultFilters(core), district: 1 };
    const yr = trend(core, f, cellMask(core, f), 'complaints', 'year');
    expect(yr.map((p) => p.label)).toEqual(['2023', '2024']);
    expect(yr[0].count).toBe(1); expect(yr[0].bostonCount).toBe(3);
    expect(yr[1].partial).toBe(true);
    expect(trend(core, f, cellMask(core, f), 'cited', 'month')).toHaveLength(14);
  });
  it('lists buildings with their most common issue', () => {
    const f = defaultFilters(core);
    const rows = buildingRows(core, f, cellMask(core, f));
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.b === 2)!.top).toBe(0);
    expect(rows.find((r) => r.b === 0)!.citationDates).toBe(2);
  });
  it('escapes CSV cells, including formula-looking text', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(toCsv(['x'], [[1]])).toBe('x\r\n1\r\n');
  });
});

describe('default table order', () => {
  it('uses the citywide rate for the chosen dates and issues, at buildings with a unit count', () => {
    const f = defaultFilters(core);
    expect(cityPerUnit(core, f, [2, 10, null])).toBeCloseTo(3 / 60);   // building 2 has no unit count
    expect(cityPerUnit(core, { ...f, issues: [false, true, false, false] }, [2, 10, 4])).toBeCloseTo(1 / 60);
  });
  it('pulls a small building toward the citywide rate more than a large one', () => {
    const city = 0.1;
    expect(adjustedPerUnit(2, 1, city)).toBeCloseTo((2 + 0.5) / 6);      // raw 2.00 per unit
    expect(adjustedPerUnit(200, 100, city)).toBeCloseTo(200.5 / 105);    // raw 2.00 per unit
    expect(adjustedPerUnit(200, 100, city)).toBeGreaterThan(adjustedPerUnit(2, 1, city));
    expect(adjustedPerUnit(0, 3, city)).toBeLessThan(city);
    expect(adjustedPerUnit(9, null, city)).toBe(city);
  });
});

// When the real data files are present (after the pipeline has run), the page's own math must
// reproduce the pipeline's benchmark numbers for calendar 2025.
const real = 'public/data/core.json';
describe.skipIf(!existsSync(real))('against the built data', () => {
  it('reproduces 2025 complaints per 1,000 rental units', () => {
    const c = JSON.parse(readFileSync(real, 'utf8')) as Core;
    const m0 = c.meta.months.indexOf('2025-01'), m1 = c.meta.months.indexOf('2025-12');
    const rate = (district: number) => {
      const f = { ...defaultFilters(c), district, m0, m1 };
      return Number(summarize(c, f, cellMask(c, f)).ratePerYear!.toFixed(1));
    };
    expect(rate(-1)).toBe(26.2);
    expect(c.districts.map((_, i) => rate(i))).toEqual([16.4, 16.0, 30.2, 41.6, 29.6, 25.3, 32.7, 18.9, 30.7]);
  });
});
