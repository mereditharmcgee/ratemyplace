import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The privacy page makes claims about what the code stores. Each test pairs a claim with the
 * code that makes it true, so a change to one side fails here until the other side follows.
 *
 * The keyed-hash claim is true only once rate limit keys are stored as a digest
 * (`rateLimitKeys.test.ts` covers that side), so this page ships with or after that change.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

// Collapse whitespace so a line wrap in the template cannot break a phrase match.
const page = read('src/pages/privacy.astro').replace(/\s+/g, ' ');

describe('privacy page: IP addresses', () => {
  it('says rate limits keep a keyed hash of the IP address, not the address', () => {
    expect(page).toContain('a scrambled form of your IP address (a keyed hash), never the address itself');
    expect(page).not.toContain('keeps your IP address for one hour');
  });

  it('says rate limit entries expire, not that they are deleted on the hour', () => {
    expect(read('src/lib/rateLimit.ts')).toContain('DELETE FROM rate_limits WHERE expires_at < ?');
    expect(page).toContain('Each entry expires within an hour, and we delete expired entries as new requests come in');
    expect(page).not.toContain('delete it after about an hour');
  });

  it('names the audit log as the one place a full IP address is kept', () => {
    expect(read('src/lib/audit.ts')).toContain('admin_ip');
    expect(page).toContain('The one place we keep a full IP address is our admin audit log');
    expect(page).toContain('the IP address of the team member who made each change');
  });
});

describe('privacy page: accounts', () => {
  it('does not call stored passwords salted while unsalted legacy hashes still verify', () => {
    if (read('src/lib/password.ts').includes('legacyHashPassword')) {
      expect(page).not.toMatch(/salted/i);
    }
  });

  it('says a Google-linked account cannot change its email address here', () => {
    expect(read('src/pages/api/user/email.ts')).toContain('dbUser.google_id !== null');
    expect(page).toContain('unless you have signed in with Google');
  });

  it('says the audit log keeps part of a deleted review', () => {
    const route = read('src/pages/api/admin/reviews/[id].ts');
    expect(route).toContain('title: review.review_title');
    expect(route).toContain('score: review.overall_score');
    expect(page).toContain('If a review is deleted, the log keeps its title, its score and the account it came from');
  });
});
