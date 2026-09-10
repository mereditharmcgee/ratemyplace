import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordsRequestButton from '../../components/records/RecordsRequestButton';
import {
  FILL_QUEUED_COPY,
  REQUESTED_COPY,
  REQUEST_ALREADY_PULLED_COPY,
  REQUEST_BUTTON_LABEL,
} from '../records/display';

// Window.turnstile is already declared globally (see DisputeForm.tsx / ContactForm.tsx);
// TypeScript merges that augmentation across the project, so it is not redeclared here —
// the same reason recordCorrectionForm.test.tsx does not declare it either.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as { turnstile?: unknown }).turnstile;
});

/** The widget answers with a token the moment it is rendered, which is the press path. */
function stubTurnstile(token = 'test-token') {
  window.turnstile = {
    render: (_container, options) => {
      options.callback?.(token);
      return 'widget-1';
    },
    reset: vi.fn(),
    remove: vi.fn(),
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('RecordsRequestButton', () => {
  it('renders the button and, for a fill-queued building, the fill line', () => {
    render(<RecordsRequestButton buildingId="b1" initialState="fill_queued" />);
    expect(screen.getByRole('button', { name: REQUEST_BUTTON_LABEL })).toBeTruthy();
    expect(screen.getByText(FILL_QUEUED_COPY)).toBeTruthy();
  });

  it('on press renders Turnstile, posts the token, and shows the requested line', async () => {
    stubTurnstile('tok');
    const fetchMock = vi.fn(async () => jsonResponse(202, { data: { status: 'queued' } }));
    vi.stubGlobal('fetch', fetchMock);
    render(<RecordsRequestButton buildingId="b1" initialState="never_pulled" />);

    await userEvent.click(screen.getByRole('button', { name: REQUEST_BUTTON_LABEL }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(REQUESTED_COPY));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/records/request');
    expect(JSON.parse(String(init.body))).toEqual({ buildingId: 'b1', turnstileToken: 'tok' });
    expect(screen.queryByRole('button', { name: REQUEST_BUTTON_LABEL })).toBeNull();
  });

  it('treats already_queued like queued', async () => {
    stubTurnstile();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(202, { data: { status: 'already_queued' } })));
    render(<RecordsRequestButton buildingId="b1" initialState="never_pulled" />);
    await userEvent.click(screen.getByRole('button', { name: REQUEST_BUTTON_LABEL }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(REQUESTED_COPY));
  });

  it('shows the already-pulled line on a 409', async () => {
    stubTurnstile();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(409, { error: 'City records for this building have already been retrieved.' })),
    );
    render(<RecordsRequestButton buildingId="b1" initialState="never_pulled" />);
    await userEvent.click(screen.getByRole('button', { name: REQUEST_BUTTON_LABEL }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(REQUEST_ALREADY_PULLED_COPY));
  });

  it('shows the server error, resets the widget, and offers the button again on a 429', async () => {
    stubTurnstile();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(429, { error: 'Too many requests. Please try again later.' })));
    render(<RecordsRequestButton buildingId="b1" initialState="never_pulled" />);
    await userEvent.click(screen.getByRole('button', { name: REQUEST_BUTTON_LABEL }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Too many requests'));
    // The token that POST spent is single-use, so the next press needs a fresh challenge.
    expect(window.turnstile?.reset).toHaveBeenCalledWith('widget-1');
    expect(screen.getByRole('button', { name: REQUEST_BUTTON_LABEL })).toBeTruthy();
  });
});
