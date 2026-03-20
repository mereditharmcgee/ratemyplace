import { useState } from 'react';
import VerificationModal from './VerificationModal';

interface Props {
  reviewId: string;
}

export default function PostSubmitVerification({ reviewId }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <div className="flex items-start gap-3 mt-3 pt-3 border-t border-teal-200">
        <svg className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-teal-700 text-sm">
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
          Verified reviews display a trust badge and carry more weight in building scores. Upload proof of tenancy to get verified.
        </p>
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-3">
          <p className="text-xs text-blue-800">
            <span className="font-medium">Accepted documents:</span> lease agreement, utility bill, rent receipt, or a piece of mail showing your name and this address.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-teal-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors"
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
        />
      )}
    </>
  );
}
