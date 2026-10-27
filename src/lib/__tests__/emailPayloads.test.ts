import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pins the full Resend payload — from, to, replyTo, subject, html or text — of every
// existing email, so the delivery refactor can prove it changed nothing a recipient sees.
// Never update this snapshot with `-u` to make a refactor pass: a diff here IS the bug.

const mockSend = vi.fn();

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
  sendRecordCorrectionOutcomeEmail,
  sendRecordsBreakerEmail,
  sendRecordsResumedEmail,
} from '../email';

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue({ data: { id: 'msg_snapshot' }, error: null });
});

async function payloadOf(send: () => Promise<unknown>): Promise<unknown> {
  await send();
  expect(mockSend).toHaveBeenCalledOnce();
  return mockSend.mock.calls[0][0];
}

describe('email payloads (snapshot)', () => {
  it('sendVerificationEmail', async () => {
    expect(await payloadOf(() => sendVerificationEmail('k', 'https://ratemyplace.org', 'user@example.com', 'tok123'))).toMatchSnapshot();
  });

  it('sendPasswordResetEmail', async () => {
    expect(await payloadOf(() => sendPasswordResetEmail('k', 'https://ratemyplace.org', 'user@example.com', 'tok123'))).toMatchSnapshot();
  });

  it('sendDisputeConfirmationEmail with an explanation', async () => {
    expect(
      await payloadOf(() =>
        sendDisputeConfirmationEmail('k', 'https://ratemyplace.org', 'landlord@example.com', {
          landlordName: 'Acme LLC',
          buildingAddress: '23-27 Lanark Rd, Boston, MA 02135',
          disputeReasons: ['Not a tenant', '<b>x</b>'],
          disputeExplanation: 'The reviewer <never> lived here & says so',
        }),
      ),
    ).toMatchSnapshot();
  });

  it('sendDisputeConfirmationEmail without an explanation', async () => {
    expect(
      await payloadOf(() =>
        sendDisputeConfirmationEmail('k', 'https://ratemyplace.org', 'landlord@example.com', {
          landlordName: 'Acme LLC',
          buildingAddress: '23-27 Lanark Rd, Boston, MA 02135',
          disputeReasons: ['Not a tenant', '<b>x</b>'],
        }),
      ),
    ).toMatchSnapshot();
  });

  it.each(['general', 'privacy', 'support', 'landlord', 'other'])('sendContactConfirmationEmail (%s)', async (category) => {
    expect(await payloadOf(() => sendContactConfirmationEmail('k', 'sender@example.com', 'Pat <Doe>', category))).toMatchSnapshot();
  });

  it('sendContactNotificationEmail', async () => {
    expect(
      await payloadOf(() => sendContactNotificationEmail('k', 'Pat <script>', 'pat@example.com', 'support', 'Hello & <b>bye</b>')),
    ).toMatchSnapshot();
  });

  it.each(['uphold', 'dismiss', 'partially_valid'] as const)('sendDisputeResolutionEmail (%s)', async (outcome) => {
    expect(
      await payloadOf(() => sendDisputeResolutionEmail('k', 'landlord@example.com', 'Acme <LLC>', outcome, 'Notes & <i>more</i>')),
    ).toMatchSnapshot();
  });

  it('sendReviewRejectedEmail with a reason', async () => {
    expect(
      await payloadOf(() =>
        sendReviewRejectedEmail('k', 'https://ratemyplace.org', 'reviewer@example.com', '1 Main St <b>', 'Names a <neighbor>'),
      ),
    ).toMatchSnapshot();
  });

  it('sendReviewRejectedEmail without a reason', async () => {
    expect(
      await payloadOf(() => sendReviewRejectedEmail('k', 'https://ratemyplace.org', 'reviewer@example.com', '1 Main St', null)),
    ).toMatchSnapshot();
  });

  it.each(['repulled_unchanged', 'repulled_updated', 'source_mismatch_noted'] as const)(
    'sendRecordCorrectionOutcomeEmail (%s)',
    async (outcome) => {
      expect(
        await payloadOf(() =>
          sendRecordCorrectionOutcomeEmail(
            'k',
            'filer@example.com',
            '23-27 Lanark Rd <b>',
            'https://ratemyplace.org/building/bldg-lanark#records',
            outcome,
          ),
        ),
      ).toMatchSnapshot();
    },
  );

  it('sendRecordsBreakerEmail', async () => {
    expect(
      await payloadOf(() => sendRecordsBreakerEmail('k', 'ops@example.org', 'Records fill paused', 'Line one\nLine two')),
    ).toMatchSnapshot();
  });

  it('sendRecordsResumedEmail', async () => {
    expect(
      await payloadOf(() => sendRecordsResumedEmail('k', 'ops@example.org', 'Records fill resumed', 'Back to normal')),
    ).toMatchSnapshot();
  });
});
