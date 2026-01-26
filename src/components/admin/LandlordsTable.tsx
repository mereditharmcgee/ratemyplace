import { useState, useEffect } from 'react';

interface Landlord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  building_count: number;
  review_count: number;
  avg_score: number | null;
  created_at: number;
}

export default function LandlordsTable() {
  const [landlords, setLandlords] = useState<Landlord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expandedLandlord, setExpandedLandlord] = useState<string | null>(null);
  const [editingLandlord, setEditingLandlord] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Landlord>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchLandlords();
  }, []);

  const fetchLandlords = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/landlords');
      const data = await response.json();

      if (response.ok) {
        setLandlords(data.landlords);
      } else {
        setError(data.error || 'Failed to load landlords');
      }
    } catch (err) {
      setError('Failed to load landlords');
    } finally {
      setLoading(false);
    }
  };

  const startEditing = (landlord: Landlord) => {
    setEditingLandlord(landlord.id);
    setEditForm({
      name: landlord.name,
      description: landlord.description || '',
      website: landlord.website || '',
      phone: landlord.phone || '',
      email: landlord.email || '',
    });
  };

  const cancelEditing = () => {
    setEditingLandlord(null);
    setEditForm({});
  };

  const saveLandlord = async (landlordId: string) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/landlords/${landlordId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });

      if (response.ok) {
        setLandlords((prev) =>
          prev.map((l) => (l.id === landlordId ? { ...l, ...editForm } : l))
        );
        setEditingLandlord(null);
        setEditForm({});
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to save landlord');
      }
    } catch (err) {
      alert('Failed to save landlord');
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

  const filteredLandlords = landlords.filter((landlord) => {
    return (
      landlord.name.toLowerCase().includes(search.toLowerCase()) ||
      landlord.email?.toLowerCase().includes(search.toLowerCase())
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
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          />
        </div>
        <button
          onClick={fetchLandlords}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
        >
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="text-2xl font-bold text-gray-900">{landlords.length}</div>
          <div className="text-sm text-gray-500">Total Landlords</div>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="text-2xl font-bold text-gray-900">
            {landlords.reduce((sum, l) => sum + l.building_count, 0)}
          </div>
          <div className="text-sm text-gray-500">Total Buildings</div>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="text-2xl font-bold text-gray-900">
            {landlords.reduce((sum, l) => sum + l.review_count, 0)}
          </div>
          <div className="text-sm text-gray-500">Total Reviews</div>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="text-2xl font-bold text-gray-900">
            {landlords.filter((l) => l.avg_score && l.avg_score >= 4).length}
          </div>
          <div className="text-sm text-gray-500">High Rated (4+)</div>
        </div>
      </div>

      {/* Landlords List */}
      <div className="space-y-3">
        {filteredLandlords.map((landlord) => (
          <div
            key={landlord.id}
            className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
          >
            {/* Landlord Header */}
            <div
              className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() =>
                setExpandedLandlord(expandedLandlord === landlord.id ? null : landlord.id)
              }
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900">{landlord.name}</h3>
                  <p className="text-sm text-gray-500">
                    {landlord.building_count} buildings • {landlord.review_count} reviews
                  </p>
                  {landlord.email && (
                    <p className="text-sm text-teal-600 mt-1">{landlord.email}</p>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className={`text-lg font-bold ${getScoreColor(landlord.avg_score)}`}>
                      {landlord.avg_score?.toFixed(1) || 'N/A'}
                    </div>
                    <div className="text-xs text-gray-500">avg score</div>
                  </div>
                  <svg
                    className={`w-5 h-5 text-gray-400 transition-transform ${
                      expandedLandlord === landlord.id ? 'rotate-180' : ''
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
            {expandedLandlord === landlord.id && (
              <div className="border-t border-gray-200 p-4 bg-gray-50">
                {editingLandlord === landlord.id ? (
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
                        onClick={() => saveLandlord(landlord.id)}
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
                            <dd className="text-gray-900">{landlord.email || 'N/A'}</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-gray-500">Phone:</dt>
                            <dd className="text-gray-900">{landlord.phone || 'N/A'}</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-gray-500">Website:</dt>
                            <dd className="text-gray-900">
                              {landlord.website ? (
                                <a
                                  href={landlord.website}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-teal-600 hover:underline"
                                >
                                  {landlord.website}
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
                          {landlord.description || 'No description provided.'}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-4 border-t border-gray-200">
                      <button
                        onClick={() => startEditing(landlord)}
                        className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium"
                      >
                        Edit Landlord
                      </button>
                      <a
                        href={`/landlord/${landlord.slug}`}
                        className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 text-sm font-medium"
                      >
                        View Page
                      </a>
                      <a
                        href={`/admin/buildings?landlord=${landlord.id}`}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm font-medium"
                      >
                        View Buildings ({landlord.building_count})
                      </a>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {filteredLandlords.length === 0 && (
        <div className="text-center py-12 text-gray-500 bg-white rounded-xl border border-gray-200">
          No landlords found matching your criteria.
        </div>
      )}

      <div className="text-sm text-gray-500">
        Showing {filteredLandlords.length} of {landlords.length} landlords
      </div>
    </div>
  );
}
