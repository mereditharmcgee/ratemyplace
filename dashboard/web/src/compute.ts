// Pure calculations over the precomputed files. No DOM here, so every number on the page can be unit-tested.

export interface Core {
  meta: {
    pulled: string; dataThrough: string; windowStart: string; months: string[]; groups: string[];
    ownerPolicy: string; sources: Record<string, { name: string; url: string }>;
    recordShards: number; ownerShards: number; universeBuildings: number; rentalBuildings: number; buildingsWithRecords: number;
    universeUnits: number;   // units at every building in the dashboard that has a unit count
    unitSources: string[];   // what Buildings.usrc indexes: 'none', 'class', 'condo', 'address'
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
  owner: OwnerType;                                      // map, table and download only; the tiles and the trend ignore it
}

export const OWNER_TYPES = ['private', 'all', 'public', 'nonprofit'] as const;
export type OwnerType = typeof OWNER_TYPES[number];

/**
 * Whether a building passes the owner-type filter. `flags` is Buildings.flags: bit 1 is a public owner or public
 * housing, bit 2 a nonprofit or income-restricted housing owner (never set together with bit 1).
 * 'private' is every building whose owner is not marked public.
 */
export function ownerTypeOn(flags: number, t: OwnerType): boolean {
  if (t === 'all') return true;
  if (t === 'public') return (flags & 1) !== 0;
  if (t === 'nonprofit') return (flags & 2) !== 0;
  return (flags & 1) === 0;
}

export function defaultFilters(core: Core): Filters {
  return { district: -1, neighborhood: -1, zip: -1, issues: core.meta.groups.map(() => false), m0: 0, m1: core.meta.months.length - 1, owner: 'private' };
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

/** How many average units are added to every building before its rate is used for the default table order. */
export const SHRINK_UNITS = 5;

/** Citywide complaints per unit for the chosen dates and issues (place filters do not apply). Buildings with no unit count are left out of both sides. */
export function cityPerUnit(core: Core, f: Filters, units: (number | null)[]): number {
  const { b, m, g } = core.complaints;
  let n = 0;
  for (let i = 0; i < b.length; i++) {
    if (m[i] < f.m0 || m[i] > f.m1 || !issueOn(f, g[i]) || !units[b[i]]) continue;
    n++;
  }
  return core.meta.universeUnits > 0 ? n / core.meta.universeUnits : 0;
}

/** Raw complaints per unit, or null when the building has no unit count. */
export function perUnit(complaints: number, units: number | null): number | null {
  return units ? complaints / units : null;
}

/**
 * The rate used only to order the table: the building's complaints per unit, pulled toward the citywide rate.
 * It is the rate the building would have with SHRINK_UNITS extra units that each had the citywide number of
 * complaints. A small building moves a lot, a large one hardly at all. No unit count: the citywide rate.
 */
export function adjustedPerUnit(complaints: number, units: number | null, cityRate: number): number {
  return units ? (complaints + SHRINK_UNITS * cityRate) / (units + SHRINK_UNITS) : cityRate;
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
export function fmtPerUnit(n: number | null): string { return n === null ? '' : n.toFixed(2); }
export function fmtPct(n: number | null, digits = 0): string { return n === null ? '' : `${(100 * n).toFixed(digits)}%`; }
export function fmtChange(n: number | null): string { return n === null ? '' : `${n >= 0 ? '+' : '-'}${Math.abs(100 * n).toFixed(0)}%`; }

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function monthLabel(ym: string): string { return `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`; }
export function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}

/** Picks the singular or plural wording for a count. */
export function plural(n: number, w: { one: string; many: string }): string {
  return n === 1 ? w.one : w.many;
}

// Street words as people type them, mapped to the way the city lists them. Applied to both the typed text and the
// city address, so "Street", "St" and "st" all meet.
const STREET_WORDS: Record<string, string> = {
  STREET: 'ST', AVENUE: 'AV', AVE: 'AV', ROAD: 'RD', TERRACE: 'TE', TER: 'TE', PLACE: 'PL', PARK: 'PK', SQUARE: 'SQ', WAY: 'WY',
  COURT: 'CT', HIGHWAY: 'HW', HWY: 'HW', DRIVE: 'DR', BOULEVARD: 'BLVD', CIRCLE: 'CI', CIR: 'CI', PARKWAY: 'PW', PKWY: 'PW',
  LANE: 'LA', LN: 'LA', EAST: 'E', WEST: 'W', NORTH: 'N', SOUTH: 'S', SAINT: 'ST', MOUNT: 'MT',
};
const streetWords = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 -]/g, ' ').split(/\s+/).filter(Boolean).map((w) => STREET_WORDS[w] ?? w);

export interface AddressIndex { words: string[][]; lo: number[]; hi: number[] }   // lo is -1 when the city lists no number

/** Splits each city address into its number (or range) and its street words. */
export function addressIndex(addrs: string[]): AddressIndex {
  const words: string[][] = [], lo: number[] = [], hi: number[] = [];
  for (const a of addrs) {
    const w = streetWords(a);
    const m = w.length > 1 ? /^(\d+)[A-Z]?(?:-(\d+)[A-Z]?)?$/.exec(w[0]) : null;
    if (m) {
      const x = Number(m[1]), y = m[2] ? Number(m[2]) : x;
      lo.push(Math.min(x, y)); hi.push(Math.max(x, y)); words.push(w.slice(1));
    } else { lo.push(-1); hi.push(-1); words.push(w); }
  }
  return { words, lo, hi };
}

export interface AddressMatches { hits: number[]; numberMissed: boolean }

/**
 * Buildings on the street someone typed. The street words must appear in a row, in the city's order; the last word
 * may be unfinished. A typed number only narrows the list: it keeps that number, any range that holds it, and rows
 * the city lists with no number. If no row on the street fits the number, the whole street is listed with the
 * closest numbers first (rows with no number last) and `numberMissed` is set. Returns null until there is a street word of two letters or more.
 */
export function findAddresses(ix: AddressIndex, query: string): AddressMatches | null {
  const typed = streetWords(query);
  const numbers: number[] = [];
  while (typed.length && /^\d+[A-Z]?(-\d+[A-Z]?)?$/.test(typed[0])) numbers.push(parseInt(typed.shift()!, 10));
  if (!typed.length || typed.join('').length < 2) return null;
  const n = typed.length;
  const street: number[] = [];
  for (let i = 0; i < ix.words.length; i++) {
    const w = ix.words[i];
    for (let s = 0; s + n <= w.length; s++) {
      let ok = true;
      for (let j = 0; j < n && ok; j++) ok = j === n - 1 ? w[s + j].startsWith(typed[j]) : w[s + j] === typed[j];
      if (ok) { street.push(i); break; }
    }
  }
  if (!numbers.length) return { hits: street, numberMissed: false };
  const num = numbers[0];
  const fits = street.filter((i) => ix.lo[i] < 0 || (num >= ix.lo[i] && num <= ix.hi[i]));
  const numbered = fits.some((i) => ix.lo[i] >= 0);
  if (numbered) return { hits: fits, numberMissed: false };
  const away = (i: number) => (ix.lo[i] < 0 ? Infinity : Math.min(Math.abs(num - ix.lo[i]), Math.abs(num - ix.hi[i])));
  return { hits: [...street].sort((a, b) => away(a) - away(b) || ix.lo[a] - ix.lo[b]), numberMissed: true };
}
