import { useState, useEffect } from 'react';

interface BugReport {
  id: string;
  user_id: string | null;
  user_email: string | null;
  email: string | null;
  category: string;
  description: string;
  url: string | null;
  status: string;
  created_at: number;
  resolved_at: number | null;
  admin_notes: string | null;
}

export default function BugReportsTable() {
  const [bugs, setBugs] = useState<BugReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('new');
  const [expandedBug, setExpandedBug] = useState<string | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => {
    fetchBugs();
  }, []);

  const fetchBugs = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/bug-reports');
      const data = await response.json();
      if (response.ok) {
        setBugs(data.bugs);
      } else {
        setError(data.error || 'Failed to load bug reports');
      }
    } catch {
      setError('Failed to load bug reports');
    } finally {
      setLoading(false);
    }
  };

  const updateBug = async (id: string, status: string, notes?: string) => {
    setProcessing(id);
    try {
      const body: Record<string, string> = { status };
      if (notes !== undefined) body.admin_notes = notes;

      const response = await fetch(`/api/admin/bug-reports/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        setBugs((prev) =>
          prev.map((b) =>
            b.id === id
              ? {
                  ...b,
                  status,
                  admin_notes: notes ?? b.admin_notes,
                  resolved_at: (status === 'resolved' || status === 'wont_fix')
                    ? Math.floor(Date.now() / 1000)
                    : b.resolved_at,
                }
              : b
          )
        );
        setExpandedBug(null);
        setAdminNotes('');
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to update');
      }
    } catch {
      alert('Failed to update bug report');
    } finally {
      setProcessing(null);
    }
  };

  const handleExpand = (id: string) => {
    if (expandedBug === id) {
      setExpandedBug(null);
      setAdminNotes('');
    } else {
      setExpandedBug(id);
      const bug = bugs.find((b) => b.id === id);
      setAdminNotes(bug?.admin_notes || '');
    }
  };

  const formatDate = (timestamp: number) =>
    new Date(timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'new': return 'bg-blue-100 text-blue-800';
      case 'in_progress': return 'bg-amber-100 text-amber-800';
      case 'resolved': return 'bg-green-100 text-green-800';
      case 'wont_fix': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case 'bug': return 'Bug';
      case 'ui': return 'UI/Display';
      case 'performance': return 'Performance';
      case 'other': return 'Other';
      default: return category;
    }
  };

  const statusCounts = {
    all: bugs.length,
    new: bugs.filter((b) => b.status === 'new').length,
    in_progress: bugs.filter((b) => b.status === 'in_progress').length,
    resolved: bugs.filter((b) => b.status === 'resolved').length,
    wont_fix: bugs.filter((b) => b.status === 'wont_fix').length,
  };

  const filteredBugs = bugs.filter((b) => statusFilter === 'all' || b.status === statusFilter);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{error}</div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        {(['new', 'in_progress', 'resolved', 'wont_fix', 'all'] as const).map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === status
                ? 'bg-teal-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {status === 'wont_fix' ? "Won't Fix" : status === 'in_progress' ? 'In Progress' : status.charAt(0).toUpperCase() + status.slice(1)} ({statusCounts[status]})
          </button>
        ))}
      </div>

      {/* Bug reports list */}
      <div className="space-y-3">
        {filteredBugs.map((bug) => (
          <div
            key={bug.id}
            className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
          >
            {/* Header row */}
            <div
              className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => handleExpand(bug.id)}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-700">
                      {getCategoryLabel(bug.category)}
                    </span>
                    <span className="text-sm text-gray-500">
                      {formatDate(bug.created_at)}
                    </span>
                  </div>
                  <p className="text-sm text-gray-900 truncate">{bug.description}</p>
                  {(bug.email || bug.user_email) && (
                    <p className="text-xs text-gray-500 mt-1">
                      From: {bug.email || bug.user_email}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 text-xs font-medium rounded-full ${getStatusColor(bug.status)}`}>
                    {bug.status === 'wont_fix' ? "Won't Fix" : bug.status === 'in_progress' ? 'In Progress' : bug.status}
                  </span>
                  <svg
                    className={`w-5 h-5 text-gray-400 transition-transform ${expandedBug === bug.id ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Expanded details */}
            {expandedBug === bug.id && (
              <div className="border-t border-gray-200 p-4 bg-gray-50 space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-gray-500 mb-1">Full Description</h4>
                  <p className="text-sm text-gray-900 whitespace-pre-wrap">{bug.description}</p>
                </div>

                {bug.url && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-500 mb-1">Page URL</h4>
                    <a
                      href={bug.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-teal-700 hover:text-teal-700 break-all"
                    >
                      {bug.url}
                    </a>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Category:</span>
                    <span className="ml-2 text-gray-900">{getCategoryLabel(bug.category)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Contact:</span>
                    <span className="ml-2 text-gray-900">{bug.email || bug.user_email || 'Anonymous'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">User ID:</span>
                    <span className="ml-2 text-gray-900 font-mono text-xs">{bug.user_id || 'Not logged in'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Submitted:</span>
                    <span className="ml-2 text-gray-900">{formatDate(bug.created_at)}</span>
                  </div>
                </div>

                {bug.resolved_at && (
                  <div className="text-sm">
                    <span className="text-gray-500">Resolved:</span>
                    <span className="ml-2 text-gray-900">{formatDate(bug.resolved_at)}</span>
                  </div>
                )}

                {/* Admin notes + actions */}
                <div className="pt-4 border-t border-gray-200 space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Admin Notes</label>
                    <textarea
                      value={adminNotes}
                      onChange={(e) => setAdminNotes(e.target.value)}
                      rows={3}
                      placeholder="Add notes about this bug..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {bug.status === 'new' && (
                      <button
                        onClick={() => updateBug(bug.id, 'in_progress', adminNotes)}
                        disabled={processing === bug.id}
                        className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 disabled:opacity-50"
                      >
                        {processing === bug.id ? 'Updating...' : 'Mark In Progress'}
                      </button>
                    )}
                    {(bug.status === 'new' || bug.status === 'in_progress') && (
                      <>
                        <button
                          onClick={() => updateBug(bug.id, 'resolved', adminNotes)}
                          disabled={processing === bug.id}
                          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                        >
                          {processing === bug.id ? 'Updating...' : 'Resolve'}
                        </button>
                        <button
                          onClick={() => updateBug(bug.id, 'wont_fix', adminNotes)}
                          disabled={processing === bug.id}
                          className="px-4 py-2 bg-gray-500 text-white rounded-lg text-sm font-medium hover:bg-gray-600 disabled:opacity-50"
                        >
                          {processing === bug.id ? 'Updating...' : "Won't Fix"}
                        </button>
                      </>
                    )}
                    {adminNotes !== (bug.admin_notes || '') && (
                      <button
                        onClick={() => updateBug(bug.id, bug.status, adminNotes)}
                        disabled={processing === bug.id}
                        className="px-4 py-2 bg-teal-700 text-white rounded-[4px] text-sm font-semibold hover:bg-teal-800 disabled:opacity-50"
                      >
                        Save Notes
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {filteredBugs.length === 0 && (
        <div className="text-center py-12 text-gray-500 bg-white rounded-xl border border-gray-200">
          No bug reports found.
        </div>
      )}

      <div className="text-sm text-gray-500">
        Showing {filteredBugs.length} of {bugs.length} bug reports
      </div>
    </div>
  );
}
