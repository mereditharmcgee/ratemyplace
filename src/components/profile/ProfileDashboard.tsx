import { useState, useEffect } from 'react';
import ReviewListItem from './ReviewListItem';
import VerificationModal from './VerificationModal';
import type { UserReview } from '../../pages/api/reviews/user';

interface Props {
  userEmail: string;
  userName: string | null;
  avatarUrl: string | null;
  memberSince: string;
}

export default function ProfileDashboard({ userEmail, userName, avatarUrl, memberSince }: Props) {
  const [reviews, setReviews] = useState<UserReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifyingReviewId, setVerifyingReviewId] = useState<string | null>(null);

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
