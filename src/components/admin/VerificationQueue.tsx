import { useState, useEffect } from 'react';
import type { PendingVerification } from '../../pages/api/admin/pending-verifications';

export default function VerificationQueue() {
  const [verifications, setVerifications] = useState<PendingVerification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchVerifications();
  }, []);

  const fetchVerifications = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/pending-verifications');
      const data = await response.json();

      if (response.ok) {
        setVerifications(data.verifications);
      } else {
        setError(data.error || 'Failed to load verifications');
      }
    } catch (err) {
      setError('Failed to load verifications');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id: string) => {
    setProcessing(id);
    try {
      const response = await fetch(`/api/admin/verification/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      });

      if (response.ok) {
        setVerifications((prev) => prev.filter((v) => v.id !== id));
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to approve');
      }
    } catch (err) {
      alert('Failed to approve');
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (id: string) => {
    const reason = rejectionReason[id] || '';
    setProcessing(id);
    try {
      const response = await fetch(`/api/admin/verification/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', rejection_reason: reason }),
      });

      if (response.ok) {
        setVerifications((prev) => prev.filter((v) => v.id !== id));
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to reject');
      }
    } catch (err) {
      alert('Failed to reject');
    } finally {
      setProcessing(null);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

  if (verifications.length === 0) {
    return (
      <div className="bg-gray-50 rounded-lg p-8 text-center">
        <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h3 className="text-lg font-medium text-gray-900 mb-2">All caught up!</h3>
        <p className="text-gray-600">No pending verifications to review.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">
          Pending Verifications ({verifications.length})
        </h2>
        <button
          onClick={fetchVerifications}
          className="text-sm text-teal-600 hover:text-teal-700"
        >
          Refresh
        </button>
      </div>

      <div className="space-y-4">
        {verifications.map((verification) => (
          <div
            key={verification.id}
            className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm"
          >
            {/* Header */}
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="font-semibold text-gray-900">
                  {verification.building_address}
                </h3>
                <p className="text-sm text-gray-500">{verification.building_city}</p>
                <p className="text-xs text-gray-400 mt-1">
                  Submitted by {verification.user_email} on {formatDate(verification.uploaded_at)}
                </p>
              </div>
              <div className="text-sm text-gray-500">
                {verification.filename} ({formatFileSize(verification.size_bytes)})
              </div>
            </div>

            {/* Image Preview */}
            <div className="mb-4">
              {verification.content_type.startsWith('image/') ? (
                <div
                  className="relative cursor-pointer"
                  onClick={() => setExpandedImage(expandedImage === verification.id ? null : verification.id)}
                >
                  <img
                    src={`/api/admin/verification/${verification.id}`}
                    alt="Verification document"
                    className={`rounded-lg border border-gray-200 transition-all ${
                      expandedImage === verification.id
                        ? 'max-h-[600px] w-auto'
                        : 'max-h-48 w-auto'
                    }`}
                  />
                  <div className="absolute bottom-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded">
                    {expandedImage === verification.id ? 'Click to shrink' : 'Click to expand'}
                  </div>
                </div>
              ) : (
                <a
                  href={`/api/admin/verification/${verification.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                  </svg>
                  Open PDF
                </a>
              )}
            </div>

            {/* Rejection Reason Input */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Rejection Reason (optional)
              </label>
              <input
                type="text"
                value={rejectionReason[verification.id] || ''}
                onChange={(e) => setRejectionReason((prev) => ({
                  ...prev,
                  [verification.id]: e.target.value,
                }))}
                placeholder="e.g., Document doesn't show property address"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => handleApprove(verification.id)}
                disabled={processing === verification.id}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Approve
              </button>
              <button
                onClick={() => handleReject(verification.id)}
                disabled={processing === verification.id}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Full-screen image modal */}
      {expandedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setExpandedImage(null)}
        >
          <img
            src={`/api/admin/verification/${expandedImage}`}
            alt="Verification document"
            className="max-w-full max-h-full object-contain"
          />
        </div>
      )}
    </div>
  );
}
