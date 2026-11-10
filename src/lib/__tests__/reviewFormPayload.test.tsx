import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ReviewForm from '../../components/reviews/ReviewForm';
import ReviewEditForm from '../../components/reviews/ReviewEditForm';
import { browserNav } from '../reviewPaths';
import type { ReviewDetail } from '../../pages/api/reviews/[id]';

// A11Y-04 changed how a rating is chosen (buttons became native radio groups) and nothing
// else. These literals were captured on the button markup, before the change, and must pass
// unchanged on the radios: the same answers have to send the same bytes, in the same order,
// from both the new-review form and the edit form.

type RenderOptions = Parameters<NonNullable<Window['turnstile']>['render']>[1];

beforeEach(() => {
  window.turnstile = {
    render: vi.fn((_container: HTMLElement, options: RenderOptions) => {
      options.callback?.('tok-1');
      return 'widget-1';
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  };
  vi.spyOn(browserNav, 'go').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as { turnstile?: unknown }).turnstile;
});

/**
 * Answer rating question `groupIndex` (0-based, in page order) with `label`: "1" to "5" or
 * "N/A". Each question is a radio group; each answer is a radio named by its visible text.
 * (On the button markup this helper clicked the button with that text in the question's row.)
 */
function choose(groupIndex: number, label: string): void {
  const group = screen.getAllByRole('radiogroup')[groupIndex];
  fireEvent.click(within(group).getByRole('radio', { name: label }));
}

const continueButton = () => screen.getByRole('button', { name: 'Continue' });

describe('new review payload', () => {
  function walkAndSubmit(answer: { unit: () => void; building: () => void; landlord: () => void }) {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    render(<ReviewForm building={{ id: 'b1', address: '12 Example Rd', city: 'Boston' }} />);
    fireEvent.click(continueButton()); // unit details
    answer.unit();
    fireEvent.click(continueButton()); // unit rating
    answer.building();
    fireEvent.click(continueButton()); // building rating
    answer.landlord();
    fireEvent.click(continueButton()); // landlord rating
    fireEvent.click(screen.getByRole('button', { name: 'Review & Submit' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Review' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/reviews');
    return Array.from((init.body as FormData).entries());
  }

  it('sends exactly these entries for a fixed set of answers', () => {
    const entries = walkAndSubmit({
      unit: () => {
        choose(0, '5'); // unit_structural
        choose(1, '1'); // unit_plumbing
        choose(2, '3'); // unit_electrical
      },
      building: () => choose(6, 'N/A'), // building_laundry
      landlord: () => choose(0, '4'), // landlord_maintenance
    });

    expect(entries).toEqual([
      ['building_id', 'b1'],
      ['bedrooms', '1'],
      ['bathrooms', '1'],
      ['amenities', '[]'],
      ['utilities_included', '[]'],
      ['tenure_months', '18'],
      ['move_out_year', 'current'],
      ['unit_structural', '5'],
      ['unit_plumbing', '1'],
      ['unit_electrical', '3'],
      ['landlord_maintenance', '4'],
      ['laundry_type', 'none'],
      ['would_recommend', 'yes'],
      ['accepts_housing_vouchers', ''],
      ['safely_lit_at_night', ''],
      ['cf-turnstile-response', 'tok-1'],
    ]);
  });

  it('drops an answer changed to N/A, and keeps a changed number in its first place', () => {
    const entries = walkAndSubmit({
      unit: () => {
        choose(0, '2'); // unit_structural
        choose(1, '4'); // unit_plumbing
        choose(0, '5'); // unit_structural again
      },
      building: () => {
        choose(7, '2'); // building_parking
        choose(7, 'N/A'); // building_parking again
      },
      landlord: () => choose(5, 'N/A'), // landlord_deposit
    });

    expect(entries).toEqual([
      ['building_id', 'b1'],
      ['bedrooms', '1'],
      ['bathrooms', '1'],
      ['amenities', '[]'],
      ['utilities_included', '[]'],
      ['tenure_months', '18'],
      ['move_out_year', 'current'],
      ['unit_structural', '5'],
      ['unit_plumbing', '4'],
      ['laundry_type', 'none'],
      ['would_recommend', 'yes'],
      ['accepts_housing_vouchers', ''],
      ['safely_lit_at_night', ''],
      ['cf-turnstile-response', 'tok-1'],
    ]);
  });
});

describe('edit review payload', () => {
  function review(fields: Partial<ReviewDetail>): ReviewDetail {
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
      ...fields,
    } as ReviewDetail;
  }

  /** Tick consent, save with a request that never settles, and return the body it sent. */
  function save(): string {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    fireEvent.click(screen.getByRole('checkbox', { name: /I confirm this review/ }));
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/reviews/r1');
    return init.body as string;
  }

  // All 27 scored items, in the order the body sends them, after the two clicks below.
  const EXPECTED_SCORES: Array<[string, number | null]> = [
    ['unit_structural', 2],
    ['unit_plumbing', null],
    ['unit_electrical', null],
    ['unit_climate', null],
    ['unit_ventilation', null],
    ['unit_pests', null],
    ['unit_mold', null],
    ['unit_appliances', null],
    ['unit_layout', null],
    ['unit_accuracy', null],
    ['building_common_areas', null],
    ['building_security', null],
    ['building_exterior', null],
    ['building_noise_neighbors', null],
    ['building_noise_external', null],
    ['building_mail', null],
    ['building_laundry', null],
    ['building_parking', null],
    ['building_trash', null],
    ['landlord_maintenance', null],
    ['landlord_communication', null],
    ['landlord_professionalism', null],
    ['landlord_lease_clarity', null],
    ['landlord_privacy', null],
    ['landlord_deposit', 5],
    ['landlord_rent_practices', null],
    ['landlord_non_retaliation', null],
  ];

  it('sends the 27 scores in order, and a body identical to an untouched save of the same answers', () => {
    expect(EXPECTED_SCORES).toHaveLength(27);

    render(<ReviewEditForm review={review({ unit_structural: 4, building_laundry: 2, landlord_deposit: 5 })} />);
    choose(0, '2'); // unit_structural: 4 -> 2
    choose(16, 'N/A'); // building_laundry: 2 -> N/A
    const clicked = save();

    const keys = new Set(EXPECTED_SCORES.map(([key]) => key));
    const sentScores = Object.entries(JSON.parse(clicked) as Record<string, unknown>).filter(([key]) => keys.has(key));
    expect(sentScores).toEqual(EXPECTED_SCORES);

    cleanup();
    vi.unstubAllGlobals();

    render(<ReviewEditForm review={review({ unit_structural: 2, building_laundry: null, landlord_deposit: 5 })} />);
    const untouched = save();

    expect(clicked).toBe(untouched);
  });
});
