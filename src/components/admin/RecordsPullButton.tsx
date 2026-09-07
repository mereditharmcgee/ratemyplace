import { useState } from 'react';

interface RecordsPullButtonProps {
  buildingId: string;
  city: string | null;
}

interface PullSourceSummary {
  sourceId: string;
  label: string;
  status: 'ok' | 'empty' | 'error';
  rowCount: number;
  error?: string;
}

interface PullSummary {
  buildingId: string;
  jurisdiction: string;
  parcelId: string | null;
  condominium: boolean;
  sources: PullSourceSummary[];
}

/** Strip a trailing ", XX" state and lowercase, matching lib/records/jurisdictions.ts's normalizeCity. */
function isBoston(city: string | null): boolean {
  if (!city) return false;
  return city.replace(/,\s*[A-Z]{2}$/i, '').trim().toLowerCase() === 'boston';
}

function parcelLabel(summary: PullSummary): string {
  if (summary.parcelId) return summary.parcelId;
  if (summary.condominium) return 'condominium (no single parcel)';
  return 'not resolved';
}

function sourceLineClass(status: PullSourceSummary['status']): string {
  if (status === 'error') return 'text-red-700';
  if (status === 'ok') return 'text-green-700';
  return 'text-gray-500';
}

function sourceLineText(source: PullSourceSummary): string {
  const capped = source.status === 'ok' && source.rowCount === 500 ? ' (500+, capped)' : '';
  const base = `${source.label}: ${source.status} (${source.rowCount} rows)${capped}`;
  return source.status === 'error' && source.error ? `${base} — ${source.error}` : base;
}

export default function RecordsPullButton({ buildingId, city }: RecordsPullButtonProps) {
  const [parcelOverride, setParcelOverride] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PullSummary | null>(null);

  if (!isBoston(city)) {
    return <p className="text-xs text-gray-500">Public records are available for Boston buildings only.</p>;
  }

  async function pullRecords() {
    setRunning(true);
    setError(null);
    try {
      const trimmed = parcelOverride.trim();
      const response = await fetch(`/api/admin/buildings/${buildingId}/records/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trimmed ? { parcelId: trimmed } : {}),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.details?.[0]?.message || payload.error || 'Failed to pull records');
        return;
      }
      setSummary(payload.data as PullSummary);
    } catch {
      setError('Failed to pull records');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-gray-200">
      <h4 className="text-sm font-medium text-gray-700 mb-2">Public records</h4>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={pullRecords}
          disabled={running}
          className="px-3 py-1.5 bg-teal-700 text-white rounded-[4px] text-xs font-semibold hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running ? 'Pulling records…' : 'Pull records'}
        </button>
        <label className="flex items-center gap-1 text-xs text-gray-500">
          Parcel id override
          <input
            type="text"
            value={parcelOverride}
            onChange={(e) => setParcelOverride(e.target.value)}
            placeholder="10 digits"
            className="border border-gray-300 rounded-[4px] px-2 py-1 text-xs w-28"
          />
        </label>
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      {summary && (
        <div className="mt-2 text-xs space-y-1">
          <p className="text-gray-700">Parcel: {parcelLabel(summary)}</p>
          <ul className="space-y-0.5">
            {summary.sources.map((source) => (
              <li key={source.sourceId} className={sourceLineClass(source.status)}>
                {sourceLineText(source)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
