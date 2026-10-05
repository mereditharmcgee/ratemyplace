// Boston's bounding box, wide enough for Hyde Park to Charlestown and the harbor islands.
// Verified against the city boundary 2026-09-09. Two consumers: the seed pipeline drops SAM
// rows outside it (never-geocoded rows carry 0,0, and a handful carry a coordinate from the
// wrong side of the state), and the map fits its first view to the markers inside it.
//
// A leaf module with no imports: `records/seed/sam.ts` runs inside the scheduler Worker, so
// anything it pulls in must stay runtime-agnostic.

export const BOSTON_BOX = { minLat: 42.2, maxLat: 42.45, minLon: -71.2, maxLon: -70.9 } as const;

/** Strictly inside the box; a point on the edge is treated as outside. */
export function inBostonBox(latitude: number, longitude: number): boolean {
  return (
    latitude > BOSTON_BOX.minLat
    && latitude < BOSTON_BOX.maxLat
    && longitude > BOSTON_BOX.minLon
    && longitude < BOSTON_BOX.maxLon
  );
}
