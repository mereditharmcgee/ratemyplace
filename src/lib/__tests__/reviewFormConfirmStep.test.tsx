import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import ConfirmStep, {
  TURNSTILE_LOAD_FAILED_COPY,
  TURNSTILE_WAITING_COPY,
} from '../../components/reviews/form-steps/ConfirmStep';
import type { ReviewData, Tenancy, UnitDetails } from '../../components/reviews/form-steps/types';

// The review form's Turnstile widget. Its callback only stores the token (it never submits),
// which is what lets the parent reset it after a failed POST without looping (AGENTS.md
// Traps). The script wait is bounded, and "Try again" never loads api.js twice.

type RenderOptions = Parameters<NonNullable<Window['turnstile']>['render']>[1];

const unitDetails: UnitDetails = {
  unitNumber: '',
  bedrooms: '1',
  bathrooms: '1',
  squareFootage: '',
  rentAmount: '',
  moveInMonth: '',
  moveInYear: '',
  amenities: [],
  utilitiesIncluded: [],
  laundryType: 'none',
  laundryCostPerLoad: '',
  estimatedMonthlyUtilities: '',
  parkingType: '',
  petTypes: [],
};
const tenancy: Tenancy = { tenure: 18, moveOutYear: 'current' };
const review: ReviewData = {
  reviewTitle: '',
  landlordName: '',
  hasSeparateManager: false,
  propertyManagerName: '',
  wouldRecommend: 'yes',
  comments: '',
  hadPestIssues: false,
  pestTypesExperienced: [],
  hadHeatIssues: false,
  hadWaterIssues: false,
  hadSecurityDepositIssues: false,
  hadEvictionThreats: false,
  housingVouchers: null,
  safelyLit: null,
};

interface HarnessProps {
  resetSignal?: number;
  authExpired?: boolean;
  onSubmit?: () => void;
  onToken?: (token: string | null) => void;
}

/** Holds the token the way ReviewForm does, so the widget's callbacks have somewhere to land. */
function Harness({ resetSignal = 0, authExpired = false, onSubmit = () => {}, onToken = () => {} }: HarnessProps) {
  const [token, setToken] = useState<string | null>(null);
  return (
    <ConfirmStep
      building={{ id: 'b1', address: '45 Melnea Cass Blvd', city: 'Boston' }}
      unitDetails={unitDetails}
      tenancy={tenancy}
      review={review}
      scores={{}}
      privacyAcknowledged
      onPrivacyChange={() => {}}
      turnstileToken={token}
      onTurnstileToken={(value) => {
        onToken(value);
        setToken(value);
      }}
      loading={false}
      error={null}
      onBack={() => {}}
      onSubmit={onSubmit}
      turnstileResetSignal={resetSignal}
      authExpired={authExpired}
    />
  );
}

function stubTurnstile(options: { solve?: boolean } = {}) {
  const captured: RenderOptions[] = [];
  const api = {
    render: vi.fn((_container: HTMLElement, opts: RenderOptions) => {
      captured.push(opts);
      if (options.solve) opts.callback?.('tok-1');
      return 'widget-1';
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  };
  window.turnstile = api;
  return { api, captured };
}

const happyDOM = (window as unknown as { happyDOM?: { settings: { handleDisabledFileLoadingAsSuccess: boolean } } }).happyDOM;

beforeEach(() => {
  // happy-dom does not fetch scripts; by default it fires `error` on one, which would read
  // as a failed load. Let it fire `load` instead, so an injected tag stays "pending".
  if (happyDOM) happyDOM.settings.handleDisabledFileLoadingAsSuccess = true;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (window as { turnstile?: unknown }).turnstile;
  document.querySelectorAll('script[src^="https://challenges.cloudflare.com/turnstile/"]').forEach((s) => s.remove());
  if (happyDOM) happyDOM.settings.handleDisabledFileLoadingAsSuccess = false;
});

const retryScripts = () => document.querySelectorAll('script[data-rmp-turnstile-retry]');

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('ConfirmStep Turnstile widget', () => {
  it('the widget callback only stores the token; it never submits', () => {
    const { captured } = stubTurnstile();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    act(() => {
      captured[0].callback?.('a');
      captured[0].callback?.('b');
      captured[0].callback?.('c');
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Submit Review' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('says it is waiting while there is no token yet', () => {
    stubTurnstile();
    render(<Harness />);
    expect(screen.getByText(TURNSTILE_WAITING_COPY)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Submit Review' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('gives up after ten seconds with no script, and Try again loads api.js at most once', async () => {
    vi.useFakeTimers();
    render(<Harness />);
    await advance(10_000);
    expect(screen.getByText(TURNSTILE_LOAD_FAILED_COPY)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retryScripts()).toHaveLength(1);
    expect(screen.queryByText(TURNSTILE_LOAD_FAILED_COPY)).toBeNull();

    // Still nothing after another ten seconds: the retry tag is in the DOM, so it is pending
    // (a failed one removes itself), and pressing again must not add a second api.js.
    await advance(10_000);
    expect(screen.getByText(TURNSTILE_LOAD_FAILED_COPY)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retryScripts()).toHaveLength(1);

    const { api } = stubTurnstile();
    await advance(100);
    expect(api.render).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(TURNSTILE_LOAD_FAILED_COPY)).toBeNull();
  });

  it('with the original tag still pending, Try again adds no script and polls again', async () => {
    const original = document.createElement('script');
    original.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    document.head.appendChild(original);
    vi.useFakeTimers();
    render(<Harness />);
    await advance(10_000);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retryScripts()).toHaveLength(0);
    await advance(10_000);
    expect(screen.getByText(TURNSTILE_LOAD_FAILED_COPY)).toBeTruthy();
  });

  it('a retry script that fails removes itself, so the next Try again injects a fresh one', async () => {
    vi.useFakeTimers();
    render(<Harness />);
    await advance(10_000);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    const first = retryScripts()[0];
    first.dispatchEvent(new Event('error'));
    expect(document.contains(first)).toBe(false);

    await advance(10_000);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retryScripts()).toHaveLength(1);
    expect(retryScripts()[0]).not.toBe(first);
  });

  it('resets the widget once per bump of the reset signal', () => {
    const { api } = stubTurnstile({ solve: true });
    const { rerender } = render(<Harness resetSignal={0} />);
    expect(api.reset).not.toHaveBeenCalled();
    rerender(<Harness resetSignal={1} />);
    expect(api.reset).toHaveBeenCalledTimes(1);
    expect(api.reset).toHaveBeenCalledWith('widget-1');
    rerender(<Harness resetSignal={1} />);
    expect(api.reset).toHaveBeenCalledTimes(1);
  });

  it('a remount with a later signal renders a fresh widget and does not reset it', () => {
    const { api } = stubTurnstile({ solve: true });
    const first = render(<Harness resetSignal={1} />);
    first.unmount();
    render(<Harness resetSignal={2} />);
    expect(api.render).toHaveBeenCalledTimes(2);
    expect(api.reset).not.toHaveBeenCalled();
  });

  it('a widget rendered after a late script is removed on unmount, and its token dropped', async () => {
    vi.useFakeTimers();
    const onToken = vi.fn();
    const { unmount } = render(<Harness onToken={onToken} />);
    const { api } = stubTurnstile({ solve: true });
    await advance(100);
    expect(api.render).toHaveBeenCalledTimes(1);
    unmount();
    expect(api.remove).toHaveBeenCalledWith('widget-1');
    expect(onToken).toHaveBeenLastCalledWith(null);
  });

  it('when the session expired, offers sign-in in a new tab', () => {
    stubTurnstile();
    render(<Harness authExpired />);
    const link = screen.getByRole('link', { name: 'Sign in in a new tab' });
    expect(link.getAttribute('href')).toBe('/auth/signin');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});
