import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// Phase 28 (A11Y-02, A11Y-08): a focus ring has to reach 3:1 against the surface around it.
// Teal 500 is 2.42 at best on white and teal 400 is lighter still, so a focus ring in either
// shade is retired for teal-700, which is 5.47 on white.
// The site-wide outline in global.css already uses teal-700; this guard keeps the ring utilities
// from drifting back. The hero's light ring on the dark home search (teal-300) is correct there
// and is not matched.
//
// Unlike contrastTokens.test.ts, admin is scanned too: its forms are keyboard flows like any
// other. API routes render nothing and are left out. The scan reads raw source, comments
// included, so a retired ring quoted in a comment is a failure as well.

const ROOT = process.cwd();
const EXTENSIONS = ['.astro', '.tsx', '.ts', '.css'];
const EXCLUDED_PREFIXES = ['src/pages/api/'];

// Files allowed a fixed number of retired rings, and why. The two in ReviewEditForm.tsx are the
// tenure and move-out selects, which the concurrent review-edit lane is rewriting. Set this to 0
// (and remove the entry) once main is merged into this branch and those selects move to
// teal-700 with their labels.
const ALLOWED: Record<string, number> = {
  'src/components/reviews/ReviewEditForm.tsx': 2,
};

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

const SOURCE_FILES = walk(join(ROOT, 'src'))
  .map((full) => relative(ROOT, full).replace(/\\/g, '/'))
  .filter((path) => !path.includes('/__tests__/'))
  .filter((path) => !EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix)))
  .sort();

/**
 * Built from a plain string so the escapes survive. The lookarounds keep the token from
 * matching inside a longer class; a responsive prefix (sm:focus:...) or an opacity suffix
 * (.../50) still matches. A fresh object per call, because a global regex carries lastIndex.
 */
function retiredRing(): RegExp {
  return new RegExp('(?<![\\w-])(?:focus|focus-visible):ring-teal-(?:400|500)(?![\\w-])', 'g');
}

function matchesRetired(text: string): boolean {
  return retiredRing().test(text);
}

describe('focus ring tokens', () => {
  it('scans the source tree, admin included, and skips tests and API routes', () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(100);
    for (const path of [
      'src/components/admin/BuildingsFilterBar.tsx',
      'src/components/AddressAutocomplete.tsx',
      'src/components/reviews/ReviewEditForm.tsx',
      'src/pages/auth/signin.astro',
      'src/pages/admin/index.astro',
      'src/styles/global.css',
    ]) {
      expect(SOURCE_FILES).toContain(path);
    }
    for (const path of SOURCE_FILES) {
      expect(path.includes('/__tests__/')).toBe(false);
      expect(path.startsWith('src/pages/api/')).toBe(false);
    }
    for (const path of Object.keys(ALLOWED)) expect(SOURCE_FILES).toContain(path);
  });

  it('the pattern matches what it is meant to', () => {
    for (const text of [
      'className="focus:ring-teal-500"',
      'focus:ring-2 focus:ring-teal-400 ',
      'focus-visible:ring-teal-500',
      'focus-visible:ring-teal-400',
      'sm:focus:ring-teal-500',
      'focus:ring-teal-500/50',
    ]) {
      expect(matchesRetired(text), text).toBe(true);
    }
    for (const text of [
      'focus:ring-teal-700',
      'focus-visible:ring-teal-700',
      'focus:ring-4 focus:ring-teal-300',
      'focus:ring-teal-50',
      'focus:border-teal-500',
      'focus:ring-teal-5000',
      'border-teal-500 bg-teal-500',
    ]) {
      expect(matchesRetired(text), text).toBe(false);
    }
  });

  it('no source uses a teal 400 or 500 focus ring beyond the allowance', () => {
    const counts: Record<string, number> = {};
    const offenders: string[] = [];
    for (const path of SOURCE_FILES) {
      const lines = readFileSync(join(ROOT, path), 'utf8').split(/\r?\n/);
      lines.forEach((line, lineIndex) => {
        for (const match of line.matchAll(retiredRing())) {
          counts[path] = (counts[path] ?? 0) + 1;
          offenders.push(`${path}:${lineIndex + 1}: ${match[0]}`);
        }
      });
    }
    // An exact match: a file over its allowance fails, and so does an allowance that is no
    // longer needed, so the entry is removed when the last ring moves to teal-700.
    expect(counts, offenders.join('\n')).toEqual(ALLOWED);
  });
});
