import { useEffect, useRef, useState } from 'react';
import { unitItems, buildingItems, landlordItems, supplementaryItems } from '../../../lib/surveyItems';
import { bedroomOptions, bathroomOptions } from '../../../lib/formOptions';
import type { Building, UnitDetails, Tenancy, ReviewData } from './types';

const TURNSTILE_SITEKEY = '0x4AAAAAACo4KpkxsacPhM2r';
const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TURNSTILE_SCRIPT_SELECTOR = 'script[src^="https://challenges.cloudflare.com/turnstile/"]';
const POLL_MS = 100;
const POLL_TICKS = 100; // 10 seconds

export const TURNSTILE_LOAD_FAILED_COPY =
  "Bot verification didn't load. Check your connection, or allow challenges.cloudflare.com if you use a content blocker, then press Try again. Your answers stay on this page.";
export const TURNSTILE_WAITING_COPY = 'Waiting for bot verification…';
/** Rendered around a sign-in link: before, the link text, after. */
export const SESSION_EXPIRED_COPY = {
  before: 'You were signed out while writing this. ',
  link: 'Sign in in a new tab',
  after: ', then come back and press Submit Review again. Your answers are still here.',
} as const;

interface Props {
  building: Building | null;
  unitDetails: UnitDetails;
  tenancy: Tenancy;
  review: ReviewData;
  scores: Record<string, number | null>;
  privacyAcknowledged: boolean;
  onPrivacyChange: (acknowledged: boolean) => void;
  turnstileToken: string | null;
  onTurnstileToken: (token: string | null) => void;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: () => void;
  /** Bumped by the parent after a failed POST: the widget resets once per bump. */
  turnstileResetSignal: number;
  /** The last POST answered 401. */
  authExpired: boolean;
}

export default function ConfirmStep({
  building,
  unitDetails,
  tenancy,
  review,
  scores,
  privacyAcknowledged,
  onPrivacyChange,
  turnstileToken,
  onTurnstileToken,
  loading,
  error,
  onBack,
  onSubmit,
  turnstileResetSignal,
  authExpired,
}: Props) {
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  // The submit error belongs to the parent form; a widget failure is this step's own, so it
  // gets its own state and shares the one error banner below.
  const [turnstileError, setTurnstileError] = useState<string | null>(null);

  // The script never arrived within POLL_TICKS. "Try again" clears it and polls again.
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  // The signal this mount started with: a remount does not reset its own fresh widget.
  const lastResetRef = useRef(turnstileResetSignal);

  // Render once, as soon as api.js is there; wait for it at most POLL_TICKS x POLL_MS.
  useEffect(() => {
    const renderWidget = (): boolean => {
      if (!turnstileRef.current || !window.turnstile) return false;
      if (widgetIdRef.current) return true;
      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITEKEY,
        theme: 'light',
        // Stores the token and nothing else. It must never submit: the parent resets this
        // widget after a failed POST, a reset re-fires this callback, and a callback that
        // submitted would loop (AGENTS.md Traps, "Never call turnstile.reset() from a
        // callback that submits"). The writer presses Submit.
        callback: (token: string) => {
          setTurnstileError(null);
          onTurnstileToken(token);
        },
        'expired-callback': () => onTurnstileToken(null),
        // The widget could not reach Cloudflare, or the challenge ran out before it was
        // solved. Neither callback submits, so there is nothing to undo beyond dropping the
        // token and saying so; the reader presses again and the widget re-challenges.
        'error-callback': () => {
          onTurnstileToken(null);
          setTurnstileError('Bot verification failed. Please try again.');
        },
        'timeout-callback': () => {
          onTurnstileToken(null);
          setTurnstileError('Bot verification failed. Please try again.');
        },
      });
      return true;
    };

    if (renderWidget()) return;
    let ticks = 0;
    const interval = setInterval(() => {
      ticks += 1;
      if (renderWidget()) {
        clearInterval(interval);
      } else if (ticks >= POLL_TICKS) {
        clearInterval(interval);
        setLoadFailed(true);
      }
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [loadAttempt]);

  // Unmount only: remove whichever widget this step rendered, however late it arrived, and
  // drop its token. `onTurnstileToken` is the parent's stable state setter.
  useEffect(() => {
    return () => {
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
      onTurnstileToken(null);
    };
  }, []);

  // One reset per bump. The parent clears the token before bumping, so the fresh token the
  // reset produces is never overwritten.
  useEffect(() => {
    if (turnstileResetSignal === lastResetRef.current) return;
    lastResetRef.current = turnstileResetSignal;
    if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
  }, [turnstileResetSignal]);

  const handleRetryLoad = () => {
    setLoadFailed(false);
    // A Turnstile <script> still in the DOM is pending or loaded: a failed one removes itself
    // (new.astro's capture listener, and the listener below). Inject only when none is left,
    // so api.js never executes twice.
    if (!window.turnstile && !document.querySelector(TURNSTILE_SCRIPT_SELECTOR)) {
      const script = document.createElement('script');
      script.src = TURNSTILE_SRC;
      script.async = true;
      script.dataset.rmpTurnstileRetry = '';
      script.addEventListener('error', () => script.remove(), { once: true });
      document.head.appendChild(script);
    }
    setLoadAttempt((n) => n + 1);
  };

  const bannerMessage = error || turnstileError || (loadFailed ? TURNSTILE_LOAD_FAILED_COPY : null);
  const waiting = privacyAcknowledged && !turnstileToken && !turnstileError && !loadFailed && !loading;

  const unitScoreCount = unitItems.filter((item) => scores[item.key] !== undefined).length;
  const buildingScoreCount = buildingItems.filter((item) => scores[item.key] !== undefined).length;
  const landlordScoreCount = landlordItems.filter((item) => scores[item.key] !== undefined).length;

  return (
    <div className="space-y-6">
      <div className="bg-amber-50 border border-amber-200 rounded-[6px] p-4">
        <div className="flex gap-3">
          <div className="shrink-0">
            <svg className="w-5 h-5 text-amber-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h4 className="font-semibold text-amber-800 mb-1">Before you submit</h4>
            <p className="text-sm text-amber-700 mb-3">
              Your landlord may be able to identify you based on details in your review. Avoid mentioning
              specific dates, unit numbers, or personal details.
            </p>
            <label className="flex items-start gap-3 py-3 cursor-pointer">
              <input
                type="checkbox"
                checked={privacyAcknowledged}
                onChange={(e) => onPrivacyChange(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-amber-600"
              />
              <span className="text-sm text-amber-800">
                I confirm this review reflects my honest personal experience and agree to the{' '}
                <a href="/terms" target="_blank" className="underline font-medium hover:text-amber-900">
                  Terms of Service
                </a>{' '}
                and{' '}
                <a href="/guidelines" target="_blank" className="underline font-medium hover:text-amber-900">
                  Review Guidelines
                </a>
                .
              </span>
            </label>
          </div>
        </div>
      </div>

      {bannerMessage && (
        <div className="bg-red-50 border border-red-200 rounded-[6px] p-4 text-red-700">
          <p>{bannerMessage}</p>
          {loadFailed && (
            <button
              type="button"
              onClick={handleRetryLoad}
              className="mt-3 h-11 inline-flex items-center justify-center px-6 border border-red-300 bg-white text-red-700 font-semibold rounded-[4px] hover:bg-red-50"
            >
              Try again
            </button>
          )}
        </div>
      )}

      {authExpired && (
        <p role="alert" className="bg-amber-50 border border-amber-200 rounded-[6px] p-4 text-sm text-amber-800">
          {SESSION_EXPIRED_COPY.before}
          <a href="/auth/signin" target="_blank" rel="noopener" className="underline font-medium hover:text-amber-900">
            {SESSION_EXPIRED_COPY.link}
          </a>
          {SESSION_EXPIRED_COPY.after}
        </p>
      )}

      <div className="bg-white border border-gray-200 rounded-[6px] p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Review Summary</h3>

        {building && (
          <div className="mb-4 pb-4 border-b border-gray-100">
            <div className="text-sm text-gray-500">Building</div>
            <div className="font-medium">{building.address}</div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Unit:</span>
            <span className="ml-2 font-medium">
              {bedroomOptions.find((b) => b.value === unitDetails.bedrooms)?.label},{' '}
              {bathroomOptions.find((b) => b.value === unitDetails.bathrooms)?.label}
            </span>
          </div>
          <div>
            <span className="text-gray-500">Tenure:</span>
            <span className="ml-2 font-medium">
              {supplementaryItems.tenure.options.find((t) => t.value === tenancy.tenure)?.label}
            </span>
          </div>
          <div>
            <span className="text-gray-500">Unit ratings:</span>
            <span className="ml-2 font-medium">{unitScoreCount}/{unitItems.length}</span>
          </div>
          <div>
            <span className="text-gray-500">Building ratings:</span>
            <span className="ml-2 font-medium">{buildingScoreCount}/{buildingItems.length}</span>
          </div>
          <div>
            <span className="text-gray-500">Landlord ratings:</span>
            <span className="ml-2 font-medium">{landlordScoreCount}/{landlordItems.length}</span>
          </div>
          <div>
            <span className="text-gray-500">Would recommend:</span>
            <span className="ml-2 font-medium capitalize">{review.wouldRecommend}</span>
          </div>
        </div>
      </div>

      <div ref={turnstileRef} className="flex justify-center"></div>

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="h-11 inline-flex items-center justify-center px-6 border border-gray-300 rounded-[6px] hover:bg-gray-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={loading || !privacyAcknowledged || !turnstileToken}
          className="h-11 inline-flex items-center justify-center px-6 bg-teal-700 text-white font-semibold rounded-[4px] hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Submitting...' : 'Submit Review'}
        </button>
      </div>

      <p aria-live="polite" className="text-sm text-gray-600 text-right min-h-5">
        {waiting ? TURNSTILE_WAITING_COPY : ''}
      </p>
    </div>
  );
}
