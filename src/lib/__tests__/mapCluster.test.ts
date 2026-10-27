import { describe, it, expect } from 'vitest';
import {
  CLUSTER_COLORS,
  clusterBadgeSize,
  clusterBadgeStyle,
  clusterTitle,
  CLUSTER_BADGE_SIZES,
} from '../mapCluster';
import { SCORE_HEX } from '../scoring-colors';

// A cluster shows a count, not a score. A reader once took a cluster's "2", drawn in a band
// colour, for a Concerning score. These tests hold the badge to neutral colours only.
const BAND_HEXES = Object.values(SCORE_HEX).map((hex) => hex.toLowerCase());

/** "#1e293b" -> "30, 41, 59", the form a hex takes inside an rgb()/rgba() value. */
function rgbTriplet(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

describe('CLUSTER_COLORS', () => {
  it('uses no score band colour, including the no-score grey', () => {
    for (const value of Object.values(CLUSTER_COLORS)) {
      expect(BAND_HEXES).not.toContain(value.toLowerCase());
    }
  });
});

describe('clusterBadgeStyle', () => {
  it('draws a neutral filled circle with a ring', () => {
    const css = clusterBadgeStyle(36);
    expect(css).toContain('width: 36px');
    expect(css).toContain('height: 36px');
    expect(css).toContain('border-radius: 9999px');
    expect(css).toContain(`background: ${CLUSTER_COLORS.fill}`);
    expect(css).toContain(`color: ${CLUSTER_COLORS.text}`);
    // The ring: a light inner border plus an outer halo, which a score pin never has.
    expect(css).toContain(`border: 2px solid ${CLUSTER_COLORS.border}`);
    expect(css).toMatch(/box-shadow: 0 0 0 \d+px /);
  });

  it('contains no score band colour at any size, as a hex or as rgb', () => {
    for (const size of CLUSTER_BADGE_SIZES) {
      const css = clusterBadgeStyle(size).toLowerCase();
      for (const hex of BAND_HEXES) {
        expect(css).not.toContain(hex);
        expect(css).not.toContain(rgbTriplet(hex));
      }
    }
  });

  it('centres the badge on the cluster position rather than anchoring it like a pin', () => {
    expect(clusterBadgeStyle(42)).toContain('transform: translateY(50%)');
  });

  it('steps the count text up on the larger badges', () => {
    expect(clusterBadgeStyle(36)).toContain('font-size: 13px');
    expect(clusterBadgeStyle(42)).toContain('font-size: 13px');
    expect(clusterBadgeStyle(48)).toContain('font-size: 14px');
    expect(clusterBadgeStyle(56)).toContain('font-size: 14px');
  });
});

describe('clusterBadgeSize', () => {
  it('steps the badge up as the count grows', () => {
    expect(clusterBadgeSize(2)).toBe(CLUSTER_BADGE_SIZES[0]);
    expect(clusterBadgeSize(9)).toBe(CLUSTER_BADGE_SIZES[0]);
    expect(clusterBadgeSize(10)).toBe(CLUSTER_BADGE_SIZES[1]);
    expect(clusterBadgeSize(49)).toBe(CLUSTER_BADGE_SIZES[1]);
    expect(clusterBadgeSize(50)).toBe(CLUSTER_BADGE_SIZES[2]);
    expect(clusterBadgeSize(199)).toBe(CLUSTER_BADGE_SIZES[2]);
    expect(clusterBadgeSize(200)).toBe(CLUSTER_BADGE_SIZES[3]);
    expect(clusterBadgeSize(50_000)).toBe(CLUSTER_BADGE_SIZES[3]);
  });

  it('never shrinks as the count grows', () => {
    let previous = 0;
    for (let count = 1; count <= 1000; count++) {
      const size = clusterBadgeSize(count);
      expect(size).toBeGreaterThanOrEqual(previous);
      previous = size;
    }
  });

  it('stays at least a 32px touch target, even for a nonsense count', () => {
    expect(clusterBadgeSize(0)).toBeGreaterThanOrEqual(32);
    expect(clusterBadgeSize(Number.NaN)).toBe(CLUSTER_BADGE_SIZES[0]);
  });
});

describe('clusterTitle', () => {
  it('names the count of buildings and nothing about scores', () => {
    expect(clusterTitle(12)).toBe('12 buildings. Click to zoom in.');
    expect(clusterTitle(2)).toBe('2 buildings. Click to zoom in.');
  });

  it('uses the singular for one building', () => {
    expect(clusterTitle(1)).toBe('1 building. Click to zoom in.');
  });
});
