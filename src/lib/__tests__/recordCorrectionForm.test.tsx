import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordCorrectionForm from '../../components/records/RecordCorrectionForm';

// Window.turnstile is already declared globally (see DisputeForm.tsx / ContactForm.tsx);
// TypeScript merges that augmentation across the project, so it is not redeclared here.

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
});
