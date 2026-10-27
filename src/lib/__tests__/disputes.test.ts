import { describe, it, expect } from 'vitest';
import {
  extractReviewIdFromUrl,
  extractBuildingSlugFromUrl,
  normalizeReviewDates,
  validateDisputeForm,
  DISPUTE_REASONS,
} from '../disputes';

// ═══════════════════════════════════════════════════
// extractBuildingSlugFromUrl
// ═══════════════════════════════════════════════════

describe('extractBuildingSlugFromUrl', () => {
  const siteUrl = 'https://ratemyplace.org';

  it('reads the slug from a building page link', () => {
    expect(extractBuildingSlugFromUrl('https://ratemyplace.org/building/12-example-rd-boston', siteUrl))
      .toBe('12-example-rd-boston');
  });

  it('ignores a trailing slash, query and fragment', () => {
    expect(extractBuildingSlugFromUrl('https://ratemyplace.org/building/12-example-rd-boston/?tab=records#records', siteUrl))
      .toBe('12-example-rd-boston');
  });

  it('accepts surrounding whitespace from a paste', () => {
    expect(extractBuildingSlugFromUrl('  https://ratemyplace.org/building/12-example-rd-boston \n', siteUrl))
      .toBe('12-example-rd-boston');
  });

  it('rejects another origin', () => {
    expect(extractBuildingSlugFromUrl('https://evil.example/building/12-example-rd-boston', siteUrl)).toBeNull();
  });

  it('rejects pages that are not a building page', () => {
    expect(extractBuildingSlugFromUrl('https://ratemyplace.org/landlord/acme', siteUrl)).toBeNull();
    expect(extractBuildingSlugFromUrl('https://ratemyplace.org/building/', siteUrl)).toBeNull();
    expect(extractBuildingSlugFromUrl('https://ratemyplace.org/building/a/b', siteUrl)).toBeNull();
    expect(extractBuildingSlugFromUrl('https://ratemyplace.org/building/%27or%201=1', siteUrl)).toBeNull();
  });

  it('rejects text that is not a URL', () => {
    expect(extractBuildingSlugFromUrl('12 Example Rd', siteUrl)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════
// normalizeReviewDates
// ═══════════════════════════════════════════════════

describe('normalizeReviewDates', () => {
  it('reduces a card range to lowercase words', () => {
    expect(normalizeReviewDates('Fall 2023 · Current')).toBe('fall 2023 current');
  });

  it('matches however the range is punctuated or capitalised', () => {
    const want = normalizeReviewDates('Summer 2021 · 2023');
    for (const typed of ['SUMMER 2021 · 2023', 'summer 2021 - 2023', 'Summer 2021 – 2023', 'Summer 2021 to 2023', ' summer  2021,2023 ']) {
      expect(normalizeReviewDates(typed)).toBe(want);
    }
  });

  it('keeps the "2020 or earlier" bucket intact', () => {
    expect(normalizeReviewDates('Spring 2015 · 2020 or earlier')).toBe('spring 2015 2020 or earlier');
  });

  it('is empty for blank input', () => {
    expect(normalizeReviewDates('  · ')).toBe('');
  });
});

// ═══════════════════════════════════════════════════
// extractReviewIdFromUrl
// ═══════════════════════════════════════════════════

describe('extractReviewIdFromUrl', () => {
  const siteUrl = 'https://ratemyplace.org';

  it('extracts review ID from hash pattern', () => {
    const url = 'https://ratemyplace.org/building/123#review-abc123';
    const result = extractReviewIdFromUrl(url, siteUrl);
    expect(result).toBe('abc123');
  });

  it('extracts review ID from edit pattern', () => {
    const url = 'https://ratemyplace.org/review/edit/xyz789';
    const result = extractReviewIdFromUrl(url, siteUrl);
    expect(result).toBe('xyz789');
  });

  it('returns null for wrong origin', () => {
    const url = 'https://evil.com/building/123#review-abc123';
    const result = extractReviewIdFromUrl(url, siteUrl);
    expect(result).toBeNull();
  });

  it('returns null for malformed URL', () => {
    const url = 'not a url';
    const result = extractReviewIdFromUrl(url, siteUrl);
    expect(result).toBeNull();
  });

  it('returns null for URL with no review ID', () => {
    const url = 'https://ratemyplace.org/building/123';
    const result = extractReviewIdFromUrl(url, siteUrl);
    expect(result).toBeNull();
  });

  it('handles URLs with query parameters', () => {
    const url = 'https://ratemyplace.org/building/123?foo=bar#review-abc123';
    const result = extractReviewIdFromUrl(url, siteUrl);
    expect(result).toBe('abc123');
  });
});

// ═══════════════════════════════════════════════════
// validateDisputeForm
// ═══════════════════════════════════════════════════

describe('validateDisputeForm', () => {
  const validData = {
    landlordName: 'John Doe',
    landlordEmail: 'john@example.com',
    landlordPhone: '617-555-1234',
    disputeReasons: ['Factually incorrect information'],
    reviewUrl: 'https://ratemyplace.org/building/123#review-abc123',
  };

  it('returns no errors for valid data', () => {
    const errors = validateDisputeForm(validData);
    expect(errors).toHaveLength(0);
  });

  it('requires landlordName', () => {
    const errors = validateDisputeForm({ ...validData, landlordName: '' });
    expect(errors.some(e => e.field === 'landlordName')).toBe(true);
  });

  it('requires landlordEmail', () => {
    const errors = validateDisputeForm({ ...validData, landlordEmail: '' });
    expect(errors.some(e => e.field === 'landlordEmail')).toBe(true);
  });

  it('validates email format', () => {
    const errors = validateDisputeForm({ ...validData, landlordEmail: 'invalid-email' });
    expect(errors.some(e => e.field === 'landlordEmail' && e.message.includes('format'))).toBe(true);
  });

  it('requires landlordPhone', () => {
    const errors = validateDisputeForm({ ...validData, landlordPhone: '' });
    expect(errors.some(e => e.field === 'landlordPhone')).toBe(true);
  });

  it('requires at least one dispute reason', () => {
    const errors = validateDisputeForm({ ...validData, disputeReasons: [] });
    expect(errors.some(e => e.field === 'disputeReasons')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════
// DISPUTE_REASONS constant
// ═══════════════════════════════════════════════════

describe('DISPUTE_REASONS', () => {
  it('exports array of valid reasons', () => {
    expect(DISPUTE_REASONS).toBeDefined();
    expect(Array.isArray(DISPUTE_REASONS)).toBe(true);
    expect(DISPUTE_REASONS.length).toBeGreaterThan(0);
  });

  it('includes common dispute reasons', () => {
    expect(DISPUTE_REASONS).toContain('Factually incorrect information');
    expect(DISPUTE_REASONS).toContain('Defamatory or false statements');
    expect(DISPUTE_REASONS).toContain('Other');
  });
});
