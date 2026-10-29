import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Phase 28 (A11Y-02): one visible focus indicator and reduced motion, site-wide, from the base
// layer of global.css. The indicator is a 2px outline in --focus-ring, teal-700 (5.47:1 on
// white) by default and white on the dark footer and the dark home hero.

const css = readFileSync(join(process.cwd(), 'src/styles/global.css'), 'utf8');

/** The last top-level @layer base block: the Phase 28 one is appended at the end of the file. */
function lastBaseLayer(): string {
  const start = css.lastIndexOf('@layer base');
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}') depth--;
    if (depth === 0) return css.slice(start, i + 1);
  }
  throw new Error('unbalanced @layer base block');
}

describe('global focus indicator and reduced motion', () => {
  it('defines the focus ring color as teal-700 at the root', () => {
    expect(lastBaseLayer()).toMatch(/:root\s*\{\s*--focus-ring:\s*var\(--color-teal-700\);?\s*\}/);
  });

  it('switches it to white on the dark footer and the dark hero', () => {
    expect(lastBaseLayer()).toMatch(/footer,\s*\.from-slate-800\s*\{\s*--focus-ring:\s*#fff;?\s*\}/);
  });

  it('still finds the dark hero by that class, with the home search inside it', () => {
    // If the hero gradient ever changes, the white ring is lost and teal-700 on dark slate is
    // about 2:1. This fails first, so the selector moves with it.
    const index = readFileSync(join(process.cwd(), 'src/pages/index.astro'), 'utf8');
    const heroOpen = index.match(/<div class="([^"]*\bfrom-slate-800\b[^"]*)">/);
    expect(heroOpen, 'the homepage hero wrapper carries from-slate-800').not.toBeNull();
    expect(index.indexOf('<HomeSearch')).toBeGreaterThan(index.indexOf(heroOpen![0]));
  });

  it('draws a 2px outline in that color on :focus-visible, at zero specificity', () => {
    const block = lastBaseLayer();
    const rule = block.match(/:where\(([^)]*\([^)]*\)[^)]*|[^)]*)\):focus-visible\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const [, selectors, body] = rule!;
    for (const selector of ['a', 'button', 'input', 'select', 'textarea', 'summary']) {
      expect(selectors.split(',').map((s) => s.trim())).toContain(selector);
    }
    expect(selectors).toContain('[tabindex]:not([tabindex="-1"])');
    expect(body).toMatch(/outline:\s*2px solid var\(--focus-ring\)/);
    expect(body).toMatch(/outline-offset:\s*2px/);
  });

  it('cuts animation and transition time when reduced motion is asked for', () => {
    const block = lastBaseLayer();
    const media = block.slice(block.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toContain('@media (prefers-reduced-motion: reduce)');
    expect(media).toMatch(/animation-duration:\s*0\.01ms !important/);
    expect(media).toMatch(/animation-iteration-count:\s*1 !important/);
    expect(media).toMatch(/transition-duration:\s*0\.01ms !important/);
    expect(media).toMatch(/scroll-behavior:\s*auto !important/);
  });

  it('keeps the placeholder rule in the first base layer', () => {
    expect(css.indexOf('input::placeholder')).toBeLessThan(css.lastIndexOf('@layer base'));
  });
});
