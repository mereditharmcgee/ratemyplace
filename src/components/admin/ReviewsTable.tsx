import { useState, useEffect } from 'react';
import { getScoreColor as getScoreColorPair, getScoreTextColor } from '../../lib/scoring-colors';

interface Review {
  id: string;
  user_id: string;
  user_email: string;
  building_id: string;
  building_address: string;
  building_slug: string;
  building_city: string;
  building_landlord_id: string | null;
  building_landlord_name: string | null;
  landlord_name: string | null;
  review_title: string;
  review_text: string;
  comments: string;
  overall_score: number;
  status: 'pending' | 'approved' | 'rejected' | 'flagged';
  is_verified: number;
  created_at: number;
  move_in_year: number;
  move_in_season: string;
  unit_type: string;
  unit_number: string | null;
  rent_amount: number | null;
  would_recommend_new: string | null;
}

interface LandlordOption {
  id: string;
  name: string;
}

interface Props {
  initialStatus?: string;
}

const PAGE_SIZE = 100;

export default function ReviewsTable({ initialStatus = 'all' }: Props) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [statusCountsState, setStatusCountsState] = useState({ all: 0, pending: 0, approved: 0, rejected: 0, flagged: 0 });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [processing, setProcessing] = useState<string | null>(null);
  const [expandedReview, setExpandedReview] = useState<string | null>(null);
  const [reviewDetails, setReviewDetails] = useState<Record<string, any>>({});
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);

  // Landlord linking state
  const [landlords, setLandlords] = useState<LandlordOption[]>([]);
  const [linkingReview, setLinkingReview] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState<'select' | 'create'>('select');
  const [selectedLandlordId, setSelectedLandlordId] = useState('');
  const [newLandlordName, setNewLandlordName] = useState('');
  const [linkProcessing, setLinkProcessing] = useState(false);

  useEffect(() => {
    fetchReviews(0, true);
    fetchLandlords();
  }, []);

  // replace=true on initial load; replace=false appends the next page.
  const fetchReviews = async (offset: number, replace: boolean) => {
    try {
      if (replace) setLoading(true);
      else setLoadingMore(true);
      const response = await fetch(`/api/admin/reviews?limit=${PAGE_SIZE}&offset=${offset}`);
      const data = await response.json();

      if (response.ok) {
        setReviews((prev) => (replace ? data.reviews : [...prev, ...data.reviews]));
        setStatusCountsState(data.statusCounts);
        setTotal(data.total);
      } else {
        setError(data.error || 'Failed to load reviews');
      }
    } catch (err) {
      setError('Failed to load reviews');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const loadMore = () => fetchReviews(reviews.length, false);

  const fetchLandlords = async () => {
    try {
      // limit=500 so the link-landlord dropdown shows all options, not just the default page
      const response = await fetch('/api/admin/landlords?limit=500');
      const data = await response.json();
      if (response.ok) setLandlords(data.landlords);
    } catch {}
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

  const linkLandlord = async (review: Review) => {
    setLinkProcessing(true);
    try {
      let landlordId = selectedLandlordId;

      // Create new landlord if needed
      if (linkMode === 'create') {
        const name = newLandlordName.trim();
        if (!name) {
          alert('Landlord name is required');
          setLinkProcessing(false);
          return;
        }
        const createRes = await fetch('/api/admin/landlords', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        const createData = await createRes.json();
        if (!createRes.ok) {
          alert(createData.error || 'Failed to create landlord');
          setLinkProcessing(false);
          return;
        }
        landlordId = createData.landlord.id;
        // Refresh landlord list
        fetchLandlords();
      }

      if (!landlordId) {
        alert('Please select a landlord');
        setLinkProcessing(false);
        return;
      }

      // Assign landlord to the building
      const res = await fetch(`/api/admin/buildings/${review.building_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ landlord_id: landlordId }),
      });

      if (res.ok) {
        const landlordName = linkMode === 'create'
          ? newLandlordName.trim()
          : landlords.find((l) => l.id === landlordId)?.name || '';

        // Update local state for all reviews with this building
        setReviews((prev) =>
          prev.map((r) =>
            r.building_id === review.building_id
              ? { ...r, building_landlord_id: landlordId, building_landlord_name: landlordName }
              : r
          )
        );
        setLinkingReview(null);
        resetLinkForm();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to link landlord');
      }
    } catch {
      alert('Failed to link landlord');
    } finally {
      setLinkProcessing(false);
    }
  };

  const resetLinkForm = () => {
    setLinkMode('select');
    setSelectedLandlordId('');
    setNewLandlordName('');
  };

  const startLinking = (reviewId: string, tenantLandlordName: string | null) => {
    setLinkingReview(reviewId);
    resetLinkForm();
    // Pre-fill the new landlord name from what the tenant wrote
    if (tenantLandlordName) {
      setNewLandlordName(tenantLandlordName);
      // Try to find a fuzzy match in existing landlords
      const match = landlords.find((l) =>
        l.name.toLowerCase() === tenantLandlordName.toLowerCase()
      );
      if (match) {
        setLinkMode('select');
        setSelectedLandlordId(match.id);
      }
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

  const getScoreColor = (score: number) => getScoreTextColor(score);

  const getScoreBadgeColor = (score: number) => {
    const c = getScoreColorPair(score);
    return `${c.bg} ${c.text}`;
  };

  const formatScoreLabel = (key: string) => {
    return key
      .replace(/^(unit_|building_|landlord_)/, '')
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  };

  const filteredReviews = reviews.filter((review) => {
    const matchesSearch =
      review.building_address.toLowerCase().includes(search.toLowerCase()) ||
      review.user_email.toLowerCase().includes(search.toLowerCase()) ||
      (review.review_title?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
      (review.landlord_name?.toLowerCase().includes(search.toLowerCase()) ?? false);
    const matchesStatus = statusFilter === 'all' || review.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Server-computed counts so the filter badges reflect ALL reviews, not just the loaded slice.
  const statusCounts = statusCountsState;

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-[6px] p-4 text-red-700">
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
            placeholder="Search by address, email, title, or landlord..."
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
              className={`px-4 py-2 rounded-[6px] text-sm font-medium transition-colors ${
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
              onClick={async () => {
                const isCollapsing = expandedReview === review.id;
                setExpandedReview(isCollapsing ? null : review.id);
                if (!isCollapsing && !reviewDetails[review.id]) {
                  setLoadingDetail(review.id);
                  try {
                    const res = await fetch(`/api/admin/reviews/${review.id}`);
                    const data = await res.json();
                    if (res.ok) {
                      setReviewDetails((prev) => ({ ...prev, [review.id]: data.review ?? data }));
                    }
                  } catch {}
                  setLoadingDetail(null);
                }
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900 truncate">
                      {review.building_address}
                    </h3>
                    {review.is_verified ? (
                      <span className="flex items-center gap-1 text-xs text-teal-700">
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
                  {/* Landlord status indicator on header */}
                  {review.landlord_name && !review.building_landlord_id && (
                    <span className="inline-block mt-1 px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 rounded-full">
                      Landlord needs linking
                    </span>
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

                {/* Loading spinner */}
                {loadingDetail === review.id && (
                  <div className="flex justify-center py-6">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600"></div>
                  </div>
                )}

                {/* Full detail view once loaded */}
                {reviewDetails[review.id] && loadingDetail !== review.id && (() => {
                  const detail = reviewDetails[review.id];
                  const unitFields = [
                    'unit_structural', 'unit_plumbing', 'unit_electrical', 'unit_climate',
                    'unit_ventilation', 'unit_pests', 'unit_mold', 'unit_appliances',
                    'unit_layout', 'unit_accuracy',
                  ];
                  const buildingFields = [
                    'building_common_areas', 'building_security', 'building_exterior',
                    'building_noise_neighbors', 'building_noise_external', 'building_mail',
                    'building_laundry', 'building_parking', 'building_trash',
                  ];
                  const landlordFields = [
                    'landlord_maintenance', 'landlord_communication', 'landlord_professionalism',
                    'landlord_lease_clarity', 'landlord_privacy', 'landlord_deposit',
                    'landlord_rent_practices', 'landlord_non_retaliation',
                  ];

                  const renderScoreRow = (fields: string[], label: string) => (
                    <div className="mb-3">
                      <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{label}</h5>
                      <div className="flex flex-wrap gap-1.5">
                        {fields.map((field) => {
                          const val = detail[field];
                          if (val == null) return null;
                          return (
                            <span
                              key={field}
                              className={`inline-flex flex-col items-center px-2 py-1 rounded text-xs font-medium ${getScoreBadgeColor(val)}`}
                            >
                              <span className="opacity-80">{formatScoreLabel(field)}</span>
                              <span className="font-bold text-sm">{val}</span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );

                  return (
                    <>
                      {/* Score Grid */}
                      <div className="mb-4 p-3 bg-white rounded-[6px] border border-gray-200">
                        <h4 className="text-sm font-medium text-gray-700 mb-3">Scores</h4>
                        {renderScoreRow(unitFields, 'Unit')}
                        {renderScoreRow(buildingFields, 'Building')}
                        {renderScoreRow(landlordFields, 'Landlord')}
                      </div>

                      {/* Written Content */}
                      <div className="mb-4 p-3 bg-white rounded-[6px] border border-gray-200">
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Review content</h4>
                        {detail.review_title && (
                          <p className="font-semibold text-gray-900 mb-1">"{detail.review_title}"</p>
                        )}
                        <p className="text-sm text-gray-700 whitespace-pre-line">
                          {detail.review_text || detail.comments || 'No review text provided.'}
                        </p>
                        {detail.review_text && detail.comments && detail.review_text !== detail.comments && (
                          <div className="mt-2 pt-2 border-t border-gray-100">
                            <p className="text-xs font-medium text-gray-500 mb-1">Additional comments</p>
                            <p className="text-sm text-gray-700 whitespace-pre-line">{detail.comments}</p>
                          </div>
                        )}
                      </div>

                      {/* Metadata */}
                      <div className="mb-4 p-3 bg-white rounded-[6px] border border-gray-200">
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Metadata</h4>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                          <div className="flex justify-between col-span-1">
                            <dt className="text-gray-500">Reviewer:</dt>
                            <dd className="text-gray-900 truncate ml-2">{detail.user_email || review.user_email}</dd>
                          </div>
                          <div className="flex justify-between col-span-1">
                            <dt className="text-gray-500">Verified:</dt>
                            <dd>
                              {detail.is_verified ? (
                                <span className="px-1.5 py-0.5 bg-teal-100 text-teal-800 rounded text-xs font-medium">Yes</span>
                              ) : (
                                <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-medium">No</span>
                              )}
                            </dd>
                          </div>
                          <div className="flex justify-between col-span-1">
                            <dt className="text-gray-500">Move-in:</dt>
                            <dd className="text-gray-900">{detail.move_in_season} {detail.move_in_year}</dd>
                          </div>
                          <div className="flex justify-between col-span-1">
                            <dt className="text-gray-500">Unit type:</dt>
                            <dd className="text-gray-900">{detail.unit_type || 'N/A'}</dd>
                          </div>
                          {detail.unit_number && (
                            <div className="flex justify-between col-span-1">
                              <dt className="text-gray-500">Unit #:</dt>
                              <dd className="text-gray-900">{detail.unit_number}</dd>
                            </div>
                          )}
                          {detail.rent_amount && (
                            <div className="flex justify-between col-span-1">
                              <dt className="text-gray-500">Rent:</dt>
                              <dd className="text-gray-900">${detail.rent_amount}/mo</dd>
                            </div>
                          )}
                          {detail.would_recommend_new && (
                            <div className="flex justify-between col-span-1">
                              <dt className="text-gray-500">Recommend:</dt>
                              <dd className="text-gray-900 capitalize">{detail.would_recommend_new}</dd>
                            </div>
                          )}
                        </dl>
                      </div>

                      {/* Inline approve/reject for convenience */}
                      <div className="flex flex-wrap gap-2 mb-4">
                        {review.status !== 'approved' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); updateStatus(review.id, 'approved'); }}
                            disabled={processing === review.id}
                            className="px-4 py-2 bg-green-600 text-white rounded-[6px] hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
                          >
                            {processing === review.id ? '...' : 'Approve'}
                          </button>
                        )}
                        {review.status !== 'rejected' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); updateStatus(review.id, 'rejected'); }}
                            disabled={processing === review.id}
                            className="px-4 py-2 bg-red-600 text-white rounded-[6px] hover:bg-red-700 disabled:opacity-50 text-sm font-medium"
                          >
                            {processing === review.id ? '...' : 'Reject'}
                          </button>
                        )}
                      </div>
                    </>
                  );
                })()}

                {/* Landlord Linking Section */}
                {review.landlord_name && (
                  <div className="mb-4 p-3 rounded-[6px] border border-purple-200 bg-purple-50">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-medium text-purple-800">Tenant named landlord</h4>
                        <p className="text-sm text-purple-900 font-semibold mt-0.5">"{review.landlord_name}"</p>
                        <p className="text-xs text-purple-600 mt-0.5">for {review.building_address}</p>
                      </div>
                      {review.building_landlord_id ? (
                        <div className="text-right shrink-0">
                          <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            Linked to: {review.building_landlord_name}
                          </span>
                        </div>
                      ) : linkingReview === review.id ? null : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startLinking(review.id, review.landlord_name);
                          }}
                          className="shrink-0 px-3 py-1.5 bg-purple-600 text-white rounded-[6px] hover:bg-purple-700 text-sm font-medium"
                        >
                          Link Landlord
                        </button>
                      )}
                    </div>

                    {/* Inline linking form */}
                    {linkingReview === review.id && (
                      <div className="mt-3 pt-3 border-t border-purple-200 space-y-3" onClick={(e) => e.stopPropagation()}>
                        {/* Mode toggle */}
                        <div className="flex gap-2">
                          <button
                            onClick={() => setLinkMode('select')}
                            className={`px-3 py-1 rounded text-sm font-medium ${
                              linkMode === 'select'
                                ? 'bg-purple-600 text-white'
                                : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                            }`}
                          >
                            Choose Existing
                          </button>
                          <button
                            onClick={() => setLinkMode('create')}
                            className={`px-3 py-1 rounded text-sm font-medium ${
                              linkMode === 'create'
                                ? 'bg-purple-600 text-white'
                                : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                            }`}
                          >
                            Create New
                          </button>
                        </div>

                        {linkMode === 'select' ? (
                          <div>
                            <select
                              value={selectedLandlordId}
                              onChange={(e) => setSelectedLandlordId(e.target.value)}
                              className="w-full px-3 py-2 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-sm"
                            >
                              <option value="">Select a landlord...</option>
                              {landlords.map((l) => (
                                <option key={l.id} value={l.id}>{l.name}</option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div>
                            <input
                              type="text"
                              value={newLandlordName}
                              onChange={(e) => setNewLandlordName(e.target.value)}
                              placeholder="New landlord name"
                              className="w-full px-3 py-2 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-sm"
                            />
                            <p className="text-xs text-purple-600 mt-1">This will create a new landlord and assign them to this building.</p>
                          </div>
                        )}

                        <div className="flex gap-2">
                          <button
                            onClick={() => linkLandlord(review)}
                            disabled={linkProcessing}
                            className="px-3 py-1.5 bg-purple-600 text-white rounded-[6px] hover:bg-purple-700 disabled:opacity-50 text-sm font-medium"
                          >
                            {linkProcessing ? 'Linking...' : linkMode === 'create' ? 'Create & Link' : 'Link to Building'}
                          </button>
                          <button
                            onClick={() => { setLinkingReview(null); resetLinkForm(); }}
                            className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-[6px] hover:bg-gray-300 text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-2 pt-4 border-t border-gray-200">
                  {review.status !== 'approved' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        updateStatus(review.id, 'approved');
                      }}
                      disabled={processing === review.id}
                      className="px-4 py-2 bg-green-600 text-white rounded-[6px] hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
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
                      className="px-4 py-2 bg-red-600 text-white rounded-[6px] hover:bg-red-700 disabled:opacity-50 text-sm font-medium"
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
                      className="px-4 py-2 bg-orange-600 text-white rounded-[6px] hover:bg-orange-700 disabled:opacity-50 text-sm font-medium"
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
                      className="px-4 py-2 bg-gray-600 text-white rounded-[6px] hover:bg-gray-700 disabled:opacity-50 text-sm font-medium"
                    >
                      {processing === review.id ? '...' : 'Reset to Pending'}
                    </button>
                  )}
                  <a
                    href={`/review/edit/${review.id}`}
                    className="px-4 py-2 bg-teal-700 text-white rounded-[4px] hover:bg-teal-800 text-sm font-semibold"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Edit review
                  </a>
                  <a
                    href={`/building/${review.building_slug}`}
                    className="px-4 py-2 bg-slate-600 text-white rounded-[6px] hover:bg-slate-700 text-sm font-medium"
                    onClick={(e) => e.stopPropagation()}
                  >
                    View building
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

      {/* Pagination footer — search + status filters are client-side and only see the loaded slice */}
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>
          Showing {filteredReviews.length}
          {(search || statusFilter !== 'all') ? ` of ${reviews.length} loaded` : ''} ({total} total)
        </span>
        {reviews.length < total && (
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="px-4 py-2 bg-teal-700 text-white rounded-[4px] hover:bg-teal-800 disabled:opacity-50 text-sm font-semibold"
          >
            {loadingMore ? 'Loading...' : `Load more (${total - reviews.length} remaining)`}
          </button>
        )}
      </div>
    </div>
  );
}
