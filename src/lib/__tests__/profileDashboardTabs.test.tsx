import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProfileDashboard from '../../components/profile/ProfileDashboard';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

describe('ProfileDashboard tabs', () => {
  it('renders the tab row as a non-wrapping, horizontally scrollable strip', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ reviews: [] }),
    }));

    render(<ProfileDashboard {...baseProps} />);

    const tabs = await screen.findByRole('navigation', { name: 'Tabs' });
    expect(tabs.className).toContain('overflow-x-auto');
    expect(tabs.className).toContain('whitespace-nowrap');
  });

  it('shows "My Reviews" once as a tab and never repeats it as a heading in the panel', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ reviews: [] }),
    }));

    const { container } = render(<ProfileDashboard {...baseProps} />);

    await waitFor(() => {
      expect(container.textContent).toContain('No reviews yet');
    });

    const tabs = screen.getByRole('navigation', { name: 'Tabs' });
    const reviewsTab = within(tabs).getByText(/My Reviews/);
    expect(reviewsTab.tagName).toBe('BUTTON');

    // No h1/h2/h3 anywhere in the panel should repeat "My Reviews" — the tab
    // button is the only place that label appears.
    const headings = Array.from(container.querySelectorAll('h1, h2, h3'));
    expect(headings.some((h) => h.textContent?.includes('My Reviews'))).toBe(false);

    // The "Write a review" action should still be present.
    expect(container.textContent).toContain('Write a Review');
  });

  it('does not repeat "Notifications" as a heading under the Notifications tab', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/notifications')) {
        return Promise.resolve({ ok: true, json: async () => ({ notifications: [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ reviews: [] }) });
    }));

    const { container } = render(<ProfileDashboard {...baseProps} />);
    await waitFor(() => {
      expect(container.textContent).toContain('No reviews yet');
    });

    const tabs = screen.getByRole('navigation', { name: 'Tabs' });
    const notificationsTab = within(tabs).getByText(/Notifications/);
    fireEvent.click(notificationsTab);

    await waitFor(() => {
      const headings = Array.from(container.querySelectorAll('h1, h2, h3'));
      expect(headings.some((h) => h.textContent?.trim() === 'Notifications')).toBe(false);
    });
  });
});
