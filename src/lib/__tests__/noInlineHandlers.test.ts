import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// No inline event handler attributes in Astro markup. The two banner dismiss buttons were the
// last ones: they had no accessible name, and an inline handler also stands in the way of
// dropping 'unsafe-inline' from the script policy. A dismiss button now carries
// data-dismiss="<banner id>" and the one delegated listener in BaseLayout handles it.

const ROOT = process.cwd();
const DIRS = ['src/pages', 'src/components'];

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else if (entry.name.endsWith('.astro')) found.push(full);
  }
  return found;
}

const FILES = DIRS.flatMap((dir) => walk(join(ROOT, dir)))
  .map((full) => relative(ROOT, full).replace(/\\/g, '/'))
  .sort();

/** An attribute such as onclick="..." or onChange='...'. A property assignment in a script has a dot before it. */
function inlineHandler(): RegExp {
  return new RegExp('(?<=\\s)on[a-z]+\\s*=\\s*["\']', 'gi');
}

describe('inline event handlers in Astro markup', () => {
  it('scans the pages and components', () => {
    expect(FILES.length).toBeGreaterThan(40);
    expect(FILES).toContain('src/pages/building/[slug].astro');
    expect(FILES).toContain('src/pages/profile.astro');
    expect(FILES).toContain('src/components/layout/BaseLayout.astro');
  });

  it('the pattern matches what it is meant to', () => {
    expect(inlineHandler().test('<button onclick="x()">')).toBe(true);
    expect(inlineHandler().test('<button ONCLICK = \'x()\'>')).toBe(true);
    expect(inlineHandler().test('<img onload="x()" />')).toBe(true);
    expect(inlineHandler().test('button.onclick = handler;')).toBe(false);
    expect(inlineHandler().test('<button data-dismiss="banner">')).toBe(false);
  });

  it('no page or component uses one', () => {
    const offenders: string[] = [];
    for (const path of FILES) {
      const lines = readFileSync(join(ROOT, path), 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        for (const match of line.matchAll(inlineHandler())) offenders.push(`${path}:${index + 1}: ${match[0]}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('dismiss buttons', () => {
  it('each is a named button whose banner is in the same file', () => {
    const found: string[] = [];
    for (const path of FILES) {
      const source = readFileSync(join(ROOT, path), 'utf8');
      for (const match of source.matchAll(/<button\b[^>]*\bdata-dismiss="([^"]+)"[^>]*>/g)) {
        const [tag, target] = match;
        found.push(`${path} -> ${target}`);
        expect(tag, `${path}: ${tag}`).toContain('type="button"');
        expect(tag, `${path}: ${tag}`).toContain('aria-label="Close"');
        expect(source, `${path} has no element with id ${target}`).toContain(`id="${target}"`);
      }
    }
    expect(found).toEqual([
      'src/pages/building/[slug].astro -> submitted-banner',
      'src/pages/profile.astro -> updated-banner',
    ]);
  });
});
