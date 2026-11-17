import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import ReviewCard from '../../components/reviews/ReviewCard.astro';
import { recommendAnswer } from '../reviewDisplay';

// "Would you recommend this unit?" is optional, and the form offers yes, no and maybe. The
// card used to read anything but yes or maybe as "Would not recommend", so a reviewer who
// skipped the question was shown recommending against the place. A skipped or unknown answer
// now shows no badge at all.

const LABELS = ['Would recommend', 'Maybe / It depends', 'Would not recommend'];

const baseReview = {
  id: 'review-1',
  review_title: 'Fine place',
  overall_score: 4.0,
  unit_type: '1br',
  unit_structural: 4,
  building_common_areas: 4,
  landlord_maintenance: 4,
};

async function render(review: Record<string, unknown>): Promise<string> {
  const container = await AstroContainer.create();
  return container.renderToString(ReviewCard, { props: { review } });
}

/** Text of every leaf element whose text is one of the badge labels. */
function badges(html: string): string[] {
  const root = document.createElement('div');
  root.innerHTML = html;
  return Array.from(root.querySelectorAll('span'))
    .filter((el) => el.children.length === 0)
    .map((el) => el.textContent?.trim() ?? '')
    .filter((text) => LABELS.includes(text));
}

describe('recommendAnswer', () => {
  it('keeps only the answers the form offers', () => {
    expect(recommendAnswer('yes')).toBe('yes');
    expect(recommendAnswer('maybe')).toBe('maybe');
    expect(recommendAnswer('no')).toBe('no');
    for (const value of [null, undefined, '', 'unsure', 'YES', 1, true, 0]) {
      expect(recommendAnswer(value)).toBeNull();
    }
  });
});

describe('ReviewCard recommend badge', () => {
  it.each([
    ['yes', 'Would recommend'],
    ['maybe', 'Maybe / It depends'],
    ['no', 'Would not recommend'],
  ])('shows one badge for %s', async (answer, label) => {
    expect(badges(await render({ ...baseReview, would_recommend_new: answer }))).toEqual([label]);
  });

  it.each([
    ['null', null],
    ['missing', undefined],
    ['empty', ''],
    ['unrecognised', 'unsure'],
  ])('shows no badge when the answer is %s', async (_label, value) => {
    const html = await render({ ...baseReview, would_recommend_new: value });
    expect(badges(html)).toEqual([]);
    for (const label of LABELS) expect(html).not.toContain(label);
  });

  it('drops the empty footer row when there is no badge', async () => {
    const withBadge = await render({ ...baseReview, would_recommend_new: 'yes' });
    const without = await render({ ...baseReview, would_recommend_new: null });
    const footers = (html: string) => {
      const root = document.createElement('div');
      root.innerHTML = html;
      return root.querySelectorAll('article > div.border-t').length;
    };
    expect(footers(withBadge)).toBe(1);
    expect(footers(without)).toBe(0);
  });
});
