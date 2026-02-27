import { useState, useEffect } from 'react';
import ReviewListItem from './ReviewListItem';
import VerificationModal from './VerificationModal';
import type { UserReview, UserReviewsResponse } from '../../lib/api-types';

interface Props {
  userEmail: string;
  userName: string | null;
  avatarUrl: string | null;
  memberSince: string;
  emailVerified: boolean;
}

export default function ProfileDashboard({ userEmail, userName, avatarUrl, memberSince, emailVerified }: Props) {
  const [reviews, setReviews] = useState<UserReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifyingReviewId, setVerifyingReviewId] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetchReviews();
  }, []);

  const fetchReviews = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/reviews/user');
      const data = await response.json();

      if (response.ok) {
        setReviews(data.reviews);
      } else {
        setError(data.error || 'Failed to load reviews');
      }
    } catch (err) {
      setError('Failed to load reviews');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyClick = (reviewId: string) => {
    setVerifyingReviewId(reviewId);
  };

  const handleVerificationClose = () => {
    setVerifyingReviewId(null);
  };

  const handleVerificationSuccess = () => {
    setVerifyingReviewId(null);
    // Refresh reviews to show updated status
    fetchReviews();
  };

  const handleResendVerification = async () => {
    setResendLoading(true);
    setResendMessage(null);

    try {
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        credentials: 'same-origin'
      });

      const data = await response.json();

      if (response.ok) {
        setResendMessage({ type: 'success', text: 'Verification email sent! Check your inbox.' });
      } else {
        setResendMessage({ type: 'error', text: data.error || 'Failed to send email' });
      }
    } catch (err) {
      setResendMessage({ type: 'error', text: 'An error occurred' });
    } finally {
      setResendLoading(false);
    }
  };

  const getInitials = () => {
    if (userName) {
      return userName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    return userEmail[0].toUpperCase();
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Profile Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
        <div className="flex items-center gap-4">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={userName || userEmail}
              className="w-16 h-16 rounded-full"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-teal-100 flex items-center justify-center">
              <span className="text-xl font-semibold text-teal-700">{getInitials()}</span>
            </div>
          )}
          <div>
            {userName && <h2 className="text-xl font-semibold text-gray-900">{userName}</h2>}
            <p className="text-gray-600">{userEmail}</p>
            <p className="text-sm text-gray-500">Member since {memberSince}</p>
          </div>
        </div>
      </div>

      {/* Email Verification Status */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Email Verification</h3>

        {emailVerified ? (
          <div className="flex items-center gap-3 text-green-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>Your email address is verified</span>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-3 text-amber-600 mb-4">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span>Your email address is not verified</span>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              Verify your email to get the Email Verified badge on your reviews.
            </p>

            <button
              onClick={handleResendVerification}
              disabled={resendLoading}
              className="bg-teal-600 text-white py-2 px-4 rounded-lg hover:bg-teal-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resendLoading ? 'Sending...' : 'Send Verification Email'}
            </button>

            {resendMessage && (
              <p className={`mt-3 text-sm ${resendMessage.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                {resendMessage.text}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Reviews Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">
            My Reviews ({reviews.length})
          </h2>
          <a
            href="/review/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Write a Review
          </a>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
            {error}
          </div>
        ) : reviews.length === 0 ? (
          <div className="bg-gray-50 rounded-lg p-8 text-center">
            <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No reviews yet</h3>
            <p className="text-gray-600 mb-4">
              Share your rental experience to help other tenants find great places to live.
            </p>
            <a
              href="/review/new"
              className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
            >
              Write Your First Review
            </a>
          </div>
        ) : (
          <div className="space-y-4">
            {reviews.map((review) => (
              <ReviewListItem
                key={review.id}
                review={review}
                onVerifyClick={handleVerifyClick}
              />
            ))}
          </div>
        )}
      </div>

      {/* Verification Modal */}
      {verifyingReviewId && (
        <VerificationModal
          reviewId={verifyingReviewId}
          onClose={handleVerificationClose}
          onSuccess={handleVerificationSuccess}
        />
      )}
    </div>
  );
}
