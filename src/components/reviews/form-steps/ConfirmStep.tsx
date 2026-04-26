import { useEffect, useRef } from 'react';
import { unitItems, buildingItems, landlordItems, supplementaryItems } from '../../../lib/surveyItems';
import { bedroomOptions, bathroomOptions } from '../../../lib/formOptions';
import type { Building, UnitDetails, Tenancy, ReviewData } from './types';

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: {
        sitekey: string;
        theme?: string;
        callback?: (token: string) => void;
        'expired-callback'?: () => void;
      }) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

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
}: Props) {
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    const renderWidget = () => {
      if (!turnstileRef.current || !window.turnstile || widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: '0x4AAAAAACo4KpkxsacPhM2r',
        theme: 'light',
        callback: (token: string) => onTurnstileToken(token),
        'expired-callback': () => onTurnstileToken(null),
      });
    };

    // If turnstile script is already loaded, render immediately
    if (window.turnstile) {
      renderWidget();
    } else {
      // Wait for the script to load
      const interval = setInterval(() => {
        if (window.turnstile) {
          clearInterval(interval);
          renderWidget();
        }
      }, 100);
      return () => clearInterval(interval);
    }

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, []);

  const unitScoreCount = unitItems.filter((item) => scores[item.key] !== undefined).length;
  const buildingScoreCount = buildingItems.filter((item) => scores[item.key] !== undefined).length;
  const landlordScoreCount = landlordItems.filter((item) => scores[item.key] !== undefined).length;

  return (
    <div className="space-y-6">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
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
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={privacyAcknowledged}
                onChange={(e) => onPrivacyChange(e.target.checked)}
                className="mt-0.5 rounded border-amber-400 text-amber-700 focus:ring-amber-500"
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

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{error}</div>}

      <div className="bg-white border border-gray-200 rounded-lg p-6">
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
          className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={loading || !privacyAcknowledged || !turnstileToken}
          className="px-6 py-2 bg-teal-700 text-white font-semibold rounded-[4px] hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Submitting...' : 'Submit Review'}
        </button>
      </div>
    </div>
  );
}
