import { describe, it, expect } from 'vitest';
import {
  validateReviewForm,
  sanitizeText,
  isValidEmail,
  isValidZipCode,
  isSafeHttpUrl,
  enforceMaxLength,
  escapeLikePattern,
  validateDisputeForm,
  validateBugReport,
  validateContactForm,
  validateSearch,
} from '../validation';

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
    // rent_amount is typed number|undefined but validateReviewForm handles null at
    // runtime; cast the arg to the param type to assert null is accepted.
    const errors = validateReviewForm({ ...validData, rent_amount: null } as unknown as Parameters<typeof validateReviewForm>[0]);
    expect(errors.some(e => e.field === 'rent_amount')).toBe(false);
  });

  it('rejects score outside 1-5 range', () => {
    // Partial scores object exercises per-field validation; cast to the param type
    // since the function reads scores field-by-field and tolerates partial input.
    const errors = validateReviewForm({
      ...validData,
      scores: { building_quality: 6 },
    } as Parameters<typeof validateReviewForm>[0]);
    expect(errors.some(e => e.field.startsWith('scores.'))).toBe(true);
  });

  it('rejects non-integer score', () => {
    const errors = validateReviewForm({
      ...validData,
      scores: { building_quality: 3.5 },
    } as Parameters<typeof validateReviewForm>[0]);
    expect(errors.some(e => e.field.startsWith('scores.'))).toBe(true);
  });

  it('accepts valid integer scores 1-5', () => {
    for (let score = 1; score <= 5; score++) {
      const errors = validateReviewForm({
        ...validData,
        scores: { building_quality: score },
      } as Parameters<typeof validateReviewForm>[0]);
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

// ═══════════════════════════════════════════════════
// isValidEmail — VAL-05
// ═══════════════════════════════════════════════════

describe('isValidEmail', () => {
  it('rejects "notanemail"', () => {
    expect(isValidEmail('notanemail')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidEmail('')).toBe(false);
  });

  it('rejects email with whitespace', () => {
    expect(isValidEmail('a b@c.d')).toBe(false);
    expect(isValidEmail('a@b. c')).toBe(false);
  });

  it('rejects email missing @', () => {
    expect(isValidEmail('userexample.com')).toBe(false);
  });

  it('rejects email missing dot in domain', () => {
    expect(isValidEmail('user@example')).toBe(false);
  });

  it('accepts standard email', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
  });

  it('accepts minimal valid email a@b.c', () => {
    expect(isValidEmail('a@b.c')).toBe(true);
  });

  it('accepts email with subdomain', () => {
    expect(isValidEmail('user@mail.example.com')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════
// isValidZipCode — VAL-05
// ═══════════════════════════════════════════════════

describe('isValidZipCode', () => {
  it('accepts 5-digit zip', () => {
    expect(isValidZipCode('02134')).toBe(true);
  });

  it('accepts 5+4 zip', () => {
    expect(isValidZipCode('02134-5678')).toBe(true);
  });

  it('rejects 4-digit zip', () => {
    expect(isValidZipCode('1234')).toBe(false);
  });

  it('rejects 6-digit zip', () => {
    expect(isValidZipCode('123456')).toBe(false);
  });

  it('rejects letters in zip', () => {
    expect(isValidZipCode('0213A')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidZipCode('')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════
// enforceMaxLength — VAL-05
// ═══════════════════════════════════════════════════

describe('enforceMaxLength', () => {
  it('returns null for value at exactly max length', () => {
    expect(enforceMaxLength('a'.repeat(200), 200, 'name', 'Name')).toBeNull();
  });

  it('returns ValidationError for value one char over max', () => {
    const result = enforceMaxLength('a'.repeat(201), 200, 'name', 'Name');
    expect(result).not.toBeNull();
    expect(result!.field).toBe('name');
    expect(result!.message).toContain('200');
  });

  it('returns null for undefined value', () => {
    expect(enforceMaxLength(undefined, 100, 'x', 'X')).toBeNull();
  });

  it('returns null for null value', () => {
    expect(enforceMaxLength(null, 100, 'x', 'X')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(enforceMaxLength('', 100, 'x', 'X')).toBeNull();
  });

  it('message references the human-readable label', () => {
    const err = enforceMaxLength('a'.repeat(101), 100, 'description', 'Description');
    expect(err).not.toBeNull();
    expect(err!.message).toContain('Description');
  });
});

// ═══════════════════════════════════════════════════
// escapeLikePattern — VAL-04
// ═══════════════════════════════════════════════════

describe('escapeLikePattern', () => {
  it('escapes percent sign', () => {
    // input: '5%'  expected: '5\\%'
    expect(escapeLikePattern('5%')).toBe('5\\%');
  });

  it('escapes underscore', () => {
    // input: 'a_b'  expected: 'a\\_b'
    expect(escapeLikePattern('a_b')).toBe('a\\_b');
  });

  it('escapes backslash before wildcards (avoids double-escaping)', () => {
    // input bytes: backslash + percent (\%)
    // expected bytes: backslash backslash + backslash percent (\\\\%)
    // As JS string literals: input = '\\%', expected = '\\\\\\%'
    expect(escapeLikePattern('\\%')).toBe('\\\\\\%');
  });

  it('leaves non-special chars untouched', () => {
    expect(escapeLikePattern('Hello World 123')).toBe('Hello World 123');
  });

  it('returns empty string for empty input', () => {
    expect(escapeLikePattern('')).toBe('');
  });
});

// ═══════════════════════════════════════════════════
// validateDisputeForm — VAL-01
// ═══════════════════════════════════════════════════

describe('validateDisputeForm', () => {
  it('rejects "notanemail" as landlordEmail', () => {
    const errors = validateDisputeForm({
      landlordName: 'X', landlordEmail: 'notanemail', landlordPhone: '555',
    });
    expect(errors.some(e => e.field === 'landlordEmail')).toBe(true);
  });

  it('rejects disputeExplanation > 5000 chars', () => {
    const errors = validateDisputeForm({
      landlordName: 'X', landlordEmail: 'x@y.z', landlordPhone: '555',
      disputeExplanation: 'a'.repeat(5001),
    });
    expect(errors.some(e => e.field === 'disputeExplanation')).toBe(true);
  });

  it('accepts disputeExplanation at exactly 5000 chars', () => {
    const errors = validateDisputeForm({
      landlordName: 'X', landlordEmail: 'x@y.z', landlordPhone: '555',
      disputeExplanation: 'a'.repeat(5000),
    });
    expect(errors.some(e => e.field === 'disputeExplanation')).toBe(false);
  });

  it('rejects landlordName > 200 chars', () => {
    const errors = validateDisputeForm({
      landlordName: 'a'.repeat(201), landlordEmail: 'x@y.z', landlordPhone: '555',
    });
    expect(errors.some(e => e.field === 'landlordName')).toBe(true);
  });

  it('rejects landlordPhone > 30 chars', () => {
    const errors = validateDisputeForm({
      landlordName: 'X', landlordEmail: 'x@y.z', landlordPhone: 'a'.repeat(31),
    });
    expect(errors.some(e => e.field === 'landlordPhone')).toBe(true);
  });

  it('requires landlordName', () => {
    const errors = validateDisputeForm({
      landlordName: '', landlordEmail: 'x@y.z', landlordPhone: '555',
    });
    expect(errors.some(e => e.field === 'landlordName')).toBe(true);
  });

  it('requires landlordEmail', () => {
    const errors = validateDisputeForm({
      landlordName: 'X', landlordEmail: '', landlordPhone: '555',
    });
    expect(errors.some(e => e.field === 'landlordEmail')).toBe(true);
  });

  it('requires landlordPhone', () => {
    const errors = validateDisputeForm({
      landlordName: 'X', landlordEmail: 'x@y.z', landlordPhone: '',
    });
    expect(errors.some(e => e.field === 'landlordPhone')).toBe(true);
  });

  it('returns no errors for valid input', () => {
    const errors = validateDisputeForm({
      landlordName: 'Test Landlord', landlordEmail: 'landlord@example.com', landlordPhone: '555-1234',
    });
    expect(errors).toHaveLength(0);
  });

  it('collects all errors instead of short-circuiting', () => {
    const errors = validateDisputeForm({
      landlordName: '', landlordEmail: 'notanemail', landlordPhone: '',
    });
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ═══════════════════════════════════════════════════
// validateBugReport — VAL-02
// ═══════════════════════════════════════════════════

describe('validateBugReport', () => {
  it('rejects description shorter than 10 chars', () => {
    const errors = validateBugReport({ description: 'short', category: 'bug' });
    expect(errors.some(e => e.field === 'description')).toBe(true);
  });

  it('rejects description > 5000 chars', () => {
    const errors = validateBugReport({ description: 'a'.repeat(5001), category: 'bug' });
    expect(errors.some(e => e.field === 'description')).toBe(true);
  });

  it('rejects email with bad format when provided', () => {
    const errors = validateBugReport({
      email: 'notanemail',
      description: 'long enough description here',
      category: 'bug',
    });
    expect(errors.some(e => e.field === 'email')).toBe(true);
  });

  it('allows missing email (email is optional)', () => {
    const errors = validateBugReport({ description: 'long enough description here', category: 'bug' });
    expect(errors.some(e => e.field === 'email')).toBe(false);
  });

  it('rejects url > 2000 chars', () => {
    const errors = validateBugReport({
      description: 'long enough description here',
      url: 'a'.repeat(2001),
    });
    expect(errors.some(e => e.field === 'url')).toBe(true);
  });

  it('rejects a javascript: URL', () => {
    const errors = validateBugReport({
      description: 'long enough description here',
      url: 'javascript:fetch("/api/admin/users/x",{method:"PATCH"})',
    });
    expect(errors.some(e => e.field === 'url')).toBe(true);
  });

  it('accepts a normal https URL', () => {
    const errors = validateBugReport({
      description: 'long enough description here',
      url: 'https://ratemyplace.org/building/123-main-st-boston',
    });
    expect(errors.some(e => e.field === 'url')).toBe(false);
  });

  it('returns no errors for valid input', () => {
    const errors = validateBugReport({ description: 'long enough description here', category: 'bug' });
    expect(errors).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════
// isSafeHttpUrl — blocks dangerous schemes before render
// ═══════════════════════════════════════════════════

describe('isSafeHttpUrl', () => {
  it('accepts http and https', () => {
    expect(isSafeHttpUrl('http://example.com')).toBe(true);
    expect(isSafeHttpUrl('https://ratemyplace.org/x?y=1')).toBe(true);
  });

  it('rejects javascript:, data:, and vbscript: schemes', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeHttpUrl('vbscript:msgbox(1)')).toBe(false);
  });

  it('rejects relative URLs, empty, and null', () => {
    expect(isSafeHttpUrl('/building/x')).toBe(false);
    expect(isSafeHttpUrl('not a url')).toBe(false);
    expect(isSafeHttpUrl('')).toBe(false);
    expect(isSafeHttpUrl(null)).toBe(false);
    expect(isSafeHttpUrl(undefined)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════
// validateContactForm — VAL-03
// ═══════════════════════════════════════════════════

describe('validateContactForm', () => {
  it('rejects "notanemail" as email', () => {
    const errors = validateContactForm({
      name: 'Alice', email: 'notanemail', category: 'general', message: 'hello world long enough',
    });
    expect(errors.some(e => e.field === 'email')).toBe(true);
  });

  it('requires email', () => {
    const errors = validateContactForm({
      name: 'Alice', email: '', category: 'general', message: 'hello world long enough',
    });
    expect(errors.some(e => e.field === 'email')).toBe(true);
  });

  it('requires name 2-100 chars', () => {
    const shortErrors = validateContactForm({
      name: 'A', email: 'alice@example.com', category: 'general', message: 'hello world long enough',
    });
    expect(shortErrors.some(e => e.field === 'name')).toBe(true);

    const longErrors = validateContactForm({
      name: 'A'.repeat(101), email: 'alice@example.com', category: 'general', message: 'hello world long enough',
    });
    expect(longErrors.some(e => e.field === 'name')).toBe(true);
  });

  it('requires message 10-3000 chars', () => {
    const shortErrors = validateContactForm({
      name: 'Alice', email: 'alice@example.com', category: 'general', message: 'short',
    });
    expect(shortErrors.some(e => e.field === 'message')).toBe(true);

    const longErrors = validateContactForm({
      name: 'Alice', email: 'alice@example.com', category: 'general', message: 'a'.repeat(3001),
    });
    expect(longErrors.some(e => e.field === 'message')).toBe(true);
  });

  it('returns no errors for valid input', () => {
    const errors = validateContactForm({
      name: 'Alice',
      email: 'alice@example.com',
      category: 'general',
      message: 'a'.repeat(20),
    });
    expect(errors).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════
// validateSearch — VAL-04
// ═══════════════════════════════════════════════════

describe('validateSearch', () => {
  it('rejects query > 200 chars (after trim)', () => {
    const errors = validateSearch('a'.repeat(201));
    expect(errors.some(e => e.field === 'q')).toBe(true);
  });

  it('accepts query at exactly 200 chars', () => {
    const errors = validateSearch('a'.repeat(200));
    expect(errors).toHaveLength(0);
  });

  it('allows empty query (browse-all use case)', () => {
    expect(validateSearch('')).toHaveLength(0);
    expect(validateSearch(null)).toHaveLength(0);
  });

  it('trims whitespace before length check', () => {
    // 50 spaces + 200 a's + 50 spaces — trimmed length is 200, should pass
    const errors = validateSearch(' '.repeat(50) + 'a'.repeat(200) + ' '.repeat(50));
    expect(errors).toHaveLength(0);
  });

  it('rejects query that is 201 chars after trim', () => {
    // 1 leading space + 201 a's + 1 trailing space — trimmed length is 201
    const errors = validateSearch(' ' + 'a'.repeat(201) + ' ');
    expect(errors.some(e => e.field === 'q')).toBe(true);
  });
});
