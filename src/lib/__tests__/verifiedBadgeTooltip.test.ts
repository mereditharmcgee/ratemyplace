import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import ReviewCard from '../../components/reviews/ReviewCard.astro';
import VerifiedBadge from '../../components/ui/VerifiedBadge.astro';

/**
 * QA regression: on a phone, any review card with the Verified badge made the whole page
 * scroll sideways (scrollWidth 505 on a 375px viewport). The hidden tooltip was centered
 * on the badge with unwrapped text, so it stuck out past the screen edge even at
 * opacity 0. The tooltip now wraps, starts at the left edge of the badge's row, and is
 * capped at that row's width, so it can never be wider than the card.
 */

const TOOLTIP_TEXT = 'This tenant verified their residency with a lease or similar document';

const verifiedReview = {
  id: 'review-1',
  review_title: 'Quiet building near the park',
  is_verified: 1,
  overall_score: 4.0,
  unit_type: '1br',
  would_recommend_new: 'yes',
  unit_structural: 4,
  building_common_areas: 4,
  landlord_maintenance: 4,
};

function parse(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

function classesOf(el: Element): string[] {
  return (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}

async function renderBadge(): Promise<HTMLElement> {
  const container = await AstroContainer.create();
  return parse(await container.renderToString(VerifiedBadge, { props: { size: 'sm' } }));
}

async function renderCard(): Promise<HTMLElement> {
  const container = await AstroContainer.create();
  return parse(await container.renderToString(ReviewCard, { props: { review: verifiedReview } }));
}

describe('VerifiedBadge tooltip', () => {
  it('keeps the tooltip text unchanged', async () => {
    const root = await renderBadge();
    const tip = root.querySelector('[data-verified-tooltip]');
    expect(tip?.textContent?.trim()).toBe(TOOLTIP_TEXT);
  });

  it('wraps inside a capped width instead of running on one long line', async () => {
    const root = await renderBadge();
    const tip = root.querySelector('[data-verified-tooltip]')!;
    const classes = classesOf(tip);

    expect(classes).not.toContain('whitespace-nowrap');
    expect(classes).toContain('whitespace-normal');
    expect(classes).toContain('w-max');
    expect(classes).toContain('max-w-[min(16rem,100%)]');
  });

  it('starts at the row edge rather than centering on the badge', async () => {
    const root = await renderBadge();
    const tip = root.querySelector('[data-verified-tooltip]')!;
    const classes = classesOf(tip);

    expect(classes).toContain('absolute');
    expect(classes).toContain('left-0');
    expect(classes).not.toContain('left-1/2');
    expect(classes).not.toContain('-translate-x-1/2');

    // The badge itself must not be the positioning anchor, or the tooltip would be
    // measured against the badge's few pixels of width again.
    const badge = tip.parentElement!;
    expect(classesOf(badge)).not.toContain('relative');
  });

  it('shows on hover and on keyboard focus', async () => {
    const root = await renderBadge();
    const tip = root.querySelector('[data-verified-tooltip]')!;
    const badge = tip.parentElement!;

    expect(badge.getAttribute('tabindex')).toBe('0');
    expect(classesOf(badge)).toContain('group');
    expect(classesOf(tip)).toContain('group-hover:opacity-100');
    expect(classesOf(tip)).toContain('group-focus:opacity-100');
  });

  it('keeps the two-word label on one line, so a long title wraps instead', async () => {
    const root = await renderBadge();
    const badge = root.querySelector('[data-verified-tooltip]')!.parentElement!;
    expect(classesOf(badge)).toEqual(expect.arrayContaining(['shrink-0', 'whitespace-nowrap']));
    // The tooltip still wraps inside its capped width.
    expect(classesOf(root.querySelector('[data-verified-tooltip]')!)).toContain('whitespace-normal');
  });
});

describe('VerifiedBadge tooltip semantics', () => {
  it('is the tooltip of the badge, tied to it by aria-describedby', async () => {
    const root = await renderBadge();
    const tip = root.querySelector('[data-verified-tooltip]')!;
    const badge = tip.parentElement!;
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(tip.id).toMatch(/^verified-tip-/);
    expect(badge.getAttribute('aria-describedby')).toBe(tip.id);
  });

  it('gives each badge its own tooltip id', async () => {
    const first = (await renderBadge()).querySelector('[data-verified-tooltip]')!.id;
    const second = (await renderBadge()).querySelector('[data-verified-tooltip]')!.id;
    expect(first).not.toBe(second);
  });

  it('hides the tooltip while the badge is marked dismissed (Escape)', async () => {
    const root = await renderBadge();
    const tip = root.querySelector('[data-verified-tooltip]')!;
    expect(tip.parentElement!.hasAttribute('data-verified-badge')).toBe(true);
    expect(classesOf(tip)).toContain('group-data-[dismissed]:opacity-0!');
  });
});

describe('ReviewCard anchors each Verified tooltip inside the card', () => {
  it('gives every badge a positioned row inside the article', async () => {
    const root = await renderCard();
    const article = root.querySelector('article')!;
    const tips = Array.from(root.querySelectorAll('[data-verified-tooltip]'));

    // One badge, next to the title. The footer no longer repeats it.
    expect(tips).toHaveLength(1);

    for (const tip of tips) {
      let anchor: Element | null = tip.parentElement;
      while (anchor && anchor !== article && !classesOf(anchor).includes('relative')) {
        anchor = anchor.parentElement;
      }
      // The anchor is a row inside the card, so the tooltip is capped at the card's width.
      expect(anchor).not.toBeNull();
      expect(anchor).not.toBe(article);
      expect(article.contains(anchor)).toBe(true);
    }
  });
});
