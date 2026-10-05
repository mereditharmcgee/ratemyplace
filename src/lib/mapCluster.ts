// How a marker cluster on /map looks, as pure decisions so they can be unit tested without
// Google Maps. `BuildingMap.tsx` is the glue: its clusterer renderer hands these the scores
// of the buildings in a cluster and draws the badge they describe.
//
// A cluster is coloured by the band of the plain average of its buildings' scores. This is
// a colour for the map only, never a published number: it is not weighted, not recency
// decayed, and does not appear anywhere as a score. Buildings with no score are left out of
// the average rather than counted as zero (a zero would drag every cluster toward Poor); a
// cluster with no scored building takes the no-score grey, the same as a lone unscored pin.
//
// Leaf module: imports only `scoring-colors`, which is the one home for band colours.

import { getScoreColor, getScoreHex } from './scoring-colors';

/** Mean of the finite scores, or null when there are none. */
export function averageScore(scores: readonly (number | null)[]): number | null {
  let sum = 0;
  let count = 0;
  for (const score of scores) {
    if (score === null || !Number.isFinite(score)) continue;
    sum += score;
    count += 1;
  }
  return count === 0 ? null : sum / count;
}

export interface ClusterAppearance {
  /** Plain mean of the scored buildings, or null when none is scored. */
  average: number | null;
  /** Badge fill, from `getScoreHex`. */
  hex: string;
  /** Band label of the average ("Good", "Mixed", ...), or null when none is scored. */
  label: string | null;
}

/** Colour and band label for a cluster holding buildings with these scores. */
export function clusterAppearance(scores: readonly (number | null)[]): ClusterAppearance {
  const average = averageScore(scores);
  return {
    average,
    hex: getScoreHex(average),
    label: average === null ? null : getScoreColor(average).label,
  };
}

/** Badge diameters in px, smallest first. The smallest keeps a usable touch target. */
export const CLUSTER_BADGE_SIZES = [36, 42, 48, 56] as const;

/** Badge diameter for a cluster of `count` buildings: under 10, under 50, under 200, more. */
export function clusterBadgeSize(count: number): number {
  if (!(count >= 10)) return CLUSTER_BADGE_SIZES[0];
  if (count < 50) return CLUSTER_BADGE_SIZES[1];
  if (count < 200) return CLUSTER_BADGE_SIZES[2];
  return CLUSTER_BADGE_SIZES[3];
}

/** Hover title and accessible name for a cluster badge. */
export function clusterTitle(count: number, label: string | null): string {
  const band = label === null ? 'no scores yet' : `average ${label}`;
  return `${count} buildings, ${band}. Click to zoom in.`;
}
