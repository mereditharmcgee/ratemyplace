import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, within } from '@testing-library/react';
import ReviewEditForm from '../../components/reviews/ReviewEditForm';
import type { ReviewDetail } from '../../pages/api/reviews/[id]';
import { supplementaryItems } from '../surveyItems';
import { REVIEW_CHECKLIST_COPY } from '../reviewChecklistCopy';

/**
 * A reviewer who skipped "Would you recommend this unit?" has would_recommend_new NULL, and
 * the review card shows no recommend badge for it. The edit form used to start a skipped
 * answer at "No" and send it back, so editing anything (a typo, say) stored 'no' and the
 * card began to show "Would not recommend". A skipped answer now starts with no radio
 * checked and is saved as NULL.
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

/** The three recommend radios, found under the question so other yes/no groups are ignored. */
function recommendRadios(): HTMLInputElement[] {
  const heading = screen.getByText(supplementaryItems.wouldRecommend.text);
  const group = heading.parentElement as HTMLElement;
  return within(group).getAllByRole('radio') as HTMLInputElement[];
}

/** Submit the form and return the JSON body it sent. The request never settles. */
function submittedBody(container: HTMLElement, fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  fireEvent.click(screen.getByRole('checkbox', { name: /I confirm this review/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: REVIEW_CHECKLIST_COPY.identifyAcknowledgement }));
  fireEvent.submit(container.querySelector('form') as HTMLFormElement);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>(() => {}));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ReviewEditForm recommend answer', () => {
  it('checks no radio when the reviewer skipped the question', () => {
    render(<ReviewEditForm review={review({ would_recommend_new: null })} />);
    const radios = recommendRadios();
    expect(radios).toHaveLength(3);
    expect(radios.filter((radio) => radio.checked)).toEqual([]);
  });

  it('saves a skipped answer as null, never as no', () => {
    const fetchMock = stubFetch();
    const { container } = render(<ReviewEditForm review={review({ would_recommend_new: null })} />);
    const body = submittedBody(container, fetchMock);
    expect(body).toHaveProperty('would_recommend_new', null);
  });

  it('checks the stored answer and sends it back unchanged', () => {
    const fetchMock = stubFetch();
    const { container } = render(<ReviewEditForm review={review({ would_recommend_new: 'no' })} />);
    const checked = recommendRadios().filter((radio) => radio.checked);
    expect(checked).toHaveLength(1);
    expect(checked[0].closest('label')?.textContent).toBe('No');
    expect(submittedBody(container, fetchMock).would_recommend_new).toBe('no');
  });

  it('sends an answer the reviewer picks on the edit form', () => {
    const fetchMock = stubFetch();
    const { container } = render(<ReviewEditForm review={review({ would_recommend_new: null })} />);
    const yes = recommendRadios().find((radio) => radio.closest('label')?.textContent === 'Yes');
    fireEvent.click(yes as HTMLInputElement);
    expect(submittedBody(container, fetchMock).would_recommend_new).toBe('yes');
  });
});
