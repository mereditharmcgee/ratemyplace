import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import ReviewCard from '../../components/reviews/ReviewCard.astro';

/**
 * Public review cards carry one trust label: the document-verified badge, shown only
 * when an admin approved a verification document (`is_verified = 1`). Email
 * verification proves an inbox, not a tenancy, so it stays in the reviewer's own
 * profile and the admin users table and never appears on a public card.
 *
 * The badge reads "Residency verified", not "Verified" or "Lease verified": the upload
 * accepts a lease, a utility bill, a rent receipt or mail, so what was checked is that
 * the tenant lived there. It appears once per card, next to the title.
 */

const TRUST_LABEL = 'Residency verified';

/** Visible text of every element whose own text is exactly `text`. */
function elementsWithText(html: string, text: string): Element[] {
  const root = document.createElement('div');
  root.innerHTML = html;
  return Array.from(root.querySelectorAll('*')).filter(
    (el) => el.children.length === 0 && el.textContent?.trim() === text,
  );
}

const baseReview = {
  id: 'review-1',
  review_title: 'Fine place',
  overall_score: 4.0,
  unit_type: '1br',
  would_recommend_new: 'yes',
  unit_structural: 4,
  building_common_areas: 4,
  landlord_maintenance: 4,
};

// Text unique to each badge component, so a hit means the component rendered.
const EMAIL_BADGE_MARKERS = ['Email verified', 'confirmed their email address'];
const DOCUMENT_BADGE_MARKER = 'verified their residency';

async function render(review: Record<string, unknown>): Promise<string> {
  const container = await AstroContainer.create();
  return container.renderToString(ReviewCard, { props: { review } });
}

describe('ReviewCard trust label', () => {
  it('shows no email badge for an email-verified reviewer', async () => {
    const html = await render({ ...baseReview, user_email_verified: 1, is_verified: 0 });
    for (const marker of EMAIL_BADGE_MARKERS) expect(html).not.toContain(marker);
    expect(html).not.toContain(DOCUMENT_BADGE_MARKER);
  });

  it('shows the document-verified badge, and still no email badge, when is_verified = 1', async () => {
    const html = await render({ ...baseReview, user_email_verified: 1, is_verified: 1 });
    for (const marker of EMAIL_BADGE_MARKERS) expect(html).not.toContain(marker);
    expect(html).toContain(DOCUMENT_BADGE_MARKER);
  });

  it('labels the badge "Residency verified", once per card', async () => {
    const html = await render({ ...baseReview, is_verified: 1 });
    expect(elementsWithText(html, TRUST_LABEL)).toHaveLength(1);
    // The old bare label is gone from the card.
    expect(elementsWithText(html, 'Verified')).toHaveLength(0);
  });

  it('puts the one badge in the title row, not the footer', async () => {
    const html = await render({ ...baseReview, is_verified: 1 });
    const [label] = elementsWithText(html, TRUST_LABEL);
    const row = label.closest('div');
    expect(row?.querySelector('h3')?.textContent).toBe(baseReview.review_title);
    expect(row?.textContent).not.toContain('Would recommend');
    // The longer label wraps under a long title on a phone rather than squeezing it.
    expect(row?.getAttribute('class')?.split(/\s+/)).toContain('flex-wrap');
  });

  it('shows no trust label on an unverified card', async () => {
    const html = await render({ ...baseReview, is_verified: 0 });
    expect(elementsWithText(html, TRUST_LABEL)).toHaveLength(0);
  });

  it.each([
    ['0', 0],
    ['null', null],
    ['missing', undefined],
  ])('shows no document-verified badge when is_verified is %s', async (_label, value) => {
    const html = await render({ ...baseReview, is_verified: value });
    expect(html).not.toContain(DOCUMENT_BADGE_MARKER);
  });
});

// Directories that are never public: the reviewer's own profile and the admin area.
const PRIVATE_PATHS = [
  'src/components/admin/',
  'src/components/profile/',
  'src/pages/admin/',
  'src/pages/api/',
  'src/pages/profile.astro',
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(astro|tsx|ts)$/.test(name)) out.push(full);
  }
  return out;
}

describe('public surfaces never render the email-verified badge', () => {
  const root = process.cwd();
  const publicFiles = [...sourceFiles(join(root, 'src/pages')), ...sourceFiles(join(root, 'src/components'))]
    .map((full) => relative(root, full).split(sep).join('/'))
    .filter((path) => !PRIVATE_PATHS.some((prefix) => path === prefix || path.startsWith(prefix)));

  it('the unused email badge component is gone', () => {
    expect(existsSync(join(root, 'src/components/ui/EmailVerifiedBadge.astro'))).toBe(false);
  });

  it('finds the public review surfaces it is meant to guard', () => {
    expect(publicFiles).toContain('src/components/reviews/ReviewCard.astro');
    expect(publicFiles).toContain('src/pages/building/[slug].astro');
    expect(publicFiles).toContain('src/pages/landlord/[slug].astro');
    expect(publicFiles).toContain('src/pages/property-manager/[slug].astro');
  });

  it('no public page or component imports EmailVerifiedBadge or reads the reviewer email flag', () => {
    const offenders = publicFiles.filter((path) => {
      const source = readFileSync(join(root, path), 'utf8');
      return source.includes('EmailVerifiedBadge') || source.includes('user_email_verified');
    });
    expect(offenders).toEqual([]);
  });
});
