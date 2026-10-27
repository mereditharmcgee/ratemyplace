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

  it('has one write-review link, in the header, for reviewed and unreviewed buildings alike', () => {
    // An unreviewed page used to carry three, one per "no reviews" block. The rendered layout,
    // records first when there is no review, is checked in buildingPageLayout.test.ts.
    expect(source.match(/\/review\/new\?building=/g)).toHaveLength(1);
  });
});
