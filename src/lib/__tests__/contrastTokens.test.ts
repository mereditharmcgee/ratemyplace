import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { contrast } from './helpers/contrast';

// These text colors fail WCAG AA as text on the light surfaces the public site uses: paper,
// white, gray-50 and the tinted panels. The fix is the 700 shade, or 600 for purple and violet.
// Do not add an exemption list. A decorative icon that needs a lighter shade can use bare
// text-teal-600 on its svg line, which stays allowed; text, large figures included, uses the
// brand teal-700 (brand.md 4.2 treats teal-600 as a fill). The guard also covers the
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

  it('teal-600 is used only on icons, never on text or a figure', () => {
    // The landlord and property manager recommendation rates were 3xl bold teal-600 (3.66 on
    // white). They pass as large text, but brand.md 4.2 keeps teal-600 for fills, so text is
    // teal-700 (5.36). A bare teal-600 is allowed only on an svg's own line.
    const bare = new RegExp('(?<![\\w:-])text-teal-600(?![\\w-])');
    expect(bare.test('<svg class="w-6 h-6 text-teal-600"')).toBe(true);
    expect(bare.test('hover:text-teal-600')).toBe(false);

    const offenders: string[] = [];
    for (const path of PUBLIC_FILES) {
      readFileSync(join(ROOT, path), 'utf8')
        .split(/\r?\n/)
        .forEach((line, lineIndex) => {
          if (bare.test(line) && !line.includes('<svg')) offenders.push(`${path}:${lineIndex + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});

// "Learn more" sits inline in gray text, and teal-700 against gray-500 is about 1.1:1, so the
// link is told apart by colour alone (WCAG 1.4.1). An underline is the non-colour cue.
// src/pages/about.astro is the owner's page and is left to them.
describe('"Learn more" links', () => {
  const LINK = /<a\b([^>]*)>\s*Learn more\s*<\/a>/g;
  const UNDERLINE = /(?<![\w:-])underline(?![\w-])/;

  it('patterns match what they are meant to', () => {
    expect(UNDERLINE.test('class="text-teal-700 underline underline-offset-2"')).toBe(true);
    expect(UNDERLINE.test('class="text-teal-700 underline-offset-2 hover:underline"')).toBe(false);
  });

  it('every "Learn more" link is underlined', () => {
    const links: string[] = [];
    const offenders: string[] = [];
    for (const path of PUBLIC_FILES.filter((p) => p !== 'src/pages/about.astro')) {
      for (const match of readFileSync(join(ROOT, path), 'utf8').matchAll(LINK)) {
        links.push(path);
        if (!UNDERLINE.test(match[1])) offenders.push(`${path}: ${match[0]}`);
      }
    }
    // ScoreCard's methodology note and the ReviewCard footnote.
    expect(links).toEqual(
      expect.arrayContaining(['src/components/ratings/ScoreCard.astro', 'src/components/reviews/ReviewCard.astro']),
    );
    expect(offenders).toEqual([]);
  });
});

// The assessed-value sparkline, the year bars' missing-year outline and the category tracks
// carry meaning on their own, so they need 3:1 against the panel's white card (WCAG 1.4.11).
// gray-400 is 2.60 there and gray-500 is 4.83. gray-200 stays allowed as a fill and a hairline:
// the empty category track, the zero-year stub and the cell dividers say nothing by colour.
describe('records panel graphics', () => {
  const RECORDS_FILES = PUBLIC_FILES.filter(
    (path) =>
      (path.startsWith('src/components/records/') && path.endsWith('.astro')) ||
      path === 'src/components/BuildingRecords.astro',
  );
  const LIGHT = [
    new RegExp('(?<![\\w-])(?:text|stroke|fill)-gray-(?:100|200|300|400)(?![\\w-])', 'g'),
    new RegExp('(?<![\\w-])border-gray-(?:300|400)(?![\\w-])', 'g'),
  ];

  it('scans the chart components', () => {
    for (const path of [
      'src/components/records/FactsStrip.astro',
      'src/components/records/YearBars.astro',
      'src/components/records/CategoryBars.astro',
      'src/components/BuildingRecords.astro',
    ]) {
      expect(RECORDS_FILES).toContain(path);
    }
    expect('class="shrink-0 text-gray-400"'.match(LIGHT[0])).toEqual(['text-gray-400']);
    expect('border border-dashed border-gray-400'.match(LIGHT[1])).toEqual(['border-gray-400']);
    expect('bg-gray-200 border-gray-200 text-gray-500 border-gray-500'.match(LIGHT[0])).toBeNull();
    expect('bg-gray-200 border-gray-200 text-gray-500 border-gray-500'.match(LIGHT[1])).toBeNull();
  });

  it('draws no light-gray graphic or text in the records panel', () => {
    const offenders: string[] = [];
    for (const path of RECORDS_FILES) {
      readFileSync(join(ROOT, path), 'utf8')
        .split(/\r?\n/)
        .forEach((line, lineIndex) => {
          for (const pattern of LIGHT) {
            for (const match of line.matchAll(pattern)) offenders.push(`${path}:${lineIndex + 1}: ${match[0]}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});

// getScoreColor pairs each band fill with white text. White on the Mixed fill (amber-500) is
// 2.13:1 and on the Good fill (emerald-600) 3.65:1, so no surface prints that text: small score
// text uses getScoreChipColor (a tint with dark band text) instead. The fills themselves stay
// in use for bars, dots and markers. This scan covers admin too, since the helper is shared.
describe('score band fills never carry their white text', () => {
  const ALL_FILES = walk(join(ROOT, 'src'))
    .map((full) => relative(ROOT, full).replace(/\\/g, '/'))
    .filter((path) => !path.includes('/__tests__/') && path !== 'src/lib/scoring-colors.ts' && !path.endsWith('.css'))
    .sort();

  /** Local names bound to scoring-colors' getScoreColor by an import, aliases included. */
  function importedNames(source: string): string[] {
    const names: string[] = [];
    for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*scoring-colors['"]/g)) {
      for (const specifier of match[1].split(',')) {
        const [imported, local] = specifier.trim().split(/\s+as\s+/);
        if (imported === 'getScoreColor') names.push(local ?? imported);
      }
    }
    return names;
  }

  /** Each place a source reads getScoreColor's `text`, the white meant for the fill. */
  function fillTextReads(source: string): string[] {
    const found: string[] = [];
    for (const name of importedNames(source)) {
      const call = `\\b${name}\\s*\\((?:[^()]|\\([^()]*\\))*\\)`;
      for (const match of source.matchAll(new RegExp(`${call}\\s*\\.text\\b`, 'g'))) found.push(match[0]);
      for (const match of source.matchAll(new RegExp(`\\{[^}]*\\btext\\b[^}]*\\}\\s*=\\s*${call}`, 'g'))) {
        found.push(match[0]);
      }
      for (const match of source.matchAll(new RegExp(`\\b(?:const|let|var)\\s+(\\w+)\\s*=\\s*${call}`, 'g'))) {
        if (new RegExp(`\\b${match[1]}\\.text\\b`).test(source)) found.push(`${match[1]}.text`);
      }
    }
    return found;
  }

  it('patterns match what they are meant to', () => {
    const imported = "import { getScoreColor } from '../../lib/scoring-colors';\n";
    const aliased = "import { getScoreColor as pair, getScoreTextColor } from '../../lib/scoring-colors';\n";
    expect(fillTextReads(`${aliased}const c = pair(score);\nreturn \`\${c.bg} \${c.text}\`;`)).toEqual(['c.text']);
    expect(fillTextReads(`${imported}const x = getScoreColor(Number(v)).text;`)).toHaveLength(1);
    expect(fillTextReads(`${imported}const { bg, text } = getScoreColor(score);`)).toHaveLength(1);

    expect(fillTextReads(`${imported}const { label } = getScoreColor(score);\ngetScoreColor(s).bg;`)).toEqual([]);
    // A local helper with the same name, not imported from scoring-colors, is not the pair.
    expect(fillTextReads('const getScoreColor = (s) => s;\nconst c = getScoreColor(1);\nc.text;')).toEqual([]);
  });

  it('no source prints getScoreColor text on its fill', () => {
    expect(ALL_FILES).toContain('src/components/admin/ReviewsTable.tsx');
    expect(ALL_FILES).toContain('src/components/profile/ProfileDashboard.tsx');
    const offenders: string[] = [];
    for (const path of ALL_FILES) {
      for (const read of fillTextReads(readFileSync(join(ROOT, path), 'utf8'))) offenders.push(`${path}: ${read}`);
    }
    expect(offenders).toEqual([]);
  });
});

// The map info window prints the band name ("Mixed") on a light tint of the marker colour. The
// marker colour is a fill: as its own label it was 1.95:1 for Mixed and 3.24:1 for Good. The
// label colour comes from getScoreTextHex, which scoring-colors.test.ts measures on each tint.
describe('map info window band label', () => {
  it('is not drawn in its marker colour', () => {
    const source = readFileSync(join(ROOT, 'src/components/BuildingMap.tsx'), 'utf8');
    expect(source).not.toMatch(/(?<![\w-])color:\s*\$\{scoreColor\}/);
    expect(source).toMatch(/(?<![\w-])color:\s*\$\{getScoreTextHex\(building\.avgScore\)\}/);
  });
});

// The templates set no page background, so their text sits on white, and the callout boxes are
// #f9fafb. Normal text needs 4.5:1 on both; the 24px bold h2 headings need the 3:1 large-text
// bar. A button is measured as its text on its own fill.
describe('transactional email colours', () => {
  const EMAIL = readFileSync(join(ROOT, 'src/lib/email.ts'), 'utf8');
  const SURFACES = ['#ffffff', '#f9fafb'];
  const NAMED: Record<string, string> = { white: '#ffffff', black: '#000000' };

  interface StyledTag {
    tag: string;
    color: string | null;
    background: string | null;
    source: string;
  }

  function declared(style: string, property: string): string | null {
    const match = style.match(new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`));
    if (!match) return null;
    const value = match[1].trim().toLowerCase();
    return NAMED[value] ?? value;
  }

  function styledTags(source: string): StyledTag[] {
    return [...source.matchAll(/<([a-z0-9]+)\b[^>]*?\bstyle="([^"]*)"[^>]*>/gi)].map((match) => ({
      tag: match[1].toLowerCase(),
      color: declared(match[2], 'color'),
      background: declared(match[2], 'background-color'),
      source: match[0].replace(/\s+/g, ' '),
    }));
  }

  it('finds the links, buttons and footers it is meant to check', () => {
    const tags = styledTags(EMAIL);
    const anchors = tags.filter((t) => t.tag === 'a');
    expect(anchors.filter((t) => t.background).length).toBeGreaterThanOrEqual(3);
    expect(anchors.filter((t) => !t.background).length).toBeGreaterThanOrEqual(10);
    expect(tags.filter((t) => t.tag === 'p' && /font-size: 12px/.test(t.source)).length).toBeGreaterThanOrEqual(9);
    expect(declared('background-color: #f9fafb; color: #666;', 'color')).toBe('#666');
  });

  it('every text colour clears AA on the surface it sits on', () => {
    const offenders: string[] = [];
    for (const tag of styledTags(EMAIL)) {
      if (!tag.color) continue;
      if (tag.background) {
        const ratio = contrast(tag.color, tag.background);
        if (ratio < 4.5) offenders.push(`${ratio.toFixed(2)} ${tag.source}`);
        continue;
      }
      const floor = tag.tag === 'h2' ? 3 : 4.5;
      for (const surface of SURFACES) {
        const ratio = contrast(tag.color, surface);
        if (ratio < floor) offenders.push(`${ratio.toFixed(2)} on ${surface} ${tag.source}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
