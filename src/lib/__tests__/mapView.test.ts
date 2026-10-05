import { describe, expect, it } from 'vitest';
import { BOSTON_BOX, inBostonBox } from '../bostonBox';
import {
  FIT_PADDING_PX,
  MAX_FIT_ZOOM,
  SINGLE_MARKER_ZOOM,
  boxAround,
  initialMapView,
  pointsToFit,
  shouldPanToUser,
} from '../mapView';

const LANARK = { lat: 42.3398, lng: -71.1543 }; // Brighton
const SOUTHIE = { lat: 42.3334, lng: -71.0495 }; // South Boston
const NEW_HAVEN = { lat: 41.3083, lng: -72.9279 };

describe('inBostonBox', () => {
  it('holds Boston and drops New Haven and null island', () => {
    expect(inBostonBox(LANARK.lat, LANARK.lng)).toBe(true);
    expect(inBostonBox(NEW_HAVEN.lat, NEW_HAVEN.lng)).toBe(false);
    expect(inBostonBox(0, 0)).toBe(false);
  });

  it('is the box the seed pipeline uses', () => {
    expect(BOSTON_BOX).toEqual({ minLat: 42.2, maxLat: 42.45, minLon: -71.2, maxLon: -70.9 });
  });
});

describe('pointsToFit', () => {
  it('keeps only the Boston markers when there are any', () => {
    expect(pointsToFit([LANARK, NEW_HAVEN, SOUTHIE])).toEqual([LANARK, SOUTHIE]);
  });

  it('falls back to every marker when none is in Boston', () => {
    const elsewhere = { lat: 41.31, lng: -72.92 };
    expect(pointsToFit([NEW_HAVEN, elsewhere])).toEqual([NEW_HAVEN, elsewhere]);
  });

  it('ignores a marker without a usable coordinate', () => {
    expect(pointsToFit([LANARK, { lat: Number.NaN, lng: -71 }])).toEqual([LANARK]);
  });

  it('returns nothing for no markers', () => {
    expect(pointsToFit([])).toEqual([]);
  });
});

describe('boxAround', () => {
  it('spans the extremes', () => {
    expect(boxAround([LANARK, SOUTHIE])).toEqual({
      north: LANARK.lat,
      south: SOUTHIE.lat,
      east: SOUTHIE.lng,
      west: LANARK.lng,
    });
  });

  it('is null for no points', () => {
    expect(boxAround([])).toBeNull();
  });
});

describe('initialMapView', () => {
  it('centers on a lone marker at street zoom', () => {
    expect(initialMapView([LANARK])).toEqual({
      kind: 'center',
      center: LANARK,
      zoom: SINGLE_MARKER_ZOOM,
      box: { north: LANARK.lat, south: LANARK.lat, east: LANARK.lng, west: LANARK.lng },
    });
  });

  it('centers when every marker sits on the same spot', () => {
    expect(initialMapView([LANARK, { ...LANARK }])?.kind).toBe('center');
  });

  it('fits the Boston markers and leaves an out-of-town one out of the view', () => {
    const view = initialMapView([LANARK, SOUTHIE, NEW_HAVEN]);
    expect(view).toEqual({
      kind: 'fit',
      box: { north: LANARK.lat, south: SOUTHIE.lat, east: SOUTHIE.lng, west: LANARK.lng },
      padding: FIT_PADDING_PX,
      maxZoom: MAX_FIT_ZOOM,
    });
  });

  it('centers on the one Boston marker even with others out of town', () => {
    expect(initialMapView([NEW_HAVEN, LANARK])).toMatchObject({ kind: 'center', center: LANARK });
  });

  it('has no view without markers', () => {
    expect(initialMapView([])).toBeNull();
  });

  it('clamps to street zoom, no closer', () => {
    expect(MAX_FIT_ZOOM).toBe(15);
    expect(SINGLE_MARKER_ZOOM).toBe(15);
    expect(FIT_PADDING_PX).toBe(48);
  });
});

describe('shouldPanToUser', () => {
  const fitted = { north: 42.36, south: 42.33, east: -71.04, west: -71.16 };

  it('pans to a reader inside the fitted area', () => {
    expect(shouldPanToUser({ lat: 42.35, lng: -71.1 }, fitted)).toBe(true);
  });

  it('counts the edge as inside', () => {
    expect(shouldPanToUser({ lat: 42.36, lng: -71.16 }, fitted)).toBe(true);
  });

  it('ignores a reader outside it', () => {
    expect(shouldPanToUser({ lat: 40.7128, lng: -74.006 }, fitted)).toBe(false);
    expect(shouldPanToUser({ lat: 42.35, lng: -71.2 }, fitted)).toBe(false);
  });

  it('does nothing before a fit or without a position', () => {
    expect(shouldPanToUser({ lat: 42.35, lng: -71.1 }, null)).toBe(false);
    expect(shouldPanToUser(null, fitted)).toBe(false);
  });
});
