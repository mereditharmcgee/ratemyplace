import { useState } from 'react';
import { DISPUTE_REASONS } from '../../lib/disputes';

interface Props {
  siteUrl: string;
}

export default function DisputeForm({ siteUrl }: Props) {
  // Form fields
  const [reviewUrl, setReviewUrl] = useState('');
  const [landlordName, setLandlordName] = useState('');
  const [landlordEmail, setLandlordEmail] = useState('');
  const [landlordPhone, setLandlordPhone] = useState('');
  const [disputeReasons, setDisputeReasons] = useState<string[]>([]);
  const [disputeExplanation, setDisputeExplanation] = useState('');

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Handle checkbox toggle
  const handleReasonToggle = (reason: string) => {
    if (disputeReasons.includes(reason)) {
      setDisputeReasons(disputeReasons.filter(r => r !== reason));
    } else {
      setDisputeReasons([...disputeReasons, reason]);
    }
  };

  // Client-side validation
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!reviewUrl.trim()) {
      errors.reviewUrl = 'Review URL is required';
    }

    if (!landlordName.trim()) {
      errors.landlordName = 'Your name is required';
    }

    if (!landlordEmail.trim()) {
      errors.landlordEmail = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(landlordEmail)) {
      errors.landlordEmail = 'Please enter a valid email address';
    }

    if (!landlordPhone.trim()) {
      errors.landlordPhone = 'Phone number is required';
    }

    if (disputeReasons.length === 0) {
      errors.disputeReasons = 'Please select at least one reason';
    }

    if (disputeExplanation.length > 2000) {
      errors.disputeExplanation = 'Explanation must be 2000 characters or less';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/disputes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reviewUrl,
          landlordName,
          landlordEmail,
          landlordPhone,
          disputeReasons,
          disputeExplanation: disputeExplanation || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to submit dispute');
        setLoading(false);
        return;
      }

      // Success
      setSuccess(true);
      setLoading(false);
    } catch (err) {
      console.error('Submit error:', err);
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  // Reset form for another submission
  const handleSubmitAnother = () => {
    setReviewUrl('');
    setLandlordName('');
    setLandlordEmail('');
    setLandlordPhone('');
    setDisputeReasons([]);
    setDisputeExplanation('');
    setSuccess(false);
    setError(null);
    setFieldErrors({});
  };

  // Success state
  if (success) {
    return (
      <div className="bg-green-50 border-l-4 border-green-400 p-6 rounded">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-green-800">Dispute submitted successfully</h3>
            <div className="mt-2 text-sm text-green-700">
              <p>A confirmation email has been sent to your email address.</p>
              <p className="mt-2">Our admin team will review your dispute and you will be notified if it is upheld.</p>
            </div>
            <div className="mt-4">
              <button
                onClick={handleSubmitAnother}
                className="text-sm font-medium text-green-800 hover:text-green-900 underline"
              >
                Submit another dispute
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Form rendering
  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Review URL */}
      <div>
        <label htmlFor="reviewUrl" className="block text-sm font-medium text-gray-700 mb-2">
          Review URL <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          id="reviewUrl"
          value={reviewUrl}
          onChange={(e) => setReviewUrl(e.target.value)}
          placeholder="https://..."
          className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-teal-500 focus:border-teal-500 ${
            fieldErrors.reviewUrl ? 'border-red-300' : 'border-gray-300'
          }`}
        />
        {fieldErrors.reviewUrl && (
          <p className="mt-1 text-sm text-red-700">{fieldErrors.reviewUrl}</p>
        )}
        <p className="mt-1 text-sm text-gray-500">
          Paste the URL of the review you want to dispute
        </p>
      </div>

      {/* Landlord Information */}
      <div className="border-t pt-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Your Information</h3>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label htmlFor="landlordName" className="block text-sm font-medium text-gray-700 mb-2">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="landlordName"
              value={landlordName}
              onChange={(e) => setLandlordName(e.target.value)}
              placeholder="Your full name"
              className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-teal-500 focus:border-teal-500 ${
                fieldErrors.landlordName ? 'border-red-300' : 'border-gray-300'
              }`}
            />
            {fieldErrors.landlordName && (
              <p className="mt-1 text-sm text-red-700">{fieldErrors.landlordName}</p>
            )}
          </div>

          {/* Email */}
          <div>
            <label htmlFor="landlordEmail" className="block text-sm font-medium text-gray-700 mb-2">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              id="landlordEmail"
              value={landlordEmail}
              onChange={(e) => setLandlordEmail(e.target.value)}
              placeholder="your.email@example.com"
              className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-teal-500 focus:border-teal-500 ${
                fieldErrors.landlordEmail ? 'border-red-300' : 'border-gray-300'
              }`}
            />
            {fieldErrors.landlordEmail && (
              <p className="mt-1 text-sm text-red-700">{fieldErrors.landlordEmail}</p>
            )}
          </div>

          {/* Phone */}
          <div>
            <label htmlFor="landlordPhone" className="block text-sm font-medium text-gray-700 mb-2">
              Phone <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              id="landlordPhone"
              value={landlordPhone}
              onChange={(e) => setLandlordPhone(e.target.value)}
              placeholder="(555) 123-4567"
              className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-teal-500 focus:border-teal-500 ${
                fieldErrors.landlordPhone ? 'border-red-300' : 'border-gray-300'
              }`}
            />
            {fieldErrors.landlordPhone && (
              <p className="mt-1 text-sm text-red-700">{fieldErrors.landlordPhone}</p>
            )}
          </div>
        </div>
      </div>

      {/* Dispute Reasons */}
      <div className="border-t pt-6">
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          Why are you disputing this review? <span className="text-red-500">*</span>
        </h3>
        <p className="text-sm text-gray-500 mb-4">Select all that apply</p>

        <div className="space-y-3">
          {DISPUTE_REASONS.map((reason) => (
            <div key={reason} className="flex items-start">
              <div className="flex items-center h-5">
                <input
                  type="checkbox"
                  id={`reason-${reason}`}
                  checked={disputeReasons.includes(reason)}
                  onChange={() => handleReasonToggle(reason)}
                  className="h-4 w-4 text-teal-700 border-gray-300 rounded focus:ring-teal-500"
                />
              </div>
              <div className="ml-3">
                <label htmlFor={`reason-${reason}`} className="text-sm text-gray-700">
                  {reason}
                </label>
              </div>
            </div>
          ))}
        </div>
        {fieldErrors.disputeReasons && (
          <p className="mt-2 text-sm text-red-700">{fieldErrors.disputeReasons}</p>
        )}
      </div>

      {/* Additional Explanation */}
      <div className="border-t pt-6">
        <label htmlFor="disputeExplanation" className="block text-sm font-medium text-gray-700 mb-2">
          Additional details (optional)
        </label>
        <textarea
          id="disputeExplanation"
          value={disputeExplanation}
          onChange={(e) => setDisputeExplanation(e.target.value)}
          placeholder="Provide any additional context that supports your dispute..."
          rows={6}
          maxLength={2000}
          className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-teal-500 focus:border-teal-500 ${
            fieldErrors.disputeExplanation ? 'border-red-300' : 'border-gray-300'
          }`}
        />
        {fieldErrors.disputeExplanation && (
          <p className="mt-1 text-sm text-red-700">{fieldErrors.disputeExplanation}</p>
        )}
        <p className="mt-1 text-sm text-gray-500">
          {disputeExplanation.length}/2000 characters
        </p>
      </div>

      {/* Submit Button */}
      <div className="border-t pt-6">
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-teal-600 text-white px-6 py-3 rounded-md font-semibold hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Submitting...' : 'Submit Dispute'}
        </button>
      </div>
    </form>
  );
}
