import { useEffect, useRef, useState } from 'react';
import VerificationModal from './VerificationModal';

interface Props {
  reviewId: string;
}

export default function PostSubmitVerification({ reviewId }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const successRef = useRef<HTMLParagraphElement>(null);

  // A successful upload replaces Verify Now with the success message, so focus moves to it
  // (the message is read when it takes focus).
  useEffect(() => {
    if (submitted) successRef.current?.focus();
  }, [submitted]);

  if (submitted) {
    return (
      <div className="flex items-start gap-3 mt-3 pt-3 border-t border-teal-200">
        <svg className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p ref={successRef} tabIndex={-1} className="text-teal-700 text-sm">
          Verification submitted! An admin will review your document shortly.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mt-3 pt-3 border-t border-teal-200">
        <p className="text-teal-800 font-medium mb-1">Strengthen your review with verification</p>
        <p className="text-teal-700 text-sm mb-3">
          Verified reviews display a trust badge. Upload proof of tenancy to get verified.
        </p>
        <div className="bg-blue-50 border border-blue-200 rounded-[6px] px-3 py-2 mb-3">
          <p className="text-xs text-blue-800">
            <span className="font-medium">Accepted documents:</span> lease agreement, utility bill, rent receipt, or a piece of mail showing your name and this address.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="bg-teal-700 text-white px-6 py-2 rounded-[4px] text-sm font-semibold hover:bg-teal-800 transition-colors"
        >
          Verify Now
        </button>
      </div>

      {showModal && (
        <VerificationModal
          reviewId={reviewId}
          onClose={() => setShowModal(false)}
          onSuccess={() => {
            setShowModal(false);
            setSubmitted(true);
          }}
          returnFocusFallback={() => successRef.current}
        />
      )}
    </>
  );
}
