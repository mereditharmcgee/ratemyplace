import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import ReviewCard from '../../components/reviews/ReviewCard.astro';
import {
  RENT_BANDS,
  SQUARE_FOOTAGE_BANDS,
  rentBand,
  rentRangeAcross,
  rentRangeLabel,
  squareFootageBand,
  squareFootageRangeLabel,
} from '../reviewDisplay';
import { containsExactNumber } from './helpers/exactNumbers';

/**
 * Exact rent and square footage, together with bedrooms and bathrooms, can let a landlord
 * work out which unit (and so which tenant) wrote a review. The exact values stay stored;
 * every public surface shows a range from reviewDisplay.ts instead. The owner decided this
 * on 2026-11-17.
 */

describe('rent bands', () => {
  it('uses $250 bands with the lower bound inclusive', () => {
    expect(rentRangeLabel(2250)).toBe('$2,250 to $2,500/mo');
    expect(rentRangeLabel(2400)).toBe('$2,250 to $2,500/mo');
    expect(rentRangeLabel(2499)).toBe('$2,250 to $2,500/mo');
    expect(rentRangeLabel(2500)).toBe('$2,500 to $2,750/mo');
    expect(rentRangeLabel(2249)).toBe('$2,000 to $2,250/mo');
  });

  it('opens the band at the bottom and the top', () => {
    expect(rentRangeLabel(1)).toBe('Under $1,000/mo');
    expect(rentRangeLabel(450)).toBe('Under $1,000/mo');
    expect(rentRangeLabel(999)).toBe('Under $1,000/mo');
    expect(rentRangeLabel(1000)).toBe('$1,000 to $1,250/mo');
    expect(rentRangeLabel(5999)).toBe('$5,750 to $6,000/mo');
    expect(rentRangeLabel(6000)).toBe('$6,000+/mo');
    expect(rentRangeLabel(14500)).toBe('$6,000+/mo');
    expect(rentRangeLabel(50000)).toBe('$6,000+/mo');
  });

  it('keeps the open bounds on the band grid', () => {
    expect(RENT_BANDS.width).toBe(250);
    expect(RENT_BANDS.openBelow % RENT_BANDS.width).toBe(0);
    expect(RENT_BANDS.openFrom % RENT_BANDS.width).toBe(0);
    expect(rentBand(999)).toEqual({ lo: null, hi: RENT_BANDS.openBelow });
    expect(rentBand(6000)).toEqual({ lo: RENT_BANDS.openFrom, hi: null });
    expect(rentBand(2400)).toEqual({ lo: 2250, hi: 2500 });
  });

  it('reads a stored number or a numeric string, and drops a fraction into its band', () => {
    expect(rentRangeLabel('2400')).toBe('$2,250 to $2,500/mo');
    expect(rentRangeLabel(2249.99)).toBe('$2,000 to $2,250/mo');
  });

  it('shows nothing for a missing, zero, negative or unreadable rent', () => {
    for (const value of [null, undefined, '', '  ', 'abc', 0, -5, Number.NaN, Number.POSITIVE_INFINITY, {}, true]) {
      expect(rentRangeLabel(value), String(value)).toBeNull();
      expect(rentBand(value), String(value)).toBeNull();
    }
  });
});

describe('square footage bands', () => {
  it('uses 250 sq ft bands with the lower bound inclusive', () => {
    expect(squareFootageRangeLabel(750)).toBe('750 to 1,000 sq ft');
    expect(squareFootageRangeLabel(817)).toBe('750 to 1,000 sq ft');
    expect(squareFootageRangeLabel(999)).toBe('750 to 1,000 sq ft');
    expect(squareFootageRangeLabel(1000)).toBe('1,000 to 1,250 sq ft');
    expect(squareFootageRangeLabel(500)).toBe('500 to 750 sq ft');
    expect(squareFootageRangeLabel(1999)).toBe('1,750 to 2,000 sq ft');
  });

  it('opens the band at the bottom and the top', () => {
    expect(squareFootageRangeLabel(1)).toBe('Under 500 sq ft');
    expect(squareFootageRangeLabel(499)).toBe('Under 500 sq ft');
    expect(squareFootageRangeLabel(2000)).toBe('2,000+ sq ft');
    expect(squareFootageRangeLabel(4200)).toBe('2,000+ sq ft');
    expect(SQUARE_FOOTAGE_BANDS.width).toBe(250);
    expect(squareFootageBand(499)).toEqual({ lo: null, hi: SQUARE_FOOTAGE_BANDS.openBelow });
    expect(squareFootageBand(2000)).toEqual({ lo: SQUARE_FOOTAGE_BANDS.openFrom, hi: null });
  });

  it('shows nothing for a missing, zero or unreadable size', () => {
    for (const value of [null, undefined, '', 'big', 0, -1, Number.NaN]) {
      expect(squareFootageRangeLabel(value), String(value)).toBeNull();
    }
  });
});

describe('rentRangeAcross (a rent line for several reviews)', () => {
  it('is the review band itself when there is one review', () => {
    expect(rentRangeAcross([2137])).toBe('$2,000 to $2,250/mo');
    expect(rentRangeAcross([800])).toBe('Under $1,000/mo');
    expect(rentRangeAcross([9100])).toBe('$6,000+/mo');
  });

  it('is one band when every rent falls in the same band', () => {
    expect(rentRangeAcross([2137, 2001, 2249])).toBe('$2,000 to $2,250/mo');
    expect(rentRangeAcross([7000, 9100])).toBe('$6,000+/mo');
  });

  it('runs from the lowest band to the highest band', () => {
    expect(rentRangeAcross([2611, 2137])).toBe('$2,000 to $2,750/mo');
    expect(rentRangeAcross([2611, 9100])).toBe('$2,500 to $6,000+/mo');
  });

  it('starts a span that includes the open bottom band with "From under"', () => {
    // "Under $1,000 to $2,750/mo" could be read as "under ($1,000 to $2,750)".
    expect(rentRangeAcross([800, 2611])).toBe('From under $1,000 to $2,750/mo');
    expect(rentRangeAcross([800, 9100])).toBe('From under $1,000 to $6,000+/mo');
    // One open band on its own keeps the plain wording.
    expect(rentRangeAcross([800, 450])).toBe('Under $1,000/mo');
  });

  it('never names a review exact rent', () => {
    const rents = [2137, 2611, 3333, 1077];
    const line = rentRangeAcross(rents) ?? '';
    for (const rent of rents) expect(containsExactNumber(line, rent), `${rent} in ${line}`).toBe(false);
    // The same bands give the same line whatever the exact rents inside them are.
    expect(rentRangeAcross([2001, 2501])).toBe(rentRangeAcross([2249, 2749]));
  });

  it('skips missing rents, and shows nothing when none is given', () => {
    expect(rentRangeAcross([null, 2137, undefined, 0])).toBe('$2,000 to $2,250/mo');
    expect(rentRangeAcross([])).toBeNull();
    expect(rentRangeAcross([null, 0, ''])).toBeNull();
  });
});

describe('containsExactNumber (the leak detector the page tests use)', () => {
  it('finds a number written as text', () => {
    expect(containsExactNumber('$2,137/mo', 2137)).toBe(true);
    expect(containsExactNumber('817 sq ft', 817)).toBe(true);
  });

  it('finds a number serialized as JSON or as Astro island props', () => {
    // Astro serializes a prop value as [0,value], HTML-escaped inside the props attribute.
    expect(containsExactNumber('{&quot;rent_amount&quot;:[0,2137]}', 2137)).toBe(true);
    expect(containsExactNumber('{"rent_amount":2137,"x":1}', 2137)).toBe(true);
    expect(containsExactNumber('[0,817]', 817)).toBe(true);
    expect(containsExactNumber('[2137,2611]', 2137)).toBe(true);
    expect(containsExactNumber('[3,2137]', 2137)).toBe(true);
    expect(containsExactNumber('[1500, 2137]', 2137)).toBe(true);
    expect(containsExactNumber('[2611,817]', 817)).toBe(true);
  });

  it('does not count a number that is part of a different one', () => {
    expect(containsExactNumber('$12,137/mo', 2137)).toBe(false);
    expect(containsExactNumber('$2,000 to $2,250/mo', 2137)).toBe(false);
    expect(containsExactNumber('1,817 sq ft', 817)).toBe(false);
    expect(containsExactNumber('2.137', 2137)).toBe(false);
    expect(containsExactNumber('[0,21370]', 2137)).toBe(false);
  });
});

const baseReview = {
  id: 'review-ranges',
  review_title: 'Fictional review',
  review_text: 'Fictional text.',
  is_verified: 0,
  overall_score: 3.8,
  unit_type: '2br',
  bedrooms: '2',
  bathrooms: '1',
  move_in_season: 'fall',
  move_in_year: 2023,
  move_out_year_new: 'current',
  is_current_tenant: 1,
  unit_structural: 4,
  building_common_areas: 4,
  landlord_maintenance: 3,
};

async function renderCard(review: Record<string, unknown>): Promise<string> {
  const container = await AstroContainer.create();
  return container.renderToString(ReviewCard, { props: { review } });
}

function text(html: string): string {
  const el = document.createElement('div');
  el.innerHTML = html;
  return (el.textContent ?? '').replace(/\s+/g, ' ');
}

describe('ReviewCard shows rent and size as ranges', () => {
  it('shows the bands and never the exact numbers', async () => {
    const html = await renderCard({ ...baseReview, rent_amount: 2137, square_footage: 817 });
    expect(text(html)).toContain('$2,000 to $2,250/mo');
    expect(text(html)).toContain('750 to 1,000 sq ft');
    expect(containsExactNumber(html, 2137)).toBe(false);
    expect(containsExactNumber(html, 817)).toBe(false);
  });

  it('shows the open bands at the ends', async () => {
    const out = text(await renderCard({ ...baseReview, rent_amount: 7450, square_footage: 2350 }));
    expect(out).toContain('$6,000+/mo');
    expect(out).toContain('2,000+ sq ft');
  });

  it('shows neither when the reviewer skipped them', async () => {
    const out = text(await renderCard({ ...baseReview, rent_amount: null, square_footage: null }));
    expect(out).not.toContain('/mo');
    expect(out).not.toContain('sq ft');
  });
});

/**
 * Every source file that names a review's rent or square footage, and why it may. A new file
 * that names either fails here until it is listed: a public one must show the field only
 * through the range helpers in reviewDisplay.ts.
 */
const RENT_SIZE_READERS: Record<string, string> = {
  'src/components/admin/ReviewsTable.tsx': 'admin moderation view, exact on purpose',
  'src/pages/api/admin/reviews/index.ts': 'admin API, exact on purpose',
  'src/components/reviews/ReviewForm.tsx': "the reviewer's own form",
  'src/components/reviews/form-steps/types.ts': "the reviewer's own form",
  'src/components/reviews/form-steps/UnitDetailsStep.tsx': "the reviewer's own form",
  'src/components/reviews/ReviewEditForm.tsx': "the reviewer's own edit form, exact on purpose",
  'src/pages/api/reviews.ts': 'writes the review',
  'src/pages/api/reviews/[id].ts': "the author's own GET and the PATCH write; 403 for anyone else",
  'src/lib/api-types.ts': 'types',
  'src/lib/types.ts': 'types',
  'src/lib/validation.ts': 'input validation',
  'src/lib/reviewEdit.ts': 'edit write rules',
  'src/lib/reviewDisplay.ts': 'the range helpers',
  'src/lib/exampleReview.ts': 'made-up example data that ReviewCard turns into ranges (signupExampleReview.test.ts)',
  'src/components/reviews/ReviewCard.astro': 'public: ranges only',
  'src/pages/building/[slug].astro': 'public: ranges only',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.(astro|ts|tsx|js|mjs)$/.test(name) ? [path] : [];
  });
}

describe('public surfaces read rent and size only through the range helpers', () => {
  const root = process.cwd();
  const files = ['src/pages', 'src/components', 'src/lib', 'workers'].flatMap((dir) => sourceFiles(join(root, dir)));
  const FIELD = /rent_amount|square_footage|rentAmount|squareFootage/;

  it('lists every file that names the fields', () => {
    const naming = files
      .filter((file) => FIELD.test(readFileSync(file, 'utf8')))
      .map((file) => relative(root, file).replace(/\\/g, '/'))
      .sort();
    expect(naming).toEqual(Object.keys(RENT_SIZE_READERS).sort());
  });

  it('the review card reads each field once, inside its range helper', () => {
    const source = readFileSync(join(root, 'src/components/reviews/ReviewCard.astro'), 'utf8');
    expect(source.match(/review\.rent_amount/g)).toEqual(['review.rent_amount']);
    expect(source.match(/review\.square_footage/g)).toEqual(['review.square_footage']);
    expect(source).toContain('rentRangeLabel(review.rent_amount)');
    expect(source).toContain('squareFootageRangeLabel(review.square_footage)');
  });

  it('the building page builds its rent line from bands only', () => {
    const source = readFileSync(join(root, 'src/pages/building/[slug].astro'), 'utf8');
    expect(source).not.toMatch(/minRent|maxRent|Math\.(min|max)\([^)]*rent/i);
    expect(source).toContain('rentRangeAcross(');
    expect(source).not.toMatch(/square_footage/);
  });
});
