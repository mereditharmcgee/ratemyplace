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

export function buildIdentity(building: BuildingRowForIdentity): BuildingIdentity {
  const parsed = parseStreetAddress(building.address.trim());
  if (!parsed) throw new Error(`Could not parse street address: ${building.address}`);

  const numberToken = parsed.number.toUpperCase();
  const parts = Array.from(new Set(numberToken.split('-').filter(Boolean)));
  const rangeForm = parts.length > 1 ? numberToken : null;
  // A lettered number also matches as its bare number: '12A' -> ['12A','12'].
  const numbers = Array.from(new Set(parts.flatMap((p) => (/[A-Z]$/.test(p) ? [p, p.replace(/[A-Z]+$/, '')] : [p])))).filter(Boolean);

  const { base, spellings } = splitStreet(normalizeStreet(parsed.street));
  // A suffix word is only degenerate when it stood alone with nothing before it to split
  // off ("5 Ave"); once a suffix has actually been split off, the base can legitimately
  // be a suffix word itself ("10 Park St" -> base "PARK", suffix "ST").
  if (!base || (!spellings && SUFFIX_ROW_BY_SPELLING.has(base)) || /^[^A-Z0-9]/.test(base)) {
    throw new Error(`Degenerate street name from address: ${building.address}`);
  }

  const streetForms = spellings ? Array.from(new Set(spellings.map((s) => `${base} ${s}`))) : [base];
  const streetShort = spellings ? `${base} ${spellings[0]}` : base;
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
