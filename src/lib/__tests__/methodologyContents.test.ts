import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A container render test is impractical for a static Astro page with no
// props, so this is a string-level check of the source: every <h2 must carry
// an id, the in-page contents nav must link to every one of those ids (and
// only those), and the six health/safety weighting subsections must be
// collapsible <details> elements (first one open) without touching the
// published methodology wording.

const filePath = join(process.cwd(), 'src/pages/methodology.astro');
const source = readFileSync(filePath, 'utf8');

function extractH2s(html: string): { attrs: string; text: string }[] {
  const matches = [...html.matchAll(/<h2([^>]*)>([\s\S]*?)<\/h2>/g)];
  return matches.map((m) => ({ attrs: m[1], text: m[2].trim() }));
}

describe('methodology.astro contents nav', () => {
  it('has a nav landmark labeled "Contents"', () => {
    expect(source).toMatch(/<nav\s+aria-label="Contents"/);
  });

  it('gives every h2 an id', () => {
    const h2s = extractH2s(source);
    expect(h2s.length).toBeGreaterThan(0);
    for (const h2 of h2s) {
      expect(h2.attrs).toMatch(/id=/);
    }
  });

  it('references every h2 id from the contents nav, one entry per heading', () => {
    const navMatch = source.match(/<nav\s+aria-label="Contents"[\s\S]*?<\/nav>/);
    expect(navMatch).not.toBeNull();
    const nav = navMatch![0];

    // The nav renders one <li>/<a> per entry in sectionHeadings, linking to
    // each heading's id and printing its title — the same array that stamps
    // ids onto every h2 further down the page. This only asserts that
    // `heading.id` and `heading.title` are referenced somewhere in the nav;
    // it doesn't pin the exact interpolation syntax (template literal vs.
    // string concatenation vs. anything else).
    expect(nav).toMatch(/sectionHeadings\.map/);
    expect(nav).toContain('heading.id');
    expect(nav).toContain('heading.title');

    const sectionHeadingsMatch = source.match(/const sectionHeadings = \[([\s\S]*?)\]\.map/);
    expect(sectionHeadingsMatch).not.toBeNull();
    const titles = [...sectionHeadingsMatch![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(titles.length).toBeGreaterThan(0);

    // One id-stamped h2 per declared heading — the nav (rendered from the
    // same array via .map) then produces exactly one link per h2.
    const h2s = extractH2s(source);
    expect(h2s.length).toBe(titles.length);
    for (const h2 of h2s) {
      expect(h2.attrs).toMatch(/id=\{sectionHeadings\[\d+\]\.id\}/);
    }
  });

  it('does not change any heading wording — titles appear verbatim in both the nav array and an h2', () => {
    const sectionHeadingsMatch = source.match(/const sectionHeadings = \[([\s\S]*?)\]\.map/);
    const titles = [...sectionHeadingsMatch![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const h2Texts = extractH2s(source).map((h) => h.text);

    for (const title of titles) {
      expect(h2Texts).toContain(title);
    }
  });
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('methodology.astro health/safety weighting disclosures', () => {
  it('wraps each of the six weighting items in a <details> with its h3 inside <summary>', () => {
    const itemTitles = [
      'Pest control',
      'Mold and moisture',
      'Structural integrity',
      'Climate control (heating and cooling)',
      'Plumbing',
      'Security',
    ];

    for (const title of itemTitles) {
      const pattern = new RegExp(
        `<details[^>]*>\\s*<summary[^>]*>[\\s\\S]*?<h3[^>]*>${escapeRegExp(title)}</h3>[\\s\\S]*?</summary>`
      );
      expect(source).toMatch(pattern);
    }
  });

  it('opens exactly the first weighting disclosure by default', () => {
    // Scope to the "Health and safety weighting" section specifically —
    // the substring between its h2 (not the contents-nav link of the same
    // text, which appears earlier in the page) and the next h2 — rather
    // than assuming its six <details> are the only ones on the page.
    const h2Match = source.match(/<h2[^>]*>Health and safety weighting<\/h2>/);
    expect(h2Match).not.toBeNull();
    const sectionStart = h2Match!.index! + h2Match![0].length;
    const nextH2 = source.indexOf('<h2', sectionStart);
    expect(nextH2).toBeGreaterThan(-1);
    const section = source.slice(sectionStart, nextH2);

    const detailsBlocks = [...section.matchAll(/<details([^>]*)>/g)];
    expect(detailsBlocks.length).toBe(6);
    expect(detailsBlocks[0][1]).toMatch(/\bopen\b/);
    for (const block of detailsBlocks.slice(1)) {
      expect(block[1]).not.toMatch(/\bopen\b/);
    }
  });
});
