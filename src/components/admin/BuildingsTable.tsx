import { useState, useEffect, useMemo, useRef } from 'react';
import { getScoreTextColor } from '../../lib/scoring-colors';
import type { AdminBuilding, AdminBuildingsResponse, AdminBuildingsStats, AdminLandlordsResponse } from '../../lib/api-types';
import { adminBuildingsUrl, type AdminBuildingsFilter } from '../../lib/admin/buildingsFilter';
import { applyBuildingPatch, buildingEditForm, buildingEditPatch, type BuildingEditForm } from '../../lib/admin/buildingEdit';
import { landlordOptionLabel, type LandlordGeo } from '../../lib/admin/landlordMatch';
import BuildingsFilterBar from './BuildingsFilterBar';
import OrphanCleanupButton from './OrphanCleanupButton';
import RecordsPullButton from './RecordsPullButton';

interface ManagerOption {
  id: string;
  name: string;
}

type Building = AdminBuilding;

const PAGE_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 300;

export default function BuildingsTable() {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [stats, setStats] = useState<AdminBuildingsStats>({ total_buildings: 0, with_reviews: 0, with_landlords: 0, total_reviews: 0 });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Filters run on the server. `ready` holds the first fetch until `?landlord=` is read.
  const [ready, setReady] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [landlordId, setLandlordId] = useState<string | null>(null);
  const [landlordName, setLandlordName] = useState<string | null>(null);
  const [orphansOnly, setOrphansOnly] = useState(false);
  const [expandedBuilding, setExpandedBuilding] = useState<string | null>(null);
  const [editingBuilding, setEditingBuilding] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<BuildingEditForm>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [landlords, setLandlords] = useState<LandlordGeo[]>([]);
  const [managers, setManagers] = useState<ManagerOption[]>([]);
  const [enriching, setEnriching] = useState<string | null>(null);
  const [enrichResult, setEnrichResult] = useState<any>(null);
  // Only the newest list request may write state, so a slow response for an old filter
  // cannot overwrite the rows for the current one.
  const requestSeq = useRef(0);
  // Bumped on Refresh and after a single-building delete so the orphan cleanup count refetches.
  const [cleanupKey, setCleanupKey] = useState(0);

  const filter = useMemo<AdminBuildingsFilter>(
    () => ({ landlord: landlordId, q: search || null, orphans: orphansOnly }),
    [landlordId, search, orphansOnly],
  );

  useEffect(() => {
    setLandlordId(new URLSearchParams(window.location.search).get('landlord')?.trim() || null);
    setReady(true);
    fetchLandlords();
    fetchManagers();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Any filter change replaces the list from the first page.
  useEffect(() => {
    if (ready) fetchBuildings(0, true);
  }, [ready, filter]);

  // replace=true starts the list over; replace=false appends the next page.
  const fetchBuildings = async (offset: number, replace: boolean) => {
    const seq = ++requestSeq.current;
    if (replace) setRefreshing(true);
    else setLoadingMore(true);
    try {
      const response = await fetch(adminBuildingsUrl({ limit: PAGE_SIZE, offset }, filter));
      const data = await response.json();
      if (seq !== requestSeq.current) return;

      if (response.ok) {
        const body = data as AdminBuildingsResponse;
        setBuildings((prev) => (replace ? body.buildings : [...prev, ...body.buildings]));
        setStats(body.stats);
        setTotal(body.total);
        setLandlordName(body.filter?.landlord?.name ?? null);
        setError(null);
      } else {
        setError(data.error || 'Failed to load buildings');
      }
    } catch (err) {
      if (seq === requestSeq.current) setError('Failed to load buildings');
    } finally {
      if (seq === requestSeq.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  };

  // A filter change still in flight owns the list: appending a page now would take the newer
  // request number and add the new filter's rows onto the old filter's.
  const loadMore = () => {
    if (refreshing) return;
    fetchBuildings(buildings.length, false);
  };

  const refresh = () => {
    setCleanupKey((k) => k + 1);
    fetchBuildings(0, true);
  };

  const clearLandlord = () => {
    setLandlordId(null);
    setLandlordName(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('landlord');
    window.history.replaceState(null, '', url.toString());
  };

  const fetchLandlords = async () => {
    try {
      // limit=500 so the assign-landlord dropdown shows all options, not just the default page
      const response = await fetch('/api/admin/landlords?limit=500');
      const data = (await response.json()) as AdminLandlordsResponse;
      if (response.ok) setLandlords(data.landlords);
    } catch {}
  };

  const fetchManagers = async () => {
    try {
      // /api/admin/managers is not yet paginated; if it ever is, add limit=500 here too
      const response = await fetch('/api/admin/managers');
      const data = await response.json();
      if (response.ok) setManagers(data.managers);
    } catch {}
  };

  const startEditing = (building: Building) => {
    setEditingBuilding(building.id);
    setEditForm(buildingEditForm(building));
  };

  const cancelEditing = () => {
    setEditingBuilding(null);
    setEditForm({});
  };

  const saveBuilding = async (buildingId: string) => {
    const original = buildings.find((b) => b.id === buildingId);
    if (!original) return;
    // Send only what changed, so a field the form did not start from is never overwritten.
    const patch = buildingEditPatch(original, editForm);
    if (Object.keys(patch).length === 0) {
      cancelEditing();
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/buildings/${buildingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });

      if (response.ok) {
        const updated = applyBuildingPatch(original, patch);
        // Resolve landlord/PM names for the updated local state
        updated.landlord_name = landlords.find((l) => l.id === updated.landlord_id)?.name ?? null;
        updated.property_manager_name = managers.find((m) => m.id === updated.property_manager_id)?.name ?? null;
        setBuildings((prev) => prev.map((b) => (b.id === buildingId ? updated : b)));
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

  const deleteBuilding = async (buildingId: string, address: string) => {
    if (!confirm(`Are you sure you want to delete "${address}"? This will also delete all reviews for this building. This action cannot be undone.`)) {
      return;
    }

    setDeleting(buildingId);
    try {
      const response = await fetch(`/api/admin/buildings/${buildingId}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (response.ok) {
        setBuildings((prev) => prev.filter((b) => b.id !== buildingId));
        setTotal((prev) => Math.max(0, prev - 1));
        setExpandedBuilding(null);
        setCleanupKey((k) => k + 1);
        alert(`Successfully deleted "${data.deleted}". ${data.reviewsDeleted} review(s) were also deleted.`);
      } else {
        alert(data.error || 'Failed to delete building');
      }
    } catch (err) {
      alert('Failed to delete building');
    } finally {
      setDeleting(null);
    }
  };

  const enrichBuilding = async (buildingId: string) => {
    setEnriching(buildingId);
    setEnrichResult(null);
    try {
      const response = await fetch(`/api/admin/buildings/${buildingId}/enrich`);
      const data = await response.json();
      if (response.ok) {
        setEnrichResult(data);
      } else {
        alert(data.error || 'Failed to look up building data');
      }
    } catch (err) {
      alert('Failed to look up building data');
    } finally {
      setEnriching(null);
    }
  };

  const applyEnrichment = (buildingId: string, result: any) => {
    startEditing(buildings.find((b) => b.id === buildingId)!);
    setEditForm((prev) => ({
      ...prev,
      year_built: result.yearBuilt || prev.year_built,
      unit_count: result.unitCount || prev.unit_count,
      building_type: result.buildingType || prev.building_type,
      owner_name: result.owner || prev.owner_name,
      owner_entity: result.ownerEntityInferred || prev.owner_entity,
    }));
    setEnrichResult(null);
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
    return getScoreTextColor(score);
  };

  const filtersActive = Boolean(filter.landlord || filter.q || filter.orphans);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search and Actions */}
      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-[200px]">
          <BuildingsFilterBar
            searchInput={searchInput}
            onSearchInput={setSearchInput}
            landlordId={landlordId}
            landlordName={landlordName}
            onClearLandlord={clearLandlord}
            orphansOnly={orphansOnly}
            onOrphansOnly={setOrphansOnly}
            refreshing={refreshing}
          />
        </div>
        <button
          onClick={refresh}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-[6px] hover:bg-gray-200"
        >
          Refresh
        </button>
        <OrphanCleanupButton refreshKey={cleanupKey} onDeleted={() => fetchBuildings(0, true)} />
      </div>

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 rounded-[6px] p-4 text-red-700">
          {error}
        </div>
      )}

      {/* Stats — values come from the API so they reflect ALL buildings, not the loaded slice or the filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-[6px] border border-gray-200">
          <div className="text-2xl font-bold text-gray-900">{stats.total_buildings}</div>
          <div className="text-sm text-gray-500">Total buildings</div>
        </div>
        <div className="bg-white p-4 rounded-[6px] border border-gray-200">
          <div className="text-2xl font-bold text-gray-900">{stats.with_reviews}</div>
          <div className="text-sm text-gray-500">With reviews</div>
        </div>
        <div className="bg-white p-4 rounded-[6px] border border-gray-200">
          <div className="text-2xl font-bold text-gray-900">{stats.with_landlords}</div>
          <div className="text-sm text-gray-500">With landlords</div>
        </div>
        <div className="bg-white p-4 rounded-[6px] border border-gray-200">
          <div className="text-2xl font-bold text-gray-900">{stats.total_reviews}</div>
          <div className="text-sm text-gray-500">Total reviews</div>
        </div>
      </div>

      {/* Buildings List */}
      <div className="space-y-3">
        {buildings.map((building) => (
          <div
            key={building.id}
            className="bg-white rounded-[6px] border border-gray-200 overflow-hidden hover:shadow-sm transition-shadow"
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
                    <p className="text-sm text-teal-700 mt-1">
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
                          className="w-full px-3 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-500"
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
                          className="w-full px-3 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                        <input
                          type="text"
                          value={editForm.city || ''}
                          onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                        <input
                          type="text"
                          value={editForm.state || ''}
                          onChange={(e) => setEditForm({ ...editForm, state: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-500"
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
                          className="w-full px-3 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-500"
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
                          className="w-full px-3 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-500"
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
                          className="w-full px-3 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-500"
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
                          className="w-full px-3 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                    </div>

                    {/* Landlord & Property Manager */}
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <h4 className="text-sm font-medium text-gray-700 mb-3">Landlord and property manager</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Landlord
                          </label>
                          <select
                            value={editForm.landlord_id || ''}
                            onChange={(e) => setEditForm({ ...editForm, landlord_id: e.target.value || null })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-500"
                          >
                            <option value="">None</option>
                            {landlords.map((l) => (
                              <option key={l.id} value={l.id}>{landlordOptionLabel(l)}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Property Manager
                          </label>
                          <select
                            value={editForm.property_manager_id || ''}
                            onChange={(e) => setEditForm({ ...editForm, property_manager_id: e.target.value || null })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-500"
                          >
                            <option value="">None</option>
                            {managers.map((m) => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Admin Info Section */}
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <h4 className="text-sm font-medium text-gray-700 mb-3">Ownership and admin info</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Owner Name
                          </label>
                          <input
                            type="text"
                            value={editForm.owner_name || ''}
                            onChange={(e) => setEditForm({ ...editForm, owner_name: e.target.value })}
                            placeholder="e.g., John Smith, ABC Properties LLC"
                            className="w-full px-3 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Owner Entity Type
                          </label>
                          <select
                            value={editForm.owner_entity || ''}
                            onChange={(e) => setEditForm({ ...editForm, owner_entity: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-500"
                          >
                            <option value="">Select type...</option>
                            <option value="individual">Individual</option>
                            <option value="llc">LLC</option>
                            <option value="corporation">Corporation</option>
                            <option value="trust">Trust</option>
                            <option value="partnership">Partnership</option>
                            <option value="reit">REIT</option>
                            <option value="other">Other</option>
                          </select>
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Owner Website
                          </label>
                          <input
                            type="url"
                            value={editForm.owner_website || ''}
                            onChange={(e) => setEditForm({ ...editForm, owner_website: e.target.value })}
                            placeholder="https://..."
                            className="w-full px-3 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-500"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Admin Notes (internal only)
                          </label>
                          <textarea
                            value={editForm.admin_notes || ''}
                            onChange={(e) => setEditForm({ ...editForm, admin_notes: e.target.value })}
                            rows={3}
                            placeholder="Internal notes about this building..."
                            className="w-full px-3 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-500"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2 mt-4">
                      <button
                        onClick={() => saveBuilding(building.id)}
                        disabled={saving}
                        className="px-4 py-2 bg-teal-700 text-white font-semibold rounded-[4px] hover:bg-teal-800 disabled:opacity-50"
                      >
                        {saving ? 'Saving...' : 'Save changes'}
                      </button>
                      <button
                        onClick={cancelEditing}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded-[6px] hover:bg-gray-300"
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
                        <h4 className="text-sm font-medium text-gray-500 mb-2">Building info</h4>
                        <dl className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <dt className="text-gray-500">Year built:</dt>
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

                    {/* Admin Info Display */}
                    {(building.owner_name || building.owner_entity || building.admin_notes) && (
                      <div className="mt-4 pt-4 border-t border-gray-200">
                        <h4 className="text-sm font-medium text-gray-500 mb-2">Admin info</h4>
                        <dl className="space-y-1 text-sm">
                          {building.owner_name && (
                            <div className="flex justify-between">
                              <dt className="text-gray-500">Owner:</dt>
                              <dd className="text-gray-900">{building.owner_name}</dd>
                            </div>
                          )}
                          {building.owner_entity && (
                            <div className="flex justify-between">
                              <dt className="text-gray-500">Entity type:</dt>
                              <dd className="text-gray-900 capitalize">{building.owner_entity}</dd>
                            </div>
                          )}
                          {building.owner_website && (
                            <div className="flex justify-between">
                              <dt className="text-gray-500">Website:</dt>
                              <dd className="text-gray-900">
                                <a href={building.owner_website} target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:underline">
                                  {building.owner_website.replace(/^https?:\/\//, '')}
                                </a>
                              </dd>
                            </div>
                          )}
                          {building.admin_notes && (
                            <div className="mt-2">
                              <dt className="text-gray-500 mb-1">Notes:</dt>
                              <dd className="text-gray-900 bg-gray-50 p-2 rounded text-xs whitespace-pre-wrap">{building.admin_notes}</dd>
                            </div>
                          )}
                        </dl>
                      </div>
                    )}

                    <RecordsPullButton buildingId={building.id} city={building.city} />
                    {/* Enrichment Results */}
                    {enrichResult && enrichResult.results?.length > 0 && expandedBuilding === building.id && (
                      <div className="mt-4 pt-4 border-t border-gray-200">
                        <h4 className="text-sm font-medium text-gray-700 mb-2">
                          {enrichResult.source ? `${enrichResult.source} Results` : 'Auto-Research Results'}
                          {enrichResult.fuzzyMatch && (
                            <span className="ml-2 text-xs text-amber-700 font-normal">(fuzzy match)</span>
                          )}
                        </h4>
                        <div className="space-y-2">
                          {enrichResult.results.map((r: any, i: number) => (
                            <div key={i} className="bg-white border border-gray-200 rounded-[6px] p-3 text-sm">
                              <div className="flex justify-between items-start mb-2">
                                <div className="font-medium text-gray-900">{r.address}, {r.city}</div>
                                <button
                                  onClick={() => applyEnrichment(building.id, r)}
                                  className="px-3 py-1 bg-teal-700 text-white rounded-[4px] text-xs font-semibold hover:bg-teal-800"
                                >
                                  Apply
                                </button>
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                                <div><span className="text-gray-500">Owner:</span> <span className="text-gray-900">{r.owner}</span></div>
                                <div><span className="text-gray-500">Entity:</span> <span className="text-gray-900 capitalize">{r.ownerEntityInferred}</span></div>
                                <div><span className="text-gray-500">Year built:</span> <span className="text-gray-900">{r.yearBuilt || 'N/A'}</span></div>
                                <div><span className="text-gray-500">Units:</span> <span className="text-gray-900">{r.unitCount || 'N/A'} ({r.residentialUnits || 0} res / {r.commercialUnits || 0} com)</span></div>
                                <div><span className="text-gray-500">Type:</span> <span className="text-gray-900">{r.buildingType}</span></div>
                                <div><span className="text-gray-500">Property:</span> <span className="text-gray-900">{r.propertyType}</span></div>
                                {r.totalValue && <div><span className="text-gray-500">Value:</span> <span className="text-gray-900">${r.totalValue.toLocaleString()}</span></div>}
                                {r.yearRemodeled && <div><span className="text-gray-500">Remodeled:</span> <span className="text-gray-900">{r.yearRemodeled}</span></div>}
                                {r.overallCondition && <div><span className="text-gray-500">Condition:</span> <span className="text-gray-900">{r.overallCondition}</span></div>}
                              </div>
                            </div>
                          ))}
                        </div>
                        <button
                          onClick={() => setEnrichResult(null)}
                          className="mt-2 text-xs text-gray-500 hover:text-gray-700"
                        >
                          Dismiss results
                        </button>
                      </div>
                    )}

                    {enrichResult && enrichResult.unsupported === true && expandedBuilding === building.id && (
                      <div className="mt-4 pt-4 border-t border-gray-200">
                        <div className="bg-amber-50 border border-amber-200 rounded-[6px] p-3 text-sm text-amber-800">
                          {enrichResult.message}
                        </div>
                        <button
                          onClick={() => setEnrichResult(null)}
                          className="mt-2 text-xs text-gray-500 hover:text-gray-700"
                        >
                          Dismiss
                        </button>
                      </div>
                    )}

                    {enrichResult && enrichResult.results?.length === 0 && !enrichResult.unsupported && expandedBuilding === building.id && (
                      <div className="mt-4 pt-4 border-t border-gray-200">
                        <div className="bg-amber-50 border border-amber-200 rounded-[6px] p-3 text-sm text-amber-800">
                          {enrichResult.source
                            ? `No matching records found in ${enrichResult.source} for "${enrichResult.address}".`
                            : `No matching records found for "${enrichResult.address}".`}
                          {enrichResult.searchedFor && (
                            <span className="text-xs block mt-1 text-amber-700">
                              Searched: #{enrichResult.searchedFor.number} {enrichResult.searchedFor.street}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => setEnrichResult(null)}
                          className="mt-2 text-xs text-gray-500 hover:text-gray-700"
                        >
                          Dismiss
                        </button>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 pt-4 border-t border-gray-200">
                      <button
                        onClick={() => startEditing(building)}
                        className="px-4 py-2 bg-teal-700 text-white rounded-[4px] hover:bg-teal-800 text-sm font-semibold"
                      >
                        Edit building
                      </button>
                      <button
                        onClick={() => enrichBuilding(building.id)}
                        disabled={enriching === building.id}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-[6px] hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium"
                      >
                        {enriching === building.id ? 'Researching...' : 'Auto-research'}
                      </button>
                      <a
                        href={`/building/${building.slug}`}
                        className="px-4 py-2 bg-slate-600 text-white rounded-[6px] hover:bg-slate-700 text-sm font-medium"
                      >
                        View page
                      </a>
                      {building.landlord_id && (
                        <a
                          href={`/admin/landlords?id=${building.landlord_id}`}
                          className="px-4 py-2 bg-gray-200 text-gray-700 rounded-[6px] hover:bg-gray-300 text-sm font-medium"
                        >
                          View landlord
                        </a>
                      )}
                      <button
                        onClick={() => deleteBuilding(building.id, building.address)}
                        disabled={deleting === building.id}
                        className="px-4 py-2 bg-red-600 text-white rounded-[6px] hover:bg-red-700 disabled:opacity-50 text-sm font-medium ml-auto"
                      >
                        {deleting === building.id ? 'Deleting...' : 'Delete building'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {buildings.length === 0 && !refreshing && (
        <div className="text-center py-12 text-gray-500 bg-white rounded-[6px] border border-gray-200">
          No buildings found matching your criteria.
        </div>
      )}

      {/* Pagination footer — search and filters run on the server, so `total` counts every match */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-500">
        <span>
          Showing {buildings.length} of {total}{filtersActive ? ' matching' : ''} buildings
          {filter.q ? ' (search covers address, city, and ZIP across all buildings)' : ''}
        </span>
        {buildings.length < total && (
          <button
            onClick={loadMore}
            disabled={loadingMore || refreshing}
            className="px-4 py-2 bg-teal-700 text-white rounded-[4px] hover:bg-teal-800 disabled:opacity-50 text-sm font-semibold"
          >
            {loadingMore ? 'Loading...' : `Load more (${total - buildings.length} remaining)`}
          </button>
        )}
      </div>
    </div>
  );
}
