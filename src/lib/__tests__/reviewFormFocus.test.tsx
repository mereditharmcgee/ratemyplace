import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ReviewForm from '../../components/reviews/ReviewForm';
import {
  TURNSTILE_LOAD_FAILED_COPY,
  TURNSTILE_WAITING_COPY,
} from '../../components/reviews/form-steps/ConfirmStep';
import { browserNav } from '../reviewPaths';
import { SUBMIT_FAILED_COPY, SUBMIT_NETWORK_COPY } from '../reviewSubmitOutcome';

// A11Y-05: the review form says where the reader is and what went wrong, once each.
//
// - A step change unmounts the button that was pressed, so focus moves to an sr-only step
//   heading ("Step 3 of 7: Your Unit"). Focus alone announces it; there is no live region.
// - A submit error arrives after a press, so focus moves to the error box, which has no live
//   role (focus plus a live region would make a screen reader read it twice).
// - A Turnstile message arrives without a press, so it is read from an alert region that is
//   already on the page before the message appears.

type RenderOptions = Parameters<NonNullable<Window['turnstile']>['render']>[1];

const BUILDING = { id: 'b1', address: '12 Example Rd', city: 'Boston' };
const NO_RATING_COPY = 'Please rate at least one item before submitting your review.';

let scrollCalls: { el: Element; arg: unknown }[];
const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  vi.spyOn(browserNav, 'go').mockImplementation(() => {});
  scrollCalls = [];
  Element.prototype.scrollIntoView = function (this: Element, arg?: unknown) {
    scrollCalls.push({ el: this, arg });
  } as Element['scrollIntoView'];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Element.prototype.scrollIntoView = originalScrollIntoView;
  delete (window as { turnstile?: unknown }).turnstile;
});

/** A widget that solves at once, and hands back its options so a test can fire a callback. */
function stubTurnstile(): RenderOptions[] {
  const captured: RenderOptions[] = [];
  window.turnstile = {
    render: vi.fn((_container: HTMLElement, options: RenderOptions) => {
      captured.push(options);
      options.callback?.('tok-1');
      return 'widget-1';
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  };
  return captured;
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const focused = () => document.activeElement as HTMLElement | null;

function walkToConfirm({ rate }: { rate: boolean }) {
  render(<ReviewForm building={BUILDING} />);
  fireEvent.click(button('Continue')); // unit details
  if (rate) fireEvent.click(screen.getAllByRole('radio', { name: '4' })[0]);
  fireEvent.click(button('Continue')); // unit rating
  fireEvent.click(button('Continue')); // building rating
  fireEvent.click(button('Continue')); // landlord rating
  fireEvent.click(button('Review & Submit'));
  fireEvent.click(screen.getByRole('checkbox'));
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

describe('review form step changes', () => {
  it('Continue moves focus to the new step heading, and Back to the previous one', () => {
    render(<ReviewForm building={BUILDING} />);

    fireEvent.click(button('Continue'));
    const heading = focused();
    expect(heading?.tagName).toBe('H2');
    expect(heading?.textContent).toBe('Step 3 of 7: Your Unit');
    expect(heading?.getAttribute('tabindex')).toBe('-1');
    expect(heading?.className).toContain('sr-only');

    fireEvent.click(button('Back'));
    expect(focused()?.tagName).toBe('H2');
    expect(focused()?.textContent).toBe('Step 2 of 7: Unit Details');
  });

  it('scrolls the top of the form into view with each step change', () => {
    render(<ReviewForm building={BUILDING} />);
    expect(scrollCalls).toHaveLength(0);

    fireEvent.click(button('Continue'));
    expect(scrollCalls).toHaveLength(1);
    expect(scrollCalls[0].arg).toEqual({ block: 'start' });
    // The form's root: it holds the progress indicator and the step heading.
    const root = scrollCalls[0].el;
    expect(root.contains(screen.getByRole('heading', { level: 2, name: 'Step 3 of 7: Your Unit' }))).toBe(true);
    expect(root.contains(screen.getByRole('progressbar'))).toBe(true);
  });

  it('names every step the same way, from the existing step titles', () => {
    const titles = [
      'Step 2 of 7: Unit Details',
      'Step 3 of 7: Your Unit',
      'Step 4 of 7: Building',
      'Step 5 of 7: Landlord',
      'Step 6 of 7: Additional',
      'Step 7 of 7: Submit',
    ];
    render(<ReviewForm building={BUILDING} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(titles[0]);
    for (const title of titles.slice(1)) {
      fireEvent.click(button(title.endsWith('Submit') ? 'Review & Submit' : 'Continue'));
      expect(focused()?.textContent).toBe(title);
      expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    }
  });

  it('does not move focus when the form first renders, with or without a building', () => {
    render(<ReviewForm building={BUILDING} />);
    expect(document.activeElement).toBe(document.body);
    expect(screen.getByRole('heading', { level: 2, name: 'Step 2 of 7: Unit Details' })).toBeTruthy();
    cleanup();

    render(<ReviewForm />);
    expect(document.activeElement).toBe(document.body);
    expect(screen.getByRole('heading', { level: 2, name: 'Step 1 of 7: Address' })).toBeTruthy();
    expect(scrollCalls).toHaveLength(0);
  });

  it('uses the teal-700 focus ring on the unit details controls', () => {
    const { container } = render(<ReviewForm building={BUILDING} />);
    const rings = Array.from(container.querySelectorAll('[class*="focus:ring-teal-"]')).map(
      (el) => el.className.match(/focus:ring-teal-\d+/)?.[0],
    );
    expect(rings.length).toBeGreaterThan(0);
    expect(new Set(rings)).toEqual(new Set(['focus:ring-teal-700']));
  });
});

describe('review form submit errors', () => {
  it('an unrated Submit moves focus to the message saying so, every time it is pressed', () => {
    stubTurnstile();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    walkToConfirm({ rate: false });

    fireEvent.click(button('Submit Review'));
    const box = focused();
    expect(box?.textContent).toContain(NO_RATING_COPY);
    expect(box?.getAttribute('tabindex')).toBe('-1');
    // Focus announces it. A live role as well would make it read twice.
    expect(box?.closest('[role="alert"], [role="status"], [aria-live]')).toBeNull();
    expect(scrollCalls.at(-1)).toEqual({ el: box, arg: { block: 'center' } });

    // The same message again still moves focus back to it.
    button('Back').focus();
    fireEvent.click(button('Submit Review'));
    expect(focused()).toBe(box);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['a 500', () => vi.fn().mockResolvedValueOnce(json(500, { error: SUBMIT_FAILED_COPY })), SUBMIT_FAILED_COPY],
    ['a network failure', () => vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')), SUBMIT_NETWORK_COPY],
  ])('%s moves focus to the error text', async (_label, makeFetch, copy) => {
    stubTurnstile();
    vi.stubGlobal('fetch', makeFetch());
    walkToConfirm({ rate: true });

    fireEvent.click(button('Submit Review'));
    await waitFor(() => expect(focused()?.textContent).toContain(copy));
    expect(focused()?.getAttribute('tabindex')).toBe('-1');
    expect(focused()?.closest('[role="alert"], [role="status"], [aria-live]')).toBeNull();
  });

  it('coming back to the confirm step focuses its heading, not the earlier error', () => {
    stubTurnstile();
    walkToConfirm({ rate: false });
    fireEvent.click(button('Submit Review'));
    expect(focused()?.textContent).toContain(NO_RATING_COPY);

    fireEvent.click(button('Back'));
    fireEvent.click(button('Review & Submit'));
    expect(focused()?.textContent).toBe('Step 7 of 7: Submit');
    // The message is still shown where it was.
    expect(screen.getByText(NO_RATING_COPY)).toBeTruthy();
  });
});

describe('review form Turnstile messages and the Submit description', () => {
  it('the load-failed copy and its Try again button appear inside an alert that was already there', async () => {
    vi.useFakeTimers();
    walkToConfirm({ rate: true }); // no widget script: it never loads

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByRole('alert')).toBe(alert);
    expect(alert.textContent).toContain(TURNSTILE_LOAD_FAILED_COPY);
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeTruthy();
    // Nothing pressed, so focus stays where it was.
    expect(alert.contains(document.activeElement)).toBe(false);
  });

  it('a widget failure is read from the same alert region', () => {
    const captured = stubTurnstile();
    walkToConfirm({ rate: true });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('');

    act(() => captured[0]['error-callback']?.());
    expect(alert.textContent).toBe('Bot verification failed. Please try again.');
  });

  it('Submit is described by the confirmation text and the waiting message', () => {
    walkToConfirm({ rate: true }); // no token yet, so the waiting message shows

    const submit = button('Submit Review');
    const ids = (submit.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
    expect(ids).toHaveLength(2);
    const [confirmation, waiting] = ids.map((id) => document.getElementById(id));
    expect(confirmation?.textContent).toContain('I confirm this review reflects my honest personal experience');
    expect(waiting?.getAttribute('aria-live')).toBe('polite');
    expect(waiting?.textContent).toBe(TURNSTILE_WAITING_COPY);
  });

  it('the warning icon is hidden from assistive technology', () => {
    stubTurnstile();
    walkToConfirm({ rate: true });
    const icons = Array.from(document.querySelectorAll('svg'));
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) expect(icon.getAttribute('aria-hidden')).toBe('true');
  });
});
