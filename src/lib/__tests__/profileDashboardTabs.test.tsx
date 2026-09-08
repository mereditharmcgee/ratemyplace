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

  it('marks the active tab with aria-current="true" and the others without it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ reviews: [] }),
    }));

    render(<ProfileDashboard {...baseProps} />);

    const tabs = await screen.findByRole('navigation', { name: 'Tabs' });
    const reviewsTab = within(tabs).getByText(/My Reviews/).closest('button')!;
    const savedTab = within(tabs).getByText(/Saved Buildings/).closest('button')!;

    expect(reviewsTab.getAttribute('aria-current')).toBe('true');
    expect(savedTab.getAttribute('aria-current')).toBeNull();

    fireEvent.click(savedTab);

    expect(savedTab.getAttribute('aria-current')).toBe('true');
    expect(reviewsTab.getAttribute('aria-current')).toBeNull();
  });

  it('shows "My Reviews" once as a tab and never repeats it as a VISIBLE heading in the panel', async () => {
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

    // No *visible* h1/h2/h3 in the panel should repeat "My Reviews" — a
    // sr-only heading carrying that label for screen readers is fine, since
    // it's never visually rendered alongside the tab button.
    const headings = Array.from(container.querySelectorAll('h1, h2, h3'));
    const visibleHeadings = headings.filter((h) => !h.classList.contains('sr-only'));
    expect(visibleHeadings.some((h) => h.textContent?.includes('My Reviews'))).toBe(false);

    // The "Write a review" action should still be present.
    expect(container.textContent).toContain('Write a Review');
  });

  it('does not repeat "Notifications" as a VISIBLE heading under the Notifications tab', async () => {
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
      const visibleHeadings = headings.filter((h) => !h.classList.contains('sr-only'));
      expect(visibleHeadings.some((h) => h.textContent?.trim() === 'Notifications')).toBe(false);
    });
  });
});
