import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Every email the site sends must leave a trace on /admin when it fails. That holds only if
// every send goes through `trackSend` (routes) or `trackEmail` (lib, the Worker). This scan
// reads the source of every route, page and lib module and fails on an untracked send, so a
// new endpoint cannot quietly reintroduce a bare `fireAndForget(context, sendX(...))` or a
// `console.warn` skip.

const ROOT = process.cwd();

function walk(dir: string, accept: (path: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      found.push(...walk(path, accept));
    } else if (accept(path)) {
      found.push(path);
    }
  }
  return found;
}

const EMAIL_MODULE = join(ROOT, 'src', 'lib', 'email.ts');

const SCANNED: string[] = [
  ...walk(join(ROOT, 'src', 'pages'), (path) => path.endsWith('.ts') || path.endsWith('.astro')),
  ...walk(join(ROOT, 'src', 'lib'), (path) => path.endsWith('.ts') && path !== EMAIL_MODULE),
];

const sources = new Map(SCANNED.map((path) => [relative(ROOT, path).split(sep).join('/'), readFileSync(path, 'utf8')]));

const SEND = /\bsend[A-Z]\w*Email\(/g;
const TRACK = /\btrack(?:Send|Email)\(/g;

function count(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

describe('every email send is tracked', () => {
  it('scans the routes and lib modules, not an empty set', () => {
    expect(sources.size).toBeGreaterThan(50);
    expect(sources.has('src/pages/api/contact.ts')).toBe(true);
    expect(sources.has('src/lib/ownerNotify.ts')).toBe(true);
    expect(sources.has('src/lib/email.ts')).toBe(false);
  });

  it('counts the sends a file makes, so the count check cannot pass vacuously', () => {
    expect(count(sources.get('src/pages/api/contact.ts') ?? '', SEND)).toBe(2);
  });

  it('never hands a send straight to fireAndForget', () => {
    const offenders = [...sources].filter(([, source]) => /fireAndForget\(\s*context,\s*send[A-Z]\w*Email\(/.test(source));
    expect(offenders.map(([path]) => path)).toEqual([]);
  });

  it('has at least as many trackSend/trackEmail calls as sends in every file', () => {
    const offenders = [...sources]
      .map(([path, source]) => ({ path, sends: count(source, SEND), tracks: count(source, TRACK) }))
      .filter(({ sends, tracks }) => sends > tracks);
    expect(offenders).toEqual([]);
    expect(count(sources.get('src/pages/api/contact.ts') ?? '', TRACK)).toBeGreaterThanOrEqual(2);
  });

  it('has no silent "RESEND_API_KEY not configured - skipping" branch left', () => {
    const offenders = [...sources].filter(([, source]) => source.includes('RESEND_API_KEY not configured - skipping'));
    expect(offenders.map(([path]) => path)).toEqual([]);
  });

  it('keeps email.ts to one Resend call and no console logging', () => {
    const email = readFileSync(EMAIL_MODULE, 'utf8');
    expect(email).not.toContain('console.error(');
    expect(count(email, /new Resend\(/g)).toBe(1);
  });
});
