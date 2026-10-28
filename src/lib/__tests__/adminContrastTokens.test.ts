import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// The admin pages sit on a gray-100 page with white cards and gray-50 table heads and expanded
// rows. The text colors below fail WCAG AA (4.5:1) on all three surfaces, and the fills below
// fail it under white text. The fix is the 700 shade, gray-600 for gray meta text, or gray-500
// for an icon-only control or chevron (3:1). See brand.md 4.2.
//
// The scan reads raw source, comments included, so a retired token quoted in a comment is a
// failure too. The lines in EXEMPT are the only allowed hits: decorative icons beside or above
// a text label, and a disabled button. Each one names an exact fragment of its line.
//
// Not covered here: gray-500 on the gray-100 page (4.39), which needs the real background to
// judge, and the score chips, whose fills come from src/lib/scoring-colors.ts at run time.

const ROOT = process.cwd();
const EXTENSIONS = ['.astro', '.tsx', '.ts'];
const ADMIN_DIRS = ['src/components/admin', 'src/pages/admin'];

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

const ADMIN_FILES = ADMIN_DIRS.flatMap((dir) => walk(join(ROOT, dir)))
  .map((full) => relative(ROOT, full).replace(/\\/g, '/'))
  .filter((path) => !path.includes('/__tests__/'))
  .sort();

interface Exemption {
  path: string;
  fragment: string;
  reason: string;
}

const EXEMPT: Exemption[] = [
  {
    path: 'src/components/admin/AdminLayout.astro',
    fragment: '<svg class="w-5 h-5 text-teal-400"',
    reason: 'decorative gear beside the "Admin panel" label on the slate-800 bar',
  },
  {
    path: 'src/components/admin/VerificationQueue.tsx',
    fragment: '<svg className="w-12 h-12 text-gray-400 mx-auto mb-4"',
    reason: 'decorative empty-state icon above its heading',
  },
  {
    path: 'src/pages/admin/contact.astro',
    fragment: '<svg class="w-12 h-12 text-gray-300 mx-auto mb-4"',
    reason: 'decorative empty-state icon above its message',
  },
  {
    path: 'src/components/admin/UsersTable.tsx',
    fragment: "'bg-gray-100 text-gray-400 cursor-not-allowed'",
    reason: 'disabled button, exempt under WCAG 1.4.3',
  },
];

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
    new RegExp('(?<![\\w-])(?:hover|focus|focus-visible|active|group-hover):text-teal-600(?![\\w-])', 'g'),
    // Colored text below the 700 shade. Red 600 is 4.33 on the gray-100 page, and the rest are
    // 4.40 or lower even on white.
    new RegExp(
      '(?<![\\w-])text-(?:(?:red|orange|amber|yellow|green|emerald)-(?:400|500|600)|(?:blue|purple|violet)-(?:400|500))(?![\\w-])',
      'g',
    ),
    // Gray 300 and 400 as text. Best case is 2.60 on white.
    new RegExp('(?<![\\w-])text-gray-(?:300|400)(?![\\w-])', 'g'),
    // Gray 300 and 400 placeholders.
    new RegExp('(?<![\\w-])placeholder(?:-|:text-)gray-(?:300|400)(?![\\w-])', 'g'),
  ];
}

// White text on a fill that cannot carry it: 3.82 or lower for every fill listed. Checked per
// line, so a class string that sets both is caught, hover variants included.
function whiteTextPattern(): RegExp {
  return new RegExp('(?<![\\w-])text-white(?![\\w-])');
}

function weakFillPattern(): RegExp {
  return new RegExp(
    '(?<![\\w-])bg-(?:(?:teal|emerald|green|amber|orange|yellow)-(?:400|500|600)|(?:red|blue)-(?:400|500))(?![\\w-])',
    'g',
  );
}

const [TEAL, TEAL_HOVER, COLORED, GRAY, PLACEHOLDER] = [0, 1, 2, 3, 4];

function matches(index: number, text: string): boolean {
  return bannedPatterns()[index].test(text);
}

function anyMatch(text: string): boolean {
  return bannedPatterns().some((pattern) => pattern.test(text));
}

function lineOffenders(line: string): string[] {
  const found: string[] = [];
  for (const pattern of bannedPatterns()) {
    for (const match of line.matchAll(pattern)) found.push(match[0]);
  }
  if (whiteTextPattern().test(line)) {
    for (const match of line.matchAll(weakFillPattern())) found.push(`text-white with ${match[0]}`);
  }
  return found;
}

function isExempt(path: string, line: string): boolean {
  return EXEMPT.some((exemption) => exemption.path === path && line.includes(exemption.fragment));
}

describe('contrast tokens on the admin pages', () => {
  it('scans every admin page and component', () => {
    expect(ADMIN_FILES.length).toBeGreaterThan(20);
    for (const path of [
      'src/components/admin/AdminLayout.astro',
      'src/components/admin/ReviewsTable.tsx',
      'src/components/admin/VerificationQueue.tsx',
      'src/pages/admin/index.astro',
      'src/pages/admin/contact.astro',
    ]) {
      expect(ADMIN_FILES).toContain(path);
    }
  });

  it('patterns match what they are meant to', () => {
    expect(matches(TEAL, 'class="text-teal-500"')).toBe(true);
    expect(matches(TEAL, 'hover:text-teal-400')).toBe(true);
    expect(matches(TEAL_HOVER, 'className="hover:text-teal-600"')).toBe(true);
    expect(matches(COLORED, 'class="text-green-600"')).toBe(true);
    expect(matches(COLORED, 'text-amber-500 ml-1')).toBe(true);
    expect(matches(COLORED, 'hover:text-red-600')).toBe(true);
    expect(matches(COLORED, 'text-purple-500')).toBe(true);
    expect(matches(GRAY, "'text-gray-400'")).toBe(true);
    expect(matches(GRAY, 'text-xs text-gray-300')).toBe(true);
    expect(matches(PLACEHOLDER, 'placeholder-gray-400 focus:outline-none')).toBe(true);
    expect(matches(PLACEHOLDER, 'placeholder:text-gray-400')).toBe(true);

    expect(lineOffenders('className="px-4 py-2 bg-green-600 text-white"')).toEqual([
      'text-white with bg-green-600',
    ]);
    expect(lineOffenders("? 'bg-amber-500 text-white'")).toEqual(['text-white with bg-amber-500']);
    expect(lineOffenders('bg-green-700 text-white hover:bg-orange-600')).toEqual([
      'text-white with bg-orange-600',
    ]);

    expect(
      anyMatch(
        'text-teal-700 hover:text-teal-800 text-2xl font-bold text-teal-600 focus:ring-teal-500 ' +
          'text-green-700 text-amber-700 text-orange-800 text-red-700 text-purple-600 text-blue-600 ' +
          'text-gray-500 text-gray-600 text-slate-300 bg-amber-500 placeholder-gray-500',
      ),
    ).toBe(false);
    expect(
      lineOffenders(
        'bg-green-700 text-white hover:bg-green-800 bg-amber-700 bg-red-600 bg-purple-600 bg-teal-700 bg-black/60',
      ),
    ).toEqual([]);
    expect(lineOffenders('<div class="w-3 h-3 rounded-full bg-amber-500"></div>')).toEqual([]);
  });

  it('no admin source uses a text color or white-text fill that cannot pass AA', () => {
    const offenders: string[] = [];
    for (const path of ADMIN_FILES) {
      const lines = readFileSync(join(ROOT, path), 'utf8').split(/\r?\n/);
      lines.forEach((line, lineIndex) => {
        if (isExempt(path, line)) return;
        for (const token of lineOffenders(line)) {
          offenders.push(`${path}:${lineIndex + 1}: ${token}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('each exemption still points at exactly one line', () => {
    for (const exemption of EXEMPT) {
      const lines = readFileSync(join(ROOT, exemption.path), 'utf8').split(/\r?\n/);
      const hits = lines.filter((line) => line.includes(exemption.fragment));
      expect(hits, `${exemption.path}: ${exemption.reason}`).toHaveLength(1);
      expect(lineOffenders(hits[0]).length, `${exemption.path} no longer needs its exemption`).toBeGreaterThan(0);
    }
  });
});
