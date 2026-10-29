import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ReviewEditForm from '../../components/reviews/ReviewEditForm';
import { supplementaryItems } from '../surveyItems';
import type { ReviewDetail } from '../../pages/api/reviews/[id]';

// The reviewer's edit page (A11Y-04, A11Y-05, A11Y-08): every control has a name, the rating
// questions are radio groups, and a Save moves focus to what replaced the pressed button: the
// error when it fails, the confirmation panel when it succeeds.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllTimers();
  vi.useRealTimers();
});

/** A fictional review with every conditional control shown. */
function review(fields: Partial<ReviewDetail> = {}): ReviewDetail {
  return {
    id: 'r1',
    building_address: '12 Example Rd',
    neighborhood: 'Brighton',
    city: 'Boston',
    unit_type: '2br',
    move_in_season: 'summer',
    move_in_year: 2021,
    move_in_given: 'season_and_year',
    move_out_season: null,
    move_out_year_new: 'current',
    is_current_tenant: true,
    laundry_type: 'coin_op',
    had_pest_issues: true,
    unit_structural: 4,
    // Not on ReviewDetail; the form reads it from the row when present.
    property_manager_name: 'Example Property Co',
    ...fields,
  } as unknown as ReviewDetail;
}

// Owned by the concurrent fix/review-edit-and-admin-cleanup branch, which rewrites both
// selects. They get their id/htmlFor after that branch is merged here (plan follow-up), so
// they are the only controls this test lets through without a name.
function otherLaneSelects(): Element[] {
  const tenureLabel = supplementaryItems.tenure.options[0].label;
  return Array.from(document.querySelectorAll('select')).filter((select) =>
    Array.from(select.options).some((opt) => opt.textContent === tenureLabel || opt.value === '2020_or_earlier'),
  );
}

const ROLES = ['textbox', 'spinbutton', 'combobox', 'checkbox', 'radio'] as const;

function namedControls(): Set<HTMLElement> {
  const named = new Set<HTMLElement>();
  for (const role of ROLES) {
    for (const el of screen.queryAllByRole(role, { name: (name) => name.trim() !== '' })) named.add(el);
  }
  return named;
}

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function tickConsentAndSave() {
  fireEvent.click(screen.getByRole('checkbox', { name: /I confirm this review/ }));
  fireEvent.submit(document.querySelector('form') as HTMLFormElement);
}

describe('ReviewEditForm labels', () => {
  it('names every input, select and textarea except the two selects the other branch owns', () => {
    render(<ReviewEditForm review={review()} />);
    const skipped = otherLaneSelects();
    expect(skipped).toHaveLength(2);

    const named = namedControls();
    const controls = Array.from(document.querySelectorAll<HTMLElement>('input, select, textarea'));
    expect(controls.length).toBeGreaterThan(100);
    const unnamed = controls.filter((el) => !named.has(el) && !skipped.includes(el));
    expect(unnamed.map((el) => el.outerHTML.slice(0, 120))).toEqual([]);
  });

  it('ties each visible label to its control', () => {
    render(<ReviewEditForm review={review()} />);
    for (const [label, id] of [
      [/^Unit Number/, 'review-edit-unit-number'],
      [/^Square Footage/, 'review-edit-square-footage'],
      [/^Bedrooms$/, 'review-edit-bedrooms'],
      [/^Bathrooms$/, 'review-edit-bathrooms'],
      [/^Monthly Rent/, 'review-edit-rent-amount'],
      [/^Estimated Monthly Utility Cost/, 'review-edit-estimated-utilities'],
      [/^Laundry Situation$/, 'review-edit-laundry-type'],
      [/^Cost per Load/, 'review-edit-laundry-cost'],
      [/^Parking Situation/, 'review-edit-parking-type'],
      [/^Who was your landlord or property manager\?/, 'review-edit-landlord-name'],
      [/^Who manages the property\?/, 'review-edit-property-manager-name'],
      [/^Move-in month$/, 'review-edit-move-in-month'],
      [/^Move-in year$/, 'review-edit-move-in-year'],
      [/^Review Title/, 'review-edit-review-title'],
      [/^Additional Comments/, 'review-edit-review-text'],
    ] as const) {
      expect(screen.getByLabelText(label).id, String(label)).toBe(id);
    }
  });

  it('groups the checkbox and radio sets under their captions', () => {
    render(<ReviewEditForm review={review()} />);
    for (const name of [
      /^Amenities/,
      /^Utilities Included in Rent/,
      /^Pets Allowed/,
      /^When did you move in\?/,
      new RegExp(`^${supplementaryItems.housingVouchers.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      new RegExp(`^${supplementaryItems.safelyLit.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    ]) {
      expect(screen.getByRole('group', { name })).toBeTruthy();
    }
  });

  it('renders all 27 rating questions as named radio groups', () => {
    render(<ReviewEditForm review={review()} />);
    const groups = screen.getAllByRole('radiogroup', { name: (name) => name.trim() !== '' });
    expect(groups).toHaveLength(27);
    expect(screen.getAllByRole('radiogroup', { description: /Strongly Disagree/ })).toHaveLength(27);
    // The stored 4 shows as checked in the first question.
    expect((screen.getAllByRole('radio', { name: '4' })[0] as HTMLInputElement).checked).toBe(true);
  });

  it('uses the teal-700 focus ring everywhere but the two other-branch selects', () => {
    render(<ReviewEditForm review={review()} />);
    const html = document.body.innerHTML;
    const weak = html.match(/focus:ring-teal-500/g) ?? [];
    expect(weak).toHaveLength(2);
    for (const select of otherLaneSelects()) expect(select.className).toContain('focus:ring-teal-500');
  });
});

describe('ReviewEditForm Save focus', () => {
  it('moves focus to the error when every rating is cleared', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<ReviewEditForm review={review({ unit_structural: null })} />);
    tickConsentAndSave();
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    const focused = document.activeElement as HTMLElement;
    expect(focused.textContent).toBe('Please rate at least one item before saving your review.');
    expect(focused.getAttribute('tabindex')).toBe('-1');
    expect(focused.getAttribute('role')).toBeNull();

    // A second failed Save with the same message moves focus there again.
    (document.activeElement as HTMLElement).blur();
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    await flush();
    expect(document.activeElement?.textContent).toBe('Please rate at least one item before saving your review.');
  });

  it('moves focus to the error when the server refuses the save', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: 'Invalid rating value' }) })),
    );
    render(<ReviewEditForm review={review()} />);
    tickConsentAndSave();
    await flush();
    expect(document.activeElement?.textContent).toBe('Invalid rating value');
  });

  it('moves focus to the confirmation panel after a successful save', async () => {
    // Fake timers keep the 1.5s redirect to the profile from running.
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) })));
    render(<ReviewEditForm review={review()} />);
    tickConsentAndSave();
    await flush();

    const focused = document.activeElement as HTMLElement;
    expect(focused.getAttribute('tabindex')).toBe('-1');
    expect(focused.querySelector('h3')?.textContent).toBe('Review Updated!');
    expect(focused.textContent).toContain('Redirecting to your profile...');
  });
});
