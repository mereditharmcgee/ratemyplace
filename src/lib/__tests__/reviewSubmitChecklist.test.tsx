import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ReviewForm from '../../components/reviews/ReviewForm';
import ReviewEditForm from '../../components/reviews/ReviewEditForm';
import { TURNSTILE_WAITING_COPY } from '../../components/reviews/form-steps/ConfirmStep';
import { REVIEW_CHECKLIST_COPY } from '../reviewChecklistCopy';
import { browserNav } from '../reviewPaths';
import type { ReviewDetail } from '../../pages/api/reviews/[id]';

// Owner decision 2026-11-17: the "Before you submit" warning became a checklist of what to
// leave out, and a second box ("I understand my landlord may be able to identify me...")
// joined the Terms box. Submit stays disabled until both are ticked, on the new-review form
// and on the edit form, whose save sends the review back to moderation and then live again.
// Neither box is sent to the server: the Terms box never was, so the new one is client-side
// too. A failed submit still resets the Turnstile widget and leaves both boxes ticked.

type RenderOptions = Parameters<NonNullable<Window['turnstile']>['render']>[1];

const BUILDING = { id: 'b1', address: 'Example Building', city: 'Boston' };
const TERMS_BOX = /^I confirm this review reflects my honest personal experience/;

let reset: ReturnType<typeof vi.fn<(widgetId: string) => void>>;
let solveOnRender = true;

beforeEach(() => {
  solveOnRender = true;
  let issued = 1;
  let callback: RenderOptions['callback'];
  reset = vi.fn((_widgetId: string) => {
    issued += 1;
    const token = `tok-${issued}`;
    queueMicrotask(() => callback?.(token));
  });
  window.turnstile = {
    render: vi.fn((_container: HTMLElement, options: RenderOptions) => {
      callback = options.callback;
      if (solveOnRender) callback?.('tok-1');
      return 'widget-1';
    }),
    reset,
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

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const identifyBox = () => screen.getByRole('checkbox', { name: REVIEW_CHECKLIST_COPY.identifyAcknowledgement }) as HTMLInputElement;
const termsBox = () => screen.getByRole('checkbox', { name: TERMS_BOX }) as HTMLInputElement;
const describedBy = (el: HTMLElement) =>
  (el.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map((id) => document.getElementById(id));

/** The new-review form, walked to its last step with one rating answered. No box ticked. */
function walkToConfirm() {
  render(<ReviewForm building={BUILDING} />);
  fireEvent.click(button('Continue')); // unit details
  fireEvent.click(screen.getAllByRole('radio', { name: '4' })[0]);
  fireEvent.click(button('Continue')); // unit rating
  fireEvent.click(button('Continue')); // building rating
  fireEvent.click(button('Continue')); // landlord rating
  fireEvent.click(button('Review & Submit'));
}

/** The checklist, found by its first item; every item is a list item in a real list. */
function checklist(): HTMLElement {
  const list = screen.getByText(REVIEW_CHECKLIST_COPY.items[0]).closest('ul');
  expect(list).not.toBeNull();
  return list as HTMLElement;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

describe('the review form checklist', () => {
  it('lists what to leave out as a real list, under the heading and intro', () => {
    walkToConfirm();
    expect(screen.getByRole('heading', { name: REVIEW_CHECKLIST_COPY.heading })).toBeTruthy();
    expect(screen.getByText(REVIEW_CHECKLIST_COPY.intro)).toBeTruthy();
    const items = within(checklist()).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual([...REVIEW_CHECKLIST_COPY.items]);
    // The old one-line warning is gone.
    expect(screen.queryByText(/Avoid mentioning specific dates/)).toBeNull();
  });

  it('has exactly two boxes on the step, both named by their text and both unticked', () => {
    walkToConfirm();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(identifyBox().checked).toBe(false);
    expect(termsBox().checked).toBe(false);
  });

  it('keeps Submit disabled until both boxes are ticked', () => {
    walkToConfirm();
    const submit = button('Submit Review');
    expect(submit.disabled).toBe(true);

    fireEvent.click(identifyBox());
    expect(submit.disabled).toBe(true);

    fireEvent.click(identifyBox());
    fireEvent.click(termsBox());
    expect(submit.disabled).toBe(true);

    fireEvent.click(identifyBox());
    expect(submit.disabled).toBe(false);

    fireEvent.click(termsBox());
    expect(submit.disabled).toBe(true);
  });

  it('a press with one box ticked sends nothing', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    walkToConfirm();
    fireEvent.click(termsBox());
    fireEvent.click(button('Submit Review'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the disabled Submit is described by both boxes and a hint that says why', () => {
    walkToConfirm();
    const submit = button('Submit Review');
    const [identify, terms, note] = describedBy(submit);
    expect(describedBy(submit)).toHaveLength(3);
    expect(identify?.textContent).toBe(REVIEW_CHECKLIST_COPY.identifyAcknowledgement);
    expect(terms?.textContent).toMatch(TERMS_BOX);
    expect(note?.getAttribute('aria-live')).toBe('polite');
    expect(note?.textContent).toBe(REVIEW_CHECKLIST_COPY.submitHint);

    fireEvent.click(identifyBox());
    expect(note?.textContent).toBe(REVIEW_CHECKLIST_COPY.submitHint);
    fireEvent.click(termsBox());
    // Both ticked and the widget already solved: nothing left to explain.
    expect(note?.textContent).toBe('');
  });

  it('with both ticked and no token yet, the hint gives way to the waiting message', () => {
    solveOnRender = false;
    walkToConfirm();
    fireEvent.click(identifyBox());
    fireEvent.click(termsBox());
    const [, , note] = describedBy(button('Submit Review'));
    expect(note?.textContent).toBe(TURNSTILE_WAITING_COPY);
    expect(button('Submit Review').disabled).toBe(true);
  });

  it('a failed submit resets the widget once and leaves both boxes ticked', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(500, { error: 'Failed to submit review' }))
      .mockImplementationOnce(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    walkToConfirm();
    fireEvent.click(identifyBox());
    fireEvent.click(termsBox());

    fireEvent.click(button('Submit Review'));
    expect(await screen.findByText('Failed to submit review')).toBeTruthy();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(identifyBox().checked).toBe(true);
    expect(termsBox().checked).toBe(true);

    await waitFor(() => expect(button('Submit Review').disabled).toBe(false));
    fireEvent.click(button('Submit Review'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sent = (fetchMock.mock.calls[1][1] as RequestInit).body as FormData;
    expect(sent.get('cf-turnstile-response')).toBe('tok-2');
  });

  it('sends neither box to the server', async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    walkToConfirm();
    fireEvent.click(identifyBox());
    fireEvent.click(termsBox());
    fireEvent.click(button('Submit Review'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const keys = Array.from(((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body as FormData).map(([key]) => key);
    expect(keys.filter((key) => /ack|consent|identif|terms|privacy/i.test(key))).toEqual([]);
  });
});

/** A fictional review with no street address. */
function review(): ReviewDetail {
  return {
    id: 'r1',
    building_address: 'Example Building',
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
  } as unknown as ReviewDetail;
}

describe('the edit form checklist', () => {
  it('shows the same checklist, and Save waits for both boxes', () => {
    render(<ReviewEditForm review={review()} />);
    expect(screen.getByRole('heading', { name: REVIEW_CHECKLIST_COPY.heading })).toBeTruthy();
    const items = within(checklist()).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual([...REVIEW_CHECKLIST_COPY.items]);

    const save = button('Save Changes');
    expect(save.disabled).toBe(true);
    fireEvent.click(termsBox());
    expect(save.disabled).toBe(true);
    fireEvent.click(identifyBox());
    expect(save.disabled).toBe(false);
    fireEvent.click(termsBox());
    expect(save.disabled).toBe(true);
  });

  it('a form submit with one box ticked sends nothing', () => {
    // The disabled Save is not the only gate: the submit handler checks both boxes too.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<ReviewEditForm review={review()} />);
    fireEvent.click(termsBox());
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(termsBox());
    fireEvent.click(identifyBox());
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the disabled Save is described by both boxes and a hint that says why', () => {
    render(<ReviewEditForm review={review()} />);
    const save = button('Save Changes');
    const [identify, terms, note] = describedBy(save);
    expect(describedBy(save)).toHaveLength(3);
    expect(identify?.textContent).toBe(REVIEW_CHECKLIST_COPY.identifyAcknowledgement);
    expect(terms?.textContent).toMatch(TERMS_BOX);
    expect(note?.getAttribute('aria-live')).toBe('polite');
    expect(note?.textContent).toBe(REVIEW_CHECKLIST_COPY.saveHint);

    fireEvent.click(identifyBox());
    fireEvent.click(termsBox());
    expect(note?.textContent).toBe('');
  });
});
