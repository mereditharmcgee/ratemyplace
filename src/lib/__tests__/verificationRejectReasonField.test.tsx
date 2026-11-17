import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import VerificationQueue from '../../components/admin/VerificationQueue';
import type { PendingVerification } from '../../pages/api/admin/pending-verifications';
import { VERIFICATION_ADMIN_COPY } from '../verificationNotice';

// The moderator's rejection reason used to be stored and never shown. It now reaches the
// reviewer word for word, on My Reviews and in the rejection email, so the admin field says
// who reads it. One fictional queue row from a stubbed fetch; no document is ever loaded.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ROW: PendingVerification = {
  id: 'ver-example-reason',
  review_id: 'review-example-reason',
  user_id: 'user-example-reason',
  r2_key: 'example/key',
  filename: 'example-lease.pdf',
  content_type: 'application/pdf',
  size_bytes: 2048,
  uploaded_at: 1767225600,
  building_address: 'Example Building',
  building_city: 'Boston',
  user_email: 'tenant@example.com',
};

async function renderQueue(rows: PendingVerification[]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ verifications: rows }) }));
  render(<VerificationQueue />);
  await screen.findAllByText('Example Building');
}

describe('VerificationQueue rejection reason field', () => {
  it('is labelled for the reviewer and says where the reviewer sees it', async () => {
    await renderQueue([ROW]);
    const field = screen.getByRole('textbox', { name: VERIFICATION_ADMIN_COPY.rejectionReasonLabel });
    const hintIds = (field.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
    expect(hintIds).toHaveLength(1);
    expect(document.getElementById(hintIds[0])?.textContent).toBe(VERIFICATION_ADMIN_COPY.rejectionReasonHint);
    expect(screen.queryByText(/Rejection Reason/)).toBeNull();
  });

  it('gives each row its own field and hint', async () => {
    await renderQueue([ROW, { ...ROW, id: 'ver-example-reason-2', review_id: 'review-example-reason-2' }]);
    const fields = screen.getAllByRole('textbox', { name: VERIFICATION_ADMIN_COPY.rejectionReasonLabel });
    expect(fields).toHaveLength(2);
    const ids = fields.map((field) => field.id);
    expect(new Set(ids).size).toBe(2);
    const hints = fields.map((field) => field.getAttribute('aria-describedby'));
    expect(new Set(hints).size).toBe(2);
  });
});
