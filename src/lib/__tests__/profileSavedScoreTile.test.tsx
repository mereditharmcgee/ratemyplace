import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProfileDashboard from '../../components/profile/ProfileDashboard';
import type { SavedBuilding } from '../api-types';
import { getScoreChipColor, getScoreColor } from '../scoring-colors';

/**
 * The saved-buildings tab shows each building's score in an 18px bold tile. It was white text
 * on the band fill, 2.13:1 on Mixed amber-500 and 3.65:1 on Good emerald-600, just under the
 * large-text size. It is now the band tint with dark band text and a border in the band fill
 * (getScoreChipColor), so every band clears 4.5:1.
 */

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

function saved(id: number, avgOverall: number): SavedBuilding {
  return {
    id,
    building_id: `building-${id}`,
    building_address: `${id} Example Rd`,
    building_slug: `${id}-example-rd`,
    neighborhood: null,
    city: 'Boston',
    state: 'MA',
    review_count: 4,
    avg_overall: avgOverall,
    saved_at: 1735689600,
  };
}

describe('ProfileDashboard saved-building score tile', () => {
  it('draws each band as a tint tile with dark text, never white on the fill', async () => {
    const buildings = [saved(1, 4.6), saved(2, 3.4), saved(3, 2.5), saved(4, 1.2)];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/buildings/saved') return { ok: true, json: async () => ({ buildings }) };
      return { ok: true, json: async () => ({ reviews: [] }) };
    }));

    render(<ProfileDashboard {...baseProps} />);
    const tabs = await screen.findByRole('navigation', { name: 'Tabs' });
    fireEvent.click(within(tabs).getByText(/Saved Buildings/).closest('button')!);

    for (const building of buildings) {
      const label = building.avg_overall!.toFixed(1);
      const tile = await waitFor(() => screen.getByText(label));
      const expected = getScoreChipColor(building.avg_overall!);
      const classes = tile.className.split(/\s+/);
      expect(classes).toEqual(expect.arrayContaining([expected.bg, expected.text, 'border', expected.border]));
      expect(classes).not.toContain('text-white');
      expect(classes).not.toContain(getScoreColor(building.avg_overall!).bg);
    }
  });
});
