import { useState, useEffect } from 'react';

interface Review {
  id: string;
  user_id: string;
  user_email: string;
  building_id: string;
  building_address: string;
  building_city: string;
  review_title: string;
  review_text: string;
  overall_score: number;
  status: 'pending' | 'approved' | 'rejected' | 'flagged';
  is_verified: number;
  created_at: number;
  move_in_year: number;
  move_in_season: string;
  unit_type: string;
  rent_amount: number | null;
}

interface Props {
  initialStatus?: string;
}

export default function ReviewsTable({ initialStatus = 'all' }: Props) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [processing, setProcessing] = useState<string | null>(null);
  const [expandedReview, setExpandedReview] = useState<string | null>(null);

  useEffect(() => {
    fetchReviews();
  }, []);

  const fetchReviews = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/reviews');
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

  const updateStatus = async (reviewId: string, newStatus: string) => {
    setProcessing(reviewId);
    try {
      const response = await fetch(`/api/admin/reviews/${reviewId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        setReviews((prev) =>
          prev.map((r) =>
            r.id === reviewId ? { ...r, status: newStatus as Review['status'] } : r
          )
        );
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to update review');
      }
    } catch (err) {
      alert('Failed to update review');
    } finally {
      setProcessing(null);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-amber-100 text-amber-800';
      case 'approved':
        return 'bg-green-100 text-green-800';
      case 'rejected':
        return 'bg-red-100 text-red-800';
      case 'flagged':
        return 'bg-orange-100 text-orange-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 4) return 'text-green-600';
    if (score >= 3) return 'text-amber-600';
    return 'text-red-600';
  };

  const filteredReviews = reviews.filter((review) => {
    const matchesSearch =
      review.building_address.toLowerCase().includes(search.toLowerCase()) ||
      review.user_email.toLowerCase().includes(search.toLowerCase()) ||
      (review.review_title?.toLowerCase().includes(search.toLowerCase()) ?? false);
    const matchesStatus = statusFilter === 'all' || review.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusCounts = {
    all: reviews.length,
    pending: reviews.filter((r) => r.status === 'pending').length,
    approved: reviews.filter((r) => r.status === 'approved').length,
    rejected: reviews.filter((r) => r.status === 'rejected').length,
    flagged: reviews.filter((r) => r.status === 'flagged').length,
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search by address, email, or title..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {(['all', 'pending', 'approved', 'rejected', 'flagged'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === status
                  ? 'bg-teal-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)} ({statusCounts[status]})
            </button>
          ))}
        </div>
      </div>

      {/* Reviews List */}
      <div className="space-y-4">
        {filteredReviews.map((review) => (
          <div
            key={review.id}
            className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
          >
            {/* Review Header */}
            <div
              className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => setExpandedReview(expandedReview === review.id ? null : review.id)}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900 truncate">
                      {review.building_address}
                    </h3>
                    {review.is_verified ? (
                      <span className="flex items-center gap-1 text-xs text-teal-600">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        Verified
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-gray-500">
                    {review.user_email} • {formatDate(review.created_at)}
                  </p>
                  {review.review_title && (
                    <p className="text-sm text-gray-700 mt-1 truncate">
                      "{review.review_title}"
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className={`text-lg font-bold ${getScoreColor(review.overall_score)}`}>
                      {review.overall_score?.toFixed(1) || 'N/A'}
                    </div>
                    <div className="text-xs text-gray-500">score</div>
                  </div>
                  <span
                    className={`px-3 py-1 text-sm font-medium rounded-full ${getStatusColor(
                      review.status
                    )}`}
                  >
                    {review.status}
                  </span>
                  <svg
                    className={`w-5 h-5 text-gray-400 transition-transform ${
                      expandedReview === review.id ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </div>
              </div>
            </div>

            {/* Expanded Details */}
            {expandedReview === review.id && (
              <div className="border-t border-gray-200 p-4 bg-gray-50">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <h4 className="text-sm font-medium text-gray-500 mb-2">Details</h4>
                    <dl className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <dt className="text-gray-500">Unit Type:</dt>
                        <dd className="text-gray-900">{review.unit_type}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-gray-500">Move-in:</dt>
                        <dd className="text-gray-900">
                          {review.move_in_season} {review.move_in_year}
                        </dd>
                      </div>
                      {review.rent_amount && (
                        <div className="flex justify-between">
                          <dt className="text-gray-500">Rent:</dt>
                          <dd className="text-gray-900">${review.rent_amount}/mo</dd>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <dt className="text-gray-500">City:</dt>
                        <dd className="text-gray-900">{review.building_city || 'N/A'}</dd>
                      </div>
                    </dl>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-gray-500 mb-2">Review Text</h4>
                    <p className="text-sm text-gray-700">
                      {review.review_text || 'No review text provided.'}
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2 pt-4 border-t border-gray-200">
                  {review.status !== 'approved' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        updateStatus(review.id, 'approved');
                      }}
                      disabled={processing === review.id}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
                    >
                      {processing === review.id ? '...' : 'Approve'}
                    </button>
                  )}
                  {review.status !== 'rejected' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        updateStatus(review.id, 'rejected');
                      }}
                      disabled={processing === review.id}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 text-sm font-medium"
                    >
                      {processing === review.id ? '...' : 'Reject'}
                    </button>
                  )}
                  {review.status !== 'flagged' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        updateStatus(review.id, 'flagged');
                      }}
                      disabled={processing === review.id}
                      className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 text-sm font-medium"
                    >
                      {processing === review.id ? '...' : 'Flag'}
                    </button>
                  )}
                  {review.status !== 'pending' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        updateStatus(review.id, 'pending');
                      }}
                      disabled={processing === review.id}
                      className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 text-sm font-medium"
                    >
                      {processing === review.id ? '...' : 'Reset to Pending'}
                    </button>
                  )}
                  <a
                    href={`/review/edit/${review.id}`}
                    className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Edit Review
                  </a>
                  <a
                    href={`/building/${review.building_id}`}
                    className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 text-sm font-medium"
                    onClick={(e) => e.stopPropagation()}
                  >
                    View Building
                  </a>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {filteredReviews.length === 0 && (
        <div className="text-center py-12 text-gray-500 bg-white rounded-xl border border-gray-200">
          No reviews found matching your criteria.
        </div>
      )}

      <div className="text-sm text-gray-500">
        Showing {filteredReviews.length} of {reviews.length} reviews
      </div>
    </div>
  );
}
