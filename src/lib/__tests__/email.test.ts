import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Resend module BEFORE importing the email helpers so the helpers pick
// up the mocked constructor instead of the real one. The mock captures the
// arguments passed to resend.emails.send so each test can assert on them.

const mockSend = vi.fn();

// Mock Resend as a real class so `new Resend(apiKey)` works as a constructor.
// `vi.fn().mockImplementation(...)` returns a callable function but is not
// reliably callable with `new`, which the email helpers do.
vi.mock('resend', () => ({
  Resend: class MockResend {
    emails = { send: mockSend };
    constructor(_apiKey: string) {}
  },
}));

import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendDisputeConfirmationEmail,
  sendContactConfirmationEmail,
  sendContactNotificationEmail,
  sendDisputeResolutionEmail,
  sendReviewRejectedEmail,
} from '../email';

beforeEach(() => {
  mockSend.mockReset();
  // Default: succeed with a Resend-shaped response
  mockSend.mockResolvedValue({ data: { id: 'msg_test_123' }, error: null });
});

describe('sendVerificationEmail', () => {
  it('skips send and reports error when no API key is configured', async () => {
    const result = await sendVerificationEmail('', 'https://ratemyplace.org', 'user@example.com', 'tok');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Email service not configured');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('sends from noreply@ to the user with sentence-case subject and accurate badge framing', async () => {
    await sendVerificationEmail('test_key', 'https://ratemyplace.org', 'user@example.com', 'tok-123');

    expect(mockSend).toHaveBeenCalledOnce();
    const args = mockSend.mock.calls[0][0];
    expect(args.from).toBe('RateMyPlace Boston <noreply@ratemyplace.org>');
    expect(args.to).toBe('user@example.com');
    expect(args.subject).toBe('Verify your email');

    // Per d8f7b89: lede was corrected to no longer claim verification gives the
    // "verified badge" (which actually requires document upload). Regression
    // guard so the wrong claim doesn't sneak back in.
    expect(args.html).not.toContain('verified badge');
    expect(args.html).toContain('Confirm your email so you can post reviews');
    expect(args.html).toContain('The next tenant is reading');

    // Verification URL embedded in CTA + plain-link fallback
    expect(args.html).toContain('https://ratemyplace.org/api/auth/verify-email?token=tok-123');
    expect(args.html).toContain('Verify email'); // button label, sentence case
  });

  it('returns the messageId on success', async () => {
    const result = await sendVerificationEmail('test_key', 'https://ratemyplace.org', 'user@example.com', 'tok');
    expect(result.success).toBe(true);
    expect(result.messageId).toBe('msg_test_123');
  });

  it('returns failure with error message when Resend returns an error', async () => {
    mockSend.mockResolvedValueOnce({ data: null, error: { message: 'rate limited' } });
    const result = await sendVerificationEmail('test_key', 'https://ratemyplace.org', 'user@example.com', 'tok');
    expect(result.success).toBe(false);
    expect(result.error).toBe('rate limited');
  });
});

describe('sendPasswordResetEmail', () => {
  it('sends with sentence-case subject and 1-hour expiration warning', async () => {
    await sendPasswordResetEmail('test_key', 'https://ratemyplace.org', 'user@example.com', 'reset-tok');

    const args = mockSend.mock.calls[0][0];
    expect(args.subject).toBe('Reset your password');
    expect(args.html).toContain('https://ratemyplace.org/auth/reset-password?token=reset-tok');
    expect(args.html).toContain('expire in 1 hour');
  });
});

describe('sendDisputeConfirmationEmail', () => {
  it('addresses the landlord by name with "Hi" greeting (not "Dear")', async () => {
    await sendDisputeConfirmationEmail(
      'test_key',
      'https://ratemyplace.org',
      'landlord@example.com',
      {
        landlordName: 'Acme Properties',
        buildingAddress: '123 Main St',
        disputeReasons: ['Factually incorrect', 'Defamatory'],
        disputeExplanation: 'The reviewer never lived here',
      }
    );

    const args = mockSend.mock.calls[0][0];
    expect(args.subject).toBe('We received your dispute');
    expect(args.to).toBe('landlord@example.com');

    // Brand voice V5: "Hi" not "Dear" for landlord-facing emails
    expect(args.html).toContain('Hi Acme Properties');
    expect(args.html).not.toMatch(/Dear Acme Properties/);

    // Building address is rendered
    expect(args.html).toContain('123 Main St');

    // Reasons list rendered
    expect(args.html).toContain('Factually incorrect');
    expect(args.html).toContain('Defamatory');

    // Optional explanation rendered when provided
    expect(args.html).toContain('The reviewer never lived here');

    // Closer mentions all three possible outcomes (audit CG1: must be honest
    // about what they'll hear back about)
    expect(args.html).toContain('uphold');
    expect(args.html).toContain('partially uphold');
    expect(args.html).toContain('dismiss');
  });

  it('omits the explanation block when no explanation is provided', async () => {
    await sendDisputeConfirmationEmail(
      'test_key',
      'https://ratemyplace.org',
      'landlord@example.com',
      {
        landlordName: 'Acme',
        buildingAddress: '123 Main St',
        disputeReasons: ['Factually incorrect'],
      }
    );

    const args = mockSend.mock.calls[0][0];
    expect(args.html).not.toContain('Your explanation:');
  });
});

describe('sendDisputeResolutionEmail', () => {
  // The 3-outcome generic helper introduced in 55e8530 — the most behavior-rich
  // template in the file. These tests lock the per-outcome subject + lede so
  // future edits can't accidentally mix them up.

  it('uphold: subject, heading, and lede match the upheld variant', async () => {
    await sendDisputeResolutionEmail(
      'test_key',
      'landlord@example.com',
      'Acme Properties',
      'uphold',
      'Removed the offending paragraph.'
    );

    const args = mockSend.mock.calls[0][0];
    expect(args.subject).toBe('We upheld your dispute');
    expect(args.html).toContain('We upheld your dispute');
    expect(args.html).toContain("We've upheld your dispute");
    expect(args.html).toContain('content guidelines');
    expect(args.html).toContain('Removed the offending paragraph.');
  });

  it('dismiss: explicitly states the review stands and frames disagreement as legitimate', async () => {
    await sendDisputeResolutionEmail(
      'test_key',
      'landlord@example.com',
      'Acme Properties',
      'dismiss',
      'Review meets guidelines.'
    );

    const args = mockSend.mock.calls[0][0];
    expect(args.subject).toBe('We did not uphold your dispute');
    expect(args.html).toContain('We did not uphold your dispute');
    expect(args.html).toContain('The review stands');
    // Audit-mandated framing: disagreement is legitimate
    expect(args.html).toContain('Reviews can be valid even when a landlord disagrees');
    expect(args.html).toContain('Review meets guidelines.');
  });

  it('partially_valid: subject and lede signal partial outcome', async () => {
    await sendDisputeResolutionEmail(
      'test_key',
      'landlord@example.com',
      'Acme Properties',
      'partially_valid',
      'Removed one sentence; rest stands.'
    );

    const args = mockSend.mock.calls[0][0];
    expect(args.subject).toBe('We partially upheld your dispute');
    expect(args.html).toContain('We partially upheld your dispute');
    expect(args.html).toContain('found some of your concerns valid');
    expect(args.html).toContain('Other parts of the review stand');
    expect(args.html).toContain('Removed one sentence; rest stands.');
  });

  it('uses "Hi" greeting (not "Dear") for all three outcomes', async () => {
    for (const outcome of ['uphold', 'dismiss', 'partially_valid'] as const) {
      mockSend.mockClear();
      await sendDisputeResolutionEmail('test_key', 'l@example.com', 'Acme', outcome, 'notes');
      const args = mockSend.mock.calls[0][0];
      expect(args.html).toContain('Hi Acme');
      expect(args.html).not.toMatch(/Dear Acme/);
    }
  });
});

describe('sendReviewRejectedEmail', () => {
  // Added in e2e648a (closes audit CG2). Subject + closer are the load-bearing
  // copy — closer sets the "rejection is usually fixable, here's the action"
  // framing.

  it('subject is sentence case with apostrophe preserved', async () => {
    await sendReviewRejectedEmail(
      'test_key',
      'https://ratemyplace.org',
      'reviewer@example.com',
      '123 Main St',
      'Please remove specific dates and names'
    );

    const args = mockSend.mock.calls[0][0];
    expect(args.subject).toBe("Your review wasn't published");
    expect(args.to).toBe('reviewer@example.com');
  });

  it('renders the moderator notes when supplied', async () => {
    await sendReviewRejectedEmail(
      'test_key',
      'https://ratemyplace.org',
      'reviewer@example.com',
      '123 Main St',
      'Please remove specific dates and names'
    );

    const args = mockSend.mock.calls[0][0];
    expect(args.html).toContain('What we noted:');
    expect(args.html).toContain('Please remove specific dates and names');
    expect(args.html).toContain('123 Main St');
  });

  it('omits the notes panel when moderator did not supply notes (null) but still ships', async () => {
    await sendReviewRejectedEmail(
      'test_key',
      'https://ratemyplace.org',
      'reviewer@example.com',
      '123 Main St',
      null
    );

    const args = mockSend.mock.calls[0][0];
    expect(args.html).not.toContain('What we noted:');
    // Closer is still present — rejection without specifics still lands the user
    // at the right next action
    expect(args.html).toContain('edit and resubmit');
    expect(args.html).toContain('Most rejections are about specific fixes');
  });

  it('omits the notes panel when notes are an empty string', async () => {
    await sendReviewRejectedEmail(
      'test_key',
      'https://ratemyplace.org',
      'reviewer@example.com',
      '123 Main St',
      '   '
    );

    const args = mockSend.mock.calls[0][0];
    expect(args.html).not.toContain('What we noted:');
  });

  it('links the profile and guidelines pages using the supplied siteUrl', async () => {
    await sendReviewRejectedEmail(
      'test_key',
      'https://staging.ratemyplace.org',
      'reviewer@example.com',
      '123 Main St',
      null
    );

    const args = mockSend.mock.calls[0][0];
    expect(args.html).toContain('https://staging.ratemyplace.org/profile');
    expect(args.html).toContain('https://staging.ratemyplace.org/guidelines');
  });
});

describe('sendContactConfirmationEmail', () => {
  // Resolves V7 contradiction: this email used to send from noreply@ while
  // telling users "reply to this email" — replies would have bounced. Per
  // d8f7b89, sender is now support@ and footer is honest about the path.

  it('sends from support@ with explicit replyTo so replies actually reach the inbox', async () => {
    await sendContactConfirmationEmail('test_key', 'user@example.com', 'Alice', 'general');

    const args = mockSend.mock.calls[0][0];
    expect(args.from).toBe('RateMyPlace Boston <support@ratemyplace.org>');
    expect(args.replyTo).toBe('support@ratemyplace.org');
    expect(args.subject).toBe('We received your message');
  });

  it('greets by name and uses the friendly category label', async () => {
    await sendContactConfirmationEmail('test_key', 'user@example.com', 'Alice', 'privacy');

    const args = mockSend.mock.calls[0][0];
    expect(args.html).toContain('Hi Alice');
    expect(args.html).toContain('privacy concern');
    expect(args.html).toContain('reply within 2-3 business days');
  });

  it('falls back to "inquiry" for unknown category values', async () => {
    await sendContactConfirmationEmail('test_key', 'user@example.com', 'Alice', 'mystery_type');

    const args = mockSend.mock.calls[0][0];
    expect(args.html).toContain('inquiry');
  });
});

describe('sendContactNotificationEmail', () => {
  it('sends to the contact@ admin inbox with category and submitter in subject', async () => {
    await sendContactNotificationEmail(
      'test_key',
      'Alice',
      'user@example.com',
      'support',
      'Help me with my account please'
    );

    const args = mockSend.mock.calls[0][0];
    expect(args.to).toBe('contact@ratemyplace.org');
    expect(args.subject).toBe('New contact: support from Alice');
    expect(args.html).toContain('user@example.com');
    expect(args.html).toContain('Help me with my account please');
  });
});

describe('cross-template guarantees', () => {
  // These guard against regressions from future voice edits that touch all
  // templates at once.

  it('no template uses Title Case "Dear" greeting (V5)', async () => {
    const sends = [
      () => sendDisputeConfirmationEmail('k', 'https://r.org', 'l@e.com', {
        landlordName: 'X', buildingAddress: 'Y', disputeReasons: ['Z'],
      }),
      () => sendDisputeResolutionEmail('k', 'l@e.com', 'X', 'uphold', 'n'),
      () => sendDisputeResolutionEmail('k', 'l@e.com', 'X', 'dismiss', 'n'),
      () => sendDisputeResolutionEmail('k', 'l@e.com', 'X', 'partially_valid', 'n'),
      () => sendReviewRejectedEmail('k', 'https://r.org', 'r@e.com', 'A', null),
      () => sendContactConfirmationEmail('k', 'u@e.com', 'X', 'general'),
    ];

    for (const send of sends) {
      mockSend.mockClear();
      await send();
      const html: string = mockSend.mock.calls[0][0].html;
      expect(html).not.toMatch(/Dear [A-Z]/);
    }
  });

  it('no template subject uses the redundant " - RateMyPlace Boston" suffix (V3)', async () => {
    const sends = [
      () => sendVerificationEmail('k', 'https://r.org', 'u@e.com', 't'),
      () => sendPasswordResetEmail('k', 'https://r.org', 'u@e.com', 't'),
      () => sendDisputeConfirmationEmail('k', 'https://r.org', 'l@e.com', {
        landlordName: 'X', buildingAddress: 'Y', disputeReasons: ['Z'],
      }),
      () => sendDisputeResolutionEmail('k', 'l@e.com', 'X', 'uphold', 'n'),
      () => sendReviewRejectedEmail('k', 'https://r.org', 'r@e.com', 'A', null),
      () => sendContactConfirmationEmail('k', 'u@e.com', 'X', 'general'),
    ];

    for (const send of sends) {
      mockSend.mockClear();
      await send();
      const subject: string = mockSend.mock.calls[0][0].subject;
      expect(subject).not.toContain('- RateMyPlace Boston');
    }
  });
});
