import { useEffect, useRef, useState } from 'react';
import {
  FILL_QUEUED_COPY,
  REQUESTED_COPY,
  REQUEST_ALREADY_PULLED_COPY,
  REQUEST_BUTTON_HELP,
  REQUEST_BUTTON_LABEL,
  REQUEST_FAILED_COPY,
  REQUEST_VERIFYING_COPY,
} from '../../lib/records/display';

// The reader-facing records button. Pressing it renders Turnstile on demand the way the
// correction form does, but only after the press, so a page that is merely read never loads
// a widget. It posts the token to /api/records/request, which enqueues one pull for the
// companion Worker. Every string comes from display.ts so the banned-words scan sees it.
//
// Window.turnstile is declared globally by three components — ContactForm.tsx,
// DisputeForm.tsx and ConfirmStep.tsx, each carrying an identical copy — and TypeScript
// merges those augmentations across the project, so this file uses it without redeclaring
// it, as RecordCorrectionForm.tsx does. One ambient declaration in src/env.d.ts is an open
// follow-up; a fourth copy here would be one more thing to move when that lands.

const TURNSTILE_SITEKEY = '0x4AAAAAACo4KpkxsacPhM2r';

/** api.js is loaded async by the panel, so the widget may be asked for before it exists. */
const POLL_MS = 100;
const POLL_TICKS = 100;

interface Props {
  buildingId: string;
  initialState: 'never_pulled' | 'fill_queued';
}

type Phase = 'idle' | 'verifying' | 'sending' | 'requested' | 'already_pulled';

export default function RecordsRequestButton({ buildingId, initialState }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const sendingRef = useRef(false);
  // A token only ever means "the reader just pressed the button". Turnstile also hands one
  // over unasked — it renews an expiring token by itself, and it answers a `reset` the same way
  // for a visitor it never has to challenge — and an unasked token must not become a POST.
  const awaitingTokenRef = useRef(false);

  const submit = async (token: string) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setPhase('sending');
    try {
      const response = await fetch('/api/records/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buildingId, turnstileToken: token }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.status === 202) {
        setError(null);
        setPhase('requested');
        return;
      }
      // Someone else's request already landed the records: the panel below is stale, not wrong.
      if (response.status === 409) {
        setError(null);
        setPhase('already_pulled');
        return;
      }
      // The two rate-limit messages are written for the reader and say something a retry
      // depends on. Every other status is a server fault the reader can do nothing with.
      setError(response.status === 429 && data.error ? data.error : REQUEST_FAILED_COPY);
      setPhase('idle');
    } catch {
      setError(REQUEST_FAILED_COPY);
      setPhase('idle');
    } finally {
      sendingRef.current = false;
      // Nothing resets the widget here on purpose. `reset` re-runs the challenge, and for a
      // visitor Turnstile never has to question it fires `callback` again with no one watching
      // — which, with a callback that submits, makes a failed POST ask for a token that asks
      // for another POST. The press path resets in `renderWidget` instead, where a person is
      // behind it. Pinned by the "sends exactly once" case in recordsRequestButton.test.tsx.
    }
  };

  useEffect(() => {
    if (phase !== 'verifying') return;
    let interval: ReturnType<typeof setInterval> | null = null;
    let ticks = 0;
    const stopPolling = () => {
      if (interval) clearInterval(interval);
      interval = null;
    };
    // Gated on a press for the same reason the token callback is: Turnstile retries a failed
    // challenge on its own (`retry: 'auto'`, about eight seconds later), so a widget that failed
    // once goes on reporting failures with no one behind them. Ungated, one of those would
    // overwrite a 429 message the reader is still reading and pull focus back to the button, or
    // raise an alert next to the requested line while the POST is in flight.
    const handleWidgetFailure = () => {
      if (!awaitingTokenRef.current) return;
      awaitingTokenRef.current = false;
      setError(REQUEST_FAILED_COPY);
      setPhase((current) => (current === 'verifying' ? 'idle' : current));
    };
    const renderWidget = () => {
      if (!turnstileRef.current || !window.turnstile) return;
      // Rendered once and kept: a second press re-challenges the same widget.
      if (widgetIdRef.current) {
        window.turnstile.reset(widgetIdRef.current);
        return;
      }
      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITEKEY,
        theme: 'light',
        // This callback is the first render's closure and keeps it for the life of the widget,
        // which is only safe because `submit` reads refs, state setters, and the `buildingId`
        // prop that never changes — never a value off a later render. Keep it that way.
        //
        // `handleWidgetFailure` below is under the same rule, and for the same reason: only
        // the first effect run's instance is ever registered with the widget, so it too must
        // read nothing but refs and state setters.
        callback: (token: string) => {
          if (!awaitingTokenRef.current) return;
          awaitingTokenRef.current = false;
          void submit(token);
        },
        // A press that is still waiting is no longer waiting once the widget gives up on it.
        'expired-callback': () => {
          awaitingTokenRef.current = false;
          setPhase((current) => (current === 'verifying' ? 'idle' : current));
        },
        // A widget that renders and then fails — an unreachable Cloudflare, a challenge the
        // reader cannot get through — never answers with a token at all. Without these two the
        // press would hold the verifying line and the disabled button for as long as the page
        // stays open, so both say so and hand the control back.
        'error-callback': handleWidgetFailure,
        'timeout-callback': handleWidgetFailure,
      });
    };
    if (window.turnstile) renderWidget();
    else {
      interval = setInterval(() => {
        if (window.turnstile) {
          stopPolling();
          renderWidget();
          return;
        }
        ticks += 1;
        // Ten seconds and the script is not coming — a blocked CDN, a reader who went offline.
        // Say so and hand the button back rather than holding a line that never resolves.
        if (ticks >= POLL_TICKS) {
          stopPolling();
          awaitingTokenRef.current = false;
          setError(REQUEST_FAILED_COPY);
          setPhase('idle');
        }
      }, POLL_MS);
    }
    return stopPolling;
  }, [phase]);

  const terminal = phase === 'requested' || phase === 'already_pulled';

  // The widget's container unmounts with the button in a terminal phase, so the widget goes
  // with it rather than being left pointing at a node no longer on the page.
  useEffect(() => {
    if (!terminal) return;
    if (widgetIdRef.current) {
      if (window.turnstile) window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    }
  }, [terminal]);

  useEffect(
    () => () => {
      if (widgetIdRef.current) {
        if (window.turnstile) window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    },
    [],
  );

  // Focus follows the outcome, as the correction form's confirmation does: the answer takes
  // focus when it arrives, and a failure hands focus back to the control that failed.
  useEffect(() => {
    if (terminal) {
      statusRef.current?.focus();
      return;
    }
    if (phase === 'idle' && error) buttonRef.current?.focus();
  }, [phase, terminal, error]);

  const busy = phase === 'verifying' || phase === 'sending';
  const statusText = terminal
    ? phase === 'requested'
      ? REQUESTED_COPY
      : REQUEST_ALREADY_PULLED_COPY
    : busy
      ? REQUEST_VERIFYING_COPY
      : '';

  return (
    <div>
      {!terminal && initialState === 'fill_queued' && <p className="text-sm text-gray-600">{FILL_QUEUED_COPY}</p>}
      {!terminal && (
        <p className={`text-sm text-gray-600 ${initialState === 'fill_queued' ? 'mt-1' : ''}`}>
          {REQUEST_BUTTON_HELP}
        </p>
      )}
      {/* Disabled rather than unmounted while the request is in flight: unmounting the control
          the reader just pressed drops focus to the top of the document. */}
      {!terminal && (
        <button
          type="button"
          ref={buttonRef}
          disabled={busy}
          onClick={() => {
            setError(null);
            awaitingTokenRef.current = true;
            setPhase('verifying');
          }}
          className="mt-3 inline-flex min-h-[44px] items-center rounded-[4px] border border-teal-700 px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-60"
        >
          {REQUEST_BUTTON_LABEL}
        </button>
      )}
      {/* One live region for the whole island, always mounted: a paragraph that appears at the
          moment it gets its text is a live region a screen reader may never have been told
          about, and one that unmounts takes the focus it was given with it. */}
      <p
        role="status"
        aria-live="polite"
        tabIndex={-1}
        ref={statusRef}
        className={statusText ? 'mt-3 text-sm text-gray-600' : undefined}
      >
        {statusText}
      </p>
      {/* Hidden rather than unmounted: the widget it holds has to survive for `reset`. */}
      {!terminal && <div ref={turnstileRef} className="mt-3" hidden={!busy} />}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
