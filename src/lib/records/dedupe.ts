// Reviewer dedupe onto existing (mostly seeded) Boston buildings, design spec Section 5.
// The same precedence as the seed's matcher: key the address, find every row on that street
// whose range contains it under the parity rule, break a tie with the ZIP, and refuse to
// guess — a null here means "create a row", never "merge onto the nearest".
import { BOSTON_LOCALITY_NAMES } from '../bostonLocalities';
import { isBostonLocality } from '../locality';
import { addressKey } from './identity';
import { rangeContains } from './seed/match';
import { zip5 } from './seed/sam';
import type { RecordsDb } from './types';

export interface DedupeInput { address: string; city: string | null; zip: string | null }
export interface DedupeHit { id: string; slug: string }

/**
 * Every spelling of a Boston building's `city` column worth seeking on: the locality
 * vocabulary as it is displayed (the seed writes 'Boston'; `POST /api/buildings` writes
 * whatever Google Places or the reviewer typed, often a neighborhood), plus the two other
 * casings of the city name itself. Exported so one test can assert the query plan against
 * the real bind list. Deduped, because 'Boston' is already the first locality name.
 */
export const CITY_CANDIDATES: readonly string[] = [
  ...new Set([...BOSTON_LOCALITY_NAMES, 'Boston', 'boston', 'BOSTON']),
];

const CITY_PLACEHOLDERS = CITY_CANDIDATES.map(() => '?').join(',');

interface CandidateRow {
  id: string;
  slug: string;
  source: 'user' | 'seed';
  st_num_lo: number;
  st_num_hi: number;
  zip_code: string | null;
  created_at: number;
}

export async function findBuildingByAddress(db: RecordsDb, input: DedupeInput): Promise<DedupeHit | null> {
  if (!isBostonLocality(input.city)) return null;
  const key = addressKey(input.address);
  if (!key) return null;

  // `city = 'Boston'` is how the seed writes it, but `POST /api/buildings` stores the city
  // as typed — and Google Places routinely hands back a neighborhood as the locality, so a
  // real user row on this street can be sitting under 'Dorchester'. Matching only 'Boston'
  // made every such row invisible to dedupe and cost a duplicate page.
  //
  // The predicate is therefore an `IN` over `CITY_CANDIDATES`: the whole Boston locality
  // vocabulary in display form, plus the two other casings of the city name itself. An `IN`
  // on the leading column of `idx_buildings_street (city, street_key)` is still a series of
  // index seeks — one per value — where the `LOWER(city)` that would catch every casing
  // would drop the index and scan 38k rows. `recordsDedupe.test.ts` asserts the plan.
  // Casings beyond the three listed ('DORCHESTER', say) remain out of reach; that is what a
  // city-normalization pass over `buildings` is for.
  //
  // Widening the city predicate widened the blast radius with it: four locality names are
  // not Boston's alone. Downtown, West End, North End and South End are all real city
  // fields elsewhere — New Haven has a Downtown too — so a non-Boston row saved under one
  // of them could become a merge target for a reviewer whose street name and house number
  // happen to line up. The ZIP guard below keeps the candidate set inside Boston: every
  // Boston ZIP is 021xx or 022xx. A NULL ZIP is kept rather than dropped, because a row
  // that never recorded one is not evidence of anywhere, and the precedence rules below
  // already decline to merge onto a candidate whose ZIP disagrees with the input.
  // `LIKE '021%'` on a prefix is a residual filter on rows the index seek already found,
  // not a second seek, so the plan is unchanged.
  //
  // Two gaps remain after it. A Massachusetts row outside Boston that shares a 021xx/022xx
  // ZIP (a Cambridge or Brookline row stored under one of those four names) is still
  // reachable in principle, and so is any casing outside the three above. Both close with
  // the same city-normalization pass.
  //
  // The span bound applies to user-entered rows only. The assessor's own ranges do go very
  // wide: `10-638 Georgetowne Drive` (a subsidized-housing development) spans 628 numbers,
  // and six seeded parcels exceed 100 — that one plus `408-826 Border St` (418),
  // `543-707 Georgetowne Dr` (164), `260-400 Mt Vernon St` (140), `124-226 Sherman Rd` and
  // `223-325 Columbia Rd` (102 each). Bounding those would strand every reviewer who lives
  // inside them, so seeded rows are never bounded: the assessor's range *is* the parcel. A
  // user-entered row carries no such authority — a span wider than any real parcel
  // ("2-9998 Washington St") is data entry, and unbounded it would contain every number on
  // the street and attract every reviewer on it. `seed/match.ts` reaches the same conclusion
  // from the other side: it treats that shape as undecidable rather than a match.
  const { results } = await db
    .prepare(
      `SELECT id, slug, source, st_num_lo, st_num_hi, zip_code, created_at FROM buildings WHERE city IN (${CITY_PLACEHOLDERS}) AND street_key = ? AND (zip_code IS NULL OR zip_code LIKE '021%' OR zip_code LIKE '022%') AND st_num_lo IS NOT NULL AND st_num_hi IS NOT NULL AND (source = 'seed' OR st_num_hi - st_num_lo <= 100)`,
    )
    .bind(...CITY_CANDIDATES, key.streetKey)
    .all<CandidateRow>();

  let contained = results.filter((row) => rangeContains({ numLo: row.st_num_lo, numHi: row.st_num_hi }, key));
  const zip = zip5(input.zip);
  if (contained.length === 1) {
    // A lone candidate still has to agree on the ZIP. Boston repeats street names across
    // neighborhoods, so the single row on "Gordon St" that happens to be seeded may be the
    // Allston one while the reviewer lives on the Brighton one. A disagreement here means a
    // different building: create a row rather than merge onto it. A ZIP missing on either
    // side proves nothing and is not held against the match.
    const rowZip = zip5(contained[0].zip_code);
    if (zip && rowZip && rowZip !== zip) return null;
  } else if (contained.length > 1) {
    // More than one row contains the number. Either they are different buildings (Boston
    // repeats street names across neighborhoods: two "15 Gordon St" parcels) and only the
    // ZIP can separate them, or they are twins on one ZIP (a user row and its seeded
    // double) and the user-first sort below picks the page that already has the reviews.
    // With an input ZIP and several candidates that all lack one, the filter empties and the
    // function refuses — deliberately stricter than the lone-candidate rule above, because
    // several rows on one street and number is exactly the case where guessing is wrong.
    if (zip) contained = contained.filter((row) => zip5(row.zip_code) === zip);
    else {
      const zipsSeen = new Set(contained.map((row) => zip5(row.zip_code)));
      if (zipsSeen.size > 1) return null;
    }
  }
  if (contained.length === 0) return null;

  // User rows first (they already hold the reviews), then the narrower range: when two
  // parcels both contain the number, the one that covers only it is the page about this
  // address rather than the block around it. `created_at` is the last resort.
  contained.sort(
    (a, b) =>
      (a.source === 'user' ? 0 : 1) - (b.source === 'user' ? 0 : 1) ||
      a.st_num_hi - a.st_num_lo - (b.st_num_hi - b.st_num_lo) ||
      a.created_at - b.created_at,
  );
  return { id: contained[0].id, slug: contained[0].slug };
}
