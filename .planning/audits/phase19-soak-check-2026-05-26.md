---
audit_topic: d1-indexes-soak-check
scheduled: 2026-05-26
phase: 19
status: pass
completed: 2026-08-12
auth_gap: resolved-via-scoped-api-token
baseline_doc: d1-indexes-2026-04-28.md
---

# Phase 19 Soak Check — 2026-05-26 (Manual Run Required)

**Context:** Phase 19 added `idx_reviews_building_status ON reviews(building_id, status)` to production D1 on 2026-04-29 to fix full-table-scan behavior on the 3 main search join queries. This is the 4-week soak check verifying the planner still picks up the composite index after real user traffic.

**Why manual:** This soak check was triggered in a remote Claude Code environment that does not have Cloudflare API credentials (`wrangler whoami` returned "You are not authenticated"). The live audit was skipped. Run the script below from a local terminal where `wrangler whoami` succeeds.

---

## Manual Soak Check Script

Run each command below in order from your local terminal. Expected output is shown under each command.

### 0. Confirm index still exists in production

```bash
npx wrangler d1 execute ratemyplace-db --remote --command "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_reviews_building_status'"
```

**Expected:** 1 row — `name = idx_reviews_building_status`

**FAIL if:** 0 rows returned (index was dropped — this is a schema regression, file a CRITICAL PR immediately).

---

### Q1 — Search results: buildings LEFT JOIN approved reviews

```bash
npx wrangler d1 execute ratemyplace-db --remote --command "EXPLAIN QUERY PLAN SELECT b.*, COUNT(r.id) as review_count, ROUND(AVG(r.overall_score), 1) as avg_overall, l.name as landlord_name FROM buildings b LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved' LEFT JOIN landlords l ON b.landlord_id = l.id GROUP BY b.id HAVING COUNT(r.id) > 0 ORDER BY COUNT(r.id) DESC, AVG(r.overall_score) DESC LIMIT 10 OFFSET 0"
```

**Expected (from `d1-indexes-2026-04-28.md` "After (remote)"):**
```
SCAN b USING INDEX sqlite_autoindex_buildings_1
SEARCH r USING INDEX idx_reviews_building_status (building_id=? AND status=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_landlords_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
```

**PASS if:** `SEARCH r USING INDEX idx_reviews_building_status` is present for the reviews join.
**FAIL if:** `SEARCH r USING INDEX idx_reviews_status` (reverted to single-column) or `SCAN TABLE reviews` (no index at all).

- [x] Q1 PASS (2026-08-12)

---

### Q2 — Search results: landlords LEFT JOIN buildings LEFT JOIN approved reviews

```bash
npx wrangler d1 execute ratemyplace-db --remote --command "EXPLAIN QUERY PLAN SELECT l.*, COUNT(DISTINCT b.id) as building_count, COUNT(r.id) as review_count, ROUND(AVG(r.overall_score), 1) as avg_overall FROM landlords l LEFT JOIN buildings b ON b.landlord_id = l.id LEFT JOIN reviews r ON r.building_id = b.id AND r.status = 'approved' GROUP BY l.id HAVING COUNT(r.id) > 0 ORDER BY COUNT(r.id) DESC, l.name ASC LIMIT 10 OFFSET 0"
```

**Expected (from `d1-indexes-2026-04-28.md` "After (remote)"):**
```
SCAN l USING INDEX sqlite_autoindex_landlords_1
SEARCH b USING INDEX idx_buildings_landlord (landlord_id=?) LEFT-JOIN
BLOOM FILTER ON r (building_id=? AND status=?)
SEARCH r USING INDEX idx_reviews_building_status (building_id=? AND status=?) LEFT-JOIN
USE TEMP B-TREE FOR count(DISTINCT)
USE TEMP B-TREE FOR ORDER BY
```

Note: The `BLOOM FILTER ON r` line is a bonus optimization the production planner added when the composite index became available. Its presence indicates the planner is fully utilizing the composite. If absent but `SEARCH r USING INDEX idx_reviews_building_status` is present, that is still a PASS (bloom filter is an optional planner enhancement, not guaranteed).

**PASS if:** `SEARCH r USING INDEX idx_reviews_building_status` is present for the reviews join.
**FAIL if:** `SEARCH r USING INDEX idx_reviews_status` or `SCAN TABLE reviews`.

- [x] Q2 PASS (2026-08-12)

---

### Q3 — Autocomplete: buildings LEFT JOIN approved reviews

```bash
npx wrangler d1 execute ratemyplace-db --remote --command "EXPLAIN QUERY PLAN SELECT b.id, b.address, b.neighborhood, b.city, b.state, b.slug, COUNT(r.id) as review_count, ROUND(AVG(r.overall_score), 1) as avg_overall FROM buildings b LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved' WHERE b.address LIKE '%boston%' ESCAPE '\' OR b.neighborhood LIKE '%boston%' ESCAPE '\' GROUP BY b.id ORDER BY review_count DESC, b.address ASC LIMIT 5"
```

**Expected (from `d1-indexes-2026-04-28.md` "After (remote)"):**
```
SCAN b USING INDEX sqlite_autoindex_buildings_1
SEARCH r USING INDEX idx_reviews_building_status (building_id=? AND status=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
```

Note: `SCAN b USING INDEX sqlite_autoindex_buildings_1` is expected — the `LIKE '%boston%'` leading-wildcard pattern cannot use a btree index; a full buildings scan is inherent to this query type.

**PASS if:** `SEARCH r USING INDEX idx_reviews_building_status` is present for the reviews join.
**FAIL if:** `SEARCH r USING INDEX idx_reviews_status` or `SCAN TABLE reviews`.

- [x] Q3 PASS (2026-08-12)

---

## If any query FAILS

1. First, try refreshing ANALYZE statistics:
   ```bash
   npx wrangler d1 execute ratemyplace-db --remote --command "PRAGMA optimize"
   ```
   Then re-run the failing EXPLAIN. SQLite occasionally needs an ANALYZE refresh; this may resolve transient regressions.

2. If still regressed after `PRAGMA optimize`:
   - If Step 0 failed (index missing): **schema regression** — open a CRITICAL PR.
   - If Step 0 passed but planner isn't using the index: **planner-choice regression** — open a PR titled `fix(19-followup): D1 planner regression on <Q1/Q2/Q3>`.
   - Include: full results table, before-and-after PRAGMA optimize EXPLAIN outputs, hypothesis.
   - Mark as DRAFT — review before fixing.

## If ALL 3 queries PASS

No PR needed. Record the green soak check date here and close this file out:

- **Soak check date:** 2026-08-12
- **Result:** PASS (all 4 checks)
- **Checked by:** Claude Code (local terminal, scoped `CLOUDFLARE_API_TOKEN`)

### Recorded output (2026-08-12, served_by v3-prod/ENAM)

**Step 0:** 1 row returned — `idx_reviews_building_status` exists.

**Q1** — exact match to baseline:
```
SCAN b USING INDEX sqlite_autoindex_buildings_1
SEARCH r USING INDEX idx_reviews_building_status (building_id=? AND status=?) LEFT-JOIN
SEARCH l USING INDEX sqlite_autoindex_landlords_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
```

**Q2** — exact match to baseline, bloom filter present:
```
SCAN l USING INDEX sqlite_autoindex_landlords_1
SEARCH b USING INDEX idx_buildings_landlord (landlord_id=?) LEFT-JOIN
BLOOM FILTER ON r (building_id=? AND status=?)
SEARCH r USING INDEX idx_reviews_building_status (building_id=? AND status=?) LEFT-JOIN
USE TEMP B-TREE FOR count(DISTINCT)
USE TEMP B-TREE FOR ORDER BY
```

**Q3** — exact match to baseline:
```
SCAN b USING INDEX sqlite_autoindex_buildings_1
SEARCH r USING INDEX idx_reviews_building_status (building_id=? AND status=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
```

No regression. No follow-up PR required.
