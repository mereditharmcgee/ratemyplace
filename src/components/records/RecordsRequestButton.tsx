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
// Window.turnstile is declared globally by DisputeForm.tsx / ContactForm.tsx and TypeScript
// merges that augmentation across the project, so — as in RecordCorrectionForm.tsx — this
// file uses it without redeclaring it.

const TURNSTILE_SITEKEY = '0x4AAAAAACo4KpkxsacPhM2r';

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
  const sendingRef = useRef(false);

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
        setPhase('requested');
        return;
      }
      // Someone else's request already landed the records: the panel below is stale, not wrong.
      if (response.status === 409) {
        setPhase('already_pulled');
        return;
      }
      setError(data.error || REQUEST_FAILED_COPY);
      setPhase('idle');
    } catch {
      setError(REQUEST_FAILED_COPY);
      setPhase('idle');
    } finally {
      sendingRef.current = false;
      // Tokens are single-use: a failed POST needs a fresh challenge before the next press.
      if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
    }
  };

  useEffect(() => {
    if (phase !== 'verifying') return;
    let interval: ReturnType<typeof setInterval> | null = null;
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
        callback: (token: string) => void submit(token),
        'expired-callback': () => setPhase((current) => (current === 'verifying' ? 'idle' : current)),
      });
    };
    // The api.js script is async, so the widget may be asked for before it exists.
    if (window.turnstile) renderWidget();
    else {
      interval = setInterval(() => {
        if (window.turnstile) {
          if (interval) clearInterval(interval);
          interval = null;
          renderWidget();
        }
      }, 100);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [phase]);

  useEffect(
    () => () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    },
    [],
  );

  if (phase === 'requested') return <p role="status" className="text-sm text-gray-600">{REQUESTED_COPY}</p>;
  if (phase === 'already_pulled')
    return <p role="status" className="text-sm text-gray-600">{REQUEST_ALREADY_PULLED_COPY}</p>;

  const busy = phase === 'verifying' || phase === 'sending';
  return (
    <div>
      {initialState === 'fill_queued' && <p className="text-sm text-gray-600">{FILL_QUEUED_COPY}</p>}
      <p className={`text-sm text-gray-600 ${initialState === 'fill_queued' ? 'mt-1' : ''}`}>{REQUEST_BUTTON_HELP}</p>
      {!busy && (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setPhase('verifying');
          }}
          className="mt-3 inline-flex min-h-[44px] items-center rounded-[4px] border border-teal-700 px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50"
        >
          {REQUEST_BUTTON_LABEL}
        </button>
      )}
      {busy && (
        <p className="mt-3 text-sm text-gray-600" aria-live="polite">
          {REQUEST_VERIFYING_COPY}
        </p>
      )}
      {/* Hidden rather than unmounted: the widget it holds has to survive for `reset`. */}
      <div ref={turnstileRef} className="mt-3" hidden={!busy} />
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
