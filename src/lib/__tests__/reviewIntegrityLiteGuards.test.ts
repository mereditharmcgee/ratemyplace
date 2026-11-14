import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Review limits and moderation signals: the signals are advisory and admin only, and nothing
 * here writes a review except the one guarded insert. These read source text, so a new import
 * or a new review write fails here until someone decides it belongs.
 */

const ROOT = process.cwd();

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      found.push(...walk(path));
    } else if (/\.(ts|tsx|astro|mjs|js)$/.test(entry.name)) {
      found.push(relative(ROOT, join(ROOT, path)).replace(/\\/g, '/'));
    }
  }
  return found;
}

const SOURCE = walk('src');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** Files that import the module at `src/lib/<name>`, by any relative path. */
function importersOf(name: string, files: string[]): string[] {
  const pattern = new RegExp(`from\\s+['"][^'"]*\\/lib\\/${name}['"]|from\\s+['"]\\.\\/${name}['"]`);
  return files.filter((file) => pattern.test(read(file))).sort();
}

const under = (prefix: string) => SOURCE.filter((file) => file.startsWith(prefix));

describe('moderation signals stay in the admin queue', () => {
  it('only the admin list route and the badge component import reviewFlags', () => {
    expect(importersOf('reviewFlags', under('src/pages/'))).toEqual(['src/pages/api/admin/reviews/index.ts']);
    expect(importersOf('reviewFlags', under('src/components/'))).toEqual(['src/components/admin/ReviewFlags.tsx']);
  });

  it('no email, owner notice, audit or notification module reads them', () => {
    for (const file of ['src/lib/email.ts', 'src/lib/ownerNotify.ts', 'src/lib/audit.ts', 'src/lib/notifications.ts']) {
      const source = read(file);
      expect(source, file).not.toMatch(/reviewFlags|integrity_flags/);
    }
  });

  it('only the admin list, its type and the admin table name integrity_flags', () => {
    const files = SOURCE.filter((file) => read(file).includes('integrity_flags')).sort();
    expect(files).toEqual([
      'src/components/admin/ReviewsTable.tsx',
      'src/lib/api-types.ts',
      'src/pages/api/admin/reviews/index.ts',
    ]);
  });
});

describe('signals and limits never decide a moderation action', () => {
  it('the admin review actions import neither module', () => {
    const source = read('src/pages/api/admin/reviews/[id].ts');
    expect(source).not.toMatch(/reviewFlags|reviewLimits/);
  });

  it('reviewLimits is server only: the create route and the review page import it, no component does', () => {
    expect(importersOf('reviewLimits', SOURCE.filter((file) => !file.startsWith('src/lib/')))).toEqual([
      'src/pages/api/reviews.ts',
      'src/pages/review/new.astro',
    ]);
  });

  it('the new modules write nothing and call nothing', () => {
    for (const file of ['src/lib/reviewFlags.ts', 'src/components/admin/ReviewFlags.tsx', 'src/lib/reviewLimits.ts']) {
      const source = read(file);
      expect(source, file).not.toMatch(/\bINSERT\s+(?:OR\s+\w+\s+)?INTO\b/i);
      expect(source, file).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
      expect(source, file).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(source, file).not.toMatch(/\bfetch\s*\(/);
    }
  });
});

describe('review writes', () => {
  it('happen only in the files that wrote reviews before this change', () => {
    const writes = SOURCE.filter((file) => /INSERT INTO reviews|UPDATE reviews|DELETE FROM reviews/.test(read(file))).sort();
    expect(writes).toEqual([
      'src/pages/api/admin/reviews/[id].ts', // status change and delete
      'src/pages/api/admin/verification/[id].ts', // verification approval
      'src/pages/api/reviews.ts', // the guarded insert
      'src/pages/api/reviews/[id].ts', // the author's edit
    ]);
  });

  it('the create route writes through the guard', () => {
    const route = read('src/pages/api/reviews.ts');
    expect(route).toMatch(/INSERT INTO reviews \([\s\S]*?\) SELECT[\s\S]*?WHERE \$\{REVIEW_GUARD_SQL\}/);
    expect(route).not.toMatch(/INSERT INTO reviews \([\s\S]*?\) VALUES/);
  });
});
