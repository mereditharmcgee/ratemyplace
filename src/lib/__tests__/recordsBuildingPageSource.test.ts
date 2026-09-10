import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'src/pages/building/[slug].astro'), 'utf8');

describe('building page source', () => {
  it('derives its title and description from buildingPageMeta', () => {
    expect(source).toMatch(/buildingPageMeta\(/);
    // Two loose matches rather than one on the whole tag: the scan is here to catch a page that
    // stops using the helper, not to freeze the attribute order or spacing of a layout element.
    expect(source).toMatch(/title=\{meta\.title\}/);
    expect(source).toMatch(/description=\{meta\.description\}/);
  });

  it('renders the no-reviews card from display.ts copy', () => {
    for (const name of ['NO_REVIEWS_CARD_TITLE', 'NO_REVIEWS_CARD_BODY', 'NO_REVIEWS_BREAKDOWN_COPY']) {
      expect(source).toContain(`{${name}}`);
    }
  });
});
