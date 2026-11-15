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

// Smaller places inside a Boston neighborhood, as Google Places names them in the
// `neighborhood` address component, mapped to the neighborhood a reader knows. Production
// had "27 Lanark Road" stored as "Aberdeen" while every seeded row on the same street says
// "Brighton". Every value here is a name in `BOSTON_LOCALITY_NAMES`.
//
// This is a display and storage alias only. It is deliberately NOT part of
// `BOSTON_LOCALITY_NAMES`: identity and dedupe strip those names off the end of a street,
// and "Fort Point" or "Savin Hill" there would change address keys. Three keys here
// ('Dorchester Center', 'Roxbury Crossing', 'Readville') are also postal city names in
// that list; that is fine, the two lists answer different questions.
//
// Keys are in display form; `locality.ts` normalizes them for lookup.
export const BOSTON_SUB_AREAS: Readonly<Record<string, string>> = {
  Aberdeen: 'Brighton',
  'Oak Square': 'Brighton',
  'Brighton Center': 'Brighton',
  'Cleveland Circle': 'Brighton',
  'Packards Corner': 'Allston',
  Kenmore: 'Fenway',
  Longwood: 'Fenway',
  'Audubon Circle': 'Fenway',
  'Bay Village': 'South End',
  'Leather District': 'Downtown',
  'Financial District': 'Downtown',
  'Downtown Crossing': 'Downtown',
  'Fort Point': 'Seaport',
  'City Point': 'South Boston',
  'Savin Hill': 'Dorchester',
  'Fields Corner': 'Dorchester',
  'Codman Square': 'Dorchester',
  Ashmont: 'Dorchester',
  'Lower Mills': 'Dorchester',
  Neponset: 'Dorchester',
  'Uphams Corner': 'Dorchester',
  'Dorchester Center': 'Dorchester',
  'Egleston Square': 'Jamaica Plain',
  'Hyde Square': 'Jamaica Plain',
  'Forest Hills': 'Jamaica Plain',
  'Jackson Square': 'Jamaica Plain',
  'Nubian Square': 'Roxbury',
  'Dudley Square': 'Roxbury',
  'Roxbury Crossing': 'Roxbury',
  'Orient Heights': 'East Boston',
  'Eagle Hill': 'East Boston',
  'Jeffries Point': 'East Boston',
  'Maverick Square': 'East Boston',
  Fairmount: 'Hyde Park',
  Readville: 'Hyde Park',
  'Bellevue Hill': 'West Roxbury',
};

// The neighborhood of each Boston ZIP that the city's own address file names almost
// uniformly, for a Boston building whose supplied neighborhood is not a name in
// `BOSTON_LOCALITY_NAMES` or `BOSTON_SUB_AREAS`. Google Places sometimes hands back a
// micro-area of its own that the city does not use ("Commonwealth", "St. Elizabeth's"), and
// "Commonwealth" alone covers addresses in both Allston (02134) and Brighton (02135), so no
// fixed alias can place it. The ZIP can.
//
// Measured 2026-11-14 on the seeded buildings, whose neighborhood is SAM's
// MAILING_NEIGHBORHOOD: a ZIP is listed when at least 95% of its parcels share one name.
// Left out on purpose: the central ZIPs (SAM names them plain "Boston"), 02118 (87%
// "Roxbury", though readers call it the South End), 02120 (94% Mission Hill), 02136 (86%
// Hyde Park, 14% Mattapan) and 02467 (Chestnut Hill, shared with Newton and Brookline). A
// building there keeps no neighborhood and reads as "Boston", which is never wrong.
//
// Keys are five-digit ZIPs. Every value is a name in `BOSTON_LOCALITY_NAMES`.
export const BOSTON_ZIP_NEIGHBORHOODS: Readonly<Record<string, string>> = {
  '02119': 'Roxbury',
  '02121': 'Dorchester',
  '02122': 'Dorchester',
  '02124': 'Dorchester',
  '02125': 'Dorchester',
  '02126': 'Mattapan',
  '02127': 'South Boston',
  '02128': 'East Boston',
  '02129': 'Charlestown',
  '02130': 'Jamaica Plain',
  '02131': 'Roslindale',
  '02132': 'West Roxbury',
  '02134': 'Allston',
  '02135': 'Brighton',
};
