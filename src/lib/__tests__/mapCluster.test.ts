import { describe, it, expect } from 'vitest';
import {
  averageScore,
  clusterAppearance,
  clusterBadgeSize,
  clusterTitle,
  CLUSTER_BADGE_SIZES,
} from '../mapCluster';
import { SCORE_HEX, getScoreHex } from '../scoring-colors';

describe('averageScore', () => {
  it('averages the scored buildings', () => {
    expect(averageScore([4, 2])).toBe(3);
    expect(averageScore([4.5])).toBe(4.5);
  });

  it('leaves unscored buildings out of the average rather than counting them as zero', () => {
    expect(averageScore([4, null, 2, null])).toBe(3);
  });

  it('is null when no building in the cluster has a score', () => {
    expect(averageScore([null, null])).toBeNull();
    expect(averageScore([])).toBeNull();
  });

  it('rounds to one decimal, the rule /api/buildings/map applies per building', () => {
    // Unrounded, these come out as 3.9999999999999996 and 1.9999999999999998.
    expect(averageScore([4.6, 3.8, 3.6])).toBe(4);
    expect(averageScore([1.4, 3.3, 1.3])).toBe(2);
    expect(averageScore([4, 3, 3])).toBe(3.3);
  });

  it('ignores a non-finite score instead of poisoning the average', () => {
    expect(averageScore([4, Number.NaN, 2])).toBe(3);
    expect(averageScore([Number.POSITIVE_INFINITY])).toBeNull();
  });
});

describe('clusterAppearance', () => {
  it('colours the cluster by the band of its average, through getScoreHex', () => {
    // 4.5 and 3.7 average to 4.1: Good, even though one member is Mixed.
    const look = clusterAppearance([4.5, 3.7]);
    expect(look.average).toBeCloseTo(4.1);
    expect(look.hex).toBe(SCORE_HEX.good);
    expect(look.label).toBe('Good');
  });

  it('follows the band edges exactly as the markers do', () => {
    expect(clusterAppearance([3, 3]).hex).toBe(getScoreHex(3));
    expect(clusterAppearance([3, 3]).label).toBe('Mixed');
    expect(clusterAppearance([2.5]).label).toBe('Concerning');
    expect(clusterAppearance([1, 1.5]).hex).toBe(SCORE_HEX.poor);
  });

  it('lands a float-error average on the band its exact mean belongs to', () => {
    expect(clusterAppearance([4.6, 3.8, 3.6]).label).toBe('Good');
    expect(clusterAppearance([4.6, 3.8, 3.6]).hex).toBe(SCORE_HEX.good);
    expect(clusterAppearance([1.4, 3.3, 1.3]).label).toBe('Concerning');
  });

  it('keeps a just-below-the-edge average in the lower band, and an exact edge in the upper', () => {
    expect(clusterAppearance([3.9]).label).toBe('Mixed');
    expect(clusterAppearance([4.0]).label).toBe('Good');
  });

  it('uses the no-score colour when nothing in the cluster is scored', () => {
    const look = clusterAppearance([null, null, null]);
    expect(look.average).toBeNull();
    expect(look.hex).toBe(getScoreHex(null));
    expect(look.hex).toBe(SCORE_HEX.none);
    expect(look.label).toBeNull();
  });

  it('ignores unscored members when picking the colour', () => {
    expect(clusterAppearance([null, 1.2, null]).hex).toBe(SCORE_HEX.poor);
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
  it('names the count and the band of the average', () => {
    expect(clusterTitle(12, 'Good')).toBe('12 buildings, average Good. Click to zoom in.');
  });

  it('says so when no building in the cluster has a score', () => {
    expect(clusterTitle(3, null)).toBe('3 buildings, no scores yet. Click to zoom in.');
  });
});
