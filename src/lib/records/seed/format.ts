import { textOrNull } from '../ckan';
import { isDegenerateStreet, splitSuffix } from '../identity';

/**
 * Title-case one word, splitting on an apostrophe or hyphen so both halves of a joined
 * name get a capital: "O'BRIEN" -> "O'Brien", 'MARTIN-LUTHER' -> 'Martin-Luther'. Digits
 * are left alone, so '5TH' stays '5th' rather than becoming '5Th'.
 */
function titleWord(word: string): string {
  return word
    .split(/(['’-])/)
    .map((part) => (part.length === 0 || /^['’-]$/.test(part) ? part : part[0].toUpperCase() + part.slice(1).toLowerCase()))
    .join('');
}

/**
 * Whether the assessor already wrote this word in mixed case ('McBride', 'DeWolfe'). The
 * capital has to be internal: a plainly capitalized 'Lanark' title-cases to itself, but
 * 'Martin-luther' should be corrected rather than preserved.
 */
function hasInternalCapital(word: string): boolean {
  return /[a-z]/.test(word) && /[A-Z]/.test(word.slice(1));
}

/** Uppercased word -> the assessor's own spelling of it, so casing can be checked after `splitSuffix` upper-cases. */
function rawSpellings(street: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const word of street.replace(/\./g, '').split(/\s+/)) {
    if (word && !map.has(word.toUpperCase())) map.set(word.toUpperCase(), word);
  }
  return map;
}

/** The assessor's casing when it is deliberately mixed; otherwise our own title-casing. */
function streetWord(upper: string, raw: ReadonlyMap<string, string>): string {
  const original = raw.get(upper);
  return original && hasInternalCapital(original) ? original : titleWord(upper);
}

interface HouseNumber {
  /** Leading zeros stripped, so '05' and '5' are one number. */
  text: string;
  value: number;
}

/**
 * One house number from an assessor ST_NUM / ST_NUM2. Null when there is no leading digit
 * at all, and null for 0: the assessor writes ST_NUM 0 for an unnumbered rear lot, which
 * is not an address anyone can stand in front of.
 */
function houseNumber(value: unknown): HouseNumber | null {
  const raw = textOrNull(value)?.toUpperCase();
  if (!raw) return null;
  const match = /^0*(\d+)(.*)$/.exec(raw);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  if (n === 0) return null;
  return { text: `${n}${match[2]}`, value: n };
}

/**
 * The assessor stores '23' + '27' + 'Lanark RD'; pages read '23-27 Lanark Road'. The
 * suffix is spelled out from the identity table so the seed and the normalizer agree, and
 * a spelled-out leading directional is abbreviated the way `splitSuffix` abbreviates it
 * ('WEST BROADWAY' -> 'W Broadway'). A range renders low to high numerically, whichever
 * order the two columns arrived in.
 *
 * Null for the same degenerate streets `buildIdentity` throws on ('AVE', '& ST'), so a
 * bare suffix never becomes a seeded building.
 */
export function formatSeedAddress(stNum: unknown, stNum2: unknown, stName: unknown): string | null {
  const lo = houseNumber(stNum);
  const hi = houseNumber(stNum2);
  const full = textOrNull(stName);
  if (!lo || !full) return null;

  // 'LANARK RD, REAR': the suffix keys off the street alone, the tail is shown in parentheses.
  const comma = full.indexOf(',');
  const street = comma >= 0 ? full.slice(0, comma).trim() : full;
  const tail = comma >= 0 ? full.slice(comma + 1).trim() : '';

  const { base, spellings } = splitSuffix(street);
  if (isDegenerateStreet(base, spellings)) return null;

  const raw = rawSpellings(street);
  const longest = spellings ? spellings.reduce((a, b) => (b.length > a.length ? b : a)) : null;
  const words = base.split(' ').map((word) => streetWord(word, raw));
  if (longest) words.push(titleWord(longest));

  const range = hi && hi.text !== lo.text ? [lo, hi].sort((a, b) => a.value - b.value) : null;
  const number = range ? `${range[0].text}-${range[1].text}` : lo.text;
  const suffix = tail ? ` (${tail.split(/\s+/).map(titleWord).join(' ')})` : '';
  return `${number} ${words.join(' ')}${suffix}`;
}

/** Same rule as POST /api/buildings, with in-batch collision handling. Adds the chosen slug to `taken`. */
export function seedSlug(address: string, taken: Set<string>): string {
  const body = address.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!body) throw new Error(`Cannot build a slug from an address with no letters or digits: ${JSON.stringify(address)}`);
  const base = `${body}-boston`;
  let slug = base;
  for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
  taken.add(slug);
  return slug;
}

const BUILDING_TYPE_BY_LU: Record<string, string> = {
  R2: 'two_family',
  R3: 'three_family',
  R4: 'apartment',
  A: 'apartment',
  RC: 'mixed_use',
};

/**
 * Land-use code -> site building type. Throws on anything else: `isSeedParcelRow` has
 * already rejected every code that is not in the table, so an unrecognized code here means
 * the filter and this map have drifted, and a loud failure beats silently seeding a
 * mislabeled building.
 */
export function buildingTypeFor(landUse: unknown): string {
  const code = textOrNull(landUse)?.toUpperCase();
  const type = code ? BUILDING_TYPE_BY_LU[code] : undefined;
  if (!type) throw new Error(`Unrecognized land use for a seed building type: ${JSON.stringify(landUse)}`);
  return type;
}

/** 'EAST BOSTON' -> 'East Boston'; plain Boston carries no neighborhood. */
export function titleCaseNeighborhood(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  const titled = text.split(/\s+/).map(titleWord).join(' ');
  return titled === 'Boston' ? null : titled;
}
