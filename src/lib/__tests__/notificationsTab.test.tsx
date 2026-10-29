import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import NotificationsTab from '../../components/profile/NotificationsTab';
import type { Notification } from '../../components/profile/NotificationsTab';

/**
 * An unread notification on the profile page sits on a blue-50 tint, a read one on white. The
 * row used to carry bg-white and bg-blue-50 together, and bg-white won in the built CSS, so the
 * tint never showed. The time-ago line is gray-600: gray-500 on blue-50 is 4.44:1, under AA.
 */

afterEach(() => {
  cleanup();
});

const now = Math.floor(Date.now() / 1000);

function notification(id: number, message: string, readAt: number | null): Notification {
  return { id, event_type: 'review_approved', review_id: 'r1', message, read_at: readAt, created_at: now - 7200 };
}

function row(message: string): HTMLElement {
  const text = screen.getByText(message);
  const found = text.closest('div.border');
  if (!found) throw new Error(`no row for ${message}`);
  return found as HTMLElement;
}

function classes(el: HTMLElement): string[] {
  return el.className.split(/\s+/).filter(Boolean);
}

describe('NotificationsTab rows', () => {
  it('tints an unread row blue-50 and leaves a read row white, never both on one row', () => {
    render(
      <NotificationsTab
        notifications={[notification(1, 'Unread message', null), notification(2, 'Read message', now - 60)]}
        loading={false}
        error={null}
      />,
    );

    const unread = classes(row('Unread message'));
    expect(unread).toContain('bg-blue-50');
    expect(unread).not.toContain('bg-white');

    const read = classes(row('Read message'));
    expect(read).toContain('bg-white');
    expect(read).not.toContain('bg-blue-50');
  });

  it('sets the time-ago line in gray-600, which passes AA on the blue-50 tint', () => {
    render(<NotificationsTab notifications={[notification(1, 'Unread message', null)]} loading={false} error={null} />);
    const timeAgo = screen.getByText('2 hours ago');
    expect(classes(timeAgo)).toContain('text-gray-600');
    expect(classes(timeAgo)).not.toContain('text-gray-500');
  });
});
