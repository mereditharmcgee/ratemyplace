import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecordsQueueFixtureResult, RecordsQueueParkedRow, RecordsQueueStats } from '../../lib/api-types';

/** The queue moves on a one-minute Worker tick, so a one-minute poll is as fresh as the data gets. */
const POLL_INTERVAL_MS = 60_000;

/**
 * A copy of `LOCK_TTL_SECONDS` from lib/records/queue.ts rather than an import: that module
 * is the queue's SQL, and this panel is a client island — the same reason `RecordsQueueStats`
 * is mirrored in api-types instead of imported from there. recordsQueuePanel.test.tsx asserts
 * this equals the exported constant, so the copy cannot drift silently.
 */
export const RETRY_LOCK_TTL_SECONDS = 1800;

/** Shown on a running row's Retry button, inline when it is pressed anyway, and on a 409. */
const STILL_RUNNING = 'Pull still running; retry after its lease expires';

/**
 * True while the claim that parked this row may still be pulling. `attempts` counts CLAIMS,
 * so a row crosses its attempt limit at the moment of its last claim and lands in this list
 * with the pull still in flight; retrying then would queue a second pull of the same
 * building alongside the first. The endpoint refuses that, and the button says so first.
 */
function isRunning(row: RecordsQueueParkedRow, nowSeconds: number): boolean {
  return row.locked_at !== null && nowSeconds - row.locked_at < RETRY_LOCK_TTL_SECONDS;
}

/** Enough of a stack-trace-free error to recognize it; the full text stays in the `title`. */
const MAX_ERROR_CHARS = 120;

const LOAD_ERROR = 'Could not load the queue';

/** Shown over numbers that are still on screen because a later poll failed, not because they are fresh. */
const REFRESH_ERROR = "Couldn't refresh the queue; showing the last good numbers";

const REASON_LABELS: Array<[keyof RecordsQueueStats['pendingByReason'], string]> = [
  ['button', 'Button'],
  ['follower', 'Follower'],
  ['refresh', 'Refresh'],
  ['fill', 'Fill'],
];

/**
 * The part of the scheduler's `app_settings.records_fixture_last` this panel renders.
 * Derived from the shared type so the two cannot drift, and parsed defensively anyway:
 * a settings row written by a newer scheduler must degrade to "not run yet" rather than
 * throw the panel away.
 */
type LastFixture = Pick<RecordsQueueFixtureResult, 'at' | 'failures' | 'checksTotal' | 'failed' | 'sourceErrors'>;

function parseFixture(value: unknown): LastFixture | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.at !== 'number' || typeof raw.failures !== 'number') return null;
  // The pass line names this number out loud ("all 9 checks passed"), so a row without it
  // is a row this panel cannot describe honestly.
  if (typeof raw.checksTotal !== 'number') return null;

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

  return { at: raw.at, failures: raw.failures, checksTotal: raw.checksTotal, failed, sourceErrors };
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
  if (fixture.failures === 0) return `Fixture: all ${fixture.checksTotal} checks passed at ${formatDate(fixture.at)}`;
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
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);

  /**
   * Whether a load has ever succeeded. A ref, not state: `load` is built once and reads this
   * from inside its own closure, where a state value would be the one captured on first render.
   */
  const hasData = useRef(false);

  /**
   * A dropped poll must not replace a panel that is still telling the truth. Before the first
   * successful load there is nothing to keep, so the failure IS the panel; after one, the
   * numbers stay and a banner says they are the last good ones.
   */
  const reportLoadFailure = useCallback(() => {
    if (hasData.current) setRefreshError(REFRESH_ERROR);
    else setError(LOAD_ERROR);
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/records/queue');
      const payload = await response.json();
      if (!response.ok) {
        // The endpoint's own message describes a server-side failure; the panel says
        // the one thing the admin can act on instead.
        reportLoadFailure();
        return;
      }
      // Success is a `{ data }` envelope (AGENTS.md); failures are a bare `{ error }`.
      const data = (payload?.data ?? {}) as {
        stats?: RecordsQueueStats;
        parked?: unknown;
        lastFixture?: unknown;
      };
      setStats(data.stats ?? null);
      setParked(Array.isArray(data.parked) ? (data.parked as RecordsQueueParkedRow[]) : []);
      setLastFixture(parseFixture(data.lastFixture));
      hasData.current = true;
      setError(null);
      setRefreshError(null);
    } catch {
      reportLoadFailure();
    } finally {
      setLoading(false);
    }
  }, [reportLoadFailure]);

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
      const payload = await response.json();
      if (!response.ok) {
        setActionError(paused ? 'Could not pause the fill' : 'Could not resume the fill');
        return;
      }
      const next = (payload?.data as { stats?: RecordsQueueStats } | undefined)?.stats;
      if (next) setStats(next);
    } catch {
      setActionError(paused ? 'Could not pause the fill' : 'Could not resume the fill');
    } finally {
      setPauseBusy(false);
    }
  };

  const retryRow = async (row: RecordsQueueParkedRow, running: boolean) => {
    // The endpoint would 409 this, but a POST that can only be refused is not worth sending:
    // the panel already holds the lease that decides it.
    if (running) {
      setActionError(STILL_RUNNING);
      return;
    }
    const id = row.id;
    setRetryingId(id);
    setActionError(null);
    try {
      const response = await fetch('/api/admin/records/queue/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const payload = await response.json();
      if (!response.ok) {
        // 409 is the one failure the admin can do something about — wait for the lease to
        // expire — so it says so. Everything else (403, 415, 500) is a generic failure.
        if (response.status === 409) setActionError(STILL_RUNNING);
        else if (payload?.error === 'Queue row not found') setActionError('That row is no longer in the queue');
        else setActionError('Could not retry that row');
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

  // Read once per render, and a render happens on every poll — a lease that expires between
  // two polls unlocks its Retry button up to a minute later, which is the same minute the
  // queue itself moves in.
  const nowSeconds = Math.floor(Date.now() / 1000);

  return (
    <div className="space-y-4">
      {refreshError && (
        <div
          role="status"
          className="rounded-[6px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 flex items-center justify-between gap-4"
        >
          <span>{refreshError}</span>
          <button
            type="button"
            onClick={() => {
              void load();
            }}
            className="h-11 px-4 text-sm font-medium rounded-[4px] bg-amber-100 text-amber-900 hover:bg-amber-200 shrink-0"
          >
            Try again
          </button>
        </div>
      )}

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
                {parked.map((row) => {
                  const running = isRunning(row, nowSeconds);
                  return (
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
                    <td className="py-2 pr-4 text-gray-700">
                      {row.reason}
                      {running && (
                        <span className="ml-2 inline-block rounded-[4px] bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                          running
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-gray-700">{row.attempts}</td>
                    <td className="py-2 pr-4 text-gray-700 max-w-md">
                      {row.last_error ? (
                        <span title={row.last_error}>{truncate(row.last_error, MAX_ERROR_CHARS)}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-gray-700 whitespace-nowrap">
                      {formatAge(nowSeconds - row.requested_at)}
                    </td>
                    <td className="py-2">
                      {/* A running row is refused with aria-disabled rather than `disabled`: a
                          disabled button leaves the tab order, so a keyboard admin cannot reach
                          the one control that would tell them why nothing is happening. */}
                      <button
                        type="button"
                        onClick={() => {
                          void retryRow(row, running);
                        }}
                        disabled={retryingId === row.id}
                        aria-disabled={running}
                        title={running ? STILL_RUNNING : undefined}
                        aria-label={`${retryingId === row.id ? 'Retrying' : 'Retry'} ${row.address}`}
                        className={`h-11 px-4 rounded-[4px] bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed${
                          running ? ' opacity-50 cursor-not-allowed' : ''
                        }`}
                      >
                        {retryingId === row.id ? 'Retrying…' : 'Retry'}
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
