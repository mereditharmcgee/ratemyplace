import { useEffect, useRef, useState } from 'react';
import { CLAIM_MIN, CLAIM_MAX } from '../../lib/records/corrections';
import { TURNSTILE_FAILED_COPY } from '../../lib/records/display';
import { isValidEmail } from '../../lib/validation';

interface Props {
  buildingId: string;
}

interface CorrectionErrorDetail {
  field: string;
  message: string;
}

interface CorrectionApiResponse {
  data?: { id: string };
  error?: string;
  details?: CorrectionErrorDetail[];
}

const RECORD_KIND_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'assessment', label: 'Property (owner, value, year built)' },
  { value: 'permit', label: 'Building permits' },
  { value: 'violation', label: 'Violations' },
  { value: 'enforcement_ticket', label: 'Code enforcement' },
  { value: 'service_request', label: '311 requests' },
  { value: 'rentsmart', label: 'RentSmart cross-check' },
  { value: 'panel', label: 'The whole panel' },
];

const inputClass =
  'w-full px-3 py-2 border rounded-[4px] shadow-sm focus:outline-none focus:ring-teal-500 focus:border-teal-500';

export default function RecordCorrectionForm({ buildingId }: Props) {
  const [recordKind, setRecordKind] = useState('');
  const [claim, setClaim] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [emailProvided, setEmailProvided] = useState(false);

  const submittingRef = useRef(false);
  const confirmationRef = useRef<HTMLDivElement>(null);

  // Turnstile bot verification (explicit render — see DisputeForm.tsx).
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const renderWidget = () => {
      if (!turnstileRef.current || !window.turnstile || widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: '0x4AAAAAACo4KpkxsacPhM2r',
        theme: 'light',
        callback: (token: string) => setTurnstileToken(token),
        'expired-callback': () => setTurnstileToken(null),
        // The widget could not reach Cloudflare, or the challenge ran out before it was
        // solved. Neither callback submits, so there is nothing to undo beyond dropping the
        // token and saying so; the reader presses again and the widget re-challenges.
        'error-callback': () => {
          setTurnstileToken(null);
          setError(TURNSTILE_FAILED_COPY);
        },
        'timeout-callback': () => {
          setTurnstileToken(null);
          setError(TURNSTILE_FAILED_COPY);
        },
      });
    };

    if (window.turnstile) {
      renderWidget();
    } else {
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
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (submitted) {
      confirmationRef.current?.focus();
    }
  }, [submitted]);

  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {};

    if (!recordKind) {
      errors.recordKind = 'Choose which record is wrong.';
    }

    const trimmedClaim = claim.trim();
    if (trimmedClaim.length < CLAIM_MIN) {
      errors.claim = `Tell us what is wrong in at least ${CLAIM_MIN} characters.`;
    } else if (trimmedClaim.length > CLAIM_MAX) {
      errors.claim = `Keep it under ${CLAIM_MAX} characters.`;
    }

    if (contactEmail.trim() && !isValidEmail(contactEmail.trim())) {
      errors.contactEmail = 'Please enter a valid email address.';
    }

    setFieldErrors(errors);
    return errors;
  };

  const FIELD_IDS: Record<string, string> = {
    recordKind: 'record-kind',
    claim: 'record-claim',
    contactEmail: 'record-email',
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (submittingRef.current) {
      return;
    }

    const errors = validate();
    if (Object.keys(errors).length > 0) {
      const firstInvalid = ['recordKind', 'claim', 'contactEmail'].find((key) => errors[key]);
      if (firstInvalid) {
        document.getElementById(FIELD_IDS[firstInvalid])?.focus();
      }
      return;
    }

    if (!turnstileToken) {
      setError('Please complete the bot verification below before submitting.');
      return;
    }

    submittingRef.current = true;
    setLoading(true);

    try {
      const trimmedClaim = claim.trim();
      const trimmedEmail = contactEmail.trim();

      const response = await fetch('/api/records/corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buildingId,
          recordKind,
          claim: trimmedClaim,
          contactEmail: trimmedEmail || undefined,
          turnstileToken,
        }),
      });

      const data: CorrectionApiResponse = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (data.details && data.details.length > 0) {
          const apiErrors: Record<string, string> = {};
          for (const detail of data.details) {
            apiErrors[detail.field] = detail.message;
          }
          setFieldErrors(apiErrors);
        }
        setError(data.error || 'Failed to submit report. Please try again.');
        // Turnstile tokens are single-use — reset the widget for a retry.
        if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
        setTurnstileToken(null);
        return;
      }

      setEmailProvided(Boolean(trimmedEmail));
      setReferenceId(data.data?.id ?? null);
      setSubmitted(true);
    } catch {
      setError('An unexpected error occurred. Please try again.');
      if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
      setTurnstileToken(null);
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  if (submitted) {
    const recordNoun = recordKind === 'panel' ? 'these records' : 'this record';
    return (
      <div
        ref={confirmationRef}
        role="status"
        tabIndex={-1}
        className="bg-teal-50 border border-teal-200 rounded-[6px] p-6"
      >
        <p className="font-semibold text-teal-800">Report received.</p>
        <p className="mt-1 text-sm text-teal-700">
          {referenceId && <>Reference {referenceId.slice(0, 8)}. </>}
          We will re-pull {recordNoun} from the primary source.
          {emailProvided && ' We will email you the outcome.'}
        </p>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4" role="alert">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div>
        <label htmlFor="record-kind" className="block text-sm font-medium text-gray-700 mb-2">
          Which record is wrong? <span className="text-red-500" aria-hidden="true">*</span>
        </label>
        <select
          id="record-kind"
          value={recordKind}
          onChange={(e) => {
            setRecordKind(e.target.value);
            if (fieldErrors.recordKind) {
              setFieldErrors((prev) => {
                const next = { ...prev };
                delete next.recordKind;
                return next;
              });
            }
          }}
          aria-invalid={fieldErrors.recordKind ? true : undefined}
          aria-describedby={fieldErrors.recordKind ? 'record-kind-error' : undefined}
          aria-required="true"
          className={`${inputClass} ${fieldErrors.recordKind ? 'border-red-400' : 'border-gray-300'}`}
        >
          <option value="">Choose a record type</option>
          {RECORD_KIND_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {fieldErrors.recordKind && (
          <p id="record-kind-error" className="mt-1 text-xs text-red-700">
            {fieldErrors.recordKind}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="record-claim" className="block text-sm font-medium text-gray-700 mb-2">
          What's wrong with it? <span className="text-red-500" aria-hidden="true">*</span>
        </label>
        <textarea
          id="record-claim"
          rows={4}
          maxLength={CLAIM_MAX}
          value={claim}
          onChange={(e) => {
            setClaim(e.target.value);
            if (fieldErrors.claim) {
              setFieldErrors((prev) => {
                const next = { ...prev };
                delete next.claim;
                return next;
              });
            }
          }}
          aria-invalid={fieldErrors.claim ? true : undefined}
          aria-describedby={fieldErrors.claim ? 'record-claim-error' : undefined}
          aria-required="true"
          className={`${inputClass} ${fieldErrors.claim ? 'border-red-400' : 'border-gray-300'}`}
        />
        <p className="mt-1 text-xs text-gray-500">
          {claim.length}/{CLAIM_MAX}
        </p>
        {fieldErrors.claim && (
          <p id="record-claim-error" className="mt-1 text-xs text-red-700">
            {fieldErrors.claim}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="record-email" className="block text-sm font-medium text-gray-700 mb-2">
          Email (optional, for the outcome)
        </label>
        <input
          type="email"
          id="record-email"
          value={contactEmail}
          onChange={(e) => {
            setContactEmail(e.target.value);
            if (fieldErrors.contactEmail) {
              setFieldErrors((prev) => {
                const next = { ...prev };
                delete next.contactEmail;
                return next;
              });
            }
          }}
          aria-invalid={fieldErrors.contactEmail ? true : undefined}
          aria-describedby={fieldErrors.contactEmail ? 'record-email-error' : undefined}
          className={`${inputClass} ${fieldErrors.contactEmail ? 'border-red-400' : 'border-gray-300'}`}
        />
        {fieldErrors.contactEmail && (
          <p id="record-email-error" className="mt-1 text-xs text-red-700">
            {fieldErrors.contactEmail}
          </p>
        )}
      </div>

      <div ref={turnstileRef} className="flex justify-center" />

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-teal-700 text-white px-6 py-3 rounded-[4px] font-semibold hover:bg-teal-800 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'Sending…' : 'Send report'}
      </button>
    </form>
  );
}
