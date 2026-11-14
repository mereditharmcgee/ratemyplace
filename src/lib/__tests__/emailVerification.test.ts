import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EMAIL_ALREADY_VERIFIED,
  EMAIL_GATE_COPY,
  gateResendOutcome,
  VERIFY_TO_POST_ERROR,
} from '../contributionCopy';
import {
  EMAIL_VERIFICATION_REQUIRED,
  emailVerificationRequired,
  hasVerifiedEmail,
} from '../emailVerification';

// The verified-email gate: who passes it, what the three write routes answer when someone
// does not, and what the review pages' resend button says for each answer it gets back.

describe('hasVerifiedEmail', () => {
  it.each([
    [null, false],
    [undefined, false],
    [{}, false],
    [{ emailVerified: false }, false],
    [{ emailVerified: 1 }, false],
    [{ emailVerified: 'true' }, false],
    [{ emailVerified: true }, true],
  ])('hasVerifiedEmail(%j) is %s', (user, expected) => {
    expect(hasVerifiedEmail(user as never)).toBe(expected);
  });
});

describe('emailVerificationRequired', () => {
  it('answers 403 JSON in the reason envelope shared with Phase 26', async () => {
    const res = emailVerificationRequired();
    expect(res.status).toBe(403);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(await res.json()).toEqual({
      error: VERIFY_TO_POST_ERROR,
      details: { reason: 'email_verification_required' },
    });
    expect(EMAIL_VERIFICATION_REQUIRED).toBe('email_verification_required');
  });

  it('leaks no internal names', async () => {
    const text = await emailVerificationRequired().text();
    expect(text).not.toMatch(/email_verified|users|SELECT|locals/);
  });

  it('a fresh response every call, so a consumed body never leaks into the next request', async () => {
    const first = emailVerificationRequired();
    await first.text();
    expect(await emailVerificationRequired().json()).toHaveProperty('error', VERIFY_TO_POST_ERROR);
  });
});

describe('gate copy', () => {
  it('copy follows the house rules', () => {
    for (const value of [...Object.values(EMAIL_GATE_COPY), VERIFY_TO_POST_ERROR]) {
      expect(value).not.toMatch(/\u2014|!/);
    }
  });

  it('one 403 line for create and edit: the why line', () => {
    expect(VERIFY_TO_POST_ERROR).toBe(EMAIL_GATE_COPY.why);
  });

  it("the residency line is the owner's words", () => {
    expect(EMAIL_GATE_COPY.residencyNote).toBe(
      'Confirming your email lets you post reviews. Residency verification is a separate, optional step where you show a lease or similar document, and it adds a Residency verified badge to your review.',
    );
    expect(EMAIL_GATE_COPY.sent).toBe('Verification email sent');
  });

  // Reused strings stay the ones the site already shows. If a source changes, decide whether
  // the gate changes with it.
  it.each([
    ['heading', 'src/components/profile/ProfileDashboard.tsx'],
    ['resend', 'src/components/profile/ProfileDashboard.tsx'],
    ['sending', 'src/components/profile/ProfileDashboard.tsx'],
    ['failed', 'src/components/profile/ProfileDashboard.tsx'],
    ['why', 'src/lib/email.ts'],
    ['sent', 'src/pages/api/auth/resend-verification.ts'],
  ] as const)('%s is reused from %s', (slot, file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8');
    expect(source).toContain(EMAIL_GATE_COPY[slot]);
  });
});

// One status rule for the gate (design 1.3), pinned here so the page script cannot drift.
describe('gateResendOutcome', () => {
  it.each([
    [200, { success: true }, { kind: 'status', text: EMAIL_GATE_COPY.sent }],
    [204, null, { kind: 'status', text: EMAIL_GATE_COPY.sent }],
    [400, { error: 'Email already verified', details: { reason: EMAIL_ALREADY_VERIFIED } }, { kind: 'reload' }],
    // No reason: not trusted, so a future 400 cannot cause a reload loop.
    [400, { error: 'Email already verified' }, { kind: 'status', text: EMAIL_GATE_COPY.failed }],
    [400, { error: 'x', details: [{ field: 'f', message: 'm' }] }, { kind: 'status', text: EMAIL_GATE_COPY.failed }],
    [
      429,
      { error: 'Too many attempts. Please try again later.' },
      { kind: 'status', text: 'Too many attempts. Please try again later.' },
    ],
    [
      503,
      { error: 'Service temporarily unavailable. Please try again in a few minutes.' },
      { kind: 'status', text: 'Service temporarily unavailable. Please try again in a few minutes.' },
    ],
    [429, { error: '' }, { kind: 'status', text: EMAIL_GATE_COPY.failed }],
    [429, { error: 42 }, { kind: 'status', text: EMAIL_GATE_COPY.failed }],
    [401, { error: 'Not authenticated' }, { kind: 'status', text: EMAIL_GATE_COPY.failed }],
    [500, { error: 'An error occurred' }, { kind: 'status', text: EMAIL_GATE_COPY.failed }],
    // Astro's plain-text origin 403, which the page script cannot parse.
    [403, null, { kind: 'status', text: EMAIL_GATE_COPY.failed }],
  ])('gateResendOutcome(%i, %j)', (status, body, expected) => {
    expect(gateResendOutcome(status, body)).toEqual(expected);
  });
});
