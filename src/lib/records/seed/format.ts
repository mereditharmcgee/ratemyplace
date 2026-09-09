import { textOrNull } from '../ckan';
import { splitSuffix } from '../identity';

function titleWord(word: string): string {
  if (word.length <= 1) return word.toUpperCase();
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * The assessor stores '23' + '27' + 'Lanark RD'; pages read '23-27 Lanark Road'. The
 * suffix is spelled out from the identity table so the seed and the normalizer agree.
 * A leading directional stays as the assessor wrote it ('W Broadway').
 */
export function formatSeedAddress(stNum: unknown, stNum2: unknown, stName: unknown): string | null {
  const lo = textOrNull(stNum)?.trim();
  const hi = textOrNull(stNum2)?.trim();
  const street = textOrNull(stName)?.trim();
  if (!lo || !street) return null;
  const { base, spellings } = splitSuffix(street);
  if (!base) return null;
  const longest = spellings ? spellings.reduce((a, b) => (b.length > a.length ? b : a)) : null;
  const words = base.split(' ').map(titleWord);
  if (longest) words.push(titleWord(longest));
  const number = hi && hi !== lo ? `${lo}-${hi}` : lo;
  return `${number} ${words.join(' ')}`;
}

/** Same rule as POST /api/buildings, with in-batch collision handling. Adds the chosen slug to `taken`. */
export function seedSlug(address: string, taken: Set<string>): string {
  const base = `${address.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-boston`;
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

export function buildingTypeFor(landUse: string): string {
  return BUILDING_TYPE_BY_LU[landUse.trim().toUpperCase()] ?? 'apartment';
}

/** 'EAST BOSTON' -> 'East Boston'; plain Boston carries no neighborhood. */
export function titleCaseNeighborhood(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  const titled = text.split(/\s+/).map(titleWord).join(' ');
  return titled === 'Boston' ? null : titled;
}
