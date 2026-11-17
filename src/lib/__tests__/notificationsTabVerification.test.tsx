import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import NotificationsTab from '../../components/profile/NotificationsTab';
import type { Notification } from '../../components/profile/NotificationsTab';
import ProfileDashboard from '../../components/profile/ProfileDashboard';
import SettingsTab from '../../components/profile/SettingsTab';
import { EVENT_MESSAGES } from '../notifications';
import { REVIEW_STATUS_EMAIL_HINT, VERIFICATION_COPY } from '../verificationNotice';

// The two proof-of-address outcomes show in the notification list with their own icon and a
// way back to My Reviews, where the Verified badge or the reason and next step are.
// Every name and place here is fictional.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const now = Math.floor(Date.now() / 1000);

function notice(id: number, eventType: string, message: string): Notification {
  return { id, event_type: eventType, review_id: 'rev-1', message, read_at: null, created_at: now - 120 };
}

const APPROVED = EVENT_MESSAGES.verification_approved('Sample Building');
const REJECTED = EVENT_MESSAGES.verification_rejected('Sample Building');

describe('NotificationsTab verification notices', () => {
  it('renders both messages, each with a way to My Reviews', () => {
    const onOpenReviews = vi.fn();
    render(
      <NotificationsTab
        notifications={[notice(1, 'verification_approved', APPROVED), notice(2, 'verification_rejected', REJECTED)]}
        loading={false}
        error={null}
        onOpenReviews={onOpenReviews}
      />,
    );
    expect(screen.getByText(APPROVED)).toBeTruthy();
    expect(screen.getByText(REJECTED)).toBeTruthy();
    const actions = screen.getAllByRole('button', { name: VERIFICATION_COPY.notificationAction });
    expect(actions).toHaveLength(2);
    fireEvent.click(actions[1]);
    expect(onOpenReviews).toHaveBeenCalledOnce();
  });

  it('gives the two outcomes their own icons, not the generic one', () => {
    const { container } = render(
      <NotificationsTab
        notifications={[notice(1, 'verification_approved', APPROVED), notice(2, 'verification_rejected', REJECTED)]}
        loading={false}
        error={null}
        onOpenReviews={vi.fn()}
      />,
    );
    const icons = Array.from(container.querySelectorAll('div.rounded-full'));
    expect(icons[0].className).toContain('bg-emerald-100');
    expect(icons[1].className).toContain('bg-amber-100');
  });

  it('adds no action to the review events', () => {
    render(
      <NotificationsTab
        notifications={[notice(1, 'review_approved', 'A review notice.')]}
        loading={false}
        error={null}
        onOpenReviews={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: VERIFICATION_COPY.notificationAction })).toBeNull();
  });
});

describe('the email setting says what it covers', () => {
  it('names both emails it can turn off', () => {
    render(<SettingsTab userName={null} userEmail="tenant@example.com" hasPassword={true} isGoogleUser={false} notificationOptIn={true} />);
    expect(screen.getByText(REVIEW_STATUS_EMAIL_HINT)).toBeTruthy();
    expect(REVIEW_STATUS_EMAIL_HINT).toMatch(/not approved/);
    expect(REVIEW_STATUS_EMAIL_HINT).toMatch(/verify your tenancy/);
  });
});

describe('ProfileDashboard: from a verification notice to My Reviews', () => {
  it('switches to My Reviews and puts focus on its tab', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          url.startsWith('/api/notifications')
            ? { notifications: [notice(1, 'verification_rejected', REJECTED)] }
            : { reviews: [] },
      })),
    );
    render(
      <ProfileDashboard
        userEmail="tenant@example.com"
        userName="Tenant Example"
        avatarUrl={null}
        memberSince="January 2026"
        emailVerified={true}
        unreadNotificationCount={1}
        hasPassword={true}
        isGoogleUser={false}
        notificationOptIn={true}
      />,
    );
    const tabs = await screen.findByRole('navigation', { name: 'Tabs' });
    fireEvent.click(within(tabs).getByText(/Notifications/));
    const action = await screen.findByRole('button', { name: VERIFICATION_COPY.notificationAction });
    fireEvent.click(action);

    const reviewsTab = within(tabs).getByText(/My Reviews/).closest('button')!;
    await waitFor(() => expect(reviewsTab.getAttribute('aria-current')).toBe('true'));
    expect(document.activeElement).toBe(reviewsTab);
  });
});
