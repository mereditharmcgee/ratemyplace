// Reviewer dedupe onto existing (mostly seeded) Boston buildings, design spec Section 5.
// The same precedence as the seed's matcher: key the address, find every row on that street
// whose range contains it under the parity rule, break a tie with the ZIP, and refuse to
// guess — a null here means "create a row", never "merge onto the nearest".
import { isBostonLocality } from '../locality';
import { addressKey } from './identity';
import { rangeContains } from './seed/match';
import { zip5 } from './seed/sam';
import type { RecordsDb } from './types';

export interface DedupeInput { address: string; city: string | null; zip: string | null }
export interface DedupeHit { id: string; slug: string }

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

  // `city = 'Boston'` is how the seed writes it, and the (city, street_key) index this
  // rides on is keyed the same way. A row stored with any other spelling of the city —
  // 'boston', or a neighborhood name, which is what this endpoint saves when Google hands
  // one over — is simply not a candidate. Accepted: it can only cost a duplicate page, and
  // the fix belongs in a city-normalization pass over `buildings`, not in a LOWER() here
  // that would drop the index.
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
      "SELECT id, slug, source, st_num_lo, st_num_hi, zip_code, created_at FROM buildings WHERE city = 'Boston' AND street_key = ? AND st_num_lo IS NOT NULL AND st_num_hi IS NOT NULL AND (source = 'seed' OR st_num_hi - st_num_lo <= 100)",
    )
    .bind(key.streetKey)
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
