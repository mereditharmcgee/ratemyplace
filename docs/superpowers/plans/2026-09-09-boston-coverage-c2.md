# Boston Coverage C2: Queue, Companion Worker, Planner, Circuit Breaker, Admin Controls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the scheduled half of sub-project C: a `records_queue` module, a companion Cron Worker that drains it at a polite rate and runs a daily planner, a circuit breaker that pauses the city-wide fill on fixture failure or a source error spike and emails once, and an admin panel to watch and control it. Deployed with the fill paused; C3 unpauses.

**Architecture:** All logic lives in `src/lib/records/` as pure functions over the `RecordsDb` interface with injected clock, fetch, pull, and alert dependencies, so it is unit-tested on the existing `node:sqlite` D1 double. The Worker in `workers/records-scheduler/` is a thin `scheduled()` handler that builds the dependency bag from its bindings and calls `drain` or `plan`. The Pages site does not change except for two admin API routes and one admin panel.

**Tech Stack:** TypeScript, Vitest, Cloudflare Workers (Cron Triggers, D1 binding, `nodejs_compat`), wrangler 4, Resend via the existing `email.ts`, React island for the admin panel.

**Spec:** `docs/superpowers/specs/2026-09-08-boston-coverage-design.md` Sections 2, 3, 7. **Prerequisites already true:** migration 0031 is on production (queue and settings tables exist), the seed has run (38,208 seeded buildings), the account is on Workers Paid (5 min CPU, 10,000 subrequests per invocation).

**Facts the plan relies on (verified 2026-09-09):**
- `record_pulls` has `trigger_reason TEXT` (0031); `triggered_by` is a `users(id)` FK and stays NULL for non-admin pulls.
- `pullBuildingRecords(db, building, { triggeredBy, correctionId?, fetchImpl? })` in `src/lib/records/pull.ts` writes one `record_pulls` row per source; `PULL_INSERT_SQL` there lists the columns explicitly.
- `sourcesForCity('Boston')` in `jurisdictions.ts` returns every Boston `RecordSource` (id, label, kinds, run). The assessor sources have `kinds: ['assessment']`; every other source is "deeper".
- `ASSESSOR_YEARS` in the assessor adapter lists the six assessor resource ids.
- `scripts/records-fixture-check.ts` runs the Lanark fixture with a `check(label, ok, detail)` collector; it is a script, not a module.
- Test helpers: `createRecordsTestDb()`, `insertBuilding()` in `src/lib/__tests__/helpers/recordsDb.ts` (stub `buildings`, `users`, `rate_limits`, `audit_logs`; applies 0029–0031). Tests live in `src/lib/__tests__/` and must be named `records*.test.ts` so `npx vitest run records` finds them. The stub has no `reviews` or `saved_buildings` table; Task 3 adds minimal ones to the stub.
- `email.ts` senders take `(apiKey, ...)` and return `EmailResult`; `logError(event, context)` in `logger.ts`.
- Admin routes check `context.locals.user?.isAdmin` and return JSON via a local `json()` helper; see `src/pages/api/admin/records/corrections/index.ts`.
- `vitest.config.ts` includes only `src/**/*.test.{ts,tsx}`; `tsconfig.json` includes `**/*`, so `npm run check` type-checks `workers/` too. Import types from `@cloudflare/workers-types` with `import type`, never a global `/// <reference>`, or the DOM lib conflicts.
- The site's wrangler config is `wrangler.jsonc` (Pages, `pages_build_output_dir`); the Worker gets its own config file and must not be picked up by the Pages build.

**Conventions:** TDD; `npm test`, `npm run check`, `npm run build` before each commit; commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; no `any`; no new SQL by interpolation against D1 (bind everything); every user-visible string the public panel might show stays in `display.ts` (C2 adds none to the public panel). Branch `feat/boston-coverage-c2` from `origin/main`.

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/records/pull.ts` | Modify: `PullOptions.triggerReason`, written to `record_pulls.trigger_reason` |
| `src/pages/api/admin/buildings/[id]/records/pull.ts`, `src/pages/api/admin/records/corrections/[id]/repull.ts` | Modify: pass `triggerReason: 'admin'` / `'correction'` |
| `src/lib/records/fixture.ts` | Create: `runLanarkFixture(fetchImpl)` returning structured checks |
| `scripts/records-fixture-check.ts` | Modify: thin printer over `runLanarkFixture` |
| `src/lib/records/queue.ts` | Create: enqueue, claim, complete, fail, planner selectors, breaker inputs, settings, stats |
| `src/lib/records/scheduler.ts` | Create: `drain(deps)`, `plan(deps)`, `DEEPER_SOURCE_IDS`, rate constants |
| `src/lib/email.ts` | Modify: `sendRecordsBreakerEmail` |
| `src/lib/__tests__/helpers/recordsDb.ts` | Modify: stub `reviews` and `saved_buildings` tables |
| `workers/records-scheduler/wrangler.jsonc`, `workers/records-scheduler/src/index.ts` | Create: the Worker |
| `package.json` | Modify: `records:worker`, `records:worker:deploy` scripts |
| `src/pages/api/admin/records/queue/index.ts`, `.../queue/pause.ts`, `.../queue/retry.ts` | Create: admin API |
| `src/lib/api-types.ts` | Modify: `RecordsQueueStats`, `RecordsQueueRow` |
| `src/components/admin/RecordsQueuePanel.tsx`, `src/pages/admin/records.astro` | Create/modify: admin panel |
| `docs/runbooks/records-scheduler.md`, `AGENTS.md`, `src/lib/AGENTS.md`, `migrations/AGENTS.md`, the spec, `.planning/milestones/v1.7.0-ROADMAP.md` | Docs |

---

### Task 1: `trigger_reason` on every pull

**Files:**
- Modify: `src/lib/records/pull.ts`
- Modify: `src/pages/api/admin/buildings/[id]/records/pull.ts`
- Modify: `src/pages/api/admin/records/corrections/[id]/repull.ts`
- Test: `src/lib/__tests__/recordsPull.test.ts` (existing; add a case)

- [ ] **Step 1: Write the failing test**

Find the existing pull test that inserts a building and runs `pullBuildingRecords` with a fake `fetchImpl` (it exists in `src/lib/__tests__/recordsPull.test.ts`; reuse its fixture and fake fetch). Add:

```ts
it('writes the trigger reason on every pull row and leaves triggered_by null for a non-admin pull', async () => {
  const db = createRecordsTestDb();
  const id = await insertBuilding(db, { parcel_id: '2102098000' });
  await pullBuildingRecords(db, await loadBuilding(db, id), { triggeredBy: null, triggerReason: 'queue:fill', fetchImpl: okFetch });
  const rows = await db.prepare('SELECT DISTINCT trigger_reason, triggered_by FROM record_pulls WHERE building_id = ?').bind(id).all<{ trigger_reason: string | null; triggered_by: string | null }>();
  expect(rows.results).toEqual([{ trigger_reason: 'queue:fill', triggered_by: null }]);
});

it('defaults trigger_reason to admin when an admin id is given and no reason is', async () => {
  const db = createRecordsTestDb();
  await db.prepare("INSERT INTO users (id, email, is_admin) VALUES ('admin1', 'a@x', 1)").run();
  const id = await insertBuilding(db, { parcel_id: '2102098000' });
  await pullBuildingRecords(db, await loadBuilding(db, id), { triggeredBy: 'admin1', fetchImpl: okFetch });
  const row = await db.prepare('SELECT trigger_reason FROM record_pulls WHERE building_id = ? LIMIT 1').bind(id).first<{ trigger_reason: string }>();
  expect(row?.trigger_reason).toBe('admin');
});
```

`loadBuilding` and `okFetch` are whatever the existing test file already uses to build a `BuildingRowForIdentity` and a fake fetch; if it has no such helpers, add them locally in the test.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run recordsPull`
Expected: FAIL, `trigger_reason` is null / `triggerReason` unknown option.

- [ ] **Step 3: Implement**

In `src/lib/records/pull.ts`:

```ts
export interface PullOptions {
  /** Admin user id, or null when no admin is behind the pull (seed, queue). */
  triggeredBy: string | null;
  /**
   * Why the pull ran, stored in record_pulls.trigger_reason: 'admin', 'correction',
   * 'seed', or 'queue:<reason>'. Defaults to 'admin' when triggeredBy is set.
   */
  triggerReason?: string | null;
  correctionId?: string | null;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: FetchLike;
}
```

Add `trigger_reason` to `PULL_INSERT_SQL` (12 columns, 12 placeholders), add `triggerReason: string | null` to `PullRowValues`, bind it last in `pullRowStatement`, and in `pullBuildingRecords` compute `const triggerReason = options.triggerReason ?? (options.triggeredBy ? 'admin' : null);` and include it in `base`.

In the admin pull endpoint pass `triggerReason: 'admin'`; in the correction re-pull endpoint pass `triggerReason: 'correction'` (both already pass `triggeredBy`).

- [ ] **Step 4: Run tests, commit**

Run: `npx vitest run records` then `npm test`
Expected: PASS.

```bash
git add src/lib/records/pull.ts src/pages/api/admin/buildings/[id]/records/pull.ts src/pages/api/admin/records/corrections/[id]/repull.ts src/lib/__tests__/recordsPull.test.ts
git commit -m "feat(records): record why a pull ran in record_pulls.trigger_reason"
```

---

### Task 2: The Lanark fixture as a library

**Files:**
- Create: `src/lib/records/fixture.ts`
- Modify: `scripts/records-fixture-check.ts`
- Test: `src/lib/__tests__/recordsFixture.test.ts`

The circuit breaker runs the same checks the script runs. Move the checks into a function that returns data; the script prints it.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/recordsFixture.test.ts
import { describe, expect, it } from 'vitest';
import { LANARK_FIXTURE, runLanarkFixture } from '../records/fixture';
import type { FetchLike } from '../records/types';

/** A fetch that answers every CKAN call with an empty result set. */
const emptyFetch: FetchLike = async () =>
  new Response(JSON.stringify({ success: true, result: { records: [] } }), { status: 200 });

describe('runLanarkFixture', () => {
  it('names the fixture parcel and address', () => {
    expect(LANARK_FIXTURE.parcelId).toBe('2102098000');
    expect(LANARK_FIXTURE.address).toBe('23-27 Lanark Rd, Boston, MA 02135');
  });

  it('returns one check per assertion and counts failures without throwing', async () => {
    const result = await runLanarkFixture(emptyFetch);
    expect(result.checks.length).toBeGreaterThanOrEqual(12);
    expect(result.checks.every((c) => typeof c.label === 'string' && typeof c.ok === 'boolean' && typeof c.detail === 'string')).toBe(true);
    // Empty responses fail the parcel resolution and every value check.
    expect(result.failures).toBeGreaterThan(0);
    expect(result.checks.find((c) => c.label === 'parcel resolves to 2102098000')?.ok).toBe(false);
  });

  it('reports a source that throws as a failed check, not an exception', async () => {
    const throwingFetch: FetchLike = async () => {
      throw new Error('boom');
    };
    const result = await runLanarkFixture(throwingFetch);
    expect(result.failures).toBeGreaterThan(0);
    expect(result.sourceErrors.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run recordsFixture`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `src/lib/records/fixture.ts` by moving the body of `main()` from `scripts/records-fixture-check.ts` into:

```ts
import { buildIdentity } from './identity';
import { resolveParcel } from './sources/boston/assessor';
import { sourcesForCity } from './jurisdictions';
import type { AssessmentPayload, BuildingIdentity, EnforcementTicketPayload, FetchLike, RecordRow, ServiceRequestPayload } from './types';

export interface FixtureCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export interface FixtureResult {
  checks: FixtureCheck[];
  failures: number;
  /** Sources whose run() threw, by label. A thrown source is a failure in its own right. */
  sourceErrors: Array<{ label: string; message: string }>;
  parcelId: string | null;
}

/** 23-27 Lanark Rd, Brighton: the one address every Boston adapter is verified against. */
export const LANARK_FIXTURE = {
  address: '23-27 Lanark Rd, Boston, MA 02135',
  parcelId: '2102098000',
} as const;

/**
 * Runs every Boston source for the Lanark fixture and compares the results to values
 * recorded in September 2026. Never throws: a source that fails becomes a failed check.
 * Used by `npm run records:check` (prints) and by the scheduler's daily circuit breaker.
 */
export async function runLanarkFixture(fetchImpl: FetchLike): Promise<FixtureResult> {
  const checks: FixtureCheck[] = [];
  const sourceErrors: FixtureResult['sourceErrors'] = [];
  const check = (label: string, ok: boolean, detail: string): void => {
    checks.push({ label, ok, detail });
  };
  // ... the existing main() body, with `console.log` calls removed, `check` writing to the
  // array, `failures += 1` on a source failure replaced by sourceErrors.push(...), and the
  // same rowsForOrFail / assessmentRows / enforcementRows / serviceRequestRows helpers.
  // Keep every check label and expected value exactly as the script has them today.
  const failures = checks.filter((c) => !c.ok).length + sourceErrors.length;
  return { checks, failures, sourceErrors, parcelId: identity.parcelId };
}
```

Keep the same check labels and expected values (owner `/LANARK ROAD LLC/`, mailStreet `PO BOX 35006`, landUse `A`, yearRemodel `1980`, totalValue `6720200`, six assessment years, zero permits, no violations, enforcement two cases / 2008 / 1505 Commonwealth, 311 total ≥ 90 and housing 3–8, RentSmart rows present, SAM primary point). Wrap `resolveParcel` in try/catch: a thrown resolution becomes a failed "parcel resolves" check with the message as detail, and every later check runs against an identity with `parcelId: null`.

Rewrite `scripts/records-fixture-check.ts` to:

```ts
import { runLanarkFixture } from '../src/lib/records/fixture';
import type { FetchLike } from '../src/lib/records/types';

const fetchImpl: FetchLike = (input, init) => fetch(input, init);

async function main(): Promise<void> {
  const result = await runLanarkFixture(fetchImpl);
  for (const err of result.sourceErrors) console.log(`${err.label}: FAILED — ${err.message}`);
  for (const c of result.checks) console.log(c.ok ? `PASS ${c.label}` : `FAIL ${c.label} — ${c.detail}`);
  console.log('');
  console.log(result.failures === 0 ? 'ALL PASS' : `${result.failures} failure(s)`);
  process.exit(result.failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Keep the script's header comment (what the fixture is and how to read a failure).

- [ ] **Step 4: Run the unit test and the live check, commit**

Run: `npx vitest run recordsFixture` then `npm run records:check`
Expected: unit PASS; live check prints the same 16 PASS lines as before plus `ALL PASS`.

```bash
git add src/lib/records/fixture.ts scripts/records-fixture-check.ts src/lib/__tests__/recordsFixture.test.ts
git commit -m "refactor(records): the Lanark fixture check is a library the breaker can call"
```

---

### Task 3: Queue primitives: enqueue, claim, complete, fail

**Files:**
- Create: `src/lib/records/queue.ts`
- Modify: `src/lib/__tests__/helpers/recordsDb.ts` (stub `reviews`, `saved_buildings`)
- Test: `src/lib/__tests__/recordsQueue.test.ts`

- [ ] **Step 1: Extend the stub schema**

In `createRecordsStubDb()` add, after `audit_logs`:

```sql
    CREATE TABLE reviews (
      id TEXT PRIMARY KEY,
      building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE saved_buildings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
```

(Check the real column names in `migrations/` for `saved_buildings` and mirror them; the planner only reads `building_id`.)

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/__tests__/recordsQueue.test.ts
import { describe, expect, it } from 'vitest';
import { claimBatch, completeRow, enqueue, failRow, MAX_ATTEMPTS, LOCK_TTL_SECONDS } from '../records/queue';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';

const NOW = 1_800_000_000;

async function pending(db: ReturnType<typeof createRecordsTestDb>) {
  const rows = await db.prepare('SELECT building_id, reason, priority, attempts, locked_at, done_at FROM records_queue ORDER BY id').all<Record<string, unknown>>();
  return rows.results;
}

describe('enqueue', () => {
  it('inserts one pending row with the reason priority and reports queued', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    expect(await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW })).toEqual({ status: 'queued' });
    expect(await pending(db)).toMatchObject([{ building_id: 'b1', reason: 'fill', priority: 2, attempts: 0 }]);
  });

  it('reports already_queued for a second request of equal or lower priority', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await enqueue(db, { buildingId: 'b1', reason: 'refresh', now: NOW });
    expect(await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW })).toEqual({ status: 'already_queued' });
    expect(await enqueue(db, { buildingId: 'b1', reason: 'refresh', now: NOW })).toEqual({ status: 'already_queued' });
    expect(await pending(db)).toHaveLength(1);
  });

  it('replaces a pending fill row with a button row, in one batch', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW });
    expect(await enqueue(db, { buildingId: 'b1', reason: 'button', now: NOW + 5 })).toEqual({ status: 'queued' });
    expect(await pending(db)).toMatchObject([{ building_id: 'b1', reason: 'button', priority: 0 }]);
  });

  it('allows a new pending row once the previous one is done', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW });
    const [row] = await claimBatch(db, { now: NOW, priorityMax: 2, limit: 1 });
    await completeRow(db, row.id, NOW + 1);
    expect(await enqueue(db, { buildingId: 'b1', reason: 'refresh', now: NOW + 2 })).toEqual({ status: 'queued' });
    expect(await pending(db)).toHaveLength(2);
  });
});

describe('claimBatch', () => {
  it('claims oldest-first within priority and locks the rows', async () => {
    const db = createRecordsTestDb();
    for (const id of ['b1', 'b2', 'b3']) await insertBuilding(db, { id, slug: id });
    await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW });
    await enqueue(db, { buildingId: 'b2', reason: 'button', now: NOW + 1 });
    await enqueue(db, { buildingId: 'b3', reason: 'refresh', now: NOW + 2 });
    const claimed = await claimBatch(db, { now: NOW + 10, priorityMax: 1, limit: 5 });
    expect(claimed.map((r) => r.buildingId)).toEqual(['b2', 'b3']);
    expect(claimed[0].building.address).toBeTruthy();
    const rows = await pending(db);
    expect(rows.filter((r) => r.locked_at !== null)).toHaveLength(2);
  });

  it('skips a row locked less than LOCK_TTL_SECONDS ago and reclaims an older lock', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW });
    expect(await claimBatch(db, { now: NOW, priorityMax: 2, limit: 1 })).toHaveLength(1);
    expect(await claimBatch(db, { now: NOW + 60, priorityMax: 2, limit: 1 })).toHaveLength(0);
    expect(await claimBatch(db, { now: NOW + LOCK_TTL_SECONDS + 1, priorityMax: 2, limit: 1 })).toHaveLength(1);
  });

  it('never claims a parked row (attempts >= MAX_ATTEMPTS)', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW });
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      const [row] = await claimBatch(db, { now: NOW + i * 1000, priorityMax: 2, limit: 1 });
      await failRow(db, row.id, `boom ${i}`);
    }
    expect(await claimBatch(db, { now: NOW + 99_999, priorityMax: 2, limit: 1 })).toHaveLength(0);
    expect(await pending(db)).toMatchObject([{ attempts: MAX_ATTEMPTS, done_at: null }]);
  });

  it('honors priorityMax so a fill-only claim does not take a button row', async () => {
    const db = createRecordsTestDb();
    for (const id of ['b1', 'b2']) await insertBuilding(db, { id, slug: id });
    await enqueue(db, { buildingId: 'b1', reason: 'button', now: NOW });
    await enqueue(db, { buildingId: 'b2', reason: 'fill', now: NOW });
    const fillOnly = await claimBatch(db, { now: NOW, priorityMax: 2, priorityMin: 2, limit: 5 });
    expect(fillOnly.map((r) => r.buildingId)).toEqual(['b2']);
  });
});

describe('completeRow / failRow', () => {
  it('complete sets done_at and clears the lock; fail increments attempts, records the error, clears the lock', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW });
    const [row] = await claimBatch(db, { now: NOW, priorityMax: 2, limit: 1 });
    await failRow(db, row.id, 'x'.repeat(2000));
    let [r] = await pending(db);
    expect(r).toMatchObject({ attempts: 1, locked_at: null, done_at: null });
    const err = await db.prepare('SELECT last_error FROM records_queue WHERE id = ?').bind(row.id).first<{ last_error: string }>();
    expect(err!.last_error.length).toBeLessThanOrEqual(500);
    const [again] = await claimBatch(db, { now: NOW + 2, priorityMax: 2, limit: 1 });
    await completeRow(db, again.id, NOW + 3);
    [r] = await pending(db);
    expect(r).toMatchObject({ locked_at: null, done_at: NOW + 3 });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run recordsQueue`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

```ts
// src/lib/records/queue.ts
import type { RecordsDb } from './types';
import type { BuildingRowForIdentity } from './identity';

export type QueueReason = 'button' | 'follower' | 'refresh' | 'fill';

/** Lower runs first. Button and follower are a person waiting; refresh keeps interest fresh; fill is the city-wide pass. */
export const PRIORITY: Record<QueueReason, number> = { button: 0, follower: 0, refresh: 1, fill: 2 };
/** A lock older than this is a Worker run that died mid-pull; the row is claimable again. */
export const LOCK_TTL_SECONDS = 600;
/** After this many thrown pulls the row is parked for a human. Per-source errors do not count. */
export const MAX_ATTEMPTS = 3;
const MAX_ERROR_LENGTH = 500;

export interface EnqueueInput {
  buildingId: string;
  reason: QueueReason;
  now: number;
}

export interface ClaimOptions {
  now: number;
  /** Highest priority number to claim (inclusive). 1 = button, follower, refresh; 2 = everything. */
  priorityMax: number;
  /** Lowest priority number to claim (inclusive). Defaults to 0. */
  priorityMin?: number;
  limit: number;
}

export interface ClaimedRow {
  id: number;
  buildingId: string;
  reason: QueueReason;
  attempts: number;
  building: BuildingRowForIdentity;
}

interface PendingRow {
  id: number;
  reason: QueueReason;
  priority: number;
}

/**
 * One pending row per building (0031's partial unique index). A request at a better
 * priority than the pending row replaces it in one batch; anything else is a no-op.
 */
export async function enqueue(db: RecordsDb, input: EnqueueInput): Promise<{ status: 'queued' | 'already_queued' }> {
  const priority = PRIORITY[input.reason];
  const pending = await db
    .prepare('SELECT id, reason, priority FROM records_queue WHERE building_id = ? AND done_at IS NULL')
    .bind(input.buildingId)
    .first<PendingRow>();
  const insert = db
    .prepare('INSERT INTO records_queue (building_id, reason, priority, requested_at) VALUES (?, ?, ?, ?)')
    .bind(input.buildingId, input.reason, priority, input.now);
  if (!pending) {
    await insert.run();
    return { status: 'queued' };
  }
  if (priority >= pending.priority) return { status: 'already_queued' };
  await db.batch([db.prepare('DELETE FROM records_queue WHERE id = ? AND done_at IS NULL').bind(pending.id), insert]);
  return { status: 'queued' };
}

/**
 * Claims up to `limit` pending rows in (priority, requested_at) order by setting locked_at
 * with a conditional UPDATE per row, so two overlapping Worker runs cannot both take one.
 * Rows locked within LOCK_TTL_SECONDS and rows at MAX_ATTEMPTS are skipped.
 */
export async function claimBatch(db: RecordsDb, options: ClaimOptions): Promise<ClaimedRow[]> {
  const staleBefore = options.now - LOCK_TTL_SECONDS;
  const candidates = await db
    .prepare(
      'SELECT q.id, q.building_id, q.reason, q.attempts, b.address, b.city, b.state, b.zip_code, b.parcel_id, b.sam_id ' +
        'FROM records_queue q JOIN buildings b ON b.id = q.building_id ' +
        'WHERE q.done_at IS NULL AND q.priority BETWEEN ? AND ? AND q.attempts < ? AND (q.locked_at IS NULL OR q.locked_at < ?) ' +
        'ORDER BY q.priority, q.requested_at, q.id LIMIT ?',
    )
    .bind(options.priorityMin ?? 0, options.priorityMax, MAX_ATTEMPTS, staleBefore, options.limit * 2)
    .all<{ id: number; building_id: string; reason: QueueReason; attempts: number; address: string; city: string | null; state: string | null; zip_code: string | null; parcel_id: string | null; sam_id: string | null }>();
  const claimed: ClaimedRow[] = [];
  for (const row of candidates.results) {
    if (claimed.length >= options.limit) break;
    const result = await db
      .prepare('UPDATE records_queue SET locked_at = ? WHERE id = ? AND done_at IS NULL AND (locked_at IS NULL OR locked_at < ?)')
      .bind(options.now, row.id, staleBefore)
      .run();
    if (!Number(result.meta?.changes ?? 0)) continue;
    claimed.push({
      id: row.id,
      buildingId: row.building_id,
      reason: row.reason,
      attempts: row.attempts,
      building: { id: row.building_id, address: row.address, city: row.city, state: row.state, zip_code: row.zip_code, parcel_id: row.parcel_id, sam_id: row.sam_id },
    });
  }
  return claimed;
}

export async function completeRow(db: RecordsDb, id: number, now: number): Promise<void> {
  await db.prepare('UPDATE records_queue SET done_at = ?, locked_at = NULL WHERE id = ?').bind(now, id).run();
}

export async function failRow(db: RecordsDb, id: number, error: string): Promise<void> {
  const message = error.length > MAX_ERROR_LENGTH ? `${error.slice(0, MAX_ERROR_LENGTH - 1)}…` : error;
  await db
    .prepare('UPDATE records_queue SET attempts = attempts + 1, last_error = ?, locked_at = NULL WHERE id = ?')
    .bind(message, id)
    .run();
}
```

Check `RecordsPreparedStatement` in `types.ts` exposes `run()` returning something with `meta.changes` (the correction-resolve endpoint already relies on `meta.changes`; mirror its access pattern). If the interface lacks `all()`, add it there with the D1 shape `{ results: T[] }`.

- [ ] **Step 5: Run tests, commit**

Run: `npx vitest run recordsQueue records`
Expected: PASS.

```bash
git add src/lib/records/queue.ts src/lib/__tests__/recordsQueue.test.ts src/lib/__tests__/helpers/recordsDb.ts
git commit -m "feat(records): records_queue primitives with conditional-update claims"
```

---

### Task 4: Planner selectors, settings, error rates, stats

**Files:**
- Modify: `src/lib/records/queue.ts`
- Test: `src/lib/__tests__/recordsQueuePlanner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/recordsQueuePlanner.test.ts
import { describe, expect, it } from 'vitest';
import {
  errorRateBySource, getFillPaused, planRefresh, purgeFinished, queueStats, setFillPaused, topUpFill,
  REFRESH_AFTER_SECONDS, FINISHED_RETENTION_SECONDS, FILL_TARGET,
} from '../records/queue';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';

const NOW = 1_800_000_000;
const DAY = 86_400;
const DEEPER = ['permits-res', '311-res'];

async function pull(db: ReturnType<typeof createRecordsTestDb>, buildingId: string, sourceId: string, status: 'ok' | 'empty' | 'error', at: number) {
  await db
    .prepare("INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, row_count, retrieved_at) VALUES (?, ?, 'boston', ?, ?, 'q', ?, 0, ?)")
    .bind(`${buildingId}-${sourceId}-${at}`, buildingId, sourceId, sourceId, status, at)
    .run();
}

async function seeded(db: ReturnType<typeof createRecordsTestDb>, id: string, neighborhood: string, street: string, num: number) {
  await insertBuilding(db, { id, slug: id, city: 'Boston' });
  await db.prepare("UPDATE buildings SET source = 'seed', neighborhood = ?, street_key = ?, st_num_lo = ?, st_num_hi = ? WHERE id = ?").bind(neighborhood, street, num, num, id).run();
}

describe('planRefresh', () => {
  it('enqueues refresh for a reviewed building whose deeper pulls are older than REFRESH_AFTER_SECONDS', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await db.prepare("INSERT INTO reviews (id, building_id, status) VALUES ('r1', 'b1', 'approved')").run();
    await pull(db, 'b1', DEEPER[0], 'ok', NOW - REFRESH_AFTER_SECONDS - 1);
    expect(await planRefresh(db, { now: NOW, deeperSourceIds: DEEPER })).toBe(1);
    const row = await db.prepare("SELECT reason FROM records_queue WHERE building_id = 'b1' AND done_at IS NULL").first<{ reason: string }>();
    expect(row?.reason).toBe('refresh');
  });

  it('counts a saved building and a finished button pull as interest, and ignores a pending or fresh one', async () => {
    const db = createRecordsTestDb();
    for (const id of ['saved', 'pressed', 'fresh', 'nobody']) await insertBuilding(db, { id, slug: id });
    await db.prepare("INSERT INTO saved_buildings (user_id, building_id) VALUES ('u1', 'saved')").run();
    await db.prepare("INSERT INTO records_queue (building_id, reason, priority, requested_at, done_at) VALUES ('pressed', 'button', 0, ?, ?)").bind(NOW - 40 * DAY, NOW - 40 * DAY).run();
    for (const id of ['saved', 'pressed', 'fresh', 'nobody']) await pull(db, id, DEEPER[0], 'ok', NOW - REFRESH_AFTER_SECONDS - 1);
    await pull(db, 'fresh', DEEPER[1], 'ok', NOW - 10);
    await db.prepare("INSERT INTO reviews (id, building_id, status) VALUES ('r2', 'fresh', 'approved')").run();
    expect(await planRefresh(db, { now: NOW, deeperSourceIds: DEEPER })).toBe(2);
    const rows = await db.prepare("SELECT building_id FROM records_queue WHERE reason = 'refresh' ORDER BY building_id").all<{ building_id: string }>();
    expect(rows.results.map((r) => r.building_id)).toEqual(['pressed', 'saved']);
  });

  it('ignores a pending review and a building with no deeper pull at all', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await db.prepare("INSERT INTO reviews (id, building_id, status) VALUES ('r1', 'b1', 'pending')").run();
    await pull(db, 'b1', DEEPER[0], 'ok', NOW - REFRESH_AFTER_SECONDS - 1);
    expect(await planRefresh(db, { now: NOW, deeperSourceIds: DEEPER })).toBe(0);
    await insertBuilding(db, { id: 'b2', slug: 'b2' });
    await db.prepare("INSERT INTO reviews (id, building_id, status) VALUES ('r2', 'b2', 'approved')").run();
    expect(await planRefresh(db, { now: NOW, deeperSourceIds: DEEPER })).toBe(0);
  });
});

describe('topUpFill', () => {
  it('fills up to FILL_TARGET pending fill rows from seeded buildings with no deeper pull, in neighborhood/street/number order', async () => {
    const db = createRecordsTestDb();
    await seeded(db, 's3', 'Dorchester', 'B ST', 5);
    await seeded(db, 's1', 'Allston', 'A ST', 10);
    await seeded(db, 's2', 'Allston', 'A ST', 2);
    await seeded(db, 'pulled', 'Allston', 'A ST', 1);
    await pull(db, 'pulled', DEEPER[0], 'ok', NOW - 1);
    await insertBuilding(db, { id: 'user1', slug: 'user1', city: 'Boston' });
    expect(await topUpFill(db, { now: NOW, deeperSourceIds: DEEPER, target: 2 })).toBe(2);
    const rows = await db.prepare("SELECT building_id FROM records_queue WHERE reason = 'fill' ORDER BY id").all<{ building_id: string }>();
    expect(rows.results.map((r) => r.building_id)).toEqual(['s2', 's1']);
    expect(await topUpFill(db, { now: NOW, deeperSourceIds: DEEPER, target: 2 })).toBe(0);
    expect(await topUpFill(db, { now: NOW, deeperSourceIds: DEEPER, target: 10 })).toBe(1);
    expect(FILL_TARGET).toBe(2000);
  });
});

describe('purgeFinished', () => {
  it('deletes finished refresh and fill rows older than the retention, keeps button rows and pending rows', async () => {
    const db = createRecordsTestDb();
    for (const id of ['a', 'b', 'c', 'd']) await insertBuilding(db, { id, slug: id });
    const old = NOW - FINISHED_RETENTION_SECONDS - 1;
    await db.prepare("INSERT INTO records_queue (building_id, reason, priority, requested_at, done_at) VALUES ('a', 'fill', 2, ?, ?), ('b', 'button', 0, ?, ?), ('c', 'refresh', 1, ?, ?), ('d', 'fill', 2, ?, NULL)").bind(old, old, old, old, NOW - 10, NOW - 10, old).run();
    expect(await purgeFinished(db, { now: NOW })).toBe(1);
    const left = await db.prepare('SELECT building_id FROM records_queue ORDER BY building_id').all<{ building_id: string }>();
    expect(left.results.map((r) => r.building_id)).toEqual(['b', 'c', 'd']);
  });
});

describe('errorRateBySource', () => {
  it('reports attempts and errors per source over the window, ignoring older rows', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    for (let i = 0; i < 5; i += 1) await pull(db, 'b1', 'permits-res', i < 3 ? 'error' : 'ok', NOW - 100 - i);
    await pull(db, 'b1', 'permits-res', 'error', NOW - 2 * DAY);
    await pull(db, 'b1', '311-res', 'empty', NOW - 50);
    const rates = await errorRateBySource(db, { now: NOW, windowSeconds: DAY });
    expect(rates).toEqual([
      { sourceId: '311-res', attempts: 1, errors: 0, rate: 0 },
      { sourceId: 'permits-res', attempts: 5, errors: 3, rate: 0.6 },
    ]);
  });
});

describe('fill pause flag and stats', () => {
  it('defaults to not paused, round-trips, and stamps updated_at', async () => {
    const db = createRecordsTestDb();
    expect(await getFillPaused(db)).toBe(false);
    await setFillPaused(db, true, NOW);
    expect(await getFillPaused(db)).toBe(true);
    const row = await db.prepare("SELECT value, updated_at FROM app_settings WHERE key = 'records_fill_paused'").first<{ value: string; updated_at: number }>();
    expect(row).toEqual({ value: '1', updated_at: NOW });
    await setFillPaused(db, false, NOW + 1);
    expect(await getFillPaused(db)).toBe(false);
  });

  it('summarizes the queue for the admin panel', async () => {
    const db = createRecordsTestDb();
    for (const id of ['a', 'b', 'c']) await insertBuilding(db, { id, slug: id });
    await db.prepare("INSERT INTO records_queue (building_id, reason, priority, requested_at, attempts, last_error) VALUES ('a', 'fill', 2, ?, 0, NULL), ('b', 'button', 0, ?, 3, 'boom')").bind(NOW - 500, NOW - 100).run();
    await db.prepare("INSERT INTO records_queue (building_id, reason, priority, requested_at, done_at) VALUES ('c', 'refresh', 1, ?, ?)").bind(NOW - 3000, NOW - 2000).run();
    const stats = await queueStats(db, { now: NOW });
    expect(stats).toEqual({
      pendingByReason: { button: 1, follower: 0, refresh: 0, fill: 1 },
      parked: 1,
      oldestPendingAgeSeconds: 500,
      completedLast24h: 1,
      fillPaused: false,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run recordsQueuePlanner`
Expected: FAIL, missing exports.

- [ ] **Step 3: Implement (append to `queue.ts`)**

```ts
export const REFRESH_AFTER_SECONDS = 30 * 86_400;
export const FINISHED_RETENTION_SECONDS = 90 * 86_400;
export const FILL_TARGET = 2000;
const FILL_PAUSED_KEY = 'records_fill_paused';

interface PlannerOptions {
  now: number;
  /** Every Boston source id except the assessor years; a building "has records" when one of these has a pull row. */
  deeperSourceIds: string[];
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(',');
}

/**
 * Interesting buildings (an approved review, a saved-building row, or a finished button
 * pull) whose latest deeper pull is older than REFRESH_AFTER_SECONDS and which have no
 * pending row get a refresh row. Returns the number enqueued.
 */
export async function planRefresh(db: RecordsDb, options: PlannerOptions): Promise<number> {
  const ids = options.deeperSourceIds;
  const rows = await db
    .prepare(
      'SELECT b.id FROM buildings b ' +
        'WHERE (EXISTS (SELECT 1 FROM reviews r WHERE r.building_id = b.id AND r.status = \'approved\') ' +
        '   OR EXISTS (SELECT 1 FROM saved_buildings s WHERE s.building_id = b.id) ' +
        '   OR EXISTS (SELECT 1 FROM records_queue q WHERE q.building_id = b.id AND q.reason = \'button\' AND q.done_at IS NOT NULL)) ' +
        'AND NOT EXISTS (SELECT 1 FROM records_queue p WHERE p.building_id = b.id AND p.done_at IS NULL) ' +
        `AND (SELECT MAX(retrieved_at) FROM record_pulls rp WHERE rp.building_id = b.id AND rp.source_id IN (${placeholders(ids.length)})) < ?`,
    )
    .bind(...ids, options.now - REFRESH_AFTER_SECONDS)
    .all<{ id: string }>();
  for (const row of rows.results) await enqueue(db, { buildingId: row.id, reason: 'refresh', now: options.now });
  return rows.results.length;
}

/**
 * Tops the fill queue up to `target` pending rows from seeded buildings that have never had
 * a deeper pull and have no pending row, ordered so a neighborhood completes together.
 */
export async function topUpFill(db: RecordsDb, options: PlannerOptions & { target?: number }): Promise<number> {
  const target = options.target ?? FILL_TARGET;
  const pending = await db.prepare("SELECT COUNT(*) AS n FROM records_queue WHERE reason = 'fill' AND done_at IS NULL").first<{ n: number }>();
  const room = target - (pending?.n ?? 0);
  if (room <= 0) return 0;
  const ids = options.deeperSourceIds;
  const rows = await db
    .prepare(
      "SELECT b.id FROM buildings b WHERE b.source = 'seed' " +
        'AND NOT EXISTS (SELECT 1 FROM records_queue q WHERE q.building_id = b.id AND q.done_at IS NULL) ' +
        `AND NOT EXISTS (SELECT 1 FROM record_pulls rp WHERE rp.building_id = b.id AND rp.source_id IN (${placeholders(ids.length)})) ` +
        'ORDER BY b.neighborhood, b.street_key, b.st_num_lo, b.id LIMIT ?',
    )
    .bind(...ids, room)
    .all<{ id: string }>();
  for (const row of rows.results) await enqueue(db, { buildingId: row.id, reason: 'fill', now: options.now });
  return rows.results.length;
}

/** Finished refresh and fill rows are bookkeeping; finished button rows are the record that a reader asked. */
export async function purgeFinished(db: RecordsDb, options: { now: number }): Promise<number> {
  const result = await db
    .prepare("DELETE FROM records_queue WHERE done_at IS NOT NULL AND reason IN ('refresh','fill') AND done_at < ?")
    .bind(options.now - FINISHED_RETENTION_SECONDS)
    .run();
  return Number(result.meta?.changes ?? 0);
}

export interface SourceErrorRate {
  sourceId: string;
  attempts: number;
  errors: number;
  rate: number;
}

export async function errorRateBySource(db: RecordsDb, options: { now: number; windowSeconds: number }): Promise<SourceErrorRate[]> {
  const rows = await db
    .prepare(
      "SELECT source_id, COUNT(*) AS attempts, SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors " +
        'FROM record_pulls WHERE retrieved_at >= ? GROUP BY source_id ORDER BY source_id',
    )
    .bind(options.now - options.windowSeconds)
    .all<{ source_id: string; attempts: number; errors: number }>();
  return rows.results.map((r) => ({ sourceId: r.source_id, attempts: r.attempts, errors: r.errors, rate: r.attempts ? r.errors / r.attempts : 0 }));
}

export async function getFillPaused(db: RecordsDb): Promise<boolean> {
  const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(FILL_PAUSED_KEY).first<{ value: string }>();
  return row?.value === '1';
}

export async function setFillPaused(db: RecordsDb, paused: boolean, now: number): Promise<void> {
  await db
    .prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(FILL_PAUSED_KEY, paused ? '1' : '0', now)
    .run();
}

export interface QueueStats {
  pendingByReason: Record<QueueReason, number>;
  parked: number;
  oldestPendingAgeSeconds: number | null;
  completedLast24h: number;
  fillPaused: boolean;
}

export async function queueStats(db: RecordsDb, options: { now: number }): Promise<QueueStats> {
  const byReason = await db
    .prepare('SELECT reason, COUNT(*) AS n FROM records_queue WHERE done_at IS NULL AND attempts < ? GROUP BY reason')
    .bind(MAX_ATTEMPTS)
    .all<{ reason: QueueReason; n: number }>();
  const pendingByReason: Record<QueueReason, number> = { button: 0, follower: 0, refresh: 0, fill: 0 };
  for (const r of byReason.results) pendingByReason[r.reason] = r.n;
  const parked = await db.prepare('SELECT COUNT(*) AS n FROM records_queue WHERE done_at IS NULL AND attempts >= ?').bind(MAX_ATTEMPTS).first<{ n: number }>();
  const oldest = await db.prepare('SELECT MIN(requested_at) AS t FROM records_queue WHERE done_at IS NULL AND attempts < ?').bind(MAX_ATTEMPTS).first<{ t: number | null }>();
  const done = await db.prepare('SELECT COUNT(*) AS n FROM records_queue WHERE done_at >= ?').bind(options.now - 86_400).first<{ n: number }>();
  return {
    pendingByReason,
    parked: parked?.n ?? 0,
    oldestPendingAgeSeconds: oldest?.t == null ? null : options.now - oldest.t,
    completedLast24h: done?.n ?? 0,
    fillPaused: await getFillPaused(db),
  };
}
```

- [ ] **Step 4: Run tests, commit**

Run: `npx vitest run recordsQueue records`
Expected: PASS.

```bash
git add src/lib/records/queue.ts src/lib/__tests__/recordsQueuePlanner.test.ts
git commit -m "feat(records): planner selectors, error rates, pause flag, and queue stats"
```

---

### Task 5: `scheduler.ts`: drain, plan, circuit breaker; breaker email

**Files:**
- Create: `src/lib/records/scheduler.ts`
- Modify: `src/lib/email.ts`
- Test: `src/lib/__tests__/recordsScheduler.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/recordsScheduler.test.ts
import { describe, expect, it, vi } from 'vitest';
import { DEEPER_SOURCE_IDS, FILL_PER_RUN, PRIORITY_PER_RUN, drain, plan, type SchedulerDeps } from '../records/scheduler';
import { enqueue, getFillPaused, setFillPaused } from '../records/queue';
import type { PullSummary } from '../records/types';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';

const NOW = 1_800_000_000;

function deps(db: ReturnType<typeof createRecordsTestDb>, overrides: Partial<SchedulerDeps> = {}): SchedulerDeps & { alerts: string[]; pulled: string[] } {
  const alerts: string[] = [];
  const pulled: string[] = [];
  return {
    db,
    now: () => NOW,
    pull: async (_db, building, options) => {
      pulled.push(`${building.id}:${options.triggerReason}`);
      const summary: PullSummary = { buildingId: building.id, jurisdiction: 'boston', parcelId: null, condominium: false, sources: [] };
      return summary;
    },
    fixture: async () => ({ checks: [], failures: 0, sourceErrors: [], parcelId: '2102098000' }),
    alert: async (subject, body) => {
      alerts.push(`${subject}\n${body}`);
    },
    log: () => undefined,
    alerts,
    pulled,
    ...overrides,
  };
}

describe('drain', () => {
  it('pulls up to PRIORITY_PER_RUN priority rows and FILL_PER_RUN fill rows, stamping queue:<reason>', async () => {
    const db = createRecordsTestDb();
    for (const id of ['p1', 'p2', 'p3', 'p4', 'f1', 'f2']) await insertBuilding(db, { id, slug: id });
    for (const id of ['p1', 'p2', 'p3', 'p4']) await enqueue(db, { buildingId: id, reason: 'button', now: NOW });
    for (const id of ['f1', 'f2']) await enqueue(db, { buildingId: id, reason: 'fill', now: NOW });
    const d = deps(db);
    const result = await drain(d);
    expect(result).toEqual({ pulled: PRIORITY_PER_RUN + FILL_PER_RUN, failed: 0, fillPaused: false });
    expect(d.pulled).toEqual(['p1:queue:button', 'p2:queue:button', 'p3:queue:button', 'f1:queue:fill']);
    const done = await db.prepare('SELECT COUNT(*) AS n FROM records_queue WHERE done_at IS NOT NULL').first<{ n: number }>();
    expect(done?.n).toBe(4);
  });

  it('skips fill rows while paused but still serves priority rows', async () => {
    const db = createRecordsTestDb();
    for (const id of ['p1', 'f1']) await insertBuilding(db, { id, slug: id });
    await enqueue(db, { buildingId: 'p1', reason: 'refresh', now: NOW });
    await enqueue(db, { buildingId: 'f1', reason: 'fill', now: NOW });
    await setFillPaused(db, true, NOW);
    const d = deps(db);
    expect(await drain(d)).toEqual({ pulled: 1, failed: 0, fillPaused: true });
    expect(d.pulled).toEqual(['p1:queue:refresh']);
  });

  it('records a thrown pull as a failed attempt and keeps draining the rest', async () => {
    const db = createRecordsTestDb();
    for (const id of ['p1', 'p2']) await insertBuilding(db, { id, slug: id });
    for (const id of ['p1', 'p2']) await enqueue(db, { buildingId: id, reason: 'button', now: NOW });
    const d = deps(db, {
      pull: async (_db, building) => {
        if (building.id === 'p1') throw new Error('network down');
        return { buildingId: building.id, jurisdiction: 'boston', parcelId: null, condominium: false, sources: [] };
      },
    });
    expect(await drain(d)).toEqual({ pulled: 1, failed: 1, fillPaused: false });
    const row = await db.prepare("SELECT attempts, last_error, done_at FROM records_queue WHERE building_id = 'p1'").first<{ attempts: number; last_error: string; done_at: number | null }>();
    expect(row).toEqual({ attempts: 1, last_error: 'network down', done_at: null });
  });
});

describe('plan', () => {
  it('runs refresh planning, fill top-up, purge, the fixture, and reports numbers', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 's1' });
    await db.prepare("UPDATE buildings SET source = 'seed', neighborhood = 'Allston', street_key = 'A ST', st_num_lo = 1, st_num_hi = 1 WHERE id = 's1'").run();
    const d = deps(db);
    const result = await plan(d);
    expect(result).toMatchObject({ refreshEnqueued: 0, fillEnqueued: 1, purged: 0, fixtureFailures: 0, paused: false, alerted: false });
  });

  it('pauses the fill and alerts once when the fixture fails, and does not alert again while paused', async () => {
    const db = createRecordsTestDb();
    const d = deps(db, { fixture: async () => ({ checks: [{ label: 'parcel resolves to 2102098000', ok: false, detail: 'got null' }], failures: 1, sourceErrors: [], parcelId: null }) });
    const first = await plan(d);
    expect(first).toMatchObject({ paused: true, alerted: true, fixtureFailures: 1 });
    expect(await getFillPaused(db)).toBe(true);
    expect(d.alerts).toHaveLength(1);
    expect(d.alerts[0]).toContain('parcel resolves to 2102098000');
    const second = await plan(d);
    expect(second).toMatchObject({ paused: true, alerted: false });
    expect(d.alerts).toHaveLength(1);
  });

  it('pauses when any source error rate exceeds the threshold with enough attempts, not below it', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    const insert = (status: string, i: number) =>
      db.prepare("INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, row_count, retrieved_at) VALUES (?, 'b1', 'boston', 'permits', 'Permits', 'q', ?, 0, ?)").bind(`p${i}`, status, NOW - i).run();
    for (let i = 0; i < 19; i += 1) await insert('error', i);
    expect(await plan(deps(db))).toMatchObject({ paused: false, alerted: false });
    for (let i = 19; i < 25; i += 1) await insert('error', i);
    const d = deps(db);
    expect(await plan(d)).toMatchObject({ paused: true, alerted: true });
    expect(d.alerts[0]).toContain('permits');
  });

  it('does not unpause by itself once the fixture is healthy again', async () => {
    const db = createRecordsTestDb();
    await setFillPaused(db, true, NOW);
    expect(await plan(deps(db))).toMatchObject({ paused: true, alerted: false });
    expect(await getFillPaused(db)).toBe(true);
  });
});

describe('DEEPER_SOURCE_IDS', () => {
  it('is every Boston source id except the assessor years', () => {
    expect(DEEPER_SOURCE_IDS.length).toBeGreaterThanOrEqual(4);
    expect(DEEPER_SOURCE_IDS).not.toContain('ee73430d-96c0-423e-ad21-c4cfb54c8961');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run recordsScheduler`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/records/scheduler.ts
import { sourcesForCity } from './jurisdictions';
import { pullBuildingRecords, type PullOptions } from './pull';
import {
  claimBatch, completeRow, errorRateBySource, failRow, getFillPaused, planRefresh, purgeFinished, setFillPaused, topUpFill,
  type ClaimedRow,
} from './queue';
import type { FixtureResult } from './fixture';
import type { BuildingRowForIdentity } from './identity';
import type { PullSummary, RecordsDb } from './types';

/** Per minute. Three people-facing rows plus one city-wide row is about 80 requests a minute to the city at most. */
export const PRIORITY_PER_RUN = 3;
export const FILL_PER_RUN = 1;
/** The breaker trips when a source fails more than this share of its attempts in the window, given at least MIN_ATTEMPTS. */
export const ERROR_RATE_THRESHOLD = 0.5;
export const MIN_ATTEMPTS = 20;
export const ERROR_WINDOW_SECONDS = 86_400;
const LAST_ALERT_KEY = 'records_breaker_last_alert';
const LAST_FIXTURE_KEY = 'records_fixture_last';

/** Every Boston source except the assessor years: a building "has records" when one of these has a pull row. */
export const DEEPER_SOURCE_IDS: string[] = sourcesForCity('Boston')
  .filter((s) => !s.kinds.includes('assessment'))
  .map((s) => s.id);

export interface SchedulerDeps {
  db: RecordsDb;
  now: () => number;
  pull: (db: RecordsDb, building: BuildingRowForIdentity, options: PullOptions) => Promise<PullSummary>;
  fixture: () => Promise<FixtureResult>;
  alert: (subject: string, body: string) => Promise<void>;
  log: (event: string, context: Record<string, unknown>) => void;
}

export interface DrainResult {
  pulled: number;
  failed: number;
  fillPaused: boolean;
}

export interface PlanResult {
  refreshEnqueued: number;
  fillEnqueued: number;
  purged: number;
  fixtureFailures: number;
  paused: boolean;
  alerted: boolean;
}

/** The default dependency bag for the Worker; tests build their own. */
export function liveDeps(db: RecordsDb, extra: Pick<SchedulerDeps, 'fixture' | 'alert' | 'log'>): SchedulerDeps {
  return { db, now: () => Math.floor(Date.now() / 1000), pull: pullBuildingRecords, ...extra };
}

async function runRow(deps: SchedulerDeps, row: ClaimedRow): Promise<boolean> {
  try {
    await deps.pull(deps.db, row.building, { triggeredBy: null, triggerReason: `queue:${row.reason}` });
    await completeRow(deps.db, row.id, deps.now());
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failRow(deps.db, row.id, message);
    deps.log('records_queue_pull_failed', { queueId: row.id, buildingId: row.buildingId, reason: row.reason, attempts: row.attempts + 1, error: message });
    return false;
  }
}

/** One cron tick: people-facing rows first, then one fill row unless the fill is paused. */
export async function drain(deps: SchedulerDeps): Promise<DrainResult> {
  const now = deps.now();
  const fillPaused = await getFillPaused(deps.db);
  const rows = await claimBatch(deps.db, { now, priorityMax: 1, limit: PRIORITY_PER_RUN });
  if (!fillPaused) rows.push(...(await claimBatch(deps.db, { now, priorityMin: 2, priorityMax: 2, limit: FILL_PER_RUN })));
  let pulled = 0;
  let failed = 0;
  for (const row of rows) {
    if (await runRow(deps, row)) pulled += 1;
    else failed += 1;
  }
  return { pulled, failed, fillPaused };
}

async function readSetting(db: RecordsDb, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function writeSetting(db: RecordsDb, key: string, value: string, now: number): Promise<void> {
  await db
    .prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, value, now)
    .run();
}

/**
 * The daily tick. Order matters: purge, then refresh, then fill top-up, then the fixture and
 * error rates, so a breaker trip is judged on the day's pulls and stops the fill before the
 * next drain. The breaker only ever pauses; a human unpauses from the admin panel.
 */
export async function plan(deps: SchedulerDeps): Promise<PlanResult> {
  const now = deps.now();
  const purged = await purgeFinished(deps.db, { now });
  const refreshEnqueued = await planRefresh(deps.db, { now, deeperSourceIds: DEEPER_SOURCE_IDS });
  const fillEnqueued = await topUpFill(deps.db, { now, deeperSourceIds: DEEPER_SOURCE_IDS });

  const fixture = await deps.fixture();
  await writeSetting(deps.db, LAST_FIXTURE_KEY, JSON.stringify({ at: now, failures: fixture.failures, failed: fixture.checks.filter((c) => !c.ok).map((c) => c.label), sourceErrors: fixture.sourceErrors }), now);
  const rates = await errorRateBySource(deps.db, { now, windowSeconds: ERROR_WINDOW_SECONDS });
  const tripped = rates.filter((r) => r.attempts >= MIN_ATTEMPTS && r.rate > ERROR_RATE_THRESHOLD);

  const reasons: string[] = [];
  if (fixture.failures > 0) {
    reasons.push(`Lanark fixture: ${fixture.failures} failure(s): ${fixture.checks.filter((c) => !c.ok).map((c) => `${c.label} (${c.detail})`).join('; ')}${fixture.sourceErrors.map((e) => `; ${e.label} threw: ${e.message}`).join('')}`);
  }
  for (const r of tripped) reasons.push(`Source ${r.sourceId}: ${r.errors} of ${r.attempts} pulls failed in the last 24 hours`);

  const wasPaused = await getFillPaused(deps.db);
  let alerted = false;
  if (reasons.length > 0 && !wasPaused) {
    await setFillPaused(deps.db, true, now);
    await deps.alert('RateMyPlace records fill paused', `The city-wide records fill was paused automatically.\n\n${reasons.join('\n')}\n\nButton and refresh pulls keep running. Clear the pause from /admin/records once the cause is understood.`);
    await writeSetting(deps.db, LAST_ALERT_KEY, String(now), now);
    alerted = true;
    deps.log('records_fill_paused', { reasons });
  }
  return { refreshEnqueued, fillEnqueued, purged, fixtureFailures: fixture.failures, paused: reasons.length > 0 || wasPaused, alerted };
}

export const SCHEDULER_SETTING_KEYS = { lastAlert: LAST_ALERT_KEY, lastFixture: LAST_FIXTURE_KEY } as const;
```

Add to `src/lib/email.ts`, following `sendRecordCorrectionOutcomeEmail`'s shape:

```ts
/** One email when the scheduler pauses the city-wide fill. Plain text body; the reasons come from the scheduler. */
export async function sendRecordsBreakerEmail(apiKey: string, toEmail: string, subject: string, body: string): Promise<EmailResult> {
  if (!apiKey) {
    console.error('RESEND_API_KEY not configured');
    return { success: false, error: 'Email service not configured' };
  }
  const resend = new Resend(apiKey);
  try {
    const { data, error } = await resend.emails.send({ from: 'RateMyPlace Boston <noreply@ratemyplace.org>', to: toEmail, subject, text: body });
    if (error) return { success: false, error: error.message };
    return { success: true, messageId: data?.id };
  } catch (err) {
    console.error('Email send exception:', err);
    return { success: false, error: 'Failed to send email' };
  }
}
```

- [ ] **Step 4: Run tests, commit**

Run: `npx vitest run recordsScheduler records email`
Expected: PASS.

```bash
git add src/lib/records/scheduler.ts src/lib/email.ts src/lib/__tests__/recordsScheduler.test.ts
git commit -m "feat(records): scheduler drain, daily planner, and the fill circuit breaker"
```

---

### Task 6: The companion Worker package

**Files:**
- Create: `workers/records-scheduler/wrangler.jsonc`
- Create: `workers/records-scheduler/src/index.ts`
- Create: `workers/records-scheduler/README.md`
- Modify: `package.json`

- [ ] **Step 1: Write the Worker**

```jsonc
// workers/records-scheduler/wrangler.jsonc
{
  "name": "ratemyplace-records-scheduler",
  "main": "src/index.ts",
  "compatibility_date": "2024-12-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "triggers": {
    // Every minute: drain. 06:00 UTC daily: plan (refresh, fill top-up, purge, breaker).
    "crons": ["* * * * *", "0 6 * * *"]
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "ratemyplace-db", "database_id": "7dd2a722-fdd3-4986-b2f7-6d61d069438e" }
  ],
  "vars": {
    "SITE_URL": "https://ratemyplace.org",
    "RECORDS_ALERT_EMAIL": "meredith.ar.mcgee@gmail.com"
  }
  // Secret, set once: npx wrangler secret put RESEND_API_KEY --config workers/records-scheduler/wrangler.jsonc
}
```

```ts
// workers/records-scheduler/src/index.ts
import type { D1Database, ExecutionContext, ScheduledEvent } from '@cloudflare/workers-types';
import { sendRecordsBreakerEmail } from '../../../src/lib/email';
import { runLanarkFixture } from '../../../src/lib/records/fixture';
import { drain, liveDeps, plan, type SchedulerDeps } from '../../../src/lib/records/scheduler';
import type { FetchLike, RecordsDb } from '../../../src/lib/records/types';

interface Env {
  DB: D1Database;
  RESEND_API_KEY: string;
  RECORDS_ALERT_EMAIL: string;
  SITE_URL: string;
}

const PLAN_CRON = '0 6 * * *';

function log(event: string, context: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: 'info', timestamp: new Date().toISOString(), event, ...context }));
}

function depsFor(env: Env): SchedulerDeps {
  const fetchImpl: FetchLike = (input, init) => fetch(input, init);
  // D1Database satisfies RecordsDb structurally (prepare/batch); the cast keeps the Worker
  // types and the site's types from having to agree on the D1 package version.
  const db = env.DB as unknown as RecordsDb;
  return liveDeps(db, {
    fixture: () => runLanarkFixture(fetchImpl),
    alert: async (subject, body) => {
      const result = await sendRecordsBreakerEmail(env.RESEND_API_KEY, env.RECORDS_ALERT_EMAIL, subject, body);
      if (!result.success) log('records_breaker_email_failed', { error: result.error });
    },
    log,
  });
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const deps = depsFor(env);
    const started = Date.now();
    const work = event.cron === PLAN_CRON ? plan(deps).then((r) => log('records_plan', { ...r, ms: Date.now() - started })) : drain(deps).then((r) => log('records_drain', { ...r, ms: Date.now() - started }));
    ctx.waitUntil(work.catch((err) => log('records_scheduler_error', { cron: event.cron, error: err instanceof Error ? err.message : String(err) })));
    await work;
  },
};
```

`README.md` (short): what it is, the two crons, how to run locally, deploy, set the secret, pause/unpause, where logs are.

Add to `package.json` scripts:

```json
"records:worker": "npx wrangler dev --config workers/records-scheduler/wrangler.jsonc --test-scheduled --persist-to .wrangler/state",
"records:worker:deploy": "npx wrangler deploy --config workers/records-scheduler/wrangler.jsonc"
```

- [ ] **Step 2: Type-check and run locally**

Run: `npm run check` (must be clean; `tsconfig.json` includes `workers/`). Then, with the site's local D1 already seeded, in one terminal `npm run records:worker`, and in another:

```bash
curl "http://localhost:8787/__scheduled?cron=*%20*%20*%20*%20*"
curl "http://localhost:8787/__scheduled?cron=0%206%20*%20*%20*"
```

Expected: the second call logs `records_plan` with `fillEnqueued` up to 2000 (the local seed has 38,213 seeded rows with no deeper pulls) and `fixtureFailures: 0` (it hits the live city API); then the first call logs `records_drain` with `pulled: 1, fillPaused: false` and a new `record_pulls` group for one seeded building. Verify with `npx wrangler d1 execute ratemyplace-db --local --command "SELECT reason, COUNT(*) FROM records_queue WHERE done_at IS NULL GROUP BY reason; SELECT trigger_reason, COUNT(*) FROM record_pulls GROUP BY trigger_reason"`.

- [ ] **Step 3: Commit**

```bash
git add workers/records-scheduler package.json
git commit -m "feat(records): companion Worker that drains the queue every minute and plans daily"
```

---

### Task 7: Admin API for the queue

**Files:**
- Create: `src/pages/api/admin/records/queue/index.ts` (GET stats + parked rows)
- Create: `src/pages/api/admin/records/queue/pause.ts` (POST `{ paused: boolean }`)
- Create: `src/pages/api/admin/records/queue/retry.ts` (POST `{ id: number }`)
- Modify: `src/lib/api-types.ts`
- Test: `src/lib/__tests__/recordsQueueAdminRoutes.test.ts` (follow `adminNamedPartyRoutes.test.ts` for how routes are invoked with a fake context)

- [ ] **Step 1: Write the failing test**

Cover: non-admin gets 403 on all three; GET returns `stats`, `parked` (id, building address, slug, reason, attempts, last_error), `lastFixture` (parsed JSON or null); POST pause with a non-JSON content type is 415, with `{paused:true}` sets the flag and returns the new stats; POST retry resets `attempts` and `last_error` for a parked row and 404s for an unknown id.

- [ ] **Step 2: Implement**

Each route: `if (!context.locals.user?.isAdmin) return json({ error: 'Admin access required' }, 403)`; content-type guard on POSTs; `getDB(context)`; call `queueStats`, `setFillPaused`, and a direct `UPDATE records_queue SET attempts = 0, last_error = NULL WHERE id = ? AND done_at IS NULL` (check `meta.changes` for 404). Parked rows query: `SELECT q.id, q.reason, q.attempts, q.last_error, q.requested_at, b.address, b.slug FROM records_queue q JOIN buildings b ON b.id = q.building_id WHERE q.done_at IS NULL AND q.attempts >= ? ORDER BY q.requested_at LIMIT 100`. Add `RecordsQueueStats` (mirror `QueueStats`) and `RecordsQueueParkedRow` to `api-types.ts`. No audit entry: pause, unpause, and retry are non-destructive operational switches; note this in the route comment.

- [ ] **Step 3: Run tests, commit**

```bash
git add src/pages/api/admin/records/queue src/lib/api-types.ts src/lib/__tests__/recordsQueueAdminRoutes.test.ts
git commit -m "feat(admin): records queue stats, pause switch, and retry endpoints"
```

---

### Task 8: Admin queue panel

**Files:**
- Create: `src/components/admin/RecordsQueuePanel.tsx`
- Modify: `src/pages/admin/records.astro`
- Test: `src/lib/__tests__/recordsQueuePanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Testing Library with a stubbed `fetch`: renders the four pending counts, the parked count, "Fill paused" state with a "Resume fill" button when paused and "Pause fill" when not, the last fixture result line ("Fixture: all 16 checks passed at <date>" or the failed labels), a parked-rows table with a "Retry" button per row that POSTs `/api/admin/records/queue/retry` with the id; clicking Pause/Resume POSTs `/api/admin/records/queue/pause` and re-renders from the response.

- [ ] **Step 2: Implement**

Follow `RecordCorrectionsQueue.tsx` for structure and styling (cards `rounded-[6px] border border-gray-200`, teal-700 primary button, `h-11` buttons per the audit conventions). Place `<RecordsQueuePanel client:load />` above `<RecordCorrectionsQueue />` on `records.astro` with an `h2` "Pull queue" and the page `h1` changed to "Public records". The panel polls every 60 s while mounted.

- [ ] **Step 3: Verify in the browser, commit**

Run the site dev server (`npm run dev -- --port 4322` in the worktree) with the admin session cookie `auth_session=auditsession0000000000000000000000000001`, open `/admin/records`, confirm the counts match the local queue and the pause toggle flips `app_settings`.

```bash
git add src/components/admin/RecordsQueuePanel.tsx src/pages/admin/records.astro src/lib/__tests__/recordsQueuePanel.test.tsx
git commit -m "feat(admin): pull-queue panel with pause switch, parked rows, and fixture status"
```

---

### Task 9: Docs, runbook, spec amendment, roadmap, deploy paused

**Files:**
- Create: `docs/runbooks/records-scheduler.md`
- Modify: `AGENTS.md` (Commands table: `records:worker`, `records:worker:deploy`; Traps: the second deployable, the pause flag, never re-pull on demand)
- Modify: `src/lib/AGENTS.md` (queue, scheduler, fixture modules; `trigger_reason` values)
- Modify: `migrations/AGENTS.md` (`app_settings` keys: `records_fill_paused`, `records_breaker_last_alert`, `records_fixture_last`)
- Modify: `docs/superpowers/specs/2026-09-08-boston-coverage-design.md` (Section 3 "as built" block: `trigger_reason` values, no audit rows for pause/retry, `records_fixture_last`, the Worker's `waitUntil` shape, Paid plan confirmed)
- Modify: `.planning/milestones/v1.7.0-ROADMAP.md` (Phase 32 status: C1 shipped 2026-09-09, C2 in progress)

- [ ] **Step 1: Runbook**

`docs/runbooks/records-scheduler.md` covers: what runs when (two crons); first deploy (`npx wrangler secret put RESEND_API_KEY --config workers/records-scheduler/wrangler.jsonc`, then `npm run records:worker:deploy`); confirming the fill is paused before the first deploy (`npx wrangler d1 execute ratemyplace-db --remote --command "INSERT INTO app_settings (key, value) VALUES ('records_fill_paused','1') ON CONFLICT(key) DO UPDATE SET value='1', updated_at=unixepoch()"`); reading logs (`npx wrangler tail --config workers/records-scheduler/wrangler.jsonc`); what the breaker email means and how to unpause; how to retry a parked row; how to stop everything (`npx wrangler delete --config ...` or remove the cron triggers); expected steady-state numbers (about 80 requests a minute to the city at full rate, about 1,440 fill pulls a day, D1 writes about 45,000 rows a day).

- [ ] **Step 2: Deploy paused (owner step, documented, not automated)**

The plan ends with the Worker deployed and the fill paused; C3 unpauses after the site release. The runbook's "first deploy" section is the checklist.

- [ ] **Step 3: Run everything, commit**

Run: `npm test && npm run check && npm run build`
Expected: clean.

```bash
git add docs/runbooks/records-scheduler.md AGENTS.md src/lib/AGENTS.md migrations/AGENTS.md docs/superpowers/specs/2026-09-08-boston-coverage-design.md .planning/milestones/v1.7.0-ROADMAP.md
git commit -m "docs: records scheduler runbook, agent guides, and the C2 spec amendments"
```

---

## Done when

- `npm test`, `npm run check`, `npm run build` clean; `npx vitest run records` includes every new test file.
- `npm run records:worker` plus the two `__scheduled` curls produce one `records_plan` and one `records_drain` log line against the local D1 and leave one new deeper pull group on a seeded building.
- PR opened against `main` titled "Boston coverage C2: queue, companion Worker, planner, circuit breaker". After merge the owner sets the pause flag on production, sets the `RESEND_API_KEY` secret, deploys the Worker, and watches one `records_plan` line in `wrangler tail`.
