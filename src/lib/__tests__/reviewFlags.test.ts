import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUILDING_VELOCITY_MIN,
  FLAGGED_TEXT_FIELDS,
  REVIEW_FLAG_CODES,
  REVIEW_FLAG_LABELS,
  REVIEW_FLAGS_LIST_LABEL,
  isReviewFlagCode,
  reviewFlags,
  textFlags,
  type FlaggedTextField,
  type ReviewFlagCode,
} from '../reviewFlags';

/**
 * Advisory moderation signals: codes only, computed when the admin list is read. The text
 * scan looks for contact details a reviewer may have left in prose; it never decides anything.
 */

describe('textFlags', () => {
  const cases: Array<[string, Partial<Record<FlaggedTextField, string>>, ReviewFlagCode[]]> = [
    ['plain email', { comments: 'write to someone@example.com' }, ['possible_email']],
    ['bracketed email', { comments: 'someone (at) example (dot) com' }, ['possible_email']],
    ['dashed phone', { comments: 'call 617-555-0123' }, ['possible_phone']],
    ['parenthesized phone', { landlord_name: '(617) 555 0199' }, ['possible_phone']],
    ['plus-one phone', { comments: '+1 617.555.0142' }, ['possible_phone']],
    ['link', { comments: 'see https://example.com/listing' }, ['possible_link']],
    ['www link', { comments: 'www.example.com' }, ['possible_link']],
    ['bare domain', { property_manager_name: 'examplerealty.com' }, ['possible_link']],
    ['an email is not also a link', { comments: 'someone@example.com' }, ['possible_email']],
    ['rent is not a phone', { comments: 'Rent went from $2,400 to $2,650 in 2023' }, []],
    ['a year range is not a phone', { comments: 'Lived here 2019-2023' }, []],
    ['ZIP+4 is not a phone', { comments: 'Mail goes to 02134-1234' }, []],
    ['an 11-digit run is not a phone', { comments: 'Ref 61755501234' }, []],
    ['a house number is not a phone', { comments: 'Unit 4B at 123 Example St' }, []],
    ['a time is not a phone', { comments: 'Quiet after 10:30 pm' }, []],
    ['a rating is not a link', { comments: 'I give it 4.5/5 overall' }, []],
  ];

  it.each(cases)('%s', (_name, text, codes) => {
    expect(textFlags(text)).toEqual(codes);
  });

  it('scans every listed field, after NFKC and lowercasing', () => {
    expect(textFlags({ review_title: 'SOMEONE@EXAMPLE.COM' })).toEqual(['possible_email']);
    // Fullwidth digits fold to ASCII under NFKC.
    const fullwidth617 = String.fromCharCode(0xff16, 0xff11, 0xff17);
    expect(textFlags({ review_text: `${fullwidth617}-555-0123` })).toEqual(['possible_phone']);
    expect(textFlags({ landlord_name: 'Example Realty', comments: 'see www.example.com' })).toEqual(['possible_link']);
  });

  it('returns every kind it finds, in code order, once each', () => {
    expect(
      textFlags({
        review_title: 'www.example.com',
        comments: 'someone@example.com or 617-555-0123',
        review_text: 'other@example.com',
      }),
    ).toEqual(['possible_email', 'possible_phone', 'possible_link']);
  });

  it('never scans the unit number', () => {
    expect(FLAGGED_TEXT_FIELDS).not.toContain('unit_number');
    const text = { unit_number: '617-555-0123' } as unknown as Partial<Record<FlaggedTextField, string>>;
    expect(textFlags(text)).toEqual([]);
  });

  it('skips a value that is not a string', () => {
    const blob = { comments: new Uint8Array([0]), review_text: 42 } as unknown as Partial<Record<FlaggedTextField, string>>;
    expect(() => textFlags(blob)).not.toThrow();
    expect(textFlags(blob)).toEqual([]);
    expect(textFlags({ comments: null })).toEqual([]);
  });

  // A linear scan takes well under a millisecond on these; a backtracking pattern takes
  // seconds. Each string goes into all five fields at once, past the write caps.
  const ADVERSARIAL: Array<[string, string]> = [
    ['a x5000', 'a'.repeat(5000)],
    ['1 x5000', '1'.repeat(5000)],
    ['. x5000', '.'.repeat(5000)],
    ['- x5000', '-'.repeat(5000)],
    ['@ x5000', '@'.repeat(5000)],
    ['a@ x2500', 'a@'.repeat(2500)],
    ['a. x2500', 'a.'.repeat(2500)],
    ['1- x2500', '1-'.repeat(2500)],
  ];

  it.each(ADVERSARIAL)('runs in linear time on %s', (_name, value) => {
    const text = Object.fromEntries(FLAGGED_TEXT_FIELDS.map((field) => [field, value]));
    const started = performance.now();
    const result = textFlags(text);
    const elapsed = performance.now() - started;
    expect(Array.isArray(result)).toBe(true);
    expect(elapsed).toBeLessThan(50);
  });
});

describe('reviewFlags', () => {
  it('adds the building burst at the threshold and the repeat reviewer for another review', () => {
    expect(reviewFlags({ text: {}, buildingOrdinal: BUILDING_VELOCITY_MIN - 1, otherReviewsHere: 0 })).toEqual([]);
    expect(reviewFlags({ text: {}, buildingOrdinal: BUILDING_VELOCITY_MIN, otherReviewsHere: 0 })).toEqual(['building_velocity']);
    expect(reviewFlags({ text: {}, buildingOrdinal: 1, otherReviewsHere: 1 })).toEqual(['repeat_reviewer']);
  });

  it('returns all kinds together in code order with no duplicates', () => {
    const flags = reviewFlags({
      text: { comments: 'someone@example.com 617-555-0123 www.example.com', review_text: 'other@example.com' },
      buildingOrdinal: BUILDING_VELOCITY_MIN + 3,
      otherReviewsHere: 2,
    });
    expect(flags).toEqual([...REVIEW_FLAG_CODES]);
  });

  it('knows its codes and only those', () => {
    for (const code of REVIEW_FLAG_CODES) expect(isReviewFlagCode(code)).toBe(true);
    expect(isReviewFlagCode('flagged')).toBe(false);
    expect(isReviewFlagCode(undefined)).toBe(false);
  });
});

describe('review flag labels', () => {
  it('labels every code in plain text, with no em dash and no exclamation point', () => {
    const EM_DASH = String.fromCharCode(0x2014);
    const EXCLAMATION = String.fromCharCode(0x21);
    for (const label of [REVIEW_FLAGS_LIST_LABEL, ...REVIEW_FLAG_CODES.map((code) => REVIEW_FLAG_LABELS[code])]) {
      expect(label).not.toBe('');
      expect(label).not.toContain(EM_DASH);
      expect(label).not.toContain(EXCLAMATION);
    }
  });

  it('states the burst threshold from the constant', () => {
    expect(REVIEW_FLAG_LABELS.building_velocity).toContain(String(BUILDING_VELOCITY_MIN));
    const source = readFileSync(join(process.cwd(), 'src/lib/reviewFlags.ts'), 'utf8');
    expect(source).not.toContain('5 or more');
  });
});
