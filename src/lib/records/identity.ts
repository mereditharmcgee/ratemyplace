import { BOSTON_LOCALITY_NAMES } from '../bostonLocalities';
import { parseStreetAddress } from '../enrichment/helpers';
import type { AddressMatchUncertainty, BuildingIdentity } from './types';

/**
 * The most house numbers one range address is expanded to, endpoints included. A range wider
 * than this keeps its endpoints only and is marked `wide_range`: listing every number of a
 * 300-number complex would push the CKAN SQL past the endpoint's URL limit (about 8 KB, verified
 * live 2026-10-27), and the page says its match is uncertain instead of guessing.
 */
export const MAX_RANGE_NUMBERS = 30;

/**
 * How far below and above an address a city record filed under a wider range is looked for, in
 * house numbers. '501-507 Example Av' contains 503 and starts 2 below it; 40 covers every range
 * example seen in the October 2026 review with room to spare, at 20 extra literals a side.
 */
export const ENCLOSING_RANGE_WINDOW = 40;

/** The number's integer value, a lettered number counting as its digits ('12A' -> 12); null when it has none. */
function houseNumberValue(part: string): number | null {
  const match = /^(\d+)[A-Z]*$/.exec(part);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export interface NumberExpansion {
  matchNumbers: string[];
  span: { low: number; high: number } | null;
  enclosingLows: string[];
  enclosingHighs: string[];
  matchUncertainty: AddressMatchUncertainty | null;
}

/** `count` same-parity numbers stepping away from `from` by `step` (plus or minus 2), stopping before zero. */
function steppedNumbers(from: number, step: number, count: number): string[] {
  const out: string[] = [];
  for (let n = from + step, i = 0; i < count && n > 0; n += step, i += 1) out.push(String(n));
  return out;
}

/**
 * The house numbers an address is matched on. A plain numeric range ('31-39') expands to every
 * number on the same side of the street between its endpoints ('31','33','35','37','39'), because
 * the city files records under any one of them. A lettered range ('100-100A') or a single number
 * is left as written. A range whose endpoints differ in parity, or that would expand past
 * `MAX_RANGE_NUMBERS`, keeps its endpoints and says why, so the page can say its match is
 * uncertain rather than report a zero it did not search for.
 *
 * `parts` are the uppercase hyphen-split number tokens; `numbers` is the as-written list
 * `buildIdentity` already derived from them, returned untouched whenever nothing is expanded.
 */
export function expandHouseNumbers(parts: readonly string[], numbers: readonly string[]): NumberExpansion {
  const values = parts.map(houseNumberValue).filter((v): v is number => v !== null);
  if (values.length === 0) {
    return { matchNumbers: [...numbers], span: null, enclosingLows: [], enclosingHighs: [], matchUncertainty: null };
  }
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = { low, high };
  if ((high - low) % 2 !== 0) {
    // No single side of the street to expand along, and no same-parity range can enclose it.
    return { matchNumbers: [...numbers], span, enclosingLows: [], enclosingHighs: [], matchUncertainty: 'mixed_parity' };
  }
  const windowSteps = ENCLOSING_RANGE_WINDOW / 2;
  const enclosingLows = steppedNumbers(low, -2, windowSteps);
  const enclosingHighs = steppedNumbers(high, 2, windowSteps);
  const plainRange = parts.length === 2 && parts.every((p) => /^\d+$/.test(p)) && low !== high;
  if (!plainRange) {
    return { matchNumbers: [...numbers], span, enclosingLows, enclosingHighs, matchUncertainty: null };
  }
  if ((high - low) / 2 + 1 > MAX_RANGE_NUMBERS) {
    return { matchNumbers: [...numbers], span, enclosingLows, enclosingHighs, matchUncertainty: 'wide_range' };
  }
  const matchNumbers: string[] = [];
  for (let n = low; n <= high; n += 2) matchNumbers.push(String(n));
  return { matchNumbers, span, enclosingLows, enclosingHighs, matchUncertainty: null };
}

/**
 * Whether a city record's leading house-number token belongs to this identity. Applied after a
 * query that also looked for ranges starting below the address (`enclosingLows`): such a range
 * can end below it too, and is kept only when it reaches the address on the same side of the
 * street. Every token the plain number patterns match (a single or lettered number, or the
 * address's own range as written) is kept, so this can only remove what the range arm added.
 */
export function houseNumberTokenMatches(
  token: string | null,
  identity: Pick<BuildingIdentity, 'rangeForm' | 'span' | 'matchNumbers'>,
): boolean {
  if (!token) return true;
  const upper = token.trim().toUpperCase();
  if (identity.rangeForm && upper === identity.rangeForm) return true;
  const startsRange = /^(\d+)[A-Z]?-/.exec(upper);
  if (!startsRange) return true;
  const first = Number.parseInt(startsRange[1], 10);
  const range = /^(\d+)[A-Z]?-(\d+)[A-Z]?$/.exec(upper);
  if (!range || !identity.span) return identity.matchNumbers.includes(String(first));
  const second = Number.parseInt(range[2], 10);
  const low = Math.min(first, second);
  const high = Math.max(first, second);
  const { span } = identity;
  // Some number inside both ranges that is on the record's side of the street (the parity of
  // either of its ends) and on the address's side (the parity of either of its ends).
  for (let n = Math.max(low, span.low); n <= Math.min(high, span.high); n += 1) {
    const onRecordSide = n % 2 === low % 2 || n % 2 === high % 2;
    const onAddressSide = n % 2 === span.low % 2 || n % 2 === span.high % 2;
    if (onRecordSide && onAddressSide) return true;
  }
  return false;
}

/** The first whitespace-separated word of a free-text address: its house-number token. */
export function leadingToken(address: string | null): string | null {
  if (!address) return null;
  const word = address.trim().split(/\s+/)[0];
  return word ? word : null;
}

/**
 * Why a stored address's house numbers could not all be matched, derived the same way
 * `buildIdentity` derives it at pull time. Null when the address matched on every number, or
 * cannot be parsed (an unparseable address never pulled, so there is no zero to qualify).
 */
export function addressMatchUncertainty(address: string): AddressMatchUncertainty | null {
  const parsed = parseStreetAddress(address.trim());
  if (!parsed) return null;
  const parts = Array.from(new Set(parsed.number.toUpperCase().split('-').filter(Boolean)));
  return expandHouseNumbers(parts, parts).matchUncertainty;
}

export interface BuildingRowForIdentity {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  parcel_id: string | null;
  sam_id: string | null;
}

/**
 * Assessor spelling first, then every other spelling seen in Boston datasets.
 *
 * The first spelling of a row is the KEY spelling: `streetKey` / `addressKey` end every stored
 * `buildings.street_key` in it, so it must stay the assessor's. Changing a first spelling
 * re-keys stored rows; run `npm run records:suffix-backfill` and apply its files by hand.
 * `recordsAddressKey.test.ts` pins the first spellings.
 *
 * Verified 2026-09-07; extended 2026-10 with WY/HW/PW/CI/LA/RO/AL/CR. Provenance for those, from
 * read-only CKAN queries: the assessor and the permits `address` column write GRAMPIAN WY,
 * CUMMINS HW, VFW PW, MAMELON CI, HOLDEN RO, BOARD AL and CONRY CR; the assessor writes
 * GREENOUGH LA (one parcel NEPONSET FIELD LN) where permits write RADFORD LN; the violation and
 * enforcement feeds store the bare street plus `violation_suffix` WY/HW/PW/CI/RO/AL/CR and LN;
 * 311's new system writes GRAMPIAN WAY, CUMMINS HWY, VFW PKWY, ROCKVALE CIR, RADFORD LN,
 * HOLDEN ROW and BAKERS ALY; legacy 311 `location` adds CONRY CRES.
 */
const SUFFIX_SPELLINGS: ReadonlyArray<readonly string[]> = [
  ['AV', 'AVE', 'AVENUE'],
  ['ST', 'STREET'],
  ['RD', 'ROAD'],
  ['DR', 'DRIVE'],
  ['PL', 'PLACE'],
  ['TE', 'TER', 'TERR', 'TERRACE'],
  ['CT', 'COURT'],
  ['LA', 'LN', 'LANE'],          // assessor: GREENOUGH LA (one parcel NEPONSET FIELD LN); permits, violation feeds, 311: LN
  ['BLVD', 'BOULEVARD'],
  ['PW', 'PKWY', 'PARKWAY'],     // assessor, permits, violation feeds: VFW PW; 311: VFW PKWY
  ['HW', 'HWY', 'HIGHWAY'],      // assessor, permits, violation feeds: CUMMINS HW; 311: CUMMINS HWY
  ['SQ', 'SQUARE'],
  ['CI', 'CIR', 'CIRCLE'],       // assessor, permits, violation feeds: MAMELON CI; 311: MAMELON CIR
  ['PK', 'PARK'],                // assessor: UNION PK; 311: Union Park
  ['WHARF', 'WH', 'WHF'],        // assessor: ROWES WHARF; enforcement suffix: WH
  ['RO', 'ROW'],                 // assessor, permits, violation feeds: HOLDEN RO; 311: HOLDEN ROW
  ['WY', 'WAY'],                 // assessor, permits, violation feeds: GRAMPIAN WY; 311: GRAMPIAN WAY
  ['AL', 'ALY', 'ALLEY'],        // assessor, permits, violation feeds: BOARD AL; 311: BAKERS ALY
  ['CR', 'CRES', 'CRESCENT'],    // assessor, permits, enforcement: CONRY CR; legacy 311: CONRY CRES
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
 * Derived from `src/lib/bostonLocalities.ts`, which carries the vocabulary in display form
 * and the note on what "complete" means. `src/lib/locality.ts` derives the lowercase,
 * squashed twin from the same list; its own display-side set additionally carries New Haven
 * names, which must never be stripped from a key — hence two derived sets, one source list.
 */
export const TRAILING_LOCALITIES: ReadonlySet<string> = new Set(
  BOSTON_LOCALITY_NAMES.map((name) => name.toUpperCase())
);

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
  const expansion = expandHouseNumbers(parts, numbers);

  return {
    buildingId: building.id,
    numbers,
    matchNumbers: expansion.matchNumbers,
    span: expansion.span,
    enclosingLows: expansion.enclosingLows,
    enclosingHighs: expansion.enclosingHighs,
    matchUncertainty: expansion.matchUncertainty,
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
    // Placeholder: the pull fills it in from the current-year assessor row (pull.ts).
    parcelZip: null,
    samId: building.sam_id,
  };
}

const ZIP5 = /^\d{5}$/;

/**
 * The ZIPs the address-keyed feeds (311, ISD violations, Public Works tickets) are narrowed to:
 * the page's own, plus the current-year parcel's when the pull has read one and it differs. A
 * page whose ZIP disagrees with the assessor's would otherwise lose every record the city filed
 * under the parcel's ZIP. It only ever widens: with no usable page ZIP it is empty, and the feeds
 * stay unnarrowed as before, rather than being narrowed to the parcel's.
 *
 * Five digits only. That is the digits-only guard that lets the adapters interpolate these
 * values (each still goes through `sqlLiteral`).
 */
export function recordZips(identity: Pick<BuildingIdentity, 'zip' | 'parcelZip'>): string[] {
  const page = identity.zip;
  if (page == null || !ZIP5.test(page)) return [];
  const parcel = identity.parcelZip;
  return parcel != null && ZIP5.test(parcel) && parcel !== page ? [page, parcel] : [page];
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
