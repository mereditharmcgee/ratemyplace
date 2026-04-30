# Phase 19: D1 Index Migration - Research

**Researched:** 2026-04-28
**Domain:** Cloudflare D1 / SQLite index planning, wrangler CLI, query plan analysis
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Audit document**
- Location: `.planning/audits/d1-indexes-2026-04-28.md` — full date in filename
- Structure: per-query. Each audited query gets its own H2 section: query name, SQL with `file:line` ref, EXPLAIN QUERY PLAN output BEFORE any index changes, decision (add/skip + reason), EXPLAIN QUERY PLAN output AFTER (only for indexes added)
- EXPLAIN command: `npx wrangler d1 execute ratemyplace-db --remote --command 'EXPLAIN QUERY PLAN <SQL>'`
- Migration file links to audit doc via inline comment near the top
- Audit doc is a snapshot; future re-audits create new files

**Hot-path scope — exactly 5 queries**
1. `/api/search/results` — `buildings LEFT JOIN reviews ... AND r.status = 'approved' GROUP BY b.id HAVING COUNT(r.id) > 0`
2. `/api/search/results` — `landlords LEFT JOIN buildings LEFT JOIN reviews ... AND r.status = 'approved'`
3. `/api/search/autocomplete` — same join pattern as #1 with LIMIT 5
4. `src/lib/rateLimit.ts checkRateLimit()` — `SELECT COUNT(*) FROM rate_limits WHERE rate_key = ? AND created_at > ?`
5. Any building filter query using `WHERE city = ?` or `WHERE building_type = ?` — discovered via grep; if none exist, audit notes this and skips PERF-07 with documented reason

**Indexes to add**

| Index | Status | Reason |
|-------|--------|--------|
| `reviews(building_id, status)` composite | Always added | PERF-06 unconditional |
| `buildings(city)` | Conditional on EXPLAIN showing SCAN TABLE | PERF-07 |
| `buildings(building_type)` | Conditional on EXPLAIN showing SCAN TABLE | PERF-07 |
| `rate_limits(rate_key, created_at)` composite | Conditional bonus | Add if EXPLAIN confirms meaningful plan change |

- Skip threshold: `SEARCH ... USING INDEX` = skip; `SCAN TABLE` (no USING INDEX) = add; ambiguous = default to add
- IF NOT EXISTS on every CREATE INDEX

**Migration file**
- `migrations/0024_perf_indexes.sql` — single file, all confirmed indexes
- Block-comment header linking to audit doc
- Index naming: `idx_reviews_building_status`, `idx_buildings_city`, `idx_buildings_building_type`, `idx_rate_limits_key_created`

**Apply order**
1. Local: `npx wrangler d1 migrations apply ratemyplace-db --local`
2. Verify locally: re-run EXPLAIN, document after output
3. Remote: `npx wrangler d1 migrations apply ratemyplace-db --remote`
4. Verify remote: re-run EXPLAIN against production, document after output

**Conditional-skip documentation**
- Two-place pattern: audit doc (per-query "Decisions" subsection) + migration block-comment header (one line per skipped index with one-sentence reason)

### Claude's Discretion

- Exact wording of EXPLAIN-output decision summaries in the audit doc
- Whether to also EXPLAIN the COUNT subquery as a separate audited query
- Whether the audit doc gets a top-level "Summary" table at the start
- Whether to include `EXPLAIN` (without `QUERY PLAN`) for any query as bonus depth
- Exact prose for the migration block-comment header

### Deferred Ideas (OUT OF SCOPE)

- Covering indexes (e.g., `reviews(building_id, status, overall_score)`) — v1.6.0
- Tenant dashboard / building page / landlord page query audits — v1.6.0
- D1 query logging / metrics dashboard
- Auto-refresh of audit doc on schema changes
- Production soak check scheduling
- Composite for `rate_limits(rate_key, expires_at)`
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PERF-05 | D1 query plans audited via EXPLAIN QUERY PLAN for search joins, rate-limit lookups, and hot paths | EXPLAIN QUERY PLAN confirmed supported on D1 (HIGH); wrangler `--remote --command` syntax confirmed; output format SEARCH vs SCAN documented |
| PERF-06 | Composite index `reviews(building_id, status)` added (verified necessary by audit in PERF-05) | Composite benefit over two single-col indexes confirmed via SQLite planner docs; IF NOT EXISTS pattern established |
| PERF-07 | Additional indexes on `buildings(city)` and `buildings(building_type)` if EXPLAIN shows full scans | **Grep confirms ZERO WHERE-clause filter queries on city or building_type in any SELECT** — these columns only appear in admin PATCH (UPDATE SET) — PERF-07 will almost certainly close as "skipped, no filter queries found" |
</phase_requirements>

---

## Summary

Phase 19 adds one migration file and one audit document. No application code changes. The work is entirely about (a) running EXPLAIN QUERY PLAN against 5 hot-path queries, (b) writing one composite index that is unconditional (PERF-06), and (c) deciding two conditional indexes (PERF-07) based on evidence.

**Critical pre-research finding (PERF-07):** A grep of the entire `src/` directory confirms that `city =` and `building_type =` appear only in the admin PATCH endpoint (`/api/admin/buildings/[id].ts` lines 72 and 92) as `UPDATE SET` clauses — not in any `WHERE` filter on a `SELECT`. There are no hot-path or any-path `SELECT ... WHERE city = ?` or `SELECT ... WHERE building_type = ?` queries anywhere in the codebase. PERF-07 will close as "indexes not added; no filter queries confirmed by grep." The audit doc must record this finding with the grep evidence.

**EXPLAIN QUERY PLAN on D1:** Confirmed supported by Cloudflare's own best-practices documentation, which explicitly instructs using EXPLAIN QUERY PLAN and PRAGMA optimize after index creation. The `wrangler d1 execute ratemyplace-db --remote --command '...'` syntax is confirmed correct for ad-hoc SQL including read-only EXPLAIN statements.

**Primary recommendation:** Run EXPLAIN before writing SQL, apply local-then-remote, capture before/after EXPLAIN output in the audit doc per query, skip city/building_type indexes with documented grep evidence, add rate_limits composite only if EXPLAIN shows a plan change from the current single-col index.

---

## Standard Stack

### Core Tools
| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| `wrangler d1 execute` | current (project uses npx wrangler) | Run ad-hoc SQL including EXPLAIN QUERY PLAN | `--remote --command` confirmed syntax |
| `wrangler d1 migrations apply` | current | Apply migration files to local and remote D1 | `--local` then `--remote` |
| SQLite EXPLAIN QUERY PLAN | stable SQLite feature, D1 confirmed | Reveal query plan, index usage | Read-only, safe against production |
| PRAGMA optimize | D1 confirmed | Runs ANALYZE on all tables after schema changes | Run after migration applied, before final EXPLAIN verification |

### No New Dependencies
This phase adds zero npm packages and zero new application files. The "standard stack" is wrangler (already installed) and SQLite's built-in EXPLAIN facility.

---

## Architecture Patterns

### Recommended Workflow

```
1. Extract SQL for each of the 5 hot-path queries
2. Run EXPLAIN QUERY PLAN --remote for each query (before state)
3. Document before EXPLAIN in audit doc per query
4. Decide: add or skip per index
5. Write migrations/0024_perf_indexes.sql with confirmed indexes
6. Apply --local
7. Run PRAGMA optimize locally
8. Re-run EXPLAIN QUERY PLAN --local for changed queries (after state)
9. Document after EXPLAIN in audit doc
10. Apply --remote
11. Run PRAGMA optimize --remote
12. Re-run EXPLAIN QUERY PLAN --remote for verification
13. Document remote after EXPLAIN
```

### EXPLAIN QUERY PLAN Syntax on D1

```bash
# Read-only, safe against production D1
npx wrangler d1 execute ratemyplace-db --remote --command 'EXPLAIN QUERY PLAN SELECT b.*, COUNT(r.id) as review_count FROM buildings b LEFT JOIN reviews r ON b.id = r.building_id AND r.status = '"'"'approved'"'"' GROUP BY b.id HAVING COUNT(r.id) > 0 ORDER BY COUNT(r.id) DESC LIMIT 10 OFFSET 0'
```

**Shell-quoting note for EXPLAIN commands:** The hot-path queries contain embedded single-quoted SQL strings (e.g., `status = 'approved'`). Two strategies work:

Strategy A — Use `'"'"'` to embed single quotes inside an outer single-quoted shell string:
```bash
npx wrangler d1 execute ratemyplace-db --remote --command 'EXPLAIN QUERY PLAN SELECT ... AND r.status = '"'"'approved'"'"' ...'
```

Strategy B — Use `--file` with a `.sql` file:
```bash
# Write the EXPLAIN statement to a temp file
echo "EXPLAIN QUERY PLAN SELECT ... AND r.status = 'approved' ...;" > /tmp/eq_plan.sql
npx wrangler d1 execute ratemyplace-db --remote --file /tmp/eq_plan.sql
```

**Known `--file` bug:** GitHub issue #8020 reports that `wrangler d1 execute --file --remote` fails with a `ReadableStream constructor` error; the issue was closed as "not planned." The confirmed workaround from that issue thread is `--command="$(cat file.sql)"`. However, `--command` with a quoted string works for simple statements. For complex multi-line SQL, use the heredoc-to-command pattern:

```bash
npx wrangler d1 execute ratemyplace-db --remote --command "$(cat <<'SQL'
EXPLAIN QUERY PLAN
SELECT b.*, COUNT(r.id) as review_count, ROUND(AVG(r.overall_score), 1) as avg_overall
FROM buildings b
LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved'
GROUP BY b.id
HAVING COUNT(r.id) > 0
ORDER BY COUNT(r.id) DESC
LIMIT 10 OFFSET 0
SQL
)"
```

This avoids all single-quote escaping issues and is safe for any query complexity.

### PRAGMA optimize After Index Creation

```bash
# After applying migration locally
npx wrangler d1 execute ratemyplace-db --local --command 'PRAGMA optimize'

# After applying migration remotely
npx wrangler d1 execute ratemyplace-db --remote --command 'PRAGMA optimize'
```

This runs ANALYZE on all tables, collecting statistics so the planner picks the new composite index reliably. D1 documentation explicitly recommends this after schema changes.

### Migration File Pattern

```sql
-- Phase 19: Performance indexes
-- Audit: .planning/audits/d1-indexes-2026-04-28.md
-- Added:
--   * reviews(building_id, status) — composite for search join (PERF-06, unconditional)
--   * <list any conditional indexes that were added after EXPLAIN audit>
-- Skipped (with reason):
--   * buildings(city) — no SELECT WHERE city = ? queries found in src/ (grep confirmed)
--   * buildings(building_type) — no SELECT WHERE building_type = ? queries found in src/ (grep confirmed)
--   * <any others>

CREATE INDEX IF NOT EXISTS idx_reviews_building_status ON reviews(building_id, status);

-- Conditional entries only if EXPLAIN audit confirms:
-- CREATE INDEX IF NOT EXISTS idx_rate_limits_key_created ON rate_limits(rate_key, created_at);
```

### Audit Document Structure

```markdown
# D1 Index Audit — 2026-04-28

## Summary Table
| Query | Before Plan | Index Added | After Plan |
|-------|------------|-------------|------------|

## Query 1: Search results — buildings LEFT JOIN reviews
**Source:** `src/pages/api/search/results.ts:44-54`
**SQL:**
\`\`\`sql
[extracted query]
\`\`\`
**EXPLAIN QUERY PLAN (before):**
\`\`\`
[raw wrangler output]
\`\`\`
**Decision:** Add `idx_reviews_building_status` — SCAN TABLE reviews detected
**EXPLAIN QUERY PLAN (after):**
\`\`\`
[raw wrangler output]
\`\`\`

## Query 5: buildings(city) / buildings(building_type) filter audit
**Discovery method:** `grep -rn 'city =\|building_type =' src/`
**Result:** No SELECT WHERE filter queries found. Both column references are UPDATE SET clauses in admin PATCH only (`src/pages/api/admin/buildings/[id].ts:72,92`).
**Decision:** Skip `idx_buildings_city` and `idx_buildings_building_type` — PERF-07 not applicable; no filter queries to optimize.
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Running EXPLAIN | Custom Worker endpoint | `wrangler d1 execute --remote --command` | D1 supports EXPLAIN QUERY PLAN natively via wrangler; no app code needed |
| Updating planner statistics | Manual | `PRAGMA optimize` | D1-supported wrapper around ANALYZE; run after each schema change |
| Idempotent index creation | Version-gating logic | `CREATE INDEX IF NOT EXISTS` | Standard SQLite idiom, already used in migrations 0006/0010/0011/0012/0013/0015 |

---

## Common Pitfalls

### Pitfall 1: Shell Quote Escaping in --command Breaks EXPLAIN
**What goes wrong:** The hot-path SQL contains `status = 'approved'` — single quotes inside the `--command '...'` shell argument. If the outer shell argument uses single quotes, embedded single quotes terminate the string early and produce a parse error.
**Why it happens:** Bash single-quoted strings are literal — there is no escape sequence for `'` inside single quotes.
**How to avoid:** Use the heredoc-to-`--command` pattern (Strategy B above): `--command "$(cat <<'SQL' ... SQL)"`. This avoids all shell escaping.
**Warning signs:** wrangler exits with a SQL parse error or strange "unexpected token" message.

### Pitfall 2: --file + --remote Bug (Wrangler Issue #8020)
**What goes wrong:** `npx wrangler d1 execute ratemyplace-db --remote --file /tmp/eq_plan.sql` fails with a `ReadableStream constructor` error.
**Why it happens:** Known wrangler bug, closed as "not planned" — no fix is coming.
**How to avoid:** Use `--command "$(cat file.sql)"` instead. For EXPLAIN queries, the heredoc approach works cleanly.
**Warning signs:** Error message contains "ReadableStream constructor takes an object".

### Pitfall 3: ANALYZE Statistics Not Collected — Composite Ignored
**What goes wrong:** After adding `idx_reviews_building_status`, the EXPLAIN QUERY PLAN still shows the planner using `idx_reviews_building` (single-col) instead of the new composite, because no statistics exist yet to tell it the composite is more selective.
**Why it happens:** SQLite's planner without ANALYZE statistics may arbitrarily prefer the first available index. The composite's advantage over the single-column index is only certain when statistics (`sqlite_stat1`) exist. D1's documentation says: "run PRAGMA optimize after a schema change."
**How to avoid:** Run `PRAGMA optimize` against both local and remote D1 after applying the migration, then re-run EXPLAIN QUERY PLAN for the "after" verification. If the planner still picks the single-col index, the composite is still present and the data distribution may make either equally fast for the current dataset size.
**Warning signs:** After output says `SEARCH reviews USING INDEX idx_reviews_building (building_id=?)` with no mention of `status` — the planner ignored the composite. This is acceptable (not harmful), but document the observation in the audit.

### Pitfall 4: Misreading the EXPLAIN Output — SCAN with INDEX Is Not a Full Scan
**What goes wrong:** Treating `SCAN reviews USING INDEX idx_reviews_created` as a full-table scan and adding a redundant index.
**Why it happens:** `SCAN` in EXPLAIN output indicates all rows in the index are visited (e.g., for ORDER BY over the whole table), not necessarily that no index is used. The distinction is: `SCAN TABLE reviews` (no index) = full-table heap scan; `SCAN reviews USING INDEX ...` = index scan but visiting all entries.
**How to avoid:** The skip threshold from CONTEXT.md is correct: only `SCAN TABLE <name>` with no `USING INDEX` suffix triggers adding a new index.
**Warning signs:** Output shows `SCAN reviews USING INDEX idx_reviews_created` — this is an indexed scan, not a heap scan; no new index needed.

### Pitfall 5: PERF-07 Assumed Necessary Without Verification
**What goes wrong:** Adding `idx_buildings_city` and `idx_buildings_building_type` based on the REQUIREMENTS.md description ("if EXPLAIN shows full scans on filter queries") without first confirming filter queries exist.
**Why it happens:** REQUIREMENTS.md says "if" but a planner might miss this. Grep was not run.
**How to avoid:** This research already confirmed: **there are zero SELECT WHERE filter queries on `city` or `building_type` in `src/`**. The grep result is definitive. PERF-07 closes as skipped.
**Warning signs:** N/A — evidence is clear. The audit doc must document the grep finding so PERF-07 doesn't get reopened without new code that actually uses these filters.

### Pitfall 6: rate_limits Composite — Existing Index May Already Cover the Query
**What goes wrong:** Adding `idx_rate_limits_key_created` when `idx_rate_limits_key` already satisfies the COUNT query efficiently enough.
**Why it happens:** The COUNT query is `WHERE rate_key = ? AND created_at > ?`. The existing `idx_rate_limits_key` covers `rate_key =` (equality) and returns a set of rows, then SQLite filters those rows by `created_at > ?` without an index. Whether this is materially slower than a composite depends on how many rows share a given `rate_key` value — which at typical scale (rate-limit windows are 60 seconds, rows are cleaned up by the DELETE) is likely very small.
**How to avoid:** Run EXPLAIN QUERY PLAN against the actual COUNT query. If it shows `SEARCH rate_limits USING INDEX idx_rate_limits_key (rate_key=?)`, the existing index is being used and the composite is a bonus-only addition. Per CONTEXT.md: add the composite "if EXPLAIN confirms a meaningful plan change." If the existing plan already uses the key index, skip it.
**Warning signs:** EXPLAIN shows the single-col key index is already being used — no plan change from composite. Skip and document.

---

## Code Examples

### Exact SQL for Each Hot-Path Query to EXPLAIN

**Query 1 — Search results buildings (results.ts:44-54):**
```sql
EXPLAIN QUERY PLAN
SELECT b.*, COUNT(r.id) as review_count, ROUND(AVG(r.overall_score), 1) as avg_overall, l.name as landlord_name
FROM buildings b
LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved'
LEFT JOIN landlords l ON b.landlord_id = l.id
GROUP BY b.id
HAVING COUNT(r.id) > 0
ORDER BY COUNT(r.id) DESC, AVG(r.overall_score) DESC
LIMIT 10 OFFSET 0
```

**Query 2 — Search results landlords (results.ts:78-89):**
```sql
EXPLAIN QUERY PLAN
SELECT l.*, COUNT(DISTINCT b.id) as building_count, COUNT(r.id) as review_count, ROUND(AVG(r.overall_score), 1) as avg_overall
FROM landlords l
LEFT JOIN buildings b ON b.landlord_id = l.id
LEFT JOIN reviews r ON r.building_id = b.id AND r.status = 'approved'
GROUP BY l.id
HAVING COUNT(r.id) > 0
ORDER BY COUNT(r.id) DESC, l.name ASC
LIMIT 10 OFFSET 0
```

**Query 3 — Autocomplete buildings (autocomplete.ts:49-60):**
```sql
EXPLAIN QUERY PLAN
SELECT b.id, b.address, b.neighborhood, b.city, b.state, b.slug, COUNT(r.id) as review_count, ROUND(AVG(r.overall_score), 1) as avg_overall
FROM buildings b
LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved'
WHERE b.address LIKE '%boston%' ESCAPE '\' OR b.neighborhood LIKE '%boston%' ESCAPE '\'
GROUP BY b.id
ORDER BY review_count DESC, b.address ASC
LIMIT 5
```

**Query 4 — Rate limit COUNT (rateLimit.ts:39-41):**
```sql
EXPLAIN QUERY PLAN
SELECT COUNT(*) as attempt_count, MIN(created_at) as first_attempt
FROM rate_limits
WHERE rate_key = 'search-results:1.2.3.4' AND created_at > 1714000000
```

**Query 5 — PERF-07 filter query discovery result:**
```sql
-- No query to EXPLAIN. grep src/ confirmed:
-- city = and building_type = appear ONLY in UPDATE SET (admin PATCH).
-- Result: SCAN TABLE would be hypothetical for a query that doesn't exist.
-- Decision: skip both indexes, document grep evidence.
```

### Composite Index SQL

```sql
-- PERF-06 — unconditional
CREATE INDEX IF NOT EXISTS idx_reviews_building_status ON reviews(building_id, status);

-- Conditional bonus (only if EXPLAIN confirms plan change)
CREATE INDEX IF NOT EXISTS idx_rate_limits_key_created ON rate_limits(rate_key, created_at);
```

### PRAGMA optimize (post-migration)

```bash
# Local (after migrations apply --local)
npx wrangler d1 execute ratemyplace-db --local --command 'PRAGMA optimize'

# Remote (after migrations apply --remote)
npx wrangler d1 execute ratemyplace-db --remote --command 'PRAGMA optimize'
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Run EXPLAIN against local SQLite file | Run against `--remote` D1 via wrangler | Real data distribution; real planner decisions |
| Check ANALYZE manually | `PRAGMA optimize` wrapper | D1 recommended pattern; runs ANALYZE if table stats stale |
| Separate single-col indexes for each WHERE predicate | Composite index on (building_id, status) | SQLite planner uses one index per table; composite satisfies both predicates in one lookup |

**No deprecated patterns in this phase.** The `CREATE INDEX IF NOT EXISTS` idiom is already used in 6 of the project's existing migrations and is the correct approach.

---

## Open Questions

1. **Does EXPLAIN QUERY PLAN display correctly for LEFT JOIN ON-clause filtering?**
   - What we know: EXPLAIN QUERY PLAN on D1 is confirmed supported. The output format uses SEARCH/SCAN per table. For JOIN queries with ON clauses that include `AND r.status = 'approved'`, the planner may or may not use a reviews index — this depends on actual data distribution.
   - What's unclear: Whether D1's EXPLAIN output renders identically to vanilla SQLite or if the wrangler JSON wrapper formats it differently (wrangler may return results as a JSON table).
   - Recommendation: Run EXPLAIN for Query 1 first and observe the wrangler output format before documenting the pattern. The planner result is authoritative regardless of formatting.

2. **Will PRAGMA optimize have any effect before the database has significant data?**
   - What we know: Production DB was seeded recently and has only real user data (minimal rows). ANALYZE may produce low-quality statistics if the table has <100 rows.
   - What's unclear: Whether the SQLite planner will prefer the composite index purely on structural grounds (without ANALYZE statistics) when the data is sparse.
   - Recommendation: Run PRAGMA optimize anyway (it is idempotent and fast). Document in audit if statistics are sparse. The composite index is still present and correct; the planner may or may not pick it up until data grows.

3. **Does the --remote flag work reliably given Issue #9099 (local DB ID used for remote)?**
   - What we know: Issue #9099 described a case where wrangler resolved the local DB ID instead of remote. The issue was closed as "not planned."
   - What's unclear: Whether this affects this project. The issue appears to be triggered when local and remote databases share the same name AND a local D1 binding exists.
   - Recommendation: Verify the first EXPLAIN --remote returns data (not an error). If it fails with a UUID error, use the `--database-id <uuid>` flag instead of the database name. The database UUID is in `wrangler.toml`.

---

## Validation Architecture

This phase produces no application code changes and no new test files. The deliverables are:
- `migrations/0024_perf_indexes.sql` — schema-only migration
- `.planning/audits/d1-indexes-2026-04-28.md` — audit document with EXPLAIN evidence

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (unit tests via `npm test`) + Playwright (E2E via `e2e/`) |
| Config file | `vitest.config.ts` (unit), `playwright.config.ts` (E2E) |
| Quick run command | `npm test` |
| Full suite command | `npx playwright test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PERF-05 | EXPLAIN QUERY PLAN run + evidence captured | manual-only | N/A — EXPLAIN output captured in audit doc; no automated assertion possible | N/A |
| PERF-06 | Composite index `reviews(building_id, status)` applied | manual-only | `npx wrangler d1 execute ratemyplace-db --local --command "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_reviews_building_status'"` | N/A |
| PERF-07 | Conditional indexes skipped or added per EXPLAIN | manual-only | Same sqlite_master query pattern for any added indexes | N/A |

**Note on test automation:** Index migration correctness cannot be meaningfully unit-tested. The correct verification is: (1) `sqlite_master` query confirms index exists post-migration, (2) EXPLAIN QUERY PLAN shows SEARCH USING new index. Both are captured as manual steps in the audit doc.

### Wave 0 Gaps
None — existing test infrastructure covers all other phase requirements. This phase has no automated test deliverables; all verification is EXPLAIN-based and captured in the audit document.

---

## Sources

### Primary (HIGH confidence)
- Cloudflare D1 "Use indexes" official docs — confirms EXPLAIN QUERY PLAN supported, PRAGMA optimize recommended post-schema-change, composite index semantics, leftmost-prefix rule: https://developers.cloudflare.com/d1/best-practices/use-indexes/
- Cloudflare D1 SQL statements docs — confirms PRAGMA optimize runs ANALYZE: https://developers.cloudflare.com/d1/sql-api/sql-statements/
- Cloudflare D1 wrangler commands docs — confirms `--remote --command` syntax: https://developers.cloudflare.com/d1/wrangler-commands/
- SQLite EXPLAIN QUERY PLAN official docs — SCAN vs SEARCH distinction, JOIN output format: https://www.sqlite.org/eqp.html

### Secondary (MEDIUM confidence)
- Cloudflare D1 Limits page — no index-per-table limit documented: https://developers.cloudflare.com/d1/platform/limits/
- SQLite Query Planner overview — one index per table rule, composite index advantage with ANALYZE: https://www.sqlite.org/queryplanner.html

### Tertiary (LOW — needed for awareness, not relied on for decisions)
- GitHub Issue #8020 — `wrangler d1 execute --file --remote` bug, closed not planned, workaround `--command "$(cat file)"`: https://github.com/cloudflare/workers-sdk/issues/8020
- GitHub Issue #9099 — `--remote` uses local DB ID in some configurations, closed not planned: https://github.com/cloudflare/workers-sdk/issues/9099

### Codebase grep (HIGH — direct source inspection)
- `grep -rn 'city =\|building_type =' src/` — zero SELECT WHERE results; both columns appear only in admin PATCH UPDATE SET (`src/pages/api/admin/buildings/[id].ts:72,92`)

---

## Metadata

**Confidence breakdown:**
- EXPLAIN syntax on D1: HIGH — Cloudflare official docs explicitly show this pattern
- Composite index benefit: HIGH — SQLite official docs + D1 docs confirm one-index-per-table rule
- PERF-07 skip verdict: HIGH — grep of entire src/ directory is definitive; zero filter queries on city/building_type
- rate_limits composite decision: MEDIUM — benefit depends on actual EXPLAIN output (rows per rate_key)
- --file + --remote bug: HIGH (confirmed via GitHub issue) — use --command workaround
- PRAGMA optimize effect with sparse data: LOW — unclear how much ANALYZE helps before significant dataset

**Research date:** 2026-04-28
**Valid until:** 2026-10-01 (D1 is stable; SQLite planner semantics are highly stable)
