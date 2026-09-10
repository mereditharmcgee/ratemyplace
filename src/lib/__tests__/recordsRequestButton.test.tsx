import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordsRequestButton from '../../components/records/RecordsRequestButton';
import {
  FILL_QUEUED_COPY,
  REQUESTED_COPY,
  REQUEST_ALREADY_PULLED_COPY,
  REQUEST_BUTTON_LABEL,
  REQUEST_FAILED_COPY,
  REQUEST_VERIFYING_COPY,
} from '../records/display';

// Window.turnstile is already declared globally (see DisputeForm.tsx / ContactForm.tsx);
// TypeScript merges that augmentation across the project, so it is not redeclared here —
// the same reason recordCorrectionForm.test.tsx does not declare it either.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete (window as { turnstile?: unknown }).turnstile;
});

interface TurnstileStub {
  /** Hand the island a token nobody asked for, the way an expiring widget renews itself. */
  fire: (token?: string) => void;
  reset: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

/**
 * The widget answers with a token the moment it is rendered, which is the press path. `reset`
 * answers the same way, because that is what the real widget does for a visitor it never has
 * to challenge: the challenge re-runs unattended and fires `callback` again.
 */
function stubTurnstile(token = 'test-token'): TurnstileStub {
  let callback: ((value: string) => void) | undefined;
  const reset = vi.fn(() => callback?.('token-after-reset'));
  const remove = vi.fn();
  window.turnstile = {
    render: (_container, options) => {
      callback = options.callback;
      options.callback?.(token);
      return 'widget-1';
    },
    reset,
    remove,
  };
  return { fire: (value = token) => callback?.(value), reset, remove };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const pressButton = () => userEvent.click(screen.getByRole('button', { name: REQUEST_BUTTON_LABEL }));

describe('RecordsRequestButton', () => {
  it('renders the button and, for a fill-queued building, the fill line', () => {
    render(<RecordsRequestButton buildingId="b1" initialState="fill_queued" />);
    expect(screen.getByRole('button', { name: REQUEST_BUTTON_LABEL })).toBeTruthy();
    expect(screen.getByText(FILL_QUEUED_COPY)).toBeTruthy();
    // The live region is on the page before it has anything to say, so a screen reader is
    // told about it in time to announce the first thing it does say.
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('on press renders Turnstile, posts the token, and shows the requested line', async () => {
    stubTurnstile('tok');
    const fetchMock = vi.fn(async () => jsonResponse(202, { data: { status: 'queued' } }));
    vi.stubGlobal('fetch', fetchMock);
    render(<RecordsRequestButton buildingId="b1" initialState="never_pulled" />);

    await pressButton();

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(REQUESTED_COPY));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/records/request');
    expect(JSON.parse(String(init.body))).toEqual({ buildingId: 'b1', turnstileToken: 'tok' });
    expect(screen.queryByRole('button', { name: REQUEST_BUTTON_LABEL })).toBeNull();
    // The container the widget lived in is gone, so the widget goes with it.
    expect(window.turnstile?.remove).toHaveBeenCalledWith('widget-1');
  });

  it('keeps the button mounted but disabled while the request is in flight', async () => {
    stubTurnstile();
    // A POST that never answers, so the busy phase is observable.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    render(<RecordsRequestButton buildingId="b1" initialState="never_pulled" />);

    await pressButton();

    const button = screen.getByRole('button', { name: REQUEST_BUTTON_LABEL });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe(REQUEST_VERIFYING_COPY);
  });

  it('treats already_queued like queued', async () => {
    stubTurnstile();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(202, { data: { status: 'already_queued' } })));
    render(<RecordsRequestButton buildingId="b1" initialState="never_pulled" />);
    await pressButton();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(REQUESTED_COPY));
  });

  it('shows the already-pulled line on a 409 and focuses it', async () => {
    stubTurnstile();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(409, { error: 'City records for this building have already been retrieved.' })),
    );
    render(<RecordsRequestButton buildingId="b1" initialState="never_pulled" />);
    await pressButton();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(REQUEST_ALREADY_PULLED_COPY));
    // The control the reader pressed is gone; focus lands on the answer that replaced it.
    expect(document.activeElement).toBe(screen.getByRole('status'));
  });

  it('shows the server text on a 429, sends exactly once, and offers the button again', async () => {
    const stub = stubTurnstile();
    const fetchMock = vi.fn(async () =>
      jsonResponse(429, { error: 'Too many requests. Please try again later.' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<RecordsRequestButton buildingId="b1" initialState="never_pulled" />);
    await pressButton();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Too many requests'));

    // The rate-limit messages are written for the reader, so they are shown as the server
    // wrote them. Nothing resets the widget on a failure: a reset would answer with a fresh
    // token, and a callback that submits would turn one refused POST into a run of them.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(stub.reset).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: REQUEST_BUTTON_LABEL });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    // Focus goes back to the control that failed, not to the top of the document.
    expect(document.activeElement).toBe(button);
  });

  it('ignores a token that arrives without a press', async () => {
    const stub = stubTurnstile();
    const fetchMock = vi.fn(async () =>
      jsonResponse(429, { error: 'Too many requests. Please try again later.' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<RecordsRequestButton buildingId="b1" initialState="never_pulled" />);
    await pressButton();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    fetchMock.mockClear();
    await act(async () => {
      stub.fire('token-nobody-asked-for');
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('shows the house copy on a 500 rather than the server text', async () => {
    stubTurnstile();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500, { error: 'Database is on fire' })));
    render(<RecordsRequestButton buildingId="b1" initialState="never_pulled" />);
    await pressButton();

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(REQUEST_FAILED_COPY));
    expect(screen.getByRole('alert').textContent).not.toContain('Database');
  });

  it('shows the house copy when the POST never lands', async () => {
    stubTurnstile();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    render(<RecordsRequestButton buildingId="b1" initialState="never_pulled" />);
    await pressButton();

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(REQUEST_FAILED_COPY));
  });

  it('gives up on the script after ten seconds and hands the button back', async () => {
    vi.useFakeTimers();
    // No Turnstile at all: api.js is blocked, or the reader went offline before it loaded.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<RecordsRequestButton buildingId="b1" initialState="never_pulled" />);

    fireEvent.click(screen.getByRole('button', { name: REQUEST_BUTTON_LABEL }));
    expect(screen.getByRole('status').textContent).toBe(REQUEST_VERIFYING_COPY);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(screen.getByRole('alert').textContent).toBe(REQUEST_FAILED_COPY);
    expect(screen.getByRole('status').textContent).toBe('');
    expect((screen.getByRole('button', { name: REQUEST_BUTTON_LABEL }) as HTMLButtonElement).disabled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
