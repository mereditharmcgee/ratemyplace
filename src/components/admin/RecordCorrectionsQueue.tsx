import { useState, useEffect } from 'react';
import type { RecordCorrection } from '../../lib/api-types';
import { fromStoredKind, CORRECTION_RESOLUTIONS, type CorrectionResolution } from '../../lib/records/corrections';
import type { RecordKind } from '../../lib/records/types';

interface DiffKey {
  kind: string;
  source_key: string;
}

interface RepullSourceSummary {
  label: string;
  status: string;
  rowCount: number;
  error?: string;
}

interface RepullSummary {
  parcelId: string | null;
  condominium: boolean;
  sources: RepullSourceSummary[];
}

interface RepullDiff {
  added: DiffKey[];
  removed: DiffKey[];
  changed: DiffKey[];
}

interface RepullResult {
  summary: RepullSummary;
  diff: RepullDiff;
}

const KIND_LABELS: Record<string, string> = {
  assessment: 'Property',
  permit: 'Building permits',
  violation: 'Violations',
  enforcement_ticket: 'Code enforcement',
  service_request: '311 requests',
  rentsmart: 'RentSmart',
  panel: 'Whole panel',
};

const RESOLUTION_LABELS: Record<CorrectionResolution, string> = {
  repulled_unchanged: 'Re-pulled, unchanged',
  repulled_updated: 'Re-pulled, updated',
  source_mismatch_noted: 'Source mismatch noted (public note)',
};

const MAX_DIFF_LINES = 40;

function kindLabel(recordKind: string | null): string {
  const kind = fromStoredKind(recordKind as RecordKind | null);
  return KIND_LABELS[kind] ?? kind;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** All diff lines, unsliced — callers decide how many to show and report the rest as a count. */
function diffLines(diff: RepullDiff): string[] {
  const lines: string[] = [];
  for (const key of diff.added) lines.push(`+ ${key.kind}:${key.source_key}`);
  for (const key of diff.removed) lines.push(`- ${key.kind}:${key.source_key}`);
  for (const key of diff.changed) lines.push(`~ ${key.kind}:${key.source_key}`);
  return lines;
}

export default function RecordCorrectionsQueue() {
  const [items, setItems] = useState<RecordCorrection[]>([]);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'resolved' | 'all'>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [repullResults, setRepullResults] = useState<Record<string, RepullResult>>({});
  const [repullErrors, setRepullErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resolution, setResolution] = useState<CorrectionResolution>('repulled_unchanged');
  const [notes, setNotes] = useState('');
  const [resolveBusy, setResolveBusy] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const fetchItems = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/admin/records/corrections?status=${statusFilter}`);
      const data = await response.json();
      if (response.ok) {
        setItems(data.data);
      } else {
        setError(data.error || 'Failed to load corrections');
      }
    } catch {
      setError('Failed to load corrections');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      setResolution('repulled_unchanged');
      setNotes('');
      setResolveError(null);
      setRepullErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const runRepull = async (id: string) => {
    setBusyId(id);
    setRepullErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    // A failed re-pull must not leave the previous diff on screen with Resolve
    // still enabled from a stale result.
    setRepullResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const response = await fetch(`/api/admin/records/corrections/${id}/repull`, { method: 'POST' });
      const data = await response.json();
      if (response.ok) {
        setRepullResults((prev) => ({ ...prev, [id]: data.data }));
      } else {
        setRepullErrors((prev) => ({ ...prev, [id]: data.error || 'Failed to re-pull records' }));
      }
    } catch {
      setRepullErrors((prev) => ({ ...prev, [id]: 'Failed to re-pull records' }));
    } finally {
      setBusyId(null);
    }
  };

  const resolveCorrection = async (id: string) => {
    setResolveBusy(id);
    setResolveError(null);
    try {
      const response = await fetch(`/api/admin/records/corrections/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution, notes }),
      });
      const data = await response.json();
      if (response.ok) {
        setExpandedId(null);
        setRepullResults((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        void fetchItems();
      } else {
        setResolveError(data.details?.[0]?.message || data.error || 'Failed to resolve correction');
      }
    } catch {
      setResolveError('Failed to resolve correction');
    } finally {
      setResolveBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(['pending', 'resolved', 'all'] as const).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setStatusFilter(status)}
            className={`px-4 py-2 rounded-[6px] text-sm font-medium transition-colors ${
              statusFilter === status
                ? 'bg-teal-700 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
            {status === statusFilter ? ` (${items.length})` : ''}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-[6px] p-4 text-red-700 flex items-center justify-between gap-4">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              void fetchItems();
            }}
            className="px-3 py-1.5 text-sm font-medium rounded-[4px] bg-red-100 text-red-800 hover:bg-red-200 shrink-0"
          >
            Try again
          </button>
        </div>
      )}

      {!error &&
        (loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {items.map((item) => {
                const isExpanded = expandedId === item.id;
                const repullResult = repullResults[item.id];
                const repullError = repullErrors[item.id];
                const isBusy = busyId === item.id;
                const canResolve = Boolean(repullResult) || item.has_pull === 1;

                return (
                  <div key={item.id} className="bg-white rounded-[6px] border border-gray-200 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <a
                          href={`/building/${item.building_slug}#public-records`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-teal-700 hover:text-teal-800"
                        >
                          {item.building_address}
                        </a>
                        <p className="text-sm text-gray-500 mt-1">
                          {kindLabel(item.record_kind)} &middot; filed {formatDate(item.created_at)} &middot;{' '}
                          {item.status}
                          {item.resolution ? ` (${RESOLUTION_LABELS[item.resolution]})` : ''}
                        </p>
                        <p className="whitespace-pre-wrap text-sm text-gray-700 mt-2">{item.claim}</p>
                        {item.resolution_notes && (
                          <p className="text-sm text-gray-600 mt-2">Note: {item.resolution_notes}</p>
                        )}
                      </div>
                      {item.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => toggleExpand(item.id)}
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? 'Close' : 'Open'} ${item.building_address}`}
                          className="px-3 py-1.5 text-sm font-medium rounded-[4px] bg-gray-100 text-gray-700 hover:bg-gray-200 shrink-0"
                        >
                          {isExpanded ? 'Close' : 'Open'}
                        </button>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t border-gray-200 space-y-4">
                        <button
                          type="button"
                          onClick={() => runRepull(item.id)}
                          disabled={isBusy}
                          className="px-4 py-2 bg-teal-700 rounded-[4px] text-white text-sm font-semibold hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isBusy ? 'Re-pulling…' : 'Re-pull from source'}
                        </button>

                        <div aria-live="polite" className="space-y-2">
                          {repullError && <p className="text-sm text-red-700">{repullError}</p>}
                          {repullResult &&
                            (() => {
                              const lines = diffLines(repullResult.diff);
                              const shown = lines.slice(0, MAX_DIFF_LINES);
                              return (
                                <div className="space-y-2">
                                  <p className="text-sm text-gray-700">
                                    Parcel: {repullResult.summary.parcelId ?? 'unknown'}
                                    {repullResult.summary.condominium ? ' (condominium)' : ''}
                                  </p>
                                  <p className="text-sm text-gray-700">
                                    Added {repullResult.diff.added.length}, removed{' '}
                                    {repullResult.diff.removed.length}, changed {repullResult.diff.changed.length}.
                                  </p>
                                  {shown.length > 0 && (
                                    <pre className="font-mono text-xs bg-gray-50 border border-gray-200 rounded-[4px] p-2 overflow-x-auto">
                                      {shown.join('\n')}
                                      {lines.length > MAX_DIFF_LINES
                                        ? `\n… showing first ${MAX_DIFF_LINES} of ${lines.length}`
                                        : ''}
                                    </pre>
                                  )}
                                  {repullResult.summary.sources
                                    .filter((s) => s.error)
                                    .map((s) => (
                                      <p key={s.label} className="text-sm text-red-700">
                                        {s.label}: {s.error}
                                      </p>
                                    ))}
                                </div>
                              );
                            })()}
                        </div>

                        <div>
                          <label
                            htmlFor={`resolution-${item.id}`}
                            className="block text-sm font-medium text-gray-700 mb-2"
                          >
                            Resolution
                          </label>
                          <select
                            id={`resolution-${item.id}`}
                            value={resolution}
                            onChange={(e) => setResolution(e.target.value as CorrectionResolution)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          >
                            {CORRECTION_RESOLUTIONS.map((r) => (
                              <option key={r} value={r}>
                                {RESOLUTION_LABELS[r]}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label htmlFor={`notes-${item.id}`} className="block text-sm font-medium text-gray-700 mb-2">
                            Notes
                          </label>
                          <textarea
                            id={`notes-${item.id}`}
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={3}
                            placeholder={
                              resolution === 'source_mismatch_noted'
                                ? 'Public note shown under the section (required)'
                                : 'Private note (optional)'
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          />
                        </div>

                        <div aria-live="polite">
                          {resolveError && <p className="text-sm text-red-700">{resolveError}</p>}
                        </div>

                        <button
                          type="button"
                          onClick={() => resolveCorrection(item.id)}
                          disabled={!canResolve || resolveBusy === item.id}
                          className="px-6 py-2 bg-teal-700 rounded-[4px] text-white text-sm font-semibold hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {resolveBusy === item.id ? 'Resolving…' : 'Resolve'}
                        </button>
                        {!canResolve && (
                          <p className="text-sm text-gray-500">
                            Re-pull before resolving. The re-pull is the resolution; this form only records which
                            outcome it produced.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {items.length === 0 && (
              <div className="text-center py-12 text-gray-500 bg-white rounded-[6px] border border-gray-200">
                No corrections found.
              </div>
            )}
          </>
        ))}
    </div>
  );
}
