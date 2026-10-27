// How a marker cluster on /map looks, as pure decisions so they can be unit tested without
// Google Maps. `BuildingMap.tsx` is the glue: its clusterer renderer asks these for the
// badge's size, style and accessible name, and draws it.
//
// A cluster shows how many buildings it holds, never a score. It is a dark neutral circle
// with a ring and a whole-number count, so it cannot be mistaken for a score pin (a coloured
// teardrop holding a one-decimal score). It used to be filled with the band colour of its
// buildings' average score, and a reader took a cluster's "2" in the Concerning colour for a
// Concerning score. No colour here may be a score band colour; mapCluster.test.ts checks.
//
// Leaf module: no runtime imports. It is imported by the map island.

/** Badge colours: slate-800 fill, white count and inner border, translucent slate halo. */
export const CLUSTER_COLORS = {
  fill: '#1E293B',
  text: '#FFFFFF',
  border: '#FFFFFF',
  ring: 'rgba(30, 41, 59, 0.3)',
} as const;

/** Badge diameters in px, smallest first. The smallest keeps a usable touch target. */
export const CLUSTER_BADGE_SIZES = [36, 42, 48, 56] as const;

/** Badge diameter for a cluster of `count` buildings: under 10, under 50, under 200, more. */
export function clusterBadgeSize(count: number): number {
  if (!(count >= 10)) return CLUSTER_BADGE_SIZES[0];
  if (count < 50) return CLUSTER_BADGE_SIZES[1];
  if (count < 200) return CLUSTER_BADGE_SIZES[2];
  return CLUSTER_BADGE_SIZES[3];
}

/** Inline CSS for a cluster badge `size` px across. */
export function clusterBadgeStyle(size: number): string {
  return [
    `width: ${size}px`,
    `height: ${size}px`,
    'border-radius: 9999px',
    `background: ${CLUSTER_COLORS.fill}`,
    `color: ${CLUSTER_COLORS.text}`,
    `border: 2px solid ${CLUSTER_COLORS.border}`,
    // The outer ring, then the drop shadow every marker on the map has.
    `box-shadow: 0 0 0 4px ${CLUSTER_COLORS.ring}, 0 1px 3px rgba(15, 23, 42, 0.35)`,
    'display: flex',
    'align-items: center',
    'justify-content: center',
    `font-size: ${size >= 48 ? 14 : 13}px`,
    'font-weight: 600',
    'font-variant-numeric: tabular-nums',
    'cursor: pointer',
    // AdvancedMarkerElement anchors content at its bottom centre, which suits a pin but
    // would float a round badge half its height above the cluster. Centre it instead.
    'transform: translateY(50%)',
  ].join('; ');
}

/** Hover title and accessible name for a cluster badge. */
export function clusterTitle(count: number): string {
  return `${count} ${count === 1 ? 'building' : 'buildings'}. Click to zoom in.`;
}
