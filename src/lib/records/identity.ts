import { parseStreetAddress, normalizeStreetName } from '../enrichment/helpers';
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

/** Short (assessor/permits/enforcement) and long (311 free text) suffix spellings. */
const SUFFIXES: Array<[short: string, long: string]> = [
  ['AV', 'AVENUE'], ['ST', 'STREET'], ['RD', 'ROAD'], ['DR', 'DRIVE'], ['PL', 'PLACE'],
  ['TER', 'TERRACE'], ['CT', 'COURT'], ['LN', 'LANE'], ['BLVD', 'BOULEVARD'], ['PKWY', 'PARKWAY'],
  ['HWY', 'HIGHWAY'], ['SQ', 'SQUARE'], ['CIR', 'CIRCLE'], ['PK', 'PARK'], ['WAY', 'WAY'],
];

const SUFFIX_ALIASES: Record<string, string> = {
  AVE: 'AV', AVENUE: 'AV', AV: 'AV',
  ST: 'ST', STREET: 'ST',
  RD: 'RD', ROAD: 'RD',
  DR: 'DR', DRIVE: 'DR',
  PL: 'PL', PLACE: 'PL',
  TER: 'TER', TERR: 'TER', TERRACE: 'TER',
  CT: 'CT', COURT: 'CT',
  LN: 'LN', LANE: 'LN',
  BLVD: 'BLVD', BOULEVARD: 'BLVD',
  PKWY: 'PKWY', PARKWAY: 'PKWY',
  HWY: 'HWY', HIGHWAY: 'HWY',
  SQ: 'SQ', SQUARE: 'SQ',
  CIR: 'CIR', CIRCLE: 'CIR',
  PK: 'PK', PARK: 'PK',
  WAY: 'WAY',
};

export function toCanonicalParcel(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = String(value).trim();
  if (!/^\d{9,10}$/.test(digits)) return null;
  return digits.padStart(10, '0');
}

export function toNumericParcel(value: string | null | undefined): string | null {
  const canonical = toCanonicalParcel(value);
  return canonical ? String(Number.parseInt(canonical, 10)) : null;
}

function splitStreet(streetUpper: string): { base: string; short: string | null; long: string | null } {
  const words = streetUpper.replace(/\./g, '').split(/\s+/).filter(Boolean);
  if (words.length < 2) return { base: streetUpper, short: null, long: null };
  const last = words[words.length - 1];
  const short = SUFFIX_ALIASES[last];
  if (!short) return { base: streetUpper, short: null, long: null };
  const long = SUFFIXES.find(([s]) => s === short)?.[1] ?? short;
  return { base: words.slice(0, -1).join(' '), short, long };
}

export function buildIdentity(building: BuildingRowForIdentity): BuildingIdentity {
  const parsed = parseStreetAddress(building.address.trim());
  if (!parsed) throw new Error(`Could not parse street address: ${building.address}`);

  const numberToken = parsed.number.toUpperCase();
  const numbers = Array.from(new Set(numberToken.split('-').filter(Boolean)));
  const rangeForm = numbers.length > 1 ? numberToken : null;

  const streetUpper = normalizeStreetName(parsed.street);
  const { base, short, long } = splitStreet(streetUpper);
  const streetShort = short ? `${base} ${short}` : base;
  const streetLong = long ? `${base} ${long}` : base;

  const numberForms = rangeForm ? [...numbers, rangeForm] : numbers;
  const parcelId = toCanonicalParcel(building.parcel_id);

  return {
    buildingId: building.id,
    numbers,
    rangeForm,
    streetShort,
    streetLong,
    streetBase: base,
    addressFormsShort: numberForms.map((n) => `${n} ${streetShort}`),
    addressFormsLong: numberForms.map((n) => `${n} ${streetLong}`),
    parcelId,
    parcelNumeric: toNumericParcel(parcelId),
    condominium: false,
    zip: building.zip_code,
  };
}
