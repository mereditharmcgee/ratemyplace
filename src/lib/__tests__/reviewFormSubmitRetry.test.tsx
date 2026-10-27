import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewForm from '../../components/reviews/ReviewForm';
import { browserNav } from '../reviewPaths';
import { SUBMIT_NETWORK_COPY, SUBMITTED_NO_LINK_COPY } from '../reviewSubmitOutcome';

// A failed review submit used to leave a spent Turnstile token in place, so Submit failed
// again until a reload threw every answer away. Now a failed POST clears the token and
// resets the widget, which re-challenges, and Submit works again with every answer kept.
// A 2xx never resets: the review exists.

type RenderOptions = Parameters<NonNullable<Window['turnstile']>['render']>[1];

let reset: ReturnType<typeof vi.fn<(widgetId: string) => void>>;
let go: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  let issued = 1;
  let callback: RenderOptions['callback'];
  reset = vi.fn((_widgetId: string) => {
    issued += 1;
    const token = `tok-${issued}`;
    // A real non-interactive widget re-solves on reset and calls back shortly after.
    queueMicrotask(() => callback?.(token));
  });
  window.turnstile = {
    render: vi.fn((_container: HTMLElement, options: RenderOptions) => {
      callback = options.callback;
      callback?.('tok-1');
      return 'widget-1';
    }),
    reset,
    remove: vi.fn(),
  };
  go = vi.spyOn(browserNav, 'go').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as { turnstile?: unknown }).turnstile;
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

function unparseable(status: number) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.reject(new Error('not json')) };
}

function walkToConfirm({ rate = true } = {}) {
  render(<ReviewForm building={{ id: 'b1', address: '45 Melnea Cass Blvd', city: 'Boston' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  if (rate) fireEvent.click(screen.getAllByRole('button', { name: '4' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review & Submit' }));
  fireEvent.click(screen.getByRole('checkbox'));
}

const submitButton = () => screen.getByRole('button', { name: /Submit Review|Submitting/ }) as HTMLButtonElement;
const sentToken = (fetchMock: ReturnType<typeof vi.fn>, call: number) =>
  ((fetchMock.mock.calls[call][1] as RequestInit).body as FormData).get('cf-turnstile-response');

describe('ReviewForm submit', () => {
  it('a failed POST resets the widget, and the next press sends the fresh token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(400, { error: 'Bot verification failed. Please try again.' }))
      .mockResolvedValueOnce(json(429, { error: 'Too many reviews. Please try again later.' }));
    vi.stubGlobal('fetch', fetchMock);
    walkToConfirm();

    fireEvent.click(submitButton());
    expect(await screen.findByText('Bot verification failed. Please try again.')).toBeTruthy();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledWith('widget-1');
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    expect(sentToken(fetchMock, 0)).toBe('tok-1');
    // Every answer is still there.
    expect(screen.getByText('1/10')).toBeTruthy();

    fireEvent.click(submitButton());
    expect(await screen.findByText('Too many reviews. Please try again later.')).toBeTruthy();
    expect(sentToken(fetchMock, 1)).toBe('tok-2');
    expect(reset).toHaveBeenCalledTimes(2);
    // Never a POST without a press.
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a 401 offers sign-in in a new tab and resets the widget', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(401, { error: 'Authentication required' })));
    walkToConfirm();
    fireEvent.click(submitButton());
    expect(await screen.findByRole('link', { name: 'Sign in in a new tab' })).toBeTruthy();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('a network failure says so and resets the widget', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')));
    walkToConfirm();
    fireEvent.click(submitButton());
    expect(await screen.findByText(SUBMIT_NETWORK_COPY)).toBeTruthy();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('a non-OK answer that is not JSON gets the default copy and a reset', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(unparseable(502)));
    walkToConfirm();
    fireEvent.click(submitButton());
    expect(await screen.findByText('Failed to submit review')).toBeTruthy();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a 200 that is not JSON', () => unparseable(200)],
    ['a 200 with no slug', () => json(200, { success: true })],
  ])('%s says the review is submitted, links to the profile, and never resets', async (_label, answer) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(answer());
    vi.stubGlobal('fetch', fetchMock);
    walkToConfirm();
    fireEvent.click(submitButton());
    const panel = await screen.findByRole('status');
    expect(panel.textContent).toContain(SUBMITTED_NO_LINK_COPY);
    expect(screen.getByRole('link', { name: 'Go to your profile' }).getAttribute('href')).toBe('/profile');
    expect(go).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('success navigates to the building, keeps Submit disabled, and never resets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(200, { success: true, reviewId: 'r1', buildingSlug: '45-melnea-cass-blvd' })));
    walkToConfirm();
    fireEvent.click(submitButton());
    await waitFor(() => expect(go).toHaveBeenCalledWith('/building/45-melnea-cass-blvd?submitted=true&reviewId=r1'));
    expect(submitButton().textContent).toBe('Submitting...');
    expect(submitButton().disabled).toBe(true);
    expect(reset).not.toHaveBeenCalled();
  });

  it('a double press posts once', async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    walkToConfirm();
    const button = submitButton();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('with no ratings, says so and neither posts nor resets', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    walkToConfirm({ rate: false });
    fireEvent.click(submitButton());
    expect(await screen.findByText('Please rate at least one item before submitting your review.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });
});
