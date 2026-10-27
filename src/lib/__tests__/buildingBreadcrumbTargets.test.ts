import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The building page's breadcrumb links measured 39x17 as bare text, under the 24px floor for a
 * tap target. Each is padded to 28px tall, with a matching negative margin so the header does
 * not move. Read from source: the page needs a full database to render, and the classes are
 * the whole of the fix.
 */
const PAGE = join(process.cwd(), 'src/pages/building/[slug].astro');

describe('building page breadcrumb', () => {
  const source = readFileSync(PAGE, 'utf8');
  const nav = /<nav class="text-sm text-gray-500 mb-4">([\s\S]*?)<\/nav>/.exec(source)?.[1] ?? '';

  it('is found where the header starts', () => {
    expect(nav).toContain('href="/"');
    expect(nav).toContain('href="/search"');
  });

  it('pads every breadcrumb link to a tappable height without moving the header', () => {
    const links = Array.from(nav.matchAll(/<a href="[^"]*" class="([^"]*)"/g)).map((match) => match[1].split(/\s+/));
    expect(links).toHaveLength(2);
    for (const classes of links) {
      expect(classes).toEqual(expect.arrayContaining(['inline-block', 'py-1', '-my-1']));
    }
  });
});
