import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DisputeForm from '../../components/disputes/DisputeForm';
import { DISPUTE_REASONS } from '../disputes';

// Reviews have no link of their own, so the dispute form asks for the building page link and,
// when the page has several reviews, the dates shown on the review. Both go to the API, and
// the API's own message (for example "add the dates") is what the reader sees on a 400.

type RenderOptions = Parameters<NonNullable<Window['turnstile']>['render']>[1];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.turnstile = {
    render: vi.fn((_container: HTMLElement, options: RenderOptions) => {
      options.callback?.('tok-1');
      return 'widget-1';
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  };
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as { turnstile?: unknown }).turnstile;
});

function fillAndSubmit({ link, dates }: { link: string; dates?: string }) {
  render(<DisputeForm siteUrl="https://ratemyplace.org" />);
  fireEvent.change(screen.getByLabelText(/Building page link/), { target: { value: link } });
  if (dates !== undefined) {
    fireEvent.change(screen.getByLabelText('Dates shown on the review'), { target: { value: dates } });
  }
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Example Holdings LLC' } });
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'owner@example.com' } });
  fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: '617-555-0100' } });
  fireEvent.click(screen.getByLabelText(DISPUTE_REASONS[0]));
  fireEvent.click(screen.getByRole('button', { name: 'Submit Dispute' }));
}

describe('DisputeForm building page link', () => {
  it('sends the building link and the dates shown on the review', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 201 }));
    fillAndSubmit({ link: 'https://ratemyplace.org/building/12-example-rd-boston', dates: '  Fall 2023 · Current ' });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.reviewUrl).toBe('https://ratemyplace.org/building/12-example-rd-boston');
    expect(sent.reviewDates).toBe('Fall 2023 · Current');
  });

  it('leaves the dates out when none are given', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 201 }));
    fillAndSubmit({ link: 'https://ratemyplace.org/building/12-example-rd-boston' });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect('reviewDates' in sent).toBe(false);
  });

  it('shows the API message when the page needs dates', async () => {
    const message = 'That page has more than one review. Add the dates shown on the review you mean.';
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: message }), { status: 400 }));
    fillAndSubmit({ link: 'https://ratemyplace.org/building/12-example-rd-boston' });

    expect(await screen.findByText(message)).toBeTruthy();
  });

  it('requires the building link before posting', async () => {
    fillAndSubmit({ link: '   ' });
    expect(await screen.findByText('Building page link is required')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
