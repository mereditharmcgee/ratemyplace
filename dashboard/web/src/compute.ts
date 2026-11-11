// Pure calculations over the precomputed files. No DOM here, so every number on the page can be unit-tested.

export interface Core {
  meta: {
    pulled: string; dataThrough: string; windowStart: string; months: string[]; groups: string[];
    ownerPolicy: string; sources: Record<string, { name: string; url: string }>;
    recordShards: number; ownerShards: number; universeBuildings: number; rentalBuildings: number; buildingsWithRecords: number;
  };
  districts: string[]; neighborhoods: string[]; zips: string[];
  /** [district index, neighborhood index, zip index, buildings, rental buildings, rental units] */
  cells: number[][];
  bCell: number[]; bRental: number[];
  complaints: { b: number[]; m: number[]; g: number[] };
  citations: { b: number[]; m: number[]; n: number[] };
}

export interface Filters {
  district: number; neighborhood: number; zip: number;   // index, or -1 for all
  issues: boolean[];                                     // one per issue group; all false means all issues
  m0: number; m1: number;                                // inclusive month indexes
}

export function defaultFilters(core: Core): Filters {
  return { district: -1, neighborhood: -1, zip: -1, issues: core.meta.groups.map(() => false), m0: 0, m1: core.meta.months.length - 1 };
}

export function hasGeo(f: Filters): boolean {
  return f.district >= 0 || f.neighborhood >= 0 || f.zip >= 0;
}

export function cellMask(core: Core, f: Pick<Filters, 'district' | 'neighborhood' | 'zip'>): boolean[] {
  return core.cells.map((c) => (f.district < 0 || c[0] === f.district) && (f.neighborhood < 0 || c[1] === f.neighborhood) && (f.zip < 0 || c[2] === f.zip));
}

function issueOn(f: Filters, g: number): boolean {
  return !f.issues.some(Boolean) || f.issues[g];
}

/** Length of a month range in years. The last month of the data counts as the fraction that has gone by. */
export function yearsInRange(core: Core, m0: number, m1: number): number {
  const last = core.meta.months.length - 1;
  let months = m1 - m0 + 1;
  if (m1 === last) {
    const [y, mo, d] = core.meta.dataThrough.split('-').map(Number);
    const daysInMonth = new Date(y, mo, 0).getDate();
    months = months - 1 + Math.min(1, d / daysInMonth);
  }
  return months / 12;
}

export interface Summary {
  buildings: number; rentalBuildings: number; rentalUnits: number;
  complaints: number;            // at all buildings in the selection
  rentalComplaints: number;      // at rental buildings only (the rate's numerator)
  ratePerYear: number | null;    // complaints per 1,000 rental units, per year
  byGroup: number[];
  citedBuildings: number; citedRental: number; citedShare: number | null;
  growthFrom: number; growthTo: number; growth: number | null; growthYears: [string, string] | null;
}

export function summarize(core: Core, f: Filters, mask: boolean[]): Summary {
  let buildings = 0, rentalBuildings = 0, rentalUnits = 0;
  core.cells.forEach((c, i) => { if (mask[i]) { buildings += c[3]; rentalBuildings += c[4]; rentalUnits += c[5]; } });
  const { b, m, g } = core.complaints;
  let complaints = 0, rentalComplaints = 0;
  const byGroup = core.meta.groups.map(() => 0);
  for (let i = 0; i < b.length; i++) {
    if (m[i] < f.m0 || m[i] > f.m1 || !mask[core.bCell[b[i]]] || !issueOn(f, g[i])) continue;
    complaints++; byGroup[g[i]]++;
    if (core.bRental[b[i]]) rentalComplaints++;
  }
  const years = yearsInRange(core, f.m0, f.m1);
  const cited = new Set<number>(), citedR = new Set<number>();
  const ct = core.citations;
  // growth compares the first full year with the last full year in the data
  const yearsList = fullYears(core);
  const y0 = yearsList[0], y1 = yearsList[yearsList.length - 1];
  const g0 = new Set<number>(), g1 = new Set<number>();
  for (let i = 0; i < ct.b.length; i++) {
    if (!mask[core.bCell[ct.b[i]]]) continue;
    const mo = ct.m[i];
    if (mo >= f.m0 && mo <= f.m1) { cited.add(ct.b[i]); if (core.bRental[ct.b[i]]) citedR.add(ct.b[i]); }
    const yr = core.meta.months[mo].slice(0, 4);
    if (yr === y0) g0.add(ct.b[i]);
    if (yr === y1) g1.add(ct.b[i]);
  }
  const canGrow = yearsList.length >= 2 && g0.size >= 5;
  return {
    buildings, rentalBuildings, rentalUnits, complaints, rentalComplaints, byGroup,
    ratePerYear: rentalUnits > 0 && years > 0 ? (1000 * rentalComplaints) / rentalUnits / years : null,
    citedBuildings: cited.size, citedRental: citedR.size, citedShare: rentalBuildings > 0 ? citedR.size / rentalBuildings : null,
    growthFrom: g0.size, growthTo: g1.size, growth: canGrow ? (g1.size - g0.size) / g0.size : null,
    growthYears: yearsList.length >= 2 ? [y0, y1] : null,
  };
}

/** Calendar years that are complete in the data. */
export function fullYears(core: Core): string[] {
  const out: string[] = [];
  const months = core.meta.months;
  const lastYear = core.meta.dataThrough.slice(0, 4);
  for (const mth of months) {
    const y = mth.slice(0, 4);
    if (y !== lastYear && !out.includes(y)) out.push(y);
  }
  if (core.meta.dataThrough.slice(5) === '12-31' && !out.includes(lastYear)) out.push(lastYear);
  return out;
}

export interface TrendPoint { label: string; partial: boolean; count: number; rate: number | null; bostonCount: number; bostonRate: number | null }

/** Complaints (or cited buildings) per period, as a rate, for the selection and for Boston. */
export function trend(core: Core, f: Filters, mask: boolean[], metric: 'complaints' | 'cited', by: 'month' | 'year'): TrendPoint[] {
  const months = core.meta.months;
  const keyOf = (mi: number) => (by === 'month' ? months[mi] : months[mi].slice(0, 4));
  const keys: string[] = [];
  for (let mi = f.m0; mi <= f.m1; mi++) { const k = keyOf(mi); if (!keys.includes(k)) keys.push(k); }
  const pos = new Map(keys.map((k, i) => [k, i] as const));
  let denomSel = 0, denomAll = 0;
  core.cells.forEach((c, i) => { const v = metric === 'complaints' ? c[5] : c[4]; denomAll += v; if (mask[i]) denomSel += v; });
  const sel = keys.map(() => 0), all = keys.map(() => 0);
  if (metric === 'complaints') {
    const { b, m, g } = core.complaints;
    for (let i = 0; i < b.length; i++) {
      if (m[i] < f.m0 || m[i] > f.m1 || !issueOn(f, g[i]) || !core.bRental[b[i]]) continue;
      const p = pos.get(keyOf(m[i]))!;
      all[p]++; if (mask[core.bCell[b[i]]]) sel[p]++;
    }
  } else {
    const ct = core.citations;
    const seenAll = keys.map(() => new Set<number>()), seenSel = keys.map(() => new Set<number>());
    for (let i = 0; i < ct.b.length; i++) {
      if (ct.m[i] < f.m0 || ct.m[i] > f.m1 || !core.bRental[ct.b[i]]) continue;
      const p = pos.get(keyOf(ct.m[i]))!;
      seenAll[p].add(ct.b[i]); if (mask[core.bCell[ct.b[i]]]) seenSel[p].add(ct.b[i]);
    }
    keys.forEach((_, p) => { all[p] = seenAll[p].size; sel[p] = seenSel[p].size; });
  }
  const lastMonth = months[months.length - 1];
  const endsMidMonth = yearsInRange(core, months.length - 1, months.length - 1) < 1 / 12;
  return keys.map((k, p) => ({
    label: k,
    partial: by === 'month'
      ? k === lastMonth && endsMidMonth
      : !coversWholeYear(core, f, k) || (k === lastMonth.slice(0, 4) && (endsMidMonth || !lastMonth.endsWith('-12'))),
    count: sel[p], rate: denomSel > 0 ? (1000 * sel[p]) / denomSel : null,
    bostonCount: all[p], bostonRate: denomAll > 0 ? (1000 * all[p]) / denomAll : null,
  }));
}

function coversWholeYear(core: Core, f: Filters, year: string): boolean {
  const months = core.meta.months;
  return months[f.m0] <= `${year}-01` && months[f.m1] >= `${year}-12`;
}

export interface BuildingRow { b: number; complaints: number; byGroup: number[]; citationDates: number; top: number }

/** Buildings with a complaint or a citation in the selection. `top` is the most common issue group, or -1 for citation only. */
export function buildingRows(core: Core, f: Filters, mask: boolean[]): BuildingRow[] {
  const rows = new Map<number, BuildingRow>();
  const get = (bi: number) => {
    let r = rows.get(bi);
    if (!r) { r = { b: bi, complaints: 0, byGroup: core.meta.groups.map(() => 0), citationDates: 0, top: -1 }; rows.set(bi, r); }
    return r;
  };
  const { b, m, g } = core.complaints;
  for (let i = 0; i < b.length; i++) {
    if (m[i] < f.m0 || m[i] > f.m1 || !mask[core.bCell[b[i]]] || !issueOn(f, g[i])) continue;
    const r = get(b[i]); r.complaints++; r.byGroup[g[i]]++;
  }
  const ct = core.citations;
  for (let i = 0; i < ct.b.length; i++) {
    if (ct.m[i] < f.m0 || ct.m[i] > f.m1 || !mask[core.bCell[ct.b[i]]]) continue;
    get(ct.b[i]).citationDates += ct.n[i];
  }
  const out = [...rows.values()];
  for (const r of out) {
    let best = -1, bestN = 0;
    r.byGroup.forEach((n, gi) => { if (n > bestN) { best = gi; bestN = n; } });
    r.top = best;
  }
  return out;
}

export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  // a leading = + - @ would be read as a formula by a spreadsheet
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

export function fmtInt(n: number): string { return n.toLocaleString('en-US'); }
export function fmtRate(n: number | null): string { return n === null ? '' : n.toFixed(1); }
export function fmtPct(n: number | null, digits = 0): string { return n === null ? '' : `${(100 * n).toFixed(digits)}%`; }
export function fmtChange(n: number | null): string { return n === null ? '' : `${n >= 0 ? '+' : '-'}${Math.abs(100 * n).toFixed(0)}%`; }

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function monthLabel(ym: string): string { return `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`; }
export function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}
