import { REVIEW_CHECKLIST_COPY } from '../../lib/reviewChecklistCopy';

interface Props {
  identifyAcknowledged: boolean;
  onIdentifyChange: (acknowledged: boolean) => void;
  termsAcknowledged: boolean;
  onTermsChange: (acknowledged: boolean) => void;
  /** Ids for the two boxes' text, so the parent's submit button can be described by them. */
  identifyTextId: string;
  termsTextId: string;
}

/**
 * "Before you submit": what to leave out of a review, and the two boxes both review forms
 * need ticked before they send anything. The new-review form's last step and the edit form
 * render this same block. The parent owns both states, so a failed submit leaves them ticked.
 * Neither box is sent to the server. Copy lives in `lib/reviewChecklistCopy.ts`.
 */
export default function ReviewAcknowledgements({
  identifyAcknowledged,
  onIdentifyChange,
  termsAcknowledged,
  onTermsChange,
  identifyTextId,
  termsTextId,
}: Props) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-[6px] p-4">
      <div className="flex gap-3">
        <div className="shrink-0">
          <svg aria-hidden="true" className="w-5 h-5 text-amber-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-amber-800 mb-1">{REVIEW_CHECKLIST_COPY.heading}</h3>
          <p className="text-sm text-amber-700 mb-2">{REVIEW_CHECKLIST_COPY.intro}</p>
          {/* list-disc keeps the list role in Safari, which drops it from an unstyled list. */}
          <ul className="list-disc pl-5 space-y-1 text-sm text-amber-700 mb-2">
            {REVIEW_CHECKLIST_COPY.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <label className="flex items-start gap-3 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={identifyAcknowledged}
              onChange={(e) => onIdentifyChange(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-amber-600"
            />
            <span id={identifyTextId} className="text-sm text-amber-800">
              {REVIEW_CHECKLIST_COPY.identifyAcknowledgement}
            </span>
          </label>
          <label className="flex items-start gap-3 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={termsAcknowledged}
              onChange={(e) => onTermsChange(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-amber-600"
            />
            <span id={termsTextId} className="text-sm text-amber-800">
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
  );
}
