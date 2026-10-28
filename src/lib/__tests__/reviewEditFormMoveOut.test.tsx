import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import ReviewEditForm from '../../components/reviews/ReviewEditForm';
import type { ReviewDetail } from '../../pages/api/reviews/[id]';

/**
 * The reviewer's own edit page shows the stored move-out in words beside the move-in, and the
 * move-out select starts from what is stored, so saving without touching it changes nothing.
 * New reviews store no move-out season, which used to print "Move-out: null 2025".
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
    unit_structural: 4,
    ...fields,
  } as ReviewDetail;
}

/** The read-only line under the address that holds the move-in and move-out. */
function datesLine(): HTMLElement {
  return screen.getByText(/Move-in:/);
}

function moveOutSelect(): HTMLSelectElement {
  const select = screen
    .getAllByRole('combobox')
    .find((el) => Array.from((el as HTMLSelectElement).options).some((opt) => opt.value === '2020_or_earlier'));
  if (!select) throw new Error('no move-out select');
  return select as HTMLSelectElement;
}

describe('ReviewEditForm move-out line', () => {
  it('shows a past tenant with no stored season as the year alone', () => {
    render(<ReviewEditForm review={review({ is_current_tenant: false, move_out_year_new: '2025', move_out_season: null })} />);
    expect(datesLine().textContent).toBe('Move-in: Summer 2021 - Move-out: 2025');
    expect(datesLine().textContent).not.toContain('null');
  });

  it('shows "2020 or earlier" in words, never the stored token', () => {
    render(<ReviewEditForm review={review({ is_current_tenant: false, move_out_year_new: '2020_or_earlier' })} />);
    expect(datesLine().textContent).toBe('Move-in: Summer 2021 - Move-out: 2020 or earlier');
    expect(datesLine().textContent).not.toContain('_');
  });

  it('shows a stored move-out season with its year', () => {
    render(<ReviewEditForm review={review({ is_current_tenant: false, move_out_year_new: '2023', move_out_season: 'fall' })} />);
    expect(datesLine().textContent).toBe('Move-in: Summer 2021 - Move-out: Fall 2023');
  });

  it('keeps "(Current tenant)" for a current tenant', () => {
    render(<ReviewEditForm review={review({ is_current_tenant: true, move_out_year_new: 'current' })} />);
    expect(datesLine().textContent).toBe('Move-in: Summer 2021 (Current tenant)');
  });

  it('shows no move-out for a past tenant with none stored', () => {
    render(<ReviewEditForm review={review({ is_current_tenant: false, move_out_year_new: null })} />);
    expect(datesLine().textContent).toBe('Move-in: Summer 2021');
  });

  it('sets the locality and dates lines in gray-600, which passes AA on paper', () => {
    render(<ReviewEditForm review={review({ is_current_tenant: false, move_out_year_new: '2025' })} />);
    const box = datesLine().parentElement as HTMLElement;
    expect(box.className).toContain('bg-paper');
    expect(datesLine().className).toContain('text-gray-600');
    expect(screen.getByText(/Brighton/).className).toContain('text-gray-600');
    expect(box.innerHTML).not.toMatch(/text-gray-[45]00/);
  });
});

describe('ReviewEditForm move-out select', () => {
  it('starts a past tenant at the stored year', () => {
    render(<ReviewEditForm review={review({ is_current_tenant: false, move_out_year_new: '2024' })} />);
    expect(moveOutSelect().value).toBe('2024');
  });

  it('starts a past tenant with no stored move-out blank, not at "I still live here"', () => {
    render(<ReviewEditForm review={review({ is_current_tenant: false, move_out_year_new: null })} />);
    const select = moveOutSelect();
    expect(select.value).toBe('');
    expect(select.selectedOptions[0]?.textContent).toBe('Select...');
  });

  it('shows a stored year the list no longer offers instead of "I still live here"', () => {
    render(<ReviewEditForm review={review({ is_current_tenant: false, move_out_year_new: '2020' })} />);
    const select = moveOutSelect();
    expect(select.value).toBe('2020');
    expect(select.selectedOptions[0]?.textContent).toBe('2020');
  });

  it('offers no blank choice when a move-out is stored', () => {
    render(<ReviewEditForm review={review({ is_current_tenant: false, move_out_year_new: '2024' })} />);
    expect(Array.from(moveOutSelect().options).map((opt) => opt.value)).not.toContain('');
  });

  it('saves an untouched past tenant with no stored move-out as blank, not as current', () => {
    // The request never settles, so the form stays put instead of redirecting to the profile.
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(
      <ReviewEditForm review={review({ is_current_tenant: false, move_out_year_new: null })} />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /I confirm this review/ }));
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/reviews/r1');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.move_out_year_new).toBe('');
  });
});
