import { describe, expect, it } from 'vitest';
import { existingBuildingReviewPath } from '../reviewPaths';

describe('existingBuildingReviewPath', () => {
  it('encodes the building id', () => {
    expect(existingBuildingReviewPath('a b')).toBe('/review/new?building=a%20b');
  });

  it('adds the part-of flag only when asked', () => {
    expect(existingBuildingReviewPath('a b', { partOf: true })).toBe('/review/new?building=a%20b&partOf=1');
    expect(existingBuildingReviewPath('seed-1', { partOf: false })).toBe('/review/new?building=seed-1');
  });
});
