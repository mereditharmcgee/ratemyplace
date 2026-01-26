import { useState, useEffect } from 'react';

interface Building {
  id: string;
  address: string;
  slug: string;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  latitude: number | null;
  longitude: number | null;
  year_built: number | null;
  unit_count: number | null;
  building_type: string | null;
  landlord_id: string | null;
  landlord_name: string | null;
  property_manager_id: string | null;
  property_manager_name: string | null;
  review_count: number;
  avg_score: number | null;
  created_at: number;
}

export default function BuildingsTable() {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expandedBuilding, setExpandedBuilding] = useState<string | null>(null);
  const [editingBuilding, setEditingBuilding] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Building>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchBuildings();
  }, []);

  const fetchBuildings = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/buildings');
      const data = await response.json();

      if (response.ok) {
        setBuildings(data.buildings);
      } else {
        setError(data.error || 'Failed to load buildings');
      }
    } catch (err) {
      setError('Failed to load buildings');
    } finally {
      setLoading(false);
    }
  };

  const startEditing = (building: Building) => {
    setEditingBuilding(building.id);
    setEditForm({
      address: building.address,
      neighborhood: building.neighborhood || '',
      city: building.city || '',
      state: building.state || '',
      zip_code: building.zip_code || '',
      year_built: building.year_built,
      unit_count: building.unit_count,
      building_type: building.building_type || '',
    });
  };

  const cancelEditing = () => {
    setEditingBuilding(null);
    setEditForm({});
  };

  const saveBuilding = async (buildingId: string) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/buildings/${buildingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });

      if (response.ok) {
        setBuildings((prev) =>
          prev.map((b) =>
            b.id === buildingId ? { ...b, ...editForm } : b
          )
        );
        setEditingBuilding(null);
        setEditForm({});
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to save building');
      }
    } catch (err) {
      alert('Failed to save building');
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

  const filteredBuildings = buildings.filter((building) => {
    return (
      building.address.toLowerCase().includes(search.toLowerCase()) ||
      building.city?.toLowerCase().includes(search.toLowerCase()) ||
      building.neighborhood?.toLowerCase().includes(search.toLowerCase()) ||
      building.landlord_name?.toLowerCase().includes(search.toLowerCase())
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
            placeholder="Search by address, city, neighborhood, or landlord..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          />
        </div>
        <button
          onClick={fetchBuildings}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
        >
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="text-2xl font-bold text-gray-900">{buildings.length}</div>
          <div className="text-sm text-gray-500">Total Buildings</div>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="text-2xl font-bold text-gray-900">
            {buildings.filter((b) => b.review_count > 0).length}
          </div>
          <div className="text-sm text-gray-500">With Reviews</div>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="text-2xl font-bold text-gray-900">
            {buildings.filter((b) => b.landlord_id).length}
          </div>
          <div className="text-sm text-gray-500">With Landlords</div>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="text-2xl font-bold text-gray-900">
            {buildings.reduce((sum, b) => sum + b.review_count, 0)}
          </div>
          <div className="text-sm text-gray-500">Total Reviews</div>
        </div>
      </div>

      {/* Buildings List */}
      <div className="space-y-3">
        {filteredBuildings.map((building) => (
          <div
            key={building.id}
            className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
          >
            {/* Building Header */}
            <div
              className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() =>
                setExpandedBuilding(expandedBuilding === building.id ? null : building.id)
              }
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900">{building.address}</h3>
                  <p className="text-sm text-gray-500">
                    {[building.city, building.state, building.zip_code]
                      .filter(Boolean)
                      .join(', ') || 'No location'}
                  </p>
                  {building.landlord_name && (
                    <p className="text-sm text-teal-600 mt-1">
                      Landlord: {building.landlord_name}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className={`text-lg font-bold ${getScoreColor(building.avg_score)}`}>
                      {building.avg_score?.toFixed(1) || 'N/A'}
                    </div>
                    <div className="text-xs text-gray-500">{building.review_count} reviews</div>
                  </div>
                  <svg
                    className={`w-5 h-5 text-gray-400 transition-transform ${
                      expandedBuilding === building.id ? 'rotate-180' : ''
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
            {expandedBuilding === building.id && (
              <div className="border-t border-gray-200 p-4 bg-gray-50">
                {editingBuilding === building.id ? (
                  // Edit Form
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Address
                        </label>
                        <input
                          type="text"
                          value={editForm.address || ''}
                          onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Neighborhood
                        </label>
                        <input
                          type="text"
                          value={editForm.neighborhood || ''}
                          onChange={(e) => setEditForm({ ...editForm, neighborhood: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                        <input
                          type="text"
                          value={editForm.city || ''}
                          onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                        <input
                          type="text"
                          value={editForm.state || ''}
                          onChange={(e) => setEditForm({ ...editForm, state: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          ZIP Code
                        </label>
                        <input
                          type="text"
                          value={editForm.zip_code || ''}
                          onChange={(e) => setEditForm({ ...editForm, zip_code: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Year Built
                        </label>
                        <input
                          type="number"
                          value={editForm.year_built || ''}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              year_built: e.target.value ? parseInt(e.target.value) : null,
                            })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Unit Count
                        </label>
                        <input
                          type="number"
                          value={editForm.unit_count || ''}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              unit_count: e.target.value ? parseInt(e.target.value) : null,
                            })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Building Type
                        </label>
                        <input
                          type="text"
                          value={editForm.building_type || ''}
                          onChange={(e) =>
                            setEditForm({ ...editForm, building_type: e.target.value })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveBuilding(building.id)}
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
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                      <div>
                        <h4 className="text-sm font-medium text-gray-500 mb-2">Location</h4>
                        <dl className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <dt className="text-gray-500">Neighborhood:</dt>
                            <dd className="text-gray-900">{building.neighborhood || 'N/A'}</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-gray-500">Coordinates:</dt>
                            <dd className="text-gray-900">
                              {building.latitude && building.longitude
                                ? `${building.latitude.toFixed(4)}, ${building.longitude.toFixed(4)}`
                                : 'N/A'}
                            </dd>
                          </div>
                        </dl>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-gray-500 mb-2">Building Info</h4>
                        <dl className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <dt className="text-gray-500">Year Built:</dt>
                            <dd className="text-gray-900">{building.year_built || 'N/A'}</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-gray-500">Units:</dt>
                            <dd className="text-gray-900">{building.unit_count || 'N/A'}</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-gray-500">Type:</dt>
                            <dd className="text-gray-900">{building.building_type || 'N/A'}</dd>
                          </div>
                        </dl>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-gray-500 mb-2">Management</h4>
                        <dl className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <dt className="text-gray-500">Landlord:</dt>
                            <dd className="text-gray-900">{building.landlord_name || 'N/A'}</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-gray-500">Manager:</dt>
                            <dd className="text-gray-900">
                              {building.property_manager_name || 'N/A'}
                            </dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-gray-500">Added:</dt>
                            <dd className="text-gray-900">{formatDate(building.created_at)}</dd>
                          </div>
                        </dl>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-4 border-t border-gray-200">
                      <button
                        onClick={() => startEditing(building)}
                        className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium"
                      >
                        Edit Building
                      </button>
                      <a
                        href={`/building/${building.slug}`}
                        className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 text-sm font-medium"
                      >
                        View Page
                      </a>
                      {building.landlord_id && (
                        <a
                          href={`/admin/landlords?id=${building.landlord_id}`}
                          className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm font-medium"
                        >
                          View Landlord
                        </a>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {filteredBuildings.length === 0 && (
        <div className="text-center py-12 text-gray-500 bg-white rounded-xl border border-gray-200">
          No buildings found matching your criteria.
        </div>
      )}

      <div className="text-sm text-gray-500">
        Showing {filteredBuildings.length} of {buildings.length} buildings
      </div>
    </div>
  );
}
