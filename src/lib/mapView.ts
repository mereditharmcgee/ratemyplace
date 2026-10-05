// The map page's first view, as pure decisions over plain coordinates so they can be unit
// tested without Google Maps. `BuildingMap.tsx` is the glue: it hands these the markers it
// just built and applies the answer once.
//
// The rule: fit the reviewed buildings once, on the first load that has any. Fit only the
// ones inside Boston when there are some, so a single New Haven review does not zoom the map
// out to half of New England. One marker (or several on the same spot) centers at street
// zoom instead of a zero-area fit. A reader's own location only moves the map when it falls
// inside the area just fitted; anywhere else it would pan away from every marker.

import { inBostonBox } from './bostonBox';

export interface LatLngPoint {
  lat: number;
  lng: number;
}

/** Same shape as `google.maps.LatLngBoundsLiteral`, so it can be passed to `fitBounds`. */
export interface LatLngBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

/** Zoom for a lone marker, and the closest a fit is allowed to land. */
export const SINGLE_MARKER_ZOOM = 15;
export const MAX_FIT_ZOOM = 15;
/** Pixels kept clear around the fitted markers, so edge pins are not cut off. */
export const FIT_PADDING_PX = 48;

export type InitialMapView =
  | { kind: 'center'; center: LatLngPoint; zoom: number; box: LatLngBox }
  | { kind: 'fit'; box: LatLngBox; padding: number; maxZoom: number };

/** The markers inside the Boston box when any exist, otherwise every marker with a coordinate. */
export function pointsToFit<T extends LatLngPoint>(points: readonly T[]): T[] {
  const usable = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  const inBoston = usable.filter((p) => inBostonBox(p.lat, p.lng));
  return inBoston.length > 0 ? inBoston : usable;
}

/** The smallest box holding every point, or null for none. */
export function boxAround(points: readonly LatLngPoint[]): LatLngBox | null {
  if (points.length === 0) return null;
  let north = -Infinity;
  let south = Infinity;
  let east = -Infinity;
  let west = Infinity;
  for (const { lat, lng } of points) {
    north = Math.max(north, lat);
    south = Math.min(south, lat);
    east = Math.max(east, lng);
    west = Math.min(west, lng);
  }
  return { north, south, east, west };
}

/** What the map should show first, or null when there are no markers to show. */
export function initialMapView(points: readonly LatLngPoint[]): InitialMapView | null {
  const fit = pointsToFit(points);
  const box = boxAround(fit);
  if (!box) return null;
  if (box.north === box.south && box.east === box.west) {
    return { kind: 'center', center: { lat: box.north, lng: box.east }, zoom: SINGLE_MARKER_ZOOM, box };
  }
  return { kind: 'fit', box, padding: FIT_PADDING_PX, maxZoom: MAX_FIT_ZOOM };
}

/** Whether to move the map to the reader: only when they stand inside the fitted area. */
export function shouldPanToUser(user: LatLngPoint | null, fitted: LatLngBox | null): boolean {
  if (!user || !fitted) return false;
  return (
    user.lat >= fitted.south
    && user.lat <= fitted.north
    && user.lng >= fitted.west
    && user.lng <= fitted.east
  );
}
