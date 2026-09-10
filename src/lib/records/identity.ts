import { parseStreetAddress } from '../enrichment/helpers';
import type { BuildingIdentity } from './types';

export interface BuildingRowForIdentity {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  parcel_id: string | null;
  sam_id: string | null;
}

/** Assessor spelling first, then every other spelling seen in Boston datasets. Verified 2026-09-07. */
const SUFFIX_SPELLINGS: ReadonlyArray<readonly string[]> = [
  ['AV', 'AVE', 'AVENUE'],
  ['ST', 'STREET'],
  ['RD', 'ROAD'],
  ['DR', 'DRIVE'],
  ['PL', 'PLACE'],
  ['TE', 'TER', 'TERR', 'TERRACE'],
  ['CT', 'COURT'],
  ['LN', 'LANE'],
  ['BLVD', 'BOULEVARD'],
  ['PKWY', 'PARKWAY'],
  ['HWY', 'HIGHWAY'],
  ['SQ', 'SQUARE'],
  ['CIR', 'CIRCLE'],
  ['PK', 'PARK'],        // assessor: UNION PK; 311: Union Park
  ['WHARF', 'WH', 'WHF'], // assessor: ROWES WHARF; enforcement suffix: WH
  ['ROW'],
  ['WAY'],
];

/** Any spelling -> its row. Derived so there is only one table to maintain. */
const SUFFIX_ROW_BY_SPELLING: ReadonlyMap<string, readonly string[]> = new Map(
  SUFFIX_SPELLINGS.flatMap((row) => row.map((spelling) => [spelling, row] as const)),
);

const DIRECTIONALS: Record<string, string> = { NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', N: 'N', S: 'S', E: 'E', W: 'W' };

/**
 * Unit designators, stripped from a street (including a leading unit word, so a street
 * that is nothing but a unit designator strips down to empty and trips the degenerate
 * check below). `\b` keeps UNITY/APTUCXET intact, and `\s*#` catches "#2" (the old
 * enrichment helper's `\b#` never could).
 */
const UNIT_PATTERN = /(?:^|\s+)(?:APT|APARTMENT|UNIT|STE|SUITE|FL|FLOOR|RM|ROOM)\b.*$|\s*#.*$/i;

/**
 * Locality words a person types after the street when there is no comma to cut at:
 * "1027 Commonwealth Ave Boston", "10 Centre St Jamaica Plain MA 02130". Boston's own
 * neighborhoods are here because Google Places and manual entry both use them as the
 * city. Uppercase, because it runs after `normalizeStreet`. Multi-word names are matched
 * as a unit, longest first.
 *
 * Complete means: every USPS city name for a Boston-only ZIP, plus the neighborhood names
 * people type; `CHESTNUT HILL` is excluded because 02467 also covers Newton and Brookline.
 * `src/lib/locality.ts` keeps a separate display-side set that also carries New Haven
 * names, which must never be stripped from a key — hence two sets, not one. Both are
 * exported and `recordsDedupe.test.ts` holds this one against that one's Boston half, so
 * the two spellings of the same vocabulary cannot drift.
 */
export const TRAILING_LOCALITIES: ReadonlySet<string> = new Set([
  'BOSTON',
  'ALLSTON',
  'BRIGHTON',
  'CHARLESTOWN',
  'CHINATOWN',
  'DORCHESTER',
  'DOWNTOWN',
  'FENWAY',
  'MATTAPAN',
  'ROSLINDALE',
  'ROXBURY',
  'SEAPORT',
  'HYDE PARK',
  'JAMAICA PLAIN',
  'SOUTH BOSTON',
  'EAST BOSTON',
  'WEST ROXBURY',
  'SOUTH END',
  'NORTH END',
  'BACK BAY',
  'BEACON HILL',
  'MISSION HILL',
  'WEST END',
  // Postal city names for Boston ZIPs that are not the bare neighborhood name.
  'DORCHESTER CENTER',
  'ROXBURY CROSSING',
  'READVILLE', // USPS city name for 02136/02137, both Boston-only (Hyde Park).
]);

const ZIP_TOKEN = /^\d{5}(?:-\d{4})?$/;

const STREET_ARTICLES: ReadonlySet<string> = new Set(['THE']);
const MAX_LOCALITY_WORDS = Math.max(...[...TRAILING_LOCALITIES].map((name) => name.split(' ').length));

/**
 * How many trailing words are a locality name, longest first ("SOUTH BOSTON" is not read
 * as a "BOSTON" behind a "SOUTH"). Zero when nothing usable would be left in front of it:
 * a street that *is* a locality ("BOSTON"), or one that is a locality behind an article
 * ("THE FENWAY", a real Boston street) — an article alone is not a street name.
 */
function trailingLocalityWordCount(words: readonly string[]): number {
  for (let n = MAX_LOCALITY_WORDS; n >= 1; n -= 1) {
    if (words.length < n || !TRAILING_LOCALITIES.has(words.slice(-n).join(' '))) continue;
    return words.slice(0, -n).every((word) => STREET_ARTICLES.has(word)) ? 0 : n;
  }
  return 0;
}

/**
 * Peel a trailing ZIP, then "MA", then a locality from an already-normalized (uppercase,
 * comma-free) street. Every step keeps at least one word, and a street that is itself a
 * locality name ("BOSTON", "SOUTH BOSTON") is left whole. "CT" is a street suffix (Court),
 * so it is never treated as a state. A lone "MA" after a street is only read as the state
 * when a ZIP was just removed or a locality precedes it: nothing has verified that no Boston
 * street name ends in a bare "MA", so the guard errs toward not stripping, at the known cost
 * that '23 Lanark Rd MA' keys as `LANARK RD MA` while '23 Lanark Rd MA 02135' keys as
 * `LANARK RD`. Called by `addressKey` and `buildIdentity`, which both consume user-entered
 * `buildings.address`; not by `streetKey`, whose input is a bare assessor street name.
 */
export function stripTrailingLocality(streetUpper: string): string {
  const words = streetUpper.split(' ').filter((word) => word.length > 0);
  let sawZip = false;
  if (words.length > 1 && ZIP_TOKEN.test(words[words.length - 1])) {
    words.pop();
    sawZip = true;
  }
  if (words.length > 1 && words[words.length - 1] === 'MA') {
    const before = words.slice(0, -1);
    if (sawZip || trailingLocalityWordCount(before) > 0) words.pop();
  }
  const localityWords = trailingLocalityWordCount(words);
  if (localityWords > 0) words.splice(words.length - localityWords, localityWords);
  return words.join(' ');
}

export function toCanonicalParcel(value: string | number | null | undefined): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!/^\d{9,10}$/.test(trimmed)) return null;
  return trimmed.padStart(10, '0');
}

export function toNumericParcel(value: string | number | null | undefined): string | null {
  const canonical = toCanonicalParcel(value);
  return canonical ? String(Number.parseInt(canonical, 10)) : null;
}

/** Uppercase and comma/period/unit-free. Suffix splitting and directional abbreviation happen after, on the base. */
function normalizeStreet(street: string): string {
  return street
    .replace(/,.*$/, '')
    .replace(/\./g, '')
    .replace(UNIT_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function splitStreet(streetUpper: string): { base: string; spellings: readonly string[] | null } {
  const words = streetUpper.split(' ').filter(Boolean);
  let spellings: readonly string[] | null = null;
  let baseWords = words;
  if (words.length >= 2) {
    const found = SUFFIX_ROW_BY_SPELLING.get(words[words.length - 1]);
    if (found) {
      spellings = found;
      baseWords = words.slice(0, -1);
    }
  }
  // Abbreviate a leading directional when at least one word follows it in the base
  // (suffix already removed): "WEST BROADWAY" -> "W BROADWAY", but "NORTH" (alone,
  // suffix "ST" already split off) stays: there the directional is the name.
  if (baseWords.length >= 2 && DIRECTIONALS[baseWords[0]]) {
    baseWords = [DIRECTIONALS[baseWords[0]], ...baseWords.slice(1)];
  }
  return { base: baseWords.join(' '), spellings };
}

/**
 * A suffix word is only degenerate when it stood alone with nothing before it to split
 * off ("5 Ave"); once a suffix has actually been split off, the base can legitimately be
 * a suffix word itself ("10 Park St" -> base "PARK", suffix "ST"). An empty base, or one
 * starting with punctuation, is never usable.
 *
 * One rule, four callers: `buildIdentity` throws on it, `streetKey` and `addressKey`
 * return null, and the seed's `formatSeedAddress` returns null. They must not fork, which
 * is why this is exported rather than re-derived in the seed.
 */
export function isDegenerateStreet(base: string, spellings: readonly string[] | null): boolean {
  return !base || (!spellings && SUFFIX_ROW_BY_SPELLING.has(base)) || /^[^A-Z0-9]/.test(base);
}

/** The one key builder: base plus the assessor's spelling, or the bare base with no suffix. */
function keyOf(base: string, spellings: readonly string[] | null): string {
  return spellings ? `${base} ${spellings[0]}` : base;
}

export function buildIdentity(building: BuildingRowForIdentity): BuildingIdentity {
  const parsed = parseStreetAddress(building.address.trim());
  if (!parsed) throw new Error(`Could not parse street address: ${building.address}`);

  const numberToken = parsed.number.toUpperCase();
  const parts = Array.from(new Set(numberToken.split('-').filter(Boolean)));
  const rangeForm = parts.length > 1 ? numberToken : null;
  // A lettered number also matches as its bare number: '12A' -> ['12A','12'].
  const numbers = Array.from(new Set(parts.flatMap((p) => (/[A-Z]$/.test(p) ? [p, p.replace(/[A-Z]+$/, '')] : [p])))).filter(Boolean);

  const { base, spellings } = splitStreet(stripTrailingLocality(normalizeStreet(parsed.street)));
  if (isDegenerateStreet(base, spellings)) {
    throw new Error(`Degenerate street name from address: ${building.address}`);
  }

  const streetForms = spellings ? Array.from(new Set(spellings.map((s) => `${base} ${s}`))) : [base];
  const streetShort = keyOf(base, spellings);
  const longest = spellings ? spellings.reduce((a, b) => (b.length > a.length ? b : a)) : null;
  const streetLong = longest ? `${base} ${longest}` : base;

  const numberForms = rangeForm ? [...numbers, rangeForm] : numbers;
  const parcelId = toCanonicalParcel(building.parcel_id);

  return {
    buildingId: building.id,
    numbers,
    rangeForm,
    streetShort,
    streetLong,
    streetBase: base,
    streetForms,
    addressFormsShort: numberForms.map((n) => `${n} ${streetShort}`),
    addressFormsLong: numberForms.map((n) => `${n} ${streetLong}`),
    parcelId,
    parcelNumeric: toNumericParcel(parcelId),
    // Placeholder: parcel resolution (assessor) overwrites this before any source runs.
    condominium: false,
    zip: building.zip_code,
    samId: building.sam_id,
  };
}

export { SUFFIX_SPELLINGS };

/** Public form of the normalize-then-split step: uppercase, unit- and punctuation-free, suffix split off. */
export function splitSuffix(street: string): { base: string; spellings: readonly string[] | null } {
  return splitStreet(normalizeStreet(street));
}

/**
 * The lookup key shared by seeded rows and reviewer dedupe: base name plus the assessor's
 * spelling of the suffix ('LANARK RD'), or the bare base when there is no suffix. Null
 * when the street is degenerate — the same rule `buildIdentity` throws on, so a bare
 * suffix ('Ave') or an empty street never becomes a key that silently collides.
 */
export function streetKey(street: string): string | null {
  const { base, spellings } = splitSuffix(street);
  if (isDegenerateStreet(base, spellings)) return null;
  return keyOf(base, spellings);
}

export interface AddressKey {
  streetKey: string;
  numLo: number;
  numHi: number;
}

/**
 * Street key plus house-number range for one address line. A lettered number ('12A')
 * keys on its digits; a range is ordered low to high. Null when there is no leading
 * number or the street is degenerate (the same rule buildIdentity throws on).
 */
export function addressKey(address: string): AddressKey | null {
  const parsed = parseStreetAddress(address.trim());
  if (!parsed) return null;
  const numbers = parsed.number
    .toUpperCase()
    .split('-')
    .map((p) => Number.parseInt(p.replace(/[A-Z]+$/, ''), 10))
    .filter((n) => Number.isFinite(n));
  if (numbers.length === 0) return null;
  const { base, spellings } = splitStreet(stripTrailingLocality(normalizeStreet(parsed.street)));
  if (isDegenerateStreet(base, spellings)) return null;
  return {
    streetKey: keyOf(base, spellings),
    numLo: Math.min(...numbers),
    numHi: Math.max(...numbers),
  };
}
