import { useCallback, useEffect, useState } from 'react';
import type { RecordsQueueParkedRow, RecordsQueueStats } from '../../lib/api-types';

/** The queue moves on a one-minute Worker tick, so a one-minute poll is as fresh as the data gets. */
const POLL_INTERVAL_MS = 60_000;

/** Enough of a stack-trace-free error to recognize it; the full text stays in the `title`. */
const MAX_ERROR_CHARS = 120;

const LOAD_ERROR = 'Could not load the queue';

const REASON_LABELS: Array<[keyof RecordsQueueStats['pendingByReason'], string]> = [
  ['button', 'Button'],
  ['follower', 'Follower'],
  ['refresh', 'Refresh'],
  ['fill', 'Fill'],
];

/**
 * What the scheduler stamps into `app_settings.records_fixture_last` after each daily
 * plan run. Parsed defensively: a settings row written by a newer scheduler must degrade
 * to "not run yet" rather than throw the panel away.
 */
interface LastFixture {
  at: number;
  failures: number;
  failed: string[];
  sourceErrors: Array<{ label: string; message: string }>;
}

function parseFixture(value: unknown): LastFixture | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.at !== 'number' || typeof raw.failures !== 'number') return null;

  const failed = Array.isArray(raw.failed) ? raw.failed.filter((label): label is string => typeof label === 'string') : [];

  const sourceErrors: LastFixture['sourceErrors'] = [];
  if (Array.isArray(raw.sourceErrors)) {
    for (const entry of raw.sourceErrors) {
      if (!entry || typeof entry !== 'object') continue;
      const item = entry as Record<string, unknown>;
      if (typeof item.label !== 'string') continue;
      sourceErrors.push({ label: item.label, message: typeof item.message === 'string' ? item.message : '' });
    }
  }

  return { at: raw.at, failures: raw.failures, failed, sourceErrors };
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Coarse on purpose: the useful question is "minutes, hours, or days behind?". */
function formatAge(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '—';
  if (seconds < 60) return '<1 min';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h`;
  return `${Math.floor(seconds / 86_400)} d`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function fixtureHeadline(fixture: LastFixture | null): string {
  if (!fixture) return 'Fixture: not run yet';
  if (fixture.failures === 0) return `Fixture: all checks passed at ${formatDate(fixture.at)}`;
  return `Fixture: ${fixture.failed.length} check(s) failed, ${fixture.sourceErrors.length} source(s) threw at ${formatDate(fixture.at)}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-gray-600">{label}</dt>
      <dd className="text-2xl font-semibold text-gray-900 mt-1">{value}</dd>
    </div>
  );
}

/**
 * The pull queue at a glance, for `/admin/records`: what is waiting, what has parked
 * itself after too many failures, whether the city-wide fill is running, and how the
 * last circuit-breaker fixture run went. Read-only except for two switches — pause the
 * fill, and retry one parked row.
 */
export default function RecordsQueuePanel() {
  const [stats, setStats] = useState<RecordsQueueStats | null>(null);
  const [parked, setParked] = useState<RecordsQueueParkedRow[]>([]);
  const [lastFixture, setLastFixture] = useState<LastFixture | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/records/queue');
      const data = await response.json();
      if (!response.ok) {
        // The endpoint's own message describes a server-side failure; the panel says
        // the one thing the admin can act on instead.
        setError(LOAD_ERROR);
        return;
      }
      setStats(data.stats as RecordsQueueStats);
      setParked(Array.isArray(data.parked) ? (data.parked as RecordsQueueParkedRow[]) : []);
      setLastFixture(parseFixture(data.lastFixture));
      setError(null);
    } catch {
      setError(LOAD_ERROR);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const togglePause = async () => {
    if (!stats) return;
    const paused = !stats.fillPaused;
    setPauseBusy(true);
    setActionError(null);
    try {
      const response = await fetch('/api/admin/records/queue/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused }),
      });
      const data = await response.json();
      if (!response.ok) {
        setActionError(paused ? 'Could not pause the fill' : 'Could not resume the fill');
        return;
      }
      setStats(data.stats as RecordsQueueStats);
    } catch {
      setActionError(paused ? 'Could not pause the fill' : 'Could not resume the fill');
    } finally {
      setPauseBusy(false);
    }
  };

  const retryRow = async (id: number) => {
    setRetryingId(id);
    setActionError(null);
    try {
      const response = await fetch('/api/admin/records/queue/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await response.json();
      if (!response.ok) {
        setActionError(data?.error === 'Queue row not found' ? 'That row is no longer in the queue' : 'Could not retry that row');
        return;
      }
      // Re-fetch rather than trusting the returned stats alone: the row has to leave
      // the parked list, and that list only comes from the GET.
      await load();
    } catch {
      setActionError('Could not retry that row');
    } finally {
      setRetryingId(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-[6px] border border-gray-200 bg-white p-6">
        <div className="flex justify-center py-6">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[6px] border border-red-200 bg-red-50 p-6 text-red-700 flex items-center justify-between gap-4">
        <span>{error}</span>
        <button
          type="button"
          onClick={() => {
            void load();
          }}
          className="h-11 px-4 text-sm font-medium rounded-[4px] bg-red-100 text-red-800 hover:bg-red-200 shrink-0"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[6px] border border-gray-200 bg-white p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-base font-semibold text-gray-900">{stats?.fillPaused ? 'Fill paused' : 'Fill running'}</p>
            <p className="text-sm text-gray-600 mt-1">
              Button, follower, and refresh pulls run either way. Only the city-wide fill pauses.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void togglePause();
            }}
            disabled={pauseBusy}
            className="h-11 px-6 rounded-[4px] bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            {stats?.fillPaused ? 'Resume fill' : 'Pause fill'}
          </button>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
          {REASON_LABELS.map(([reason, label]) => (
            <Stat key={reason} label={label} value={String(stats?.pendingByReason?.[reason] ?? 0)} />
          ))}
          <Stat label="Parked" value={String(stats?.parked ?? 0)} />
          <Stat label="Completed (24 h)" value={String(stats?.completedLast24h ?? 0)} />
          <Stat label="Oldest pending" value={formatAge(stats?.oldestPendingAgeSeconds ?? null)} />
        </dl>

        <div className="border-t border-gray-200 pt-4">
          <p className="text-sm text-gray-700">{fixtureHeadline(lastFixture)}</p>
          {lastFixture && lastFixture.failures > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-gray-600 list-disc list-inside">
              {lastFixture.failed.map((label) => (
                <li key={`check-${label}`}>{label}</li>
              ))}
              {lastFixture.sourceErrors.map((source) => (
                <li key={`source-${source.label}`}>
                  {source.label}
                  {source.message ? `: ${source.message}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div aria-live="polite">{actionError && <p className="text-sm text-red-700">{actionError}</p>}</div>
      </div>

      <div className="rounded-[6px] border border-gray-200 bg-white p-6">
        <h3 className="text-base font-semibold text-gray-900">Parked</h3>
        <p className="text-sm text-gray-600 mt-1">
          Pulls that used up their attempts. Retry puts one back in the queue.
        </p>

        {parked.length === 0 ? (
          <p className="text-sm text-gray-500 mt-4">No parked rows</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600 border-b border-gray-200">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Building
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Reason
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Attempts
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Last error
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Requested
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {parked.map((row) => (
                  <tr key={row.id} className="border-b border-gray-100 align-top">
                    <td className="py-2 pr-4">
                      <a
                        href={`/building/${row.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-teal-700 hover:text-teal-800"
                      >
                        {row.address}
                      </a>
                    </td>
                    <td className="py-2 pr-4 text-gray-700">{row.reason}</td>
                    <td className="py-2 pr-4 text-gray-700">{row.attempts}</td>
                    <td className="py-2 pr-4 text-gray-700 max-w-md">
                      {row.last_error ? (
                        <span title={row.last_error}>{truncate(row.last_error, MAX_ERROR_CHARS)}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-gray-700 whitespace-nowrap">{formatDate(row.requested_at)}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => {
                          void retryRow(row.id);
                        }}
                        disabled={retryingId === row.id}
                        aria-label={`Retry ${row.address}`}
                        className="h-11 px-4 rounded-[4px] bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {retryingId === row.id ? 'Retrying…' : 'Retry'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
