# Phase 19: D1 Index Migration - Context

**Gathered:** 2026-04-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Run `EXPLAIN QUERY PLAN` against the ~5 hot-path D1 queries (search joins, rate-limit lookup, building filter queries) to identify full-table scans. Add a composite index `reviews(building_id, status)` (always, per PERF-06). Add `buildings(city)` and `buildings(building_type)` indexes ONLY if the audit confirms full scans (per PERF-07). Optionally add a `rate_limits(rate_key, created_at)` composite if the audit confirms it changes the plan. All decisions and EXPLAIN evidence captured in a date-stamped audit doc.

This phase changes only the database schema (one migration file) and adds one audit document. No app-code changes. No new endpoints. No new tables. No data backfill.

</domain>

<decisions>
## Implementation Decisions

### Audit document

- **Location:** `.planning/audits/d1-indexes-2026-04-28.md` — full date in filename (intentional divergence from Phase 18's `csrf-2026-04.md` which used yearmonth only). Going forward, audit docs that capture a specific runtime state (like EXPLAIN output) use full date; audit docs that capture a posture/decision (like CSRF) can use yearmonth. Both naming patterns are valid; this divergence is explicit.
- **Structure: per-query.** Each audited query gets its own H2 section containing:
  1. Query name (e.g., "Search results: buildings JOIN approved reviews")
  2. SQL extracted from source with `file:line` reference
  3. EXPLAIN QUERY PLAN output BEFORE any index changes (raw, code-fenced)
  4. Decision: add index / skip + reason
  5. EXPLAIN QUERY PLAN output AFTER the index is applied (only for indexes added)
- **EXPLAIN command:** `npx wrangler d1 execute ratemyplace-db --remote --command 'EXPLAIN QUERY PLAN <SQL>'` — runs against the production D1 instance for accurate planner output. Read-only, no risk. Real data distribution.
- **Migration file links to audit doc** via inline SQL comment near the top: `-- Phase 19 perf indexes — audit: .planning/audits/d1-indexes-2026-04-28.md`
- **Audit doc is a snapshot.** Date-stamped, never refreshed in place. Future re-audits create new files (e.g., `d1-indexes-2026-10-15.md`). Matches Phase 18 audit-doc convention.

### Hot-path scope (which queries to audit)

- **Strict per REQUIREMENTS.md — ~5 queries.** The audit covers exactly:
  1. `/api/search/results` — `buildings LEFT JOIN reviews ... AND r.status = 'approved' GROUP BY b.id HAVING COUNT(r.id) > 0`
  2. `/api/search/results` — `landlords LEFT JOIN buildings LEFT JOIN reviews ... AND r.status = 'approved'`
  3. `/api/search/autocomplete` — same join pattern as #1 with LIMIT 5
  4. `src/lib/rateLimit.ts` `checkRateLimit()` — `SELECT COUNT(*) FROM rate_limits WHERE rate_key = ? AND created_at > ?`
  5. Any building filter query that uses `WHERE city = ?` or `WHERE building_type = ?` — discovered via `grep -rn 'city =\\|building_type =' src/`. If no such queries exist, the audit notes this and skips PERF-07 entirely with documented reason.
- **Discovery method:** grep + read source. Direct enumeration. No log-based discovery (D1 metrics are limited; not worth tooling up first).
- **Out of scope for the audit:** tenant dashboard queries, /building/[slug] page queries, /landlord/[slug] page queries, admin queries, profile queries. These can be revisited in v1.6.0 if perf signals warrant.

### Indexes to add

| Index | Status | Reason |
|-------|--------|--------|
| `reviews(building_id, status)` composite | **Always added** | PERF-06 is unconditional. Composite is more efficient than two single-column indexes joined; SQLite can satisfy both WHERE clauses in one lookup. |
| `buildings(city)` | **Conditional** | Per PERF-07: added only if EXPLAIN shows `SCAN TABLE buildings` on the city filter query. If `SEARCH ... USING INDEX` already, skip and document. |
| `buildings(building_type)` | **Conditional** | Same rule as above. |
| `rate_limits(rate_key, created_at)` composite | **Conditional bonus** | Not in PERF-06/07 but the rate-limit audit may show this is needed. Add if EXPLAIN confirms a meaningful plan change. Document either way. |

- **Skip threshold:** If EXPLAIN output says `SEARCH ... USING INDEX <name>`, the existing index is sufficient — skip the new one. If EXPLAIN says `SCAN TABLE <name>` (with no `USING INDEX`), it's a full scan — add the index. This is the line.
- **If EXPLAIN result is ambiguous:** Default to ADD the index. Rationale: indexes are cheap (small storage, low write overhead on a read-heavy app); a borderline-skip is a worse default than a borderline-add. The composite skip-threshold rule above is for clear cases; ambiguity tilts toward adding.

### Migration file structure

- **Single migration file:** `migrations/0024_perf_indexes.sql`. All confirmed-necessary indexes go in one file.
- **Idempotent SQL:** Every index uses `CREATE INDEX IF NOT EXISTS`. Matches the existing convention (migrations 0006, 0010, 0011, 0012, 0013, 0015 all use IF NOT EXISTS).
- **Block-comment header in the migration file:**
  ```sql
  -- Phase 19: Performance indexes
  -- Audit: .planning/audits/d1-indexes-2026-04-28.md
  -- Added:
  --   * reviews(building_id, status) — composite for search join
  --   * buildings(city) — IF audit confirmed full scan
  --   * buildings(building_type) — IF audit confirmed full scan
  --   * rate_limits(rate_key, created_at) — IF audit confirmed full scan
  -- Skipped (with reason):
  --   * <list any indexes considered but skipped, one per line>
  ```
- **Index naming convention:** `idx_<table>_<col1>_<col2>...` matches existing convention. Specific names:
  - `idx_reviews_building_status` (replaces no existing — composite is new)
  - `idx_buildings_city` (if added)
  - `idx_buildings_building_type` (if added)
  - `idx_rate_limits_key_created` (if added)
- **Empty migration is impossible:** PERF-06 always adds the composite, so the migration file always has at least one CREATE INDEX statement.

### Apply order

1. **Local first:** `npx wrangler d1 migrations apply ratemyplace-db --local`
2. **Verify locally:** Re-run EXPLAIN QUERY PLAN against local D1 — confirm new index appears in plan. Document this `after` output in the audit doc per query.
3. **Then remote:** `npx wrangler d1 migrations apply ratemyplace-db --remote`
4. **Verify remote:** Re-run EXPLAIN QUERY PLAN against production — confirm production also picks up the new plan (data distribution may differ from local).
5. Both before/after EXPLAIN sets are captured in the audit doc.

### Conditional-skip documentation

- **Two-place pattern (mirrors decision-vs-source separation):**
  - Audit doc has a "Decisions" subsection per skipped index: query name, EXPLAIN output, verdict (skipped), reason ("SEARCH USING idx_buildings_neighborhood already covers this filter").
  - Migration file's block-comment header lists skipped indexes one per line with one-sentence reason.
- **Future engineer reading either source can find the answer in 30 seconds.**
- **Schema drift:** Audit doc is point-in-time. New audits = new files, not edits. The migration's block comment is also point-in-time and stays as part of the migration history.

### Claude's Discretion

- Exact wording of EXPLAIN-output decision summaries in the audit doc
- Whether to also EXPLAIN /api/search/results' COUNT subquery as a separate audited query (it shares the join with the main results query but has different ORDER BY)
- Whether the audit doc gets a top-level "Summary" table at the start (probably yes, but not mandated)
- Whether to include `EXPLAIN` (without `QUERY PLAN`) for any query as bonus depth
- Exact prose for the migration block-comment header (template is illustrative, not literal)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `migrations/` directory with sequential numbered SQL files — convention is `XXXX_description.sql` (next: 0024).
- 30+ existing indexes already in place (verified via `grep CREATE INDEX migrations/`). Most use `CREATE INDEX IF NOT EXISTS` (idempotent pattern).
- `reviews` table already has: `idx_reviews_building` on `building_id`, `idx_reviews_user` on `user_id`, `idx_reviews_status` on `status`, `idx_reviews_created` on `created_at`. The composite `(building_id, status)` is new and complements (does not replace) these.
- `buildings` table already has: `idx_buildings_slug`, `idx_buildings_landlord`, `idx_buildings_neighborhood`, `idx_buildings_address`. NO indexes on `city` or `building_type` — that's why PERF-07 calls them out.
- `rate_limits` already has `idx_rate_limits_key` on `rate_key` and `idx_rate_limits_expires` on `expires_at`. The composite would be `(rate_key, created_at)` — NOT covered by either single-column index for the COUNT query that filters on both.
- `wrangler d1 execute ratemyplace-db --remote --command '...'` is the established way to run ad-hoc SQL against production. EXPLAIN QUERY PLAN is read-only and safe.
- `.planning/audits/csrf-2026-04.md` (Phase 18) established the audit-doc convention. New file follows the same overall shape (frontmatter date, sections, evidence-quoted output) with the per-query structure decided here.

### Established Patterns
- Migration commit messages: `feat(N-NN): <description>` for the migration commit, plus `docs(N-NN): <description>` for the audit doc commit.
- Migrations applied with `npx wrangler d1 migrations apply ratemyplace-db --local` then `--remote`.
- SQL formatting: lowercase keywords NOT used in this codebase — existing migrations use UPPERCASE SQL keywords (CREATE INDEX, IF NOT EXISTS). Stick with uppercase.

### Integration Points
- `migrations/0024_perf_indexes.sql` — new file, contains the schema delta.
- `.planning/audits/d1-indexes-2026-04-28.md` — new audit doc, references migration via `.planning/audits/...` path.
- ROADMAP.md — Phase 19 plan list updates from "TBD" to actual plan filenames after planner runs.
- REQUIREMENTS.md — PERF-05/06/07 status flips to Complete after verification.
- No app-code files modified. No queries rewritten. Only schema additions.

</code_context>

<specifics>
## Specific Ideas

- The "SEARCH USING INDEX" vs "SCAN TABLE" line in EXPLAIN output is the canonical SQLite distinction — well-documented in sqlite.org and stable across SQLite versions. The audit doc cites this distinction explicitly so future readers know the rule wasn't arbitrary.
- The composite `(building_id, status)` is more efficient than the existing two single-column indexes because SQLite's planner uses ONE index per table per query (with rare exceptions). With separate indexes, the planner picks `idx_reviews_building` (high-selectivity) and then filters by status on the row data. With a composite, both columns are satisfied by one index lookup.
- Adding a covering index for the search join (`reviews(building_id, status, overall_score)` to satisfy the AVG aggregate without row reads) was considered and explicitly NOT in scope — that's a v1.6.0 optimization if the EXPLAIN output post-migration still shows row reads after the composite is added.

</specifics>

<deferred>
## Deferred Ideas

- **Covering indexes** for aggregate queries (e.g., `reviews(building_id, status, overall_score)`) — not in PERF-06/07; revisit in v1.6.0 if post-migration EXPLAIN still shows row reads.
- **Tenant dashboard / building page / landlord page query audits** — wider hot-path scope deferred until a perf signal warrants it.
- **D1 query logging / metrics dashboard** — not in scope. Cloudflare's built-in D1 metrics are sufficient through v1.5.0.
- **Auto-refresh of audit doc on schema changes** — out of scope. New audits = new files.
- **Production soak check on index effectiveness** — could `/schedule` an agent in 2-4 weeks to re-run EXPLAIN and confirm the indexes are still being picked up. Decision deferred to phase completion (offer at the end).
- **Composite for rate_limits(rate_key, expires_at)** — could be considered if `expires_at` filter performance becomes an issue. Not currently load-bearing in the COUNT query; noted but skipped for this phase.

</deferred>

---

*Phase: 19-d1-index-migration*
*Context gathered: 2026-04-28*
