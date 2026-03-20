import { describe, it, expect } from 'vitest';
import { validateReviewForm, sanitizeText } from '../validation';

// ═══════════════════════════════════════════════════
// validateReviewForm
// ═══════════════════════════════════════════════════

describe('validateReviewForm', () => {
  // A valid minimal review form data
  const validData = {
    building_id: 'building-123',
    move_in_year: 2024,
    move_in_season: 'fall' as const,
    unit_type: '2br' as const,
    is_current_tenant: true,
  };

  it('returns no errors for valid data', () => {
    const errors = validateReviewForm(validData);
    expect(errors).toHaveLength(0);
  });

  it('requires building_id', () => {
    const errors = validateReviewForm({ ...validData, building_id: '' });
    expect(errors.some(e => e.field === 'building_id')).toBe(true);
  });

  it('requires valid move_in_year', () => {
    const errors = validateReviewForm({ ...validData, move_in_year: undefined });
    expect(errors.some(e => e.field === 'move_in_year')).toBe(true);
  });

  it('rejects move_in_year before 1900', () => {
    const errors = validateReviewForm({ ...validData, move_in_year: 1800 });
    expect(errors.some(e => e.field === 'move_in_year')).toBe(true);
  });

  it('rejects move_in_year in the future', () => {
    const errors = validateReviewForm({ ...validData, move_in_year: 2099 });
    expect(errors.some(e => e.field === 'move_in_year')).toBe(true);
  });

  it('accepts current year as move_in_year', () => {
    const currentYear = new Date().getFullYear();
    const errors = validateReviewForm({ ...validData, move_in_year: currentYear });
    expect(errors.some(e => e.field === 'move_in_year')).toBe(false);
  });

  it('requires valid season (legacy path)', () => {
    const errors = validateReviewForm({ ...validData, move_in_season: 'autumn' as any });
    expect(errors.some(e => e.field === 'move_in_season')).toBe(true);
  });

  it('accepts all valid seasons (legacy path)', () => {
    for (const season of ['winter', 'spring', 'summer', 'fall'] as const) {
      const errors = validateReviewForm({ ...validData, move_in_season: season });
      expect(errors.some(e => e.field === 'move_in_season')).toBe(false);
    }
  });

  // New move_in_month validation (replaces season when provided)
  it('accepts valid move_in_month (1-12)', () => {
    for (let month = 1; month <= 12; month++) {
      const errors = validateReviewForm({ ...validData, move_in_month: month });
      expect(errors.some(e => e.field === 'move_in_month')).toBe(false);
    }
  });

  it('rejects move_in_month of 0', () => {
    const errors = validateReviewForm({ ...validData, move_in_month: 0 });
    expect(errors.some(e => e.field === 'move_in_month')).toBe(true);
  });

  it('rejects move_in_month of 13', () => {
    const errors = validateReviewForm({ ...validData, move_in_month: 13 });
    expect(errors.some(e => e.field === 'move_in_month')).toBe(true);
  });

  it('rejects non-integer move_in_month', () => {
    const errors = validateReviewForm({ ...validData, move_in_month: 5.5 });
    expect(errors.some(e => e.field === 'move_in_month')).toBe(true);
  });

  it('skips season validation when move_in_month is provided', () => {
    // When move_in_month is provided, move_in_season is computed server-side — no season error expected
    const errors = validateReviewForm({ ...validData, move_in_month: 6 });
    expect(errors.some(e => e.field === 'move_in_season')).toBe(false);
  });

  it('requires valid unit_type', () => {
    const errors = validateReviewForm({ ...validData, unit_type: 'mansion' as any });
    expect(errors.some(e => e.field === 'unit_type')).toBe(true);
  });

  it('accepts all valid unit types', () => {
    for (const type of ['studio', '1br', '2br', '3br', '4br+', 'house'] as const) {
      const errors = validateReviewForm({ ...validData, unit_type: type });
      expect(errors.some(e => e.field === 'unit_type')).toBe(false);
    }
  });

  it('rejects move_out_year before move_in_year', () => {
    const errors = validateReviewForm({
      ...validData,
      is_current_tenant: false,
      move_out_year: 2023,
      move_in_year: 2024,
    });
    expect(errors.some(e => e.field === 'move_out_year')).toBe(true);
  });

  it('accepts move_out_year equal to move_in_year', () => {
    const errors = validateReviewForm({
      ...validData,
      is_current_tenant: false,
      move_out_year: 2024,
      move_in_year: 2024,
    });
    expect(errors.some(e => e.message.includes('after move-in'))).toBe(false);
  });

  it('skips move_out validation for current tenants', () => {
    const errors = validateReviewForm({
      ...validData,
      is_current_tenant: true,
      move_out_year: 1800, // Would be invalid, but should be ignored
    });
    expect(errors.some(e => e.field === 'move_out_year')).toBe(false);
  });

  it('rejects negative rent amount', () => {
    const errors = validateReviewForm({ ...validData, rent_amount: -100 });
    expect(errors.some(e => e.field === 'rent_amount')).toBe(true);
  });

  it('rejects rent over $50,000', () => {
    const errors = validateReviewForm({ ...validData, rent_amount: 51000 });
    expect(errors.some(e => e.field === 'rent_amount')).toBe(true);
  });

  it('accepts valid rent amount', () => {
    const errors = validateReviewForm({ ...validData, rent_amount: 2500 });
    expect(errors.some(e => e.field === 'rent_amount')).toBe(false);
  });

  it('accepts null rent amount', () => {
    const errors = validateReviewForm({ ...validData, rent_amount: null });
    expect(errors.some(e => e.field === 'rent_amount')).toBe(false);
  });

  it('rejects score outside 1-5 range', () => {
    const errors = validateReviewForm({
      ...validData,
      scores: { building_quality: 6 },
    });
    expect(errors.some(e => e.field.startsWith('scores.'))).toBe(true);
  });

  it('rejects non-integer score', () => {
    const errors = validateReviewForm({
      ...validData,
      scores: { building_quality: 3.5 },
    });
    expect(errors.some(e => e.field.startsWith('scores.'))).toBe(true);
  });

  it('accepts valid integer scores 1-5', () => {
    for (let score = 1; score <= 5; score++) {
      const errors = validateReviewForm({
        ...validData,
        scores: { building_quality: score },
      });
      expect(errors.some(e => e.field.startsWith('scores.'))).toBe(false);
    }
  });

  it('rejects title over 200 characters', () => {
    const errors = validateReviewForm({
      ...validData,
      review_title: 'A'.repeat(201),
    });
    expect(errors.some(e => e.field === 'review_title')).toBe(true);
  });

  it('accepts title at 200 characters', () => {
    const errors = validateReviewForm({
      ...validData,
      review_title: 'A'.repeat(200),
    });
    expect(errors.some(e => e.field === 'review_title')).toBe(false);
  });

  it('rejects review text over 5000 characters', () => {
    const errors = validateReviewForm({
      ...validData,
      review_text: 'A'.repeat(5001),
    });
    expect(errors.some(e => e.field === 'review_text')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════
// sanitizeText
// ═══════════════════════════════════════════════════

describe('sanitizeText', () => {
  it('trims leading and trailing whitespace', () => {
    expect(sanitizeText('  hello  ')).toBe('hello');
  });

  it('collapses multiple spaces into one', () => {
    expect(sanitizeText('hello    world')).toBe('hello world');
  });

  it('strips HTML tags', () => {
    expect(sanitizeText('hello <b>world</b>')).toBe('hello world');
  });

  it('strips script tags', () => {
    expect(sanitizeText('hello <script>alert("xss")</script> world')).toBe('hello alert("xss") world');
  });

  it('handles empty string', () => {
    expect(sanitizeText('')).toBe('');
  });

  it('handles string with only whitespace', () => {
    expect(sanitizeText('   ')).toBe('');
  });

  it('handles tabs and newlines', () => {
    expect(sanitizeText('hello\t\nworld')).toBe('hello world');
  });
});
