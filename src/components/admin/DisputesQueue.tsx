import { useState, useEffect } from 'react';
import type { Dispute } from '../../lib/api-types';

export default function DisputesQueue() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'resolved'>('pending');
  const [sortOrder, setSortOrder] = useState<'oldest' | 'newest'>('oldest');
  const [expandedDispute, setExpandedDispute] = useState<string | null>(null);
  const [resolutionForm, setResolutionForm] = useState<{
    outcome: string;
    notes: string;
  } | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => {
    fetchDisputes();
  }, []);

  const fetchDisputes = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/disputes');
      const data = await response.json();

      if (response.ok) {
        setDisputes(data.disputes);
      } else {
        setError(data.error || 'Failed to load disputes');
      }
    } catch (err) {
      setError('Failed to load disputes');
    } finally {
      setLoading(false);
    }
  };

  const resolveDispute = async (disputeId: string, outcome: string, notes: string) => {
    setProcessing(disputeId);
    try {
      const response = await fetch(`/api/disputes/${disputeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolutionOutcome: outcome, resolutionNotes: notes }),
      });

      if (response.ok) {
        // Update local state
        setDisputes((prev) =>
          prev.map((d) =>
            d.id === disputeId
              ? {
                  ...d,
                  status: 'resolved',
                  resolution_outcome: outcome as Dispute['resolution_outcome'],
                  resolution_notes: notes,
                  resolved_at: Math.floor(Date.now() / 1000),
                }
              : d
          )
        );
        setExpandedDispute(null);
        setResolutionForm(null);
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to resolve dispute');
      }
    } catch (err) {
      alert('Failed to resolve dispute');
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
      case 'resolved':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const parseReasons = (reasonsJson: string): string[] => {
    try {
      const parsed = JSON.parse(reasonsJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const filteredDisputes = disputes.filter((dispute) => {
    return statusFilter === 'all' || dispute.status === statusFilter;
  });

  const sortedDisputes = [...filteredDisputes].sort((a, b) => {
    return sortOrder === 'oldest'
      ? a.created_at - b.created_at
      : b.created_at - a.created_at;
  });

  const statusCounts = {
    all: disputes.length,
    pending: disputes.filter((d) => d.status === 'pending').length,
    resolved: disputes.filter((d) => d.status === 'resolved').length,
  };

  const handleExpandDispute = (disputeId: string) => {
    if (expandedDispute === disputeId) {
      setExpandedDispute(null);
      setResolutionForm(null);
    } else {
      setExpandedDispute(disputeId);
      const dispute = disputes.find((d) => d.id === disputeId);
      if (dispute && dispute.status === 'pending') {
        setResolutionForm({ outcome: 'dismiss', notes: '' });
      } else {
        setResolutionForm(null);
      }
    }
  };

  const handleResolveClick = () => {
    if (!expandedDispute || !resolutionForm || !resolutionForm.notes.trim()) {
      return;
    }
    resolveDispute(expandedDispute, resolutionForm.outcome, resolutionForm.notes);
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
      {/* Filter bar */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Status filters */}
        <div className="flex flex-wrap gap-2">
          {(['pending', 'resolved', 'all'] as const).map((status) => (
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

        {/* Sort toggle */}
        <div className="flex gap-2 ml-auto">
          <button
            onClick={() => setSortOrder('oldest')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              sortOrder === 'oldest'
                ? 'bg-teal-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Oldest First
          </button>
          <button
            onClick={() => setSortOrder('newest')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              sortOrder === 'newest'
                ? 'bg-teal-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Newest First
          </button>
        </div>
      </div>

      {/* Disputes list */}
      <div className="space-y-4">
        {sortedDisputes.map((dispute) => {
          const reasons = parseReasons(dispute.dispute_reasons);
          const reasonSnippet = reasons.length > 0 ? reasons[0] : 'No reason provided';

          return (
            <div
              key={dispute.id}
              className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
            >
              {/* Dispute Header */}
              <div
                className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => handleExpandDispute(dispute.id)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900 truncate">
                        {dispute.building_address}
                      </h3>
                    </div>
                    <p className="text-sm text-gray-500">
                      {dispute.landlord_name} â€¢ {formatDate(dispute.created_at)}
                    </p>
                    <p className="text-sm text-gray-700 mt-1 truncate">
                      {reasonSnippet}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`px-3 py-1 text-sm font-medium rounded-full ${getStatusColor(
                        dispute.status
                      )}`}
                    >
                      {dispute.status}
                    </span>
                    <svg
                      className={`w-5 h-5 text-gray-400 transition-transform ${
                        expandedDispute === dispute.id ? 'rotate-180' : ''
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

              {/* Expanded view - side-by-side */}
              {expandedDispute === dispute.id && (
                <div className="border-t border-gray-200 p-4 bg-gray-50">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-4">
                    {/* LEFT: Dispute details */}
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-sm font-medium text-gray-500 mb-2">Landlord Information</h4>
                        <dl className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <dt className="text-gray-500">Name:</dt>
                            <dd className="text-gray-900">{dispute.landlord_name}</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-gray-500">Email:</dt>
                            <dd className="text-gray-900">{dispute.landlord_email}</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-gray-500">Phone:</dt>
                            <dd className="text-gray-900">{dispute.landlord_phone}</dd>
                          </div>
                        </dl>
                      </div>

                      <div>
                        <h4 className="text-sm font-medium text-gray-500 mb-2">Dispute Reasons</h4>
                        <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
                          {reasons.map((reason, idx) => (
                            <li key={idx}>{reason}</li>
                          ))}
                        </ul>
                      </div>

                      {dispute.dispute_explanation && (
                        <div>
                          <h4 className="text-sm font-medium text-gray-500 mb-2">Explanation</h4>
                          <p className="text-sm text-gray-700">{dispute.dispute_explanation}</p>
                        </div>
                      )}

                      <div>
                        <h4 className="text-sm font-medium text-gray-500 mb-2">Submitted</h4>
                        <p className="text-sm text-gray-700">{formatDate(dispute.created_at)}</p>
                      </div>

                      {dispute.status === 'resolved' && dispute.resolution_notes && (
                        <div className="pt-4 border-t border-gray-200">
                          <h4 className="text-sm font-medium text-gray-500 mb-2">Resolution</h4>
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-700">Outcome:</span>
                              <span className={`px-2 py-1 text-xs font-medium rounded ${
                                dispute.resolution_outcome === 'uphold' ? 'bg-green-100 text-green-800' :
                                dispute.resolution_outcome === 'dismiss' ? 'bg-red-100 text-red-800' :
                                'bg-amber-100 text-amber-800'
                              }`}>
                                {dispute.resolution_outcome?.replace('_', ' ')}
                              </span>
                            </div>
                            <p className="text-sm text-gray-700">{dispute.resolution_notes}</p>
                            {dispute.resolved_at && (
                              <p className="text-xs text-gray-500">Resolved on {formatDate(dispute.resolved_at)}</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* RIGHT: Review details */}
                    <div className="space-y-4 lg:border-l lg:pl-6 border-gray-200">
                      <div>
                        <h4 className="text-sm font-medium text-gray-500 mb-2">Original Review</h4>
                        <div className="space-y-2">
                          <div>
                            <div className="text-sm font-medium text-gray-700">Building</div>
                            <div className="text-sm text-gray-900">{dispute.building_address}</div>
                          </div>

                          {dispute.review_overall_score !== null && (
                            <div>
                              <div className="text-sm font-medium text-gray-700">Overall Score</div>
                              <div className="text-2xl font-bold text-teal-600">
                                {dispute.review_overall_score.toFixed(1)}
                              </div>
                            </div>
                          )}

                          {dispute.review_title && (
                            <div>
                              <div className="text-sm font-medium text-gray-700">Title</div>
                              <div className="text-sm text-gray-900">"{dispute.review_title}"</div>
                            </div>
                          )}

                          {dispute.review_text && (
                            <div>
                              <div className="text-sm font-medium text-gray-700">Review Text</div>
                              <p className="text-sm text-gray-700">{dispute.review_text}</p>
                            </div>
                          )}

                          <a
                            href={`/review/edit/${dispute.review_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-teal-700 hover:text-teal-700 font-medium"
                          >
                            View full review
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Resolution form (only for pending disputes) */}
                  {dispute.status === 'pending' && resolutionForm && (
                    <div className="pt-4 border-t border-gray-200 space-y-4">
                      <h4 className="text-sm font-medium text-gray-700">Resolve Dispute</h4>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Outcome *
                        </label>
                        <select
                          value={resolutionForm.outcome}
                          onChange={(e) =>
                            setResolutionForm({ ...resolutionForm, outcome: e.target.value })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                        >
                          <option value="dismiss">Dismiss</option>
                          <option value="uphold">Uphold</option>
                          <option value="partially_valid">Partially Valid</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Resolution Notes * (required)
                        </label>
                        <textarea
                          value={resolutionForm.notes}
                          onChange={(e) =>
                            setResolutionForm({ ...resolutionForm, notes: e.target.value })
                          }
                          rows={4}
                          placeholder="Explain the resolution decision..."
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                        />
                      </div>

                      <button
                        onClick={handleResolveClick}
                        disabled={!resolutionForm.notes.trim() || processing === dispute.id}
                        className="px-6 py-2 bg-teal-700 text-white rounded-[4px] hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold"
                      >
                        {processing === dispute.id ? 'Resolving...' : 'Resolve Dispute'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {sortedDisputes.length === 0 && (
        <div className="text-center py-12 text-gray-500 bg-white rounded-xl border border-gray-200">
          No disputes found.
        </div>
      )}

      <div className="text-sm text-gray-500">
        Showing {sortedDisputes.length} of {disputes.length} disputes
      </div>
    </div>
  );
}
