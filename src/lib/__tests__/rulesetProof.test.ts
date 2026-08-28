import { describe, expect, it } from 'vitest';

describe('temporary main ruleset proof', () => {
  it('deliberately fails so the required quality check blocks this PR', () => {
    expect('quality gate').toBe('passing');
  });
});
