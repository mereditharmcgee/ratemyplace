import { useState, useEffect } from 'react';

interface PropertyManager {
  id: string;
  name: string;
  slug: string;
  company_name: string | null;
  description: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  building_count: number;
  review_count: number;
  avg_score: number | null;
  created_at: number;
}

export default function ManagersTable() {
  const [managers, setManagers] = useState<PropertyManager[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expandedManager, setExpandedManager] = useState<string | null>(null);
  const [editingManager, setEditingManager] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<PropertyManager>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchManagers();
  }, []);

  const fetchManagers = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/managers');
      const data = await response.json();

      if (response.ok) {
        setManagers(data.managers);
      } else {
        setError(data.error || 'Failed to load property managers');
      }
    } catch (err) {
      setError('Failed to load property managers');
    } finally {
      setLoading(false);
    }
  };

  const startEditing = (manager: PropertyManager) => {
    setEditingManager(manager.id);
    setEditForm({
      name: manager.name,
      company_name: manager.company_name || '',
      description: manager.description || '',
      website: manager.website || '',
      phone: manager.phone || '',
      email: manager.email || '',
    });
  };

  const cancelEditing = () => {
    setEditingManager(null);
    setEditForm({});
  };

  const saveManager = async (managerId: string) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/managers/${managerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });

      if (response.ok) {
        setManagers((prev) =>
          prev.map((m) => (m.id === managerId ? { ...m, ...editForm } : m))
        );
        setEditingManager(null);
        setEditForm({});
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to save property manager');
      }
    } catch (err) {
      alert('Failed to save property manager');
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getScoreColor = (score: number | null) => {
    if (score === null) return 'text-gray-400';
    if (score >= 4) return 'text-green-600';
    if (score >= 3) return 'text-amber-600';
    return 'text-red-600';
  };

  const filteredManagers = managers.filter((manager) => {
    return (
      manager.name.toLowerCase().includes(search.toLowerCase()) ||
      manager.company_name?.toLowerCase().includes(search.toLowerCase()) ||
      manager.email?.toLowerCase().includes(search.toLowerCase())
    );
  });

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
      {/* Search */}
      <div className="flex gap-4">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search by name, company, or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          />
        </div>
        <button
          onClick={fetchManagers}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
        >
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="text-2xl font-bold text-gray-900">{managers.length}</div>
          <div className="text-sm text-gray-500">Total Managers</div>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="text-2xl font-bold text-gray-900">
            {managers.reduce((sum, m) => sum + m.building_count, 0)}
          </div>
          <div className="text-sm text-gray-500">Total Buildings</div>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="text-2xl font-bold text-gray-900">
            {managers.reduce((sum, m) => sum + m.review_count, 0)}
          </div>
          <div className="text-sm text-gray-500">Total Reviews</div>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="text-2xl font-bold text-gray-900">
            {managers.filter((m) => m.avg_score && m.avg_score >= 4).length}
          </div>
          <div className="text-sm text-gray-500">High Rated (4+)</div>
        </div>
      </div>

      {/* Managers List */}
      <div className="space-y-3">
        {filteredManagers.map((manager) => (
          <div
            key={manager.id}
            className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
          >
            {/* Manager Header */}
            <div
              className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() =>
                setExpandedManager(expandedManager === manager.id ? null : manager.id)
              }
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900">{manager.name}</h3>
                  {manager.company_name && (
                    <p className="text-sm text-gray-600">{manager.company_name}</p>
                  )}
                  <p className="text-sm text-gray-500">
                    {manager.building_count} buildings • {manager.review_count} reviews
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className={`text-lg font-bold ${getScoreColor(manager.avg_score)}`}>
                      {manager.avg_score?.toFixed(1) || 'N/A'}
                    </div>
                    <div className="text-xs text-gray-500">avg score</div>
                  </div>
                  <svg
                    className={`w-5 h-5 text-gray-400 transition-transform ${
                      expandedManager === manager.id ? 'rotate-180' : ''
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
            {expandedManager === manager.id && (
              <div className="border-t border-gray-200 p-4 bg-gray-50">
                {editingManager === manager.id ? (
                  // Edit Form
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Name
                        </label>
                        <input
                          type="text"
                          value={editForm.name || ''}
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Company Name
                        </label>
                        <input
                          type="text"
                          value={editForm.company_name || ''}
                          onChange={(e) =>
                            setEditForm({ ...editForm, company_name: e.target.value })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Email
                        </label>
                        <input
                          type="email"
                          value={editForm.email || ''}
                          onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Phone
                        </label>
                        <input
                          type="tel"
                          value={editForm.phone || ''}
                          onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Website
                        </label>
                        <input
                          type="url"
                          value={editForm.website || ''}
                          onChange={(e) => setEditForm({ ...editForm, website: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Description
                        </label>
                        <textarea
                          value={editForm.description || ''}
                          onChange={(e) =>
                            setEditForm({ ...editForm, description: e.target.value })
                          }
                          rows={3}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveManager(manager.id)}
                        disabled={saving}
                        className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50"
                      >
                        {saving ? 'Saving...' : 'Save Changes'}
                      </button>
                      <button
                        onClick={cancelEditing}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  // View Details
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      <div>
                        <h4 className="text-sm font-medium text-gray-500 mb-2">Contact Info</h4>
                        <dl className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <dt className="text-gray-500">Email:</dt>
                            <dd className="text-gray-900">{manager.email || 'N/A'}</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-gray-500">Phone:</dt>
                            <dd className="text-gray-900">{manager.phone || 'N/A'}</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-gray-500">Website:</dt>
                            <dd className="text-gray-900">
                              {manager.website ? (
                                <a
                                  href={manager.website}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-teal-600 hover:underline"
                                >
                                  {manager.website}
                                </a>
                              ) : (
                                'N/A'
                              )}
                            </dd>
                          </div>
                        </dl>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-gray-500 mb-2">Description</h4>
                        <p className="text-sm text-gray-700">
                          {manager.description || 'No description provided.'}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-4 border-t border-gray-200">
                      <button
                        onClick={() => startEditing(manager)}
                        className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium"
                      >
                        Edit Manager
                      </button>
                      <a
                        href={`/property-manager/${manager.slug}`}
                        className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 text-sm font-medium"
                      >
                        View Page
                      </a>
                      <a
                        href={`/admin/buildings?manager=${manager.id}`}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm font-medium"
                      >
                        View Buildings ({manager.building_count})
                      </a>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {filteredManagers.length === 0 && (
        <div className="text-center py-12 text-gray-500 bg-white rounded-xl border border-gray-200">
          No property managers found matching your criteria.
        </div>
      )}

      <div className="text-sm text-gray-500">
        Showing {filteredManagers.length} of {managers.length} property managers
      </div>
    </div>
  );
}
