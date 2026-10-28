import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// These text colors fail WCAG AA as text on the light surfaces the public site uses: paper,
// white, gray-50 and the tinted panels. The fix is the 700 shade, or 600 for purple and violet.
// Do not add an exemption list. A decorative icon or a large display figure that needs a
// lighter shade can use bare text-teal-600, which stays allowed. The guard also covers the
// dark footer and home hero, so light teal text there should use teal-300 or lighter.
//
// The scan reads raw source, comments included, the same way the records panel scan does, so
// a retired token quoted in a comment is a failure too.
//
// Admin is left out. AdminLayout puts a lighter teal gear icon on a dark slate bar, which
// passes, and the admin pages are handled on their own.

const ROOT = process.cwd();
const EXTENSIONS = ['.astro', '.tsx', '.ts', '.css'];
const EXCLUDED_PREFIXES = ['src/components/admin/', 'src/pages/admin/', 'src/pages/api/'];

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walk(full));
    } else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      found.push(full);
    }
  }
  return found;
}

const PUBLIC_FILES = walk(join(ROOT, 'src'))
  .map((full) => relative(ROOT, full).replace(/\\/g, '/'))
  .filter((path) => !path.includes('/__tests__/'))
  .filter((path) => !EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix)))
  .sort();

/**
 * Built from plain strings so the escapes survive. The lookarounds keep a token from matching
 * inside a longer class. Each call returns fresh objects, because a global regex carries
 * lastIndex from one call to the next.
 */
function bannedPatterns(): RegExp[] {
  return [
    // Teal 400 and 500 as text, bare or behind any variant. Best case is 2.42 on white.
    new RegExp('(?<![\\w-])text-teal-(?:400|500)(?![\\w-])', 'g'),
    // Teal 600 as a hover or focus text color. Best case is 3.66.
    new RegExp(
      '(?<![\\w-])(?:hover|focus|focus-visible|focus-within|active|group-hover|group-focus|peer-hover|peer-focus):text-teal-600(?![\\w-])',
      'g',
    ),
    // Colored text below 4.5 on the light surfaces: 3.82, 2.93, 3.59, 4.12 and 4.40 at best.
    new RegExp('(?<![\\w-])text-(?:red-500|yellow-600|orange-600|purple-500|violet-500)(?![\\w-])', 'g'),
    // Gray 400 placeholders. 2.37 on paper.
    new RegExp('(?<![\\w-])placeholder(?:-|:text-)gray-400(?![\\w-])', 'g'),
  ];
}

const [TEAL, TEAL_HOVER, COLORED, PLACEHOLDER] = [0, 1, 2, 3];

function matches(index: number, text: string): boolean {
  return bannedPatterns()[index].test(text);
}

function anyMatch(text: string): boolean {
  return bannedPatterns().some((pattern) => pattern.test(text));
}

describe('contrast tokens on the public site', () => {
  it('scans the public source and skips admin', () => {
    expect(PUBLIC_FILES.length).toBeGreaterThan(50);
    for (const path of [
      'src/components/ratings/ScoreCard.astro',
      'src/components/reviews/ReviewCard.astro',
      'src/pages/auth/signin.astro',
      'src/pages/building/[slug].astro',
      'src/styles/global.css',
    ]) {
      expect(PUBLIC_FILES).toContain(path);
    }
    for (const path of PUBLIC_FILES) {
      expect(path.startsWith('src/components/admin/')).toBe(false);
      expect(path.startsWith('src/pages/admin/')).toBe(false);
      expect(path.includes('/__tests__/')).toBe(false);
    }
  });

  it('patterns match what they are meant to', () => {
    expect(matches(TEAL, 'class="text-teal-500"')).toBe(true);
    expect(matches(TEAL, 'hover:text-teal-500')).toBe(true);
    expect(matches(TEAL_HOVER, 'className="hover:text-teal-600"')).toBe(true);
    expect(matches(TEAL_HOVER, 'group-focus:text-teal-600')).toBe(true);
    expect(matches(TEAL_HOVER, 'peer-focus:text-teal-600')).toBe(true);
    expect(matches(TEAL_HOVER, 'focus-within:text-teal-600')).toBe(true);
    expect(matches(COLORED, 'text-red-500 ml-1')).toBe(true);
    expect(matches(COLORED, 'text-violet-500')).toBe(true);
    expect(matches(PLACEHOLDER, 'placeholder-gray-400 focus:outline-none')).toBe(true);
    expect(matches(PLACEHOLDER, 'placeholder:text-gray-400')).toBe(true);

    expect(
      anyMatch(
        'focus:ring-teal-500 border-teal-500 text-teal-700 hover:text-teal-800 text-teal-600 bg-red-500 ' +
          'text-red-700 text-yellow-700 text-orange-700 text-purple-600 text-violet-600 ' +
          'placeholder-gray-500 placeholder-gray-600 accent-teal-700',
      ),
    ).toBe(false);
  });

  it('no public source uses a text color that cannot pass AA', () => {
    const offenders: string[] = [];
    for (const path of PUBLIC_FILES) {
      const lines = readFileSync(join(ROOT, path), 'utf8').split(/\r?\n/);
      lines.forEach((line, lineIndex) => {
        for (const pattern of bannedPatterns()) {
          for (const match of line.matchAll(pattern)) {
            offenders.push(`${path}:${lineIndex + 1}: ${match[0]}`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('global placeholder colour stays', () => {
    const css = readFileSync(join(ROOT, 'src/styles/global.css'), 'utf8');
    // One unit: the rule, its colour and its base layer, so a gray-600 used elsewhere in the
    // file cannot stand in for it.
    expect(css).toMatch(
      /@layer base\s*\{[^{}]*input::placeholder,\s*textarea::placeholder\s*\{\s*color:\s*var\(--color-gray-600\);?\s*\}\s*\}/,
    );
  });
});
