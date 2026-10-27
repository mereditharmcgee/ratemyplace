// Which of the homepage's Google suggestions are buildings already on RateMyPlace.
//
// The homepage dropdown asks our own database first and Google only when that finds little.
// A pasted address ("12 Example Rd, Brighton, MA 02135") finds nothing in our database by
// substring, so Google answers it, and without this every such row read as a new address,
// even when the building has a page. Each suggestion is resolved read-only through the same
// resolver the review handoff uses (`findExistingBuilding`: exact place id, then the Boston
// address key with range containment), so "this is the page for that address" means the
// same thing here as it does when the reader clicks through to write a review.
//
// SERVER ONLY. Nothing here writes.
import { findExistingBuilding, resolveInputFrom, type ResolvedBuilding } from './buildingResolve';
import { bostonLocalityName, resolveBostonSubArea } from './locality';
import { predictionPlace, type AutocompletePrediction } from './places';
import type { RecordsDb } from './records/types';
import { currentReviewYear, recencyWeightedOverallSql } from './scoring-sql';

/** The building row a matched suggestion shows, in the shape `/api/search/autocomplete` uses. */
export interface ExistingBuildingSuggestion {
  slug: string;
  title: string;
  subtitle: string;
  reviewCount: number;
  avgScore: number | null;
}

export interface MatchedPrediction extends AutocompletePrediction {
  existing: ExistingBuildingSuggestion | null;
}

interface BuildingDisplayRow {
  id: string;
  slug: string;
  address: string;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  review_count: number | null;
  avg_overall: number | null;
}

// Allston and Brighton are one planning district, and Google and the city's own records
// draw the line between them differently. Treat the two names as agreeing.
const LOCALITY_GROUP: Readonly<Record<string, string>> = {
  Allston: 'Allston-Brighton',
  Brighton: 'Allston-Brighton',
};

function localityGroup(value: string | null | undefined): string | null {
  if (!value) return null;
  const name = bostonLocalityName(resolveBostonSubArea(value));
  if (!name || name === 'Boston') return null;
  return LOCALITY_GROUP[name] ?? name;
}

/**
 * An address-key match carries no ZIP from Google, so a lone building on a street name
 * Boston repeats ("Centre St") would match a suggestion in another neighborhood. When
 * Google names a Boston neighborhood and the building records a different one, the match is
 * refused and the suggestion stays an ordinary address row. When either side names only
 * "Boston", there is nothing to compare and the match stands; the row then shows our own
 * address and neighborhood, so the reader sees which page it opens.
 */
export function localityAgrees(googleLocality: string, building: { neighborhood: string | null; city: string | null }): boolean {
  const google = localityGroup(googleLocality);
  if (!google) return true;
  const ours = localityGroup(building.neighborhood) ?? localityGroup(building.city);
  if (!ours) return true;
  return ours === google;
}

async function resolvePrediction(db: RecordsDb, p: AutocompletePrediction): Promise<ResolvedBuilding | null> {
  const place = predictionPlace(p);
  const input = resolveInputFrom({
    placeId: p.placeId,
    streetAddress: p.mainText,
    city: place.locality,
    zipCode: place.zip ?? undefined,
  });
  // A suggestion always carries a place id; without one, the resolver's third tier (an
  // exact address and city anywhere) would run, which is a manual-entry rule.
  if (!input || !input.placeId) return null;
  return findExistingBuilding(db, input);
}

/**
 * READ-ONLY. Each prediction with `existing` set to the building it is, or null. At most one
 * resolver call per prediction plus one display query for all the hits.
 */
export async function matchPredictionsToBuildings(
  db: RecordsDb,
  predictions: AutocompletePrediction[],
): Promise<MatchedPrediction[]> {
  const hits = await Promise.all(predictions.map((p) => resolvePrediction(db, p)));
  const ids = [...new Set(hits.filter((h): h is ResolvedBuilding => h !== null).map((h) => h.id))];
  if (ids.length === 0) return predictions.map((p) => ({ ...p, existing: null }));

  const { results } = await db
    .prepare(
      `SELECT b.id, b.slug, b.address, b.neighborhood, b.city, b.state,
        COUNT(r.id) AS review_count,
        ${recencyWeightedOverallSql('r', currentReviewYear())} AS avg_overall
      FROM buildings b
      LEFT JOIN reviews r ON r.building_id = b.id AND r.status = 'approved'
      WHERE b.id IN (${ids.map(() => '?').join(',')})
      GROUP BY b.id`,
    )
    .bind(...ids)
    .all<BuildingDisplayRow>();
  const byId = new Map(results.map((row) => [row.id, row]));

  return predictions.map((p, i) => {
    const hit = hits[i];
    const row = hit ? byId.get(hit.id) : undefined;
    if (!hit || !row) return { ...p, existing: null };
    if (hit.tier === 'address_key' && !localityAgrees(predictionPlace(p).locality, row)) {
      return { ...p, existing: null };
    }
    return {
      ...p,
      existing: {
        slug: row.slug,
        title: row.address,
        subtitle: [row.neighborhood, row.city, row.state].filter(Boolean).join(', '),
        reviewCount: Number(row.review_count) || 0,
        avgScore: row.avg_overall ?? null,
      },
    };
  });
}
