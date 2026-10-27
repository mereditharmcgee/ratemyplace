import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import reactRenderer from '@astrojs/react/server.js';
import { describe, expect, it } from 'vitest';
import BuildingPage from '../../pages/building/[slug].astro';
import { NAMED_PARTY_MIN_REVIEWS } from '../scoring';
import { getEarlyScoreTextColor } from '../scoring-colors';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';

/**
 * The building page below NAMED_PARTY_MIN_REVIEWS: the score is an early rating (lighter,
 * "· from 1 review", "Early rating"), issue and recommend rates are counts, and a maybe is
 * never shown as a no. At the threshold the page keeps its percentages.
 */

const suite = sqliteAvailable ? describe : describe.skip;

const BUILDING_ID = 'bldg-early';
const SLUG = '12-example-rd-boston';

interface SeedReview {
  recommend: 'yes' | 'no' | 'maybe' | null;
  pests?: boolean;
  heat?: boolean;
}

async function seed(reviews: SeedReview[]): Promise<TestD1Database> {
  const db = createRecordsTestDb();
  db.exec(
    'ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0; ' +
      'ALTER TABLE reviews ADD COLUMN unit_type TEXT; ' +
      'ALTER TABLE reviews ADD COLUMN review_title TEXT; ' +
      'ALTER TABLE reviews ADD COLUMN would_recommend_new TEXT; ' +
      'ALTER TABLE reviews ADD COLUMN had_pest_issues INTEGER DEFAULT 0; ' +
      'ALTER TABLE reviews ADD COLUMN had_heat_issues INTEGER DEFAULT 0; ' +
      'ALTER TABLE reviews ADD COLUMN had_water_issues INTEGER DEFAULT 0; ' +
      'ALTER TABLE reviews ADD COLUMN had_security_deposit_issues INTEGER DEFAULT 0; ' +
      'ALTER TABLE reviews ADD COLUMN unit_structural INTEGER;',
  );
  await insertBuilding(db, { id: BUILDING_ID, slug: SLUG, address: '12 Example Rd', neighborhood: 'Allston' });
  for (const [i, review] of reviews.entries()) {
    await db
      .prepare(
        `INSERT INTO reviews (id, building_id, status, overall_score, unit_type, review_title, would_recommend_new,
           had_pest_issues, had_heat_issues, unit_structural)
         VALUES (?, ?, 'approved', 3.9, '1br', ?, ?, ?, ?, 4)`,
      )
      .bind(`review-${i}`, BUILDING_ID, `Review ${i}`, review.recommend, review.pests ? 1 : 0, review.heat ? 1 : 0)
      .run();
  }
  return db;
}

async function renderPage(db: TestD1Database): Promise<HTMLElement> {
  const container = await AstroContainer.create();
  container.addServerRenderer({ renderer: reactRenderer });
  container.addClientRenderer({ name: '@astrojs/react', entrypoint: '@astrojs/react/client.js' });
  const html = await container.renderToString(BuildingPage, {
    params: { slug: SLUG },
    request: new Request(`https://ratemyplace.org/building/${SLUG}`),
    locals: { user: null, session: null, runtime: { env: { DB: db } } } as unknown as App.Locals,
    partial: false,
  });
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The label/value rows of the rating breakdown, as "label: value". */
function breakdownRows(root: HTMLElement): string[] {
  const card = Array.from(root.querySelectorAll('h3')).find((h) => text(h) === 'Rating breakdown')?.parentElement;
  if (!card) return [];
  return Array.from(card.querySelectorAll('div.flex.justify-between')).map((row) => {
    const [label, value] = Array.from(row.children).map((c) => text(c));
    return `${label}: ${value}`;
  });
}

/** Class lists of the sub-score numbers in the breakdown's tiles. */
function breakdownTileNumbers(root: HTMLElement): string[] {
  const card = Array.from(root.querySelectorAll('h3')).find((h) => text(h) === 'Rating breakdown')?.parentElement;
  return Array.from(card?.querySelectorAll('div.text-center > div.text-2xl') ?? []).map((el) => el.getAttribute('class') ?? '');
}

function commonIssueRows(root: HTMLElement): string[] {
  const card = Array.from(root.querySelectorAll('h3')).find((h) => text(h) === 'Common issues reported')?.parentElement;
  return Array.from(card?.querySelectorAll('li') ?? []).map((li) => Array.from(li.children).map((c) => text(c)).join(': '));
}

function unitRecommendLine(root: HTMLElement): string {
  return text(root.querySelector('.unit-card .text-right p.text-xs'));
}

suite('building page, one review', () => {
  it('shows the score as an early rating with its count beside it', async () => {
    const root = await renderPage(await seed([{ recommend: 'no', pests: true }]));
    const header = root.querySelector('[data-early-rating]');
    expect(header).not.toBeNull();
    expect(text(header)).toContain('3.9 · from 1 review');
    expect(text(header)).toContain('Early rating');
    expect(header!.querySelector('a')?.getAttribute('href')).toBe('/methodology#early-ratings');
    const number = header!.querySelector('span');
    expect(number?.getAttribute('class')).toContain(getEarlyScoreTextColor(3.9));
    expect(number?.getAttribute('class')).toContain('font-semibold');
  });

  it('notes the early rating in the breakdown and shows rates as counts', async () => {
    const root = await renderPage(await seed([{ recommend: 'no', pests: true, heat: true }]));
    expect(text(root.querySelector('[data-early-rating-note]'))).toBe('Early rating: based on 1 review.');
    const rows = breakdownRows(root);
    expect(rows).toContain('Would recommend: 0 of 1 review');
    expect(rows).toContain('Reported pest issues: 1 of 1 review');
    expect(rows).toContain('Reported heat/hot water issues: 1 of 1 review');
    expect(rows.join(' ')).not.toMatch(/\d%/);
    expect(commonIssueRows(root)).toEqual(['Pest issues: 1 of 1 review', 'Heat/hot water issues: 1 of 1 review']);
  });

  it('draws the sub-scores in the breakdown lighter too', async () => {
    const root = await renderPage(await seed([{ recommend: 'yes' }]));
    const tiles = breakdownTileNumbers(root);
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      expect(tile).toContain('font-semibold');
      expect(tile).toContain(getEarlyScoreTextColor(4));
    }
  });

  it('never shows a lone maybe as 0% or as a no', async () => {
    const root = await renderPage(await seed([{ recommend: 'maybe' }]));
    const rows = breakdownRows(root);
    expect(rows).toContain('Maybe / It depends: 1 of 1 review');
    expect(rows.some((r) => r.startsWith('Would recommend'))).toBe(false);
    expect(unitRecommendLine(root)).toBe('1 of 1 said maybe');
    expect(root.textContent).not.toMatch(/0% recommend/);
  });

  it('shows a yes as a count on the unit card too', async () => {
    const root = await renderPage(await seed([{ recommend: 'yes' }]));
    expect(breakdownRows(root)).toContain('Would recommend: 1 of 1 review');
    expect(unitRecommendLine(root)).toBe('1 of 1 would recommend');
  });
});

suite('building page, two reviews', () => {
  it('counts a maybe on its own, over every review that answered', async () => {
    const root = await renderPage(await seed([{ recommend: 'yes' }, { recommend: 'maybe' }]));
    expect(text(root.querySelector('[data-early-rating]'))).toContain('from 2 reviews');
    const rows = breakdownRows(root);
    expect(rows).toContain('Would recommend: 1 of 2 reviews');
    expect(rows).toContain('Maybe / It depends: 1 of 2 reviews');
    expect(unitRecommendLine(root)).toBe('1 of 2 would recommend, 1 maybe');
  });
});

suite('building page at the threshold', () => {
  const established = (): SeedReview[] => [
    { recommend: 'yes', pests: true },
    { recommend: 'no' },
    ...Array.from({ length: NAMED_PARTY_MIN_REVIEWS - 2 }, (): SeedReview => ({ recommend: 'yes' })),
  ];

  it('keeps the score and percentages as they were', async () => {
    const root = await renderPage(await seed(established()));
    expect(root.querySelector('[data-early-rating]')).toBeNull();
    expect(root.querySelector('[data-early-rating-note]')).toBeNull();
    expect(root.textContent).not.toContain('Early rating');
    expect(root.textContent).toContain(`${NAMED_PARTY_MIN_REVIEWS} reviews`);
    const rows = breakdownRows(root);
    const yes = NAMED_PARTY_MIN_REVIEWS - 1;
    expect(rows).toContain(`Would recommend: ${Math.round((yes / NAMED_PARTY_MIN_REVIEWS) * 100)}%`);
    expect(rows).toContain(`Reported pest issues: ${Math.round((1 / NAMED_PARTY_MIN_REVIEWS) * 100)}%`);
    const tiles = breakdownTileNumbers(root);
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) expect(tile).toContain('font-bold');
  });

  it('shows maybe answers as a count beside the percentage, outside it', async () => {
    const root = await renderPage(
      await seed([{ recommend: 'yes' }, { recommend: 'no' }, ...Array.from({ length: NAMED_PARTY_MIN_REVIEWS - 2 }, (): SeedReview => ({ recommend: 'maybe' }))]),
    );
    const rows = breakdownRows(root);
    const maybes = NAMED_PARTY_MIN_REVIEWS - 2;
    expect(rows).toContain('Would recommend: 50%');
    expect(rows).toContain(`Maybe / It depends: ${maybes} of ${NAMED_PARTY_MIN_REVIEWS} reviews`);
  });
});
