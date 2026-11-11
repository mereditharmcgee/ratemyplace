import type { Core } from './compute';

export interface Buildings {
  id: string[]; addr: string[]; lat: (number | null)[]; lon: (number | null)[]; cell: number[]; units: (number | null)[]; ru: number[];
  owner: number[]; oid: number[]; flags: number[]; isd: number[]; pwd: number[]; rod: number[]; pid: string[]; ownerStrings: string[];
}
export const FLAG = { public: 1, subsidized: 2, hidden: 4, condo: 8, problem: 16, problemOwner: 32, incomeRestricted: 64, rental: 128, withheld: 256 } as const;

export interface OwnerIndex { name: string[]; n: number[]; rec: number[]; flag: number[]; shards: number }
/** [gis id, address, district, neighborhood, zip, units, complaints, citation dates, open cases, condo units held, is condo main record] */
export type Holding = [string, string, string, string, string, number | null, number, number, number, number, number];
export interface OwnerDetail { name: string; spellings: string[]; flag: number; holdings: Holding[] }

export interface BuildingRecords {
  c: [string, string, number, string][];              // day, type, group, status
  s: [string, string[]][];                            // day, descriptions
  i: [string, string, string | null, string[], boolean][]; // case, status, day, descriptions, condition-or-safety
  u: [number, string, number][];                      // owner id, name, units
}
export interface Boundaries { districts: { name: string; rings: number[][][] }[]; neighborhoods: { name: string; rings: number[][][] }[] }

const cache = new Map<string, Promise<unknown>>();
function get<T>(path: string): Promise<T> {
  let p = cache.get(path) as Promise<T> | undefined;
  if (!p) {
    p = fetch(`/data/${path}`).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json() as Promise<T>;
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}

export const loadCore = () => get<Core>('core.json');
export const loadBuildings = () => get<Buildings>('buildings.json');
export const loadOwnerIndex = () => get<OwnerIndex>('owners-index.json');
export const loadBoundaries = () => get<Boundaries>('boundaries.json');
export const loadOwner = (id: number, shards: number) =>
  get<Record<string, OwnerDetail>>(`owners/${id % shards}.json`).then((s) => s[String(id)] ?? null);
export const loadRecords = (gisId: string, shards: number) =>
  get<Record<string, BuildingRecords>>(`records/${Number(gisId) % shards}.json`).then((s) => s[gisId] ?? null);

export const ISSUE_KEYS = ['pests', 'general', 'heat', 'other'] as const;
// Validated for color-vision deficiency (all pairs) on a white surface; see dashboard/README.md.
export const ISSUE_COLORS = ['#c0398b', '#2a78d6', '#eda100', '#008300'];
export const CITATION_ONLY_COLOR = '#6b7280';

export function assessingUrl(pid: string): string {
  return `https://properties.boston.gov/details?parcelId=${encodeURIComponent(pid)}`;
}
export function rmpUrl(address: string): string {
  return `https://ratemyplace.org/search?q=${encodeURIComponent(`${address}, Boston`)}`;
}
