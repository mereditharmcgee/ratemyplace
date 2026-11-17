import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import ReviewCard from '../../components/reviews/ReviewCard.astro';
import SignupPage from '../../pages/auth/signup.astro';
import { EXAMPLE_REVIEW_COPY, exampleReview } from '../exampleReview';
import { getCurrentYear } from '../privacy';
import { containsExactNumber } from './helpers/exactNumbers';

/**
 * The sign-up page shows everyone an example of how an anonymous review will look, rendered
 * with the real review card and made-up data: no address, no names, no link to a building,
 * rent and size as ranges, the stay as a season and year. The page is noindex with no
 * structured data, so the example is never read as a real review.
 */

const YEAR = getCurrentYear();

async function renderSignup(search = ''): Promise<string> {
  const container = await AstroContainer.create();
  return container.renderToString(SignupPage, {
    locals: { user: null, session: null } as unknown as App.Locals,
    request: new Request(`https://ratemyplace.org/auth/signup${search}`),
  });
}

function parse(html: string): HTMLDivElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

function exampleSection(root: ParentNode): Element {
  const section = root.querySelector('[data-example-review]');
  if (!section) throw new Error('sign-up page has no example review');
  return section;
}

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('the example review data', () => {
  const review = exampleReview(YEAR);

  it('carries no address, name, unit number, account or building link', () => {
    for (const key of [
      'address',
      'building_address',
      'building_slug',
      'building_id',
      'landlord_name',
      'property_manager_name',
      'unit_number',
      'user_id',
      'user_email',
    ]) {
      expect(review, key).not.toHaveProperty(key);
    }
  });

  it('dates the stay relative to the current year, so the example never goes stale', () => {
    expect(review.move_in_year).toBe(YEAR - 2);
    expect(review.move_out_year_new).toBe(String(YEAR - 1));
  });

  it('keeps every string plain: no em dash, no exclamation point', () => {
    for (const value of [...Object.values(EXAMPLE_REVIEW_COPY), review.review_title, review.review_text]) {
      expect(value).not.toMatch(/[—!]/);
    }
  });
});

describe('sign-up page example review', () => {
  it('is labelled as an example and says what readers see and do not see', async () => {
    const section = exampleSection(parse(await renderSignup()));
    expect(text(section.querySelector('h2'))).toBe(EXAMPLE_REVIEW_COPY.heading);
    expect(text(section.querySelector('[data-example-label]'))).toBe(EXAMPLE_REVIEW_COPY.label);
    expect(text(section)).toContain(EXAMPLE_REVIEW_COPY.shown);
    expect(text(section)).toContain(EXAMPLE_REVIEW_COPY.hidden);
  });

  it('renders the real review card with the example data', async () => {
    const section = exampleSection(parse(await renderSignup()));
    const cards = section.querySelectorAll('article');
    expect(cards).toHaveLength(1);
    const container = await AstroContainer.create();
    const alone = parse(await container.renderToString(ReviewCard, { props: { review: exampleReview(YEAR) } }));
    expect(cards[0].outerHTML).toBe(alone.querySelector('article')?.outerHTML);
  });

  it('shows what a reader sees: unit type, season and year, rent and size as ranges', async () => {
    const card = exampleSection(parse(await renderSignup())).querySelector('article');
    const out = text(card);
    expect(out).toContain('2 bedrooms');
    expect(out).toContain(`Fall ${YEAR - 2} · ${YEAR - 1}`);
    expect(out).toContain('$2,250 to $2,500/mo');
    expect(out).toContain('750 to 1,000 sq ft');
    const review = exampleReview(YEAR);
    expect(containsExactNumber(card?.outerHTML ?? '', review.rent_amount)).toBe(false);
    expect(containsExactNumber(card?.outerHTML ?? '', review.square_footage)).toBe(false);
  });

  it('is never indexed or linked as a real review', async () => {
    const html = await renderSignup();
    const root = parse(html);
    const section = exampleSection(root);
    expect(section.querySelector('a[href^="/building/"], a[href^="/landlord/"], a[href^="/property-manager/"]')).toBeNull();
    expect(html).not.toContain('application/ld+json');
    expect(html).toMatch(/<meta name="robots" content="noindex/);
  });

  it('comes after the sign-up form, so the form stays first on a phone', async () => {
    const root = parse(await renderSignup());
    const form = root.querySelector('#signup-form');
    const section = exampleSection(root);
    expect(form).not.toBeNull();
    expect(form!.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows to everyone: from Write a review, and arriving with no return path', async () => {
    const fromReview = parse(await renderSignup('?redirect=' + encodeURIComponent('/review/new')));
    expect(fromReview.querySelector('[data-review-signin-note]')).not.toBeNull();
    expect(fromReview.querySelector('[data-example-review]')).not.toBeNull();
    const plain = parse(await renderSignup());
    expect(plain.querySelector('[data-review-signin-note]')).toBeNull();
    expect(plain.querySelector('[data-example-review]')).not.toBeNull();
  });
});
