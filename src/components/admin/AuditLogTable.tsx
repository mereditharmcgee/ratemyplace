import { useState, useEffect } from 'react';
import type { AuditLogEntry, AuditLogsResponse, AuditFilterOption } from '../../lib/api-types';

interface FilterOptions {
  actionTypes: string[];
  adminUsers: AuditFilterOption[];
}

export default function AuditLogTable() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState('all');
  const [adminFilter, setAdminFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    actionTypes: [],
    adminUsers: []
  });
  const [expandedLog, setExpandedLog] = useState<number | null>(null);

  useEffect(() => {
    fetchLogs();
  }, [actionFilter, adminFilter, page]);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        action: actionFilter,
        admin: adminFilter,
        page: String(page)
      });

      const response = await fetch(`/api/admin/audit?${params}`);
      const data = await response.json();

      if (response.ok) {
        setLogs(data.logs);
        setTotalPages(data.pages);
        setTotal(data.total);
        if (data.filters) {
          setFilterOptions(data.filters);
        }
      } else {
        setError(data.error || 'Failed to load audit logs');
      }
    } catch (err) {
      setError('Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatActionType = (action: string) => {
    return action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  const getActionColor = (action: string) => {
    if (action.includes('approved') || action.includes('upheld')) {
      return 'bg-green-100 text-green-800';
    }
    if (action.includes('rejected') || action.includes('dismissed') || action.includes('deleted')) {
      return 'bg-red-100 text-red-800';
    }
    if (action.includes('flagged') || action.includes('partially')) {
      return 'bg-amber-100 text-amber-800';
    }
    return 'bg-gray-100 text-gray-800';
  };

  const parseJson = (str: string | null): Record<string, any> | null => {
    if (!str) return null;
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  };

  if (loading && logs.length === 0) {
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
        {/* Action type filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">Action Type</label>
          <select
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          >
            <option value="all">All Actions</option>
            {filterOptions.actionTypes.map(type => (
              <option key={type} value={type}>{formatActionType(type)}</option>
            ))}
          </select>
        </div>

        {/* Admin user filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">Admin User</label>
          <select
            value={adminFilter}
            onChange={(e) => { setAdminFilter(e.target.value); setPage(1); }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          >
            <option value="all">All Admins</option>
            {filterOptions.adminUsers.map(admin => (
              <option key={admin.id} value={admin.id}>{admin.email || admin.id}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Results count */}
      <div className="text-sm text-gray-500">
        Showing {logs.length} of {total} audit log entries
      </div>

      {/* Audit log table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timestamp</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Admin</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Entity</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Details</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {logs.map((log) => {
              const oldValue = parseJson(log.old_value);
              const newValue = parseJson(log.new_value);
              const isExpanded = expandedLog === log.id;

              return (
                <tr
                  key={log.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => setExpandedLog(isExpanded ? null : log.id)}
                >
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                    {formatDate(log.created_at)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                    <div>{log.admin_email || 'Unknown'}</div>
                    <div className="text-xs text-gray-400">{log.admin_ip}</div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs font-medium rounded ${getActionColor(log.action_type)}`}>
                      {formatActionType(log.action_type)}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                    <div className="capitalize">{log.entity_type}</div>
                    <div className="text-xs text-gray-400 font-mono">{log.entity_id.slice(0, 8)}...</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {isExpanded ? (
                      <div className="space-y-2">
                        {oldValue && (
                          <div>
                            <span className="text-xs font-medium text-gray-500">From: </span>
                            <span className="text-xs">{JSON.stringify(oldValue)}</span>
                          </div>
                        )}
                        {newValue && (
                          <div>
                            <span className="text-xs font-medium text-gray-500">To: </span>
                            <span className="text-xs">{JSON.stringify(newValue)}</span>
                          </div>
                        )}
                        {log.notes && (
                          <div>
                            <span className="text-xs font-medium text-gray-500">Notes: </span>
                            <span className="text-xs">{log.notes}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-400 text-xs">Click to expand</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {logs.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No audit logs found.
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 rounded-[6px] text-sm font-medium transition-colors bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="px-4 py-2 text-sm text-gray-700">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 rounded-[6px] text-sm font-medium transition-colors bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
