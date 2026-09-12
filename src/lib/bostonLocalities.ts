// The Boston locality vocabulary, once, in display form. Two modules need it in two
// spellings and used to carry two hand-kept copies:
//
// - `locality.ts` wants it lowercase and squashed to alphanumerics, to recognise a city
//   field ("Hyde Park" → 'hydepark').
// - `records/identity.ts` wants it uppercase and space-preserving, to strip a trailing
//   locality off an already-normalized street ("HYDE PARK").
//
// Both derive from this list now, so a name added here reaches both. Add a name here and
// nowhere else.
//
// Complete means: every USPS city name for a Boston-only ZIP, plus the neighborhood names
// people type. `CHESTNUT HILL` is excluded because 02467 also covers Newton and Brookline,
// so stripping it or reading it as Boston would both be wrong.
//
// 'Boston' itself leads the list: `identity.ts` strips it off a street tail like any other
// locality, while `locality.ts` holds it out of its *neighborhood* set — a neighborhood list
// that contained the city would be a different thing — and tests it separately.
export const BOSTON_LOCALITY_NAMES: readonly string[] = [
  'Boston',
  'Allston',
  'Brighton',
  'Charlestown',
  'Chinatown',
  'Dorchester',
  'Downtown',
  'Fenway',
  'Mattapan',
  'Roslindale',
  'Roxbury',
  'Seaport',
  'Hyde Park',
  'Jamaica Plain',
  'South Boston',
  'East Boston',
  'West Roxbury',
  'South End',
  'North End',
  'Back Bay',
  'Beacon Hill',
  'Mission Hill',
  'West End',
  // Postal city names for Boston ZIPs that are not the bare neighborhood name.
  'Dorchester Center',
  'Roxbury Crossing',
  'Readville', // USPS city name for 02136/02137, both Boston-only (Hyde Park).
];
