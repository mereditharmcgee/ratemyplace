import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import ReviewEditForm from '../../components/reviews/ReviewEditForm';
import type { ReviewDetail } from '../../pages/api/reviews/[id]';

/**
 * The tenure select on the reviewer's edit page starts from what is stored, so saving without
 * touching it changes nothing. It used to start at "1-2 years" when no tenure was stored, so
 * an untouched save of an older review wrote 18 months the reviewer never gave, and a stored
 * value the list does not offer showed the first choice while the form kept the stored value.
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
    tenure_months: 18,
    unit_structural: 4,
    ...fields,
  } as ReviewDetail;
}

function tenureSelect(): HTMLSelectElement {
  const select = screen
    .getAllByRole('combobox')
    .find((el) => Array.from((el as HTMLSelectElement).options).some((opt) => opt.textContent === '1-2 years'));
  if (!select) throw new Error('no tenure select');
  return select as HTMLSelectElement;
}

/** Saves the form untouched and returns the JSON body it sent. */
function saveUntouched(container: HTMLElement): Record<string, unknown> {
  fireEvent.click(screen.getByRole('checkbox', { name: /I confirm this review/ }));
  fireEvent.submit(container.querySelector('form') as HTMLFormElement);
  const fetchMock = vi.mocked(fetch);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [, init] = fetchMock.mock.calls[0];
  return JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
}

describe('ReviewEditForm tenure select', () => {
  it('starts at the stored tenure', () => {
    render(<ReviewEditForm review={review({ tenure_months: 36 })} />);
    const select = tenureSelect();
    expect(select.value).toBe('36');
    expect(select.selectedOptions[0]?.textContent).toBe('2-3 years');
  });

  it('starts blank when no tenure is stored, not at "1-2 years"', () => {
    render(<ReviewEditForm review={review({ tenure_months: null })} />);
    const select = tenureSelect();
    expect(select.value).toBe('');
    expect(select.selectedOptions[0]?.textContent).toBe('Select...');
  });

  it('offers no blank choice when a tenure is stored', () => {
    render(<ReviewEditForm review={review({ tenure_months: 18 })} />);
    expect(Array.from(tenureSelect().options).map((opt) => opt.value)).not.toContain('');
  });

  it('shows a stored value the list does not offer instead of the first choice', () => {
    render(<ReviewEditForm review={review({ tenure_months: 12 })} />);
    const select = tenureSelect();
    expect(select.value).toBe('12');
    expect(select.selectedOptions[0]?.textContent).toBe('12 months');
  });

  it('saves an untouched review with no stored tenure as blank, not as 18 months', () => {
    // The request never settles, so the form stays put instead of redirecting to the profile.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const { container } = render(<ReviewEditForm review={review({ tenure_months: null })} />);
    expect(saveUntouched(container).tenure_months).toBe('');
  });

  it('saves an untouched stored tenure as stored', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const { container } = render(<ReviewEditForm review={review({ tenure_months: 12 })} />);
    expect(saveUntouched(container).tenure_months).toBe('12');
  });

  it('saves the tenure the reviewer picks', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const { container } = render(<ReviewEditForm review={review({ tenure_months: null })} />);
    fireEvent.change(tenureSelect(), { target: { value: '48' } });
    expect(saveUntouched(container).tenure_months).toBe('48');
  });
});
