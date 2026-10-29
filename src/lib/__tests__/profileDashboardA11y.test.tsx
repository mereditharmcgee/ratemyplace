import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProfileDashboard from '../../components/profile/ProfileDashboard';

// A11Y-05 and A11Y-06 on the profile page: the resend result is read from a region that is
// already on the page, focus comes back to the resend button, loading is announced, and the
// verification dialog returns focus somewhere sensible when its Verify button is gone.
// Fictional data and stubbed fetch only.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const baseProps = {
  userEmail: 'tenant@example.com',
  userName: 'Tenant Example',
  avatarUrl: null,
  memberSince: 'January 2026',
  emailVerified: true,
  unreadNotificationCount: 0,
  hasPassword: true,
  isGoogleUser: false,
  notificationOptIn: true,
};

const unverifiedReview = {
  id: 'review-1',
  building_id: 'b1',
  building_address: '12 Example Rd',
  building_slug: '12-example-rd',
  neighborhood: null,
  city: 'Boston',
  overall_score: 4,
  status: 'pending',
  is_verified: false,
  created_at: 1767225600,
  updated_at: null,
  review_title: 'Example title',
  moderation_notes: null,
  has_open_dispute: false,
};

function ok(body: unknown) {
  return Promise.resolve({ ok: true, json: async () => body });
}

const focused = () => document.activeElement as HTMLElement | null;

describe('ProfileDashboard resend verification email', () => {
  function stub(resend: () => Promise<unknown>) {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => (url.includes('/api/auth/resend-verification') ? resend() : ok({ reviews: [] }))),
    );
    render(<ProfileDashboard {...baseProps} emailVerified={false} />);
  }

  const resendButton = () => screen.getByRole('button', { name: 'Send Verification Email' });

  it('renders empty status and alert regions before any result', async () => {
    stub(() => ok({}));
    await screen.findByText('No reviews yet');
    const card = resendButton().parentElement!;
    expect(within(card).getByRole('status').textContent).toBe('');
    expect(within(card).getByRole('alert').textContent).toBe('');
  });

  it('reads a sent email from the status region and returns focus to the button', async () => {
    stub(() => ok({}));
    await screen.findByText('No reviews yet');
    const button = resendButton();
    fireEvent.click(button);
    const card = button.parentElement!;
    await waitFor(() =>
      expect(within(card).getByRole('status').textContent).toBe('Verification email sent! Check your inbox.'),
    );
    expect(within(card).getByRole('alert').textContent).toBe('');
    await waitFor(() => expect(focused()).toBe(resendButton()));
  });

  it('reads a failure from the alert region', async () => {
    stub(() => Promise.resolve({ ok: false, json: async () => ({ error: 'Example failure' }) }));
    await screen.findByText('No reviews yet');
    const button = resendButton();
    fireEvent.click(button);
    const card = button.parentElement!;
    await waitFor(() => expect(within(card).getByRole('alert').textContent).toBe('Example failure'));
    expect(within(card).getByRole('status').textContent).toBe('');
  });
});

describe('ProfileDashboard loading', () => {
  it('announces loading reviews with a status and hides the spinner itself', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<ProfileDashboard {...baseProps} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Loading...');
    expect(status.querySelector('.animate-spin')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('ProfileDashboard verification dialog', () => {
  it('returns focus to Verify when closed, and to the reviews tab after an upload reloads the list', async () => {
    let reviewsCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/verification/upload')) return ok({});
        reviewsCalls += 1;
        // The reload after an upload never settles, so the list stays replaced by the spinner.
        return reviewsCalls === 1 ? ok({ reviews: [unverifiedReview] }) : new Promise(() => {});
      }),
    );
    render(<ProfileDashboard {...baseProps} />);

    const verify = await screen.findByRole('button', { name: 'Verify' });
    verify.focus();
    fireEvent.click(verify);
    screen.getByRole('dialog', { name: 'Verify Your Tenancy' });
    fireEvent.keyDown(focused()!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(focused()).toBe(verify);

    fireEvent.click(verify);
    const file = new File(['fictional image bytes'], 'example-lease.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText(/Click to upload/), { target: { files: [file] } });
    await screen.findByText('example-lease.png');
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Verification' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Verify' })).toBeNull();
    const tabs = screen.getByRole('navigation', { name: 'Tabs' });
    expect(focused()).toBe(within(tabs).getByText(/My Reviews/).closest('button'));
  });
});
