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
  const { results } = await db
    .prepare(
      "SELECT id, slug, source, st_num_lo, st_num_hi, zip_code, created_at FROM buildings WHERE city = 'Boston' AND street_key = ? AND st_num_lo IS NOT NULL AND st_num_hi IS NOT NULL",
    )
    .bind(key.streetKey)
    .all<CandidateRow>();

  let contained = results.filter((row) => rangeContains({ numLo: row.st_num_lo, numHi: row.st_num_hi }, key));
  if (contained.length > 1) {
    // More than one row contains the number. Either they are different buildings (Boston
    // repeats street names across neighborhoods: two "15 Gordon St" parcels) and only the
    // ZIP can separate them, or they are twins on one ZIP (a user row and its seeded
    // double) and the user-first sort below picks the page that already has the reviews.
    const zip = zip5(input.zip);
    const zipsSeen = new Set(contained.map((row) => zip5(row.zip_code)));
    if (zip) contained = contained.filter((row) => zip5(row.zip_code) === zip);
    else if (zipsSeen.size > 1) return null;
  }
  if (contained.length === 0) return null;

  contained.sort((a, b) => (a.source === 'user' ? 0 : 1) - (b.source === 'user' ? 0 : 1) || a.created_at - b.created_at);
  return { id: contained[0].id, slug: contained[0].slug };
}
