import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ProfileDashboard from '../../components/profile/ProfileDashboard';
import UsersTable from '../../components/admin/UsersTable';

/**
 * Email verification left public review cards. It stays visible to the reviewer on
 * their own profile and to admins in the users table, and the profile no longer
 * promises a public badge that no longer exists.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const profileProps = {
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

function stubReviewsFetch() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ reviews: [] }),
  }));
}

describe('profile email verification status', () => {
  it('tells a verified reviewer their email is verified', () => {
    stubReviewsFetch();
    render(<ProfileDashboard {...profileProps} emailVerified={true} />);
    expect(screen.getByText('Your email address is verified')).toBeTruthy();
  });

  it('tells an unverified reviewer, without promising a badge on their reviews', () => {
    stubReviewsFetch();
    const { container } = render(<ProfileDashboard {...profileProps} emailVerified={false} />);
    expect(screen.getByText('Your email address is not verified')).toBeTruthy();
    expect(screen.getByText('Verify your email to confirm this address is yours. This is not shown on your public reviews.')).toBeTruthy();
    expect(container.textContent).not.toMatch(/Email Verified badge/i);
  });
});

describe('email-verified confirmation page', () => {
  it('no longer promises a badge on public reviews', () => {
    const source = readFileSync(join(process.cwd(), 'src/pages/email-verified.astro'), 'utf8');
    expect(source).not.toMatch(/badge/i);
    expect(source).toContain('Email verification is not shown on your public reviews.');
  });
});

describe('admin users table email status', () => {
  it('still marks each user verified or unverified', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        users: [
          { id: 'u1', email: 'one@example.com', is_admin: 0, email_verified: 1, created_at: 1760000000, review_count: 1 },
          { id: 'u2', email: 'two@example.com', is_admin: 0, email_verified: 0, created_at: 1760000000, review_count: 0 },
        ],
      }),
    }));

    render(<UsersTable currentUserId="admin-1" />);

    const verifiedRow = (await screen.findByText('one@example.com')).closest('tr')!;
    const unverifiedRow = screen.getByText('two@example.com').closest('tr')!;
    expect(verifiedRow.textContent).toContain('verified');
    expect(verifiedRow.textContent).not.toContain('unverified');
    expect(unverifiedRow.textContent).toContain('unverified');
  });
});
