import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordCorrectionForm from '../../components/records/RecordCorrectionForm';
import { TURNSTILE_FAILED_COPY } from '../records/display';

// Window.turnstile is declared once, ambiently, in src/env.d.ts, so it is not redeclared here.

type RenderOptions = Parameters<NonNullable<Window['turnstile']>['render']>[1];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as { turnstile?: unknown }).turnstile;
});

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

describe('RecordCorrectionForm', () => {
  it('shows a claim validation error for a too-short claim and does not submit', async () => {
    stubTurnstile();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<RecordCorrectionForm buildingId="building-1" />);

    await waitFor(() => expect(screen.getByLabelText(/which record is wrong/i)).toBeTruthy());

    await user.selectOptions(screen.getByLabelText(/which record is wrong/i), 'assessment');
    await user.type(screen.getByLabelText(/what's wrong with it/i), 'too short');
    await user.click(screen.getByRole('button', { name: /send report/i }));

    expect(await screen.findByText(/at least 20 characters/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits a valid report and shows the confirmation', async () => {
    stubTurnstile('good-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ data: { id: 'abcdef1234567890' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<RecordCorrectionForm buildingId="building-42" />);

    await waitFor(() => expect(screen.getByLabelText(/which record is wrong/i)).toBeTruthy());

    await user.selectOptions(screen.getByLabelText(/which record is wrong/i), 'violation');
    await user.type(
      screen.getByLabelText(/what's wrong with it/i),
      'This violation was resolved months ago and should not still be listed.'
    );
    await user.type(screen.getByLabelText(/email \(optional/i), 'tenant@example.com');
    await user.click(screen.getByRole('button', { name: /send report/i }));

    expect(await screen.findByText(/report received/i)).toBeTruthy();
    expect(screen.getByText(/reference abcdef12\./i)).toBeTruthy();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/records/corrections');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });

    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      buildingId: 'building-42',
      recordKind: 'violation',
      claim: 'This violation was resolved months ago and should not still be listed.',
      contactEmail: 'tenant@example.com',
      turnstileToken: 'good-token',
    });
  });

  it('shows the error text and resets the widget on a 429 response, keeping the form mounted', async () => {
    stubTurnstile('good-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Too many requests. Please try again later.' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<RecordCorrectionForm buildingId="building-1" />);

    await waitFor(() => expect(screen.getByLabelText(/which record is wrong/i)).toBeTruthy());

    await user.selectOptions(screen.getByLabelText(/which record is wrong/i), 'assessment');
    await user.type(
      screen.getByLabelText(/what's wrong with it/i),
      'This assessment record has an incorrect owner name listed.'
    );
    await user.click(screen.getByRole('button', { name: /send report/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/too many requests/i);

    expect(screen.getByLabelText(/which record is wrong/i)).toBeTruthy();
    expect(window.turnstile?.reset).toHaveBeenCalledWith('widget-1');
  });

  it('shows a field-level error and marks the claim textarea invalid on a 400 response', async () => {
    stubTurnstile('good-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'Validation failed.',
        details: [{ field: 'claim', message: 'x' }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<RecordCorrectionForm buildingId="building-1" />);

    await waitFor(() => expect(screen.getByLabelText(/which record is wrong/i)).toBeTruthy());

    await user.selectOptions(screen.getByLabelText(/which record is wrong/i), 'assessment');
    await user.type(
      screen.getByLabelText(/what's wrong with it/i),
      'This assessment record has an incorrect owner name listed.'
    );
    await user.click(screen.getByRole('button', { name: /send report/i }));

    expect(await screen.findByText('x')).toBeTruthy();
    const claimField = screen.getByLabelText(/what's wrong with it/i);
    expect(claimField.getAttribute('aria-invalid')).toBe('true');
  });

  it('shows the confirmation without a reference when the response body has no id', async () => {
    stubTurnstile('good-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<RecordCorrectionForm buildingId="building-1" />);

    await waitFor(() => expect(screen.getByLabelText(/which record is wrong/i)).toBeTruthy());

    await user.selectOptions(screen.getByLabelText(/which record is wrong/i), 'assessment');
    await user.type(
      screen.getByLabelText(/what's wrong with it/i),
      'This assessment record has an incorrect owner name listed.'
    );
    await user.click(screen.getByRole('button', { name: /send report/i }));

    expect(await screen.findByText(/report received/i)).toBeTruthy();
    expect(screen.queryByText(/reference/i)).toBeNull();
  });

  it("surfaces the failure copy on Turnstile's error-callback and still refuses to submit", async () => {
    // This stub never solves the challenge, so the form holds no token — the shape of a
    // widget that could not reach Cloudflare.
    let captured: RenderOptions | null = null;
    window.turnstile = {
      render: (_container, options) => {
        captured = options;
        return 'widget-1';
      },
      reset: vi.fn(),
      remove: vi.fn(),
    };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<RecordCorrectionForm buildingId="building-1" />);

    await waitFor(() => expect(captured).not.toBeNull());

    act(() => {
      (captured as RenderOptions)['error-callback']?.();
    });

    expect(await screen.findByText(TURNSTILE_FAILED_COPY)).toBeTruthy();

    // An otherwise valid report still goes nowhere: there is no token to send.
    await user.selectOptions(screen.getByLabelText(/which record is wrong/i), 'assessment');
    await user.type(
      screen.getByLabelText(/what's wrong with it/i),
      'This assessment record has an incorrect owner name listed.'
    );
    await user.click(screen.getByRole('button', { name: /send report/i }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/complete the bot verification/i)).toBeTruthy();
  });

  it("clears the token on Turnstile's timeout-callback", async () => {
    let captured: RenderOptions | null = null;
    window.turnstile = {
      render: (_container, options) => {
        captured = options;
        options.callback?.('good-token');
        return 'widget-1';
      },
      reset: vi.fn(),
      remove: vi.fn(),
    };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<RecordCorrectionForm buildingId="building-1" />);

    await waitFor(() => expect(captured).not.toBeNull());

    act(() => {
      (captured as RenderOptions)['timeout-callback']?.();
    });

    expect(await screen.findByText(TURNSTILE_FAILED_COPY)).toBeTruthy();

    await user.selectOptions(screen.getByLabelText(/which record is wrong/i), 'assessment');
    await user.type(
      screen.getByLabelText(/what's wrong with it/i),
      'This assessment record has an incorrect owner name listed.'
    );
    await user.click(screen.getByRole('button', { name: /send report/i }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears the failure copy once the challenge is solved, and submits on the new token', async () => {
    // Turnstile retries a failed challenge by itself, so the widget can fail and then answer
    // with a token without the reader touching anything. The stale failure line has to go
    // with it, or the form claims verification failed while holding a good token.
    let captured: RenderOptions | null = null;
    window.turnstile = {
      render: (_container, options) => {
        captured = options;
        return 'widget-1';
      },
      reset: vi.fn(),
      remove: vi.fn(),
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ data: { id: 'abcdef1234567890' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<RecordCorrectionForm buildingId="building-7" />);

    await waitFor(() => expect(captured).not.toBeNull());

    act(() => {
      (captured as RenderOptions)['error-callback']?.();
    });
    expect(await screen.findByText(TURNSTILE_FAILED_COPY)).toBeTruthy();

    act(() => {
      (captured as RenderOptions).callback?.('recovered-token');
    });

    await waitFor(() => expect(screen.queryByText(TURNSTILE_FAILED_COPY)).toBeNull());
    const submit = screen.getByRole('button', { name: /send report/i });
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    await user.selectOptions(screen.getByLabelText(/which record is wrong/i), 'assessment');
    await user.type(
      screen.getByLabelText(/what's wrong with it/i),
      'This assessment record has an incorrect owner name listed.'
    );
    await user.click(submit);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string).turnstileToken).toBe('recovered-token');
  });

  it('renders the Turnstile widget once it loads late and removes it on unmount', async () => {
    const renderFn = vi.fn((_container, options) => {
      options.callback?.('late-token');
      return 'widget-1';
    });
    const removeFn = vi.fn();
    delete (window as { turnstile?: unknown }).turnstile;

    const { unmount } = render(<RecordCorrectionForm buildingId="building-1" />);

    await waitFor(() => expect(screen.getByLabelText(/which record is wrong/i)).toBeTruthy());

    window.turnstile = {
      render: renderFn,
      reset: vi.fn(),
      remove: removeFn,
    };

    await waitFor(() => expect(renderFn).toHaveBeenCalledTimes(1));

    unmount();

    expect(removeFn).toHaveBeenCalledWith('widget-1');
  });
});
