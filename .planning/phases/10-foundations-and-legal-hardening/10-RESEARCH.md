# Phase 10: Foundations and Legal Hardening - Research

**Researched:** 2026-03-20
**Domain:** UGC disclaimers, ToS legal hardening, admin review moderation UX, move-in date bug fix
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Disclaimer placement: footer of the review section on building pages and anywhere reviews are displayed
- Disclaimer tone: "These reviews come from real tenants sharing their experiences. While we moderate for guidelines, we can't verify every detail."
- Disclaimer built as a shared `UGCDisclaimer.astro` component imported across all pages displaying reviews
- Disclaimer links to Terms of Service
- ToS: audit and expand existing — do NOT rewrite from scratch; existing language is solid
- ToS gaps to check: removal policy details, dispute mechanism reference, review guidelines link
- Update "Last updated" date on ToS
- About page: audit existing copy, ensure it positions RateMyPlace as hosting tenant experiences, not a rating agency; adjust language that could be read as making claims about specific properties
- Consent checkbox on the final step of the multi-step review form, right above the submit button
- Consent text: "I confirm this review reflects my honest personal experience and agree to the [Terms of Service] and [Review Guidelines]."
- Checkbox must be checked to enable the submit button
- Add to both new review and edit review forms
- Admin expansion: accordion/expandable row pattern in the existing ReviewsTable React island
- Click a row to expand inline, showing full review content below the summary row
- Expanded view shows: every dimension score (unit, building, landlord), written text, comments, move-in date, unit type, rent, user email, verification status
- Fetch on expand: keep list API lightweight, fetch full review details via separate API call on expand
- Approve/reject buttons in both the row AND the expanded view
- Winter rule: December belongs to the year it occurs in — December 2025 = "Winter 2025" not "Winter 2026"
- Investigate both form and display for bug source
- Fix data + display; if existing reviews have incorrect stored values, write a migration to correct them
- Current storage: `move_in_season` (string) + `move_in_year` (integer) as separate fields
- `formatFuzzyDate()` in `privacy.ts` just concatenates — bug is upstream

### Claude's Discretion
- Exact disclaimer component styling (font size, color, border)
- How to handle the expanded review layout (grid vs stacked sections)
- Loading state for the expand-on-click API call
- Whether the About page needs significant changes or just minor tweaks
- How to structure the data correction migration (if needed)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UGC-01 | Visible disclaimer on all pages that display review content (building pages, review cards) | Three pages identified: building/[slug].astro, landlord/[slug].astro, property-manager/[slug].astro all use ReviewCard — one UGCDisclaimer.astro component imported on each suffices |
| UGC-02 | Review submission flow includes acknowledgment checkbox that review is personal experience | ConfirmStep.tsx already has a `privacyAcknowledged` checkbox wired to disable submit — needs text update only; EditForm needs same pattern added |
| UGC-03 | Terms of Service includes Section 230 safe harbor, content responsibility clause, removal policy | Section 230 (lines 53-60) and content responsibility (lines 41-50) exist; removal policy gap is in "Content Moderation" section — needs explicit removal process and timeline |
| UGC-04 | About page clearly frames platform role (hosts tenant experiences, not a rating agency) | About page "How We Rate" section uses language like "Our comprehensive rating system" which could read as the platform making evaluations — needs reframing |
| ADMIN-01 | Admin can read complete review content inline from pending reviews list without navigating away | ReviewsTable already has expandedReview state and `GET /api/admin/reviews/[id]` endpoint returning `r.*` — wire the fetch-on-expand pattern |
| ADMIN-02 | All review fields visible in expanded view: ratings, text responses, photos, verification status, user info | The `GET /api/admin/reviews/[id]` returns `r.*` which includes all score columns — expanded UI needs to render them in a readable layout |
| ADMIN-03 | Approve/reject actions accessible from the expanded review view | Actions div already exists at bottom of expanded section — keep it; also confirmed buttons exist at row level |
| FIX-01 | Move-in dates display correct season/year labels including winter month edge cases | Bug is in data storage: move_in_year is hardcoded to `new Date().getFullYear()` at submission time in reviews.ts (line 233), and move_in_season is hardcoded to 'winter' (line 234) — not collected from user |
</phase_requirements>

---

## Summary

This phase is almost entirely a codebase modification exercise against well-understood existing code. No new external libraries are required. All five work areas touch files that are already identified, and in three of five cases the infrastructure already exists and only needs wiring or content changes.

The most significant finding is about FIX-01: `move_in_year` and `move_in_season` are never collected from the user during review submission. The API (`src/pages/api/reviews.ts` lines 233-234) hardcodes these as "legacy defaults" — `new Date().getFullYear()` and `'winter'`. This means every review in the database has `move_in_season = 'winter'` and `move_in_year` equal to the calendar year the review was submitted. The "December 2025 shows Winter 2026" bug occurs when a user submits in January 2026 about a property they moved into in December 2025 — the stored year becomes 2026. The fix requires: (1) collecting actual move-in month and year from the review form, (2) computing the correct season from that month, (3) applying the December-belongs-to-its-own-year rule at data-write time, and (4) a migration to correct existing rows if any have demonstrably wrong values.

For ADMIN-01/02/03: `ReviewsTable.tsx` already has accordion expansion and `expandedReview` state. The `GET /api/admin/reviews/[id]` endpoint already exists and returns `r.*`. The gap is that the expanded panel currently shows data already present in the list response — it never calls the detail endpoint. The fix is to fetch full details on expand and render all 27 score dimensions in the expanded view.

**Primary recommendation:** Tackle FIX-01 first (data model change affects form, API, and migration), then UGC-02 (consent checkbox text update), then UGC-01 (new Astro component), then ADMIN-01/02/03 (wire existing endpoint into existing UI), then UGC-03/04 (text-only ToS and About page changes).

---

## Standard Stack

### Core (all already installed, no new dependencies)
| Library/Tool | Version | Purpose | Why Standard |
|---|---|---|---|
| Astro | 5.x | Static/SSR Astro component for UGCDisclaimer | Project framework |
| React | 18.x | ReviewsTable accordion expansion (already a React island) | Project framework |
| Tailwind CSS | 4.x | Disclaimer styling | Project framework |
| Vitest | current | Unit tests for season/year correction logic | Project test runner |

### No New Dependencies Required
All work in this phase uses existing infrastructure. The only new file that is a new component is `UGCDisclaimer.astro`.

---

## Architecture Patterns

### Recommended Project Structure Changes
```
src/
├── components/
│   ├── reviews/
│   │   └── UGCDisclaimer.astro          ← NEW: shared disclaimer component
│   ├── admin/
│   │   └── ReviewsTable.tsx             ← MODIFY: add full detail fetch on expand
├── pages/
│   ├── building/[slug].astro            ← MODIFY: import UGCDisclaimer
│   ├── landlord/[slug].astro            ← MODIFY: import UGCDisclaimer
│   ├── property-manager/[slug].astro    ← MODIFY: import UGCDisclaimer
│   ├── terms.astro                      ← MODIFY: fill ToS gaps
│   ├── about.astro                      ← MODIFY: reframe platform role language
│   └── api/reviews.ts                   ← MODIFY: collect real move_in data
├── lib/
│   └── privacy.ts                       ← MODIFY: add getMoveInSeasonFromMonth()
migrations/
└── 0018_fix_move_in_season_year.sql     ← NEW: correct existing rows
```

### Pattern 1: Shared Astro Component for UGC Disclaimer

**What:** A pure Astro component (no props needed, or optional link text) that renders a styled disclaimer paragraph with a link to `/terms`.

**When to use:** Imported on every page that renders `<ReviewCard />`.

**Placement:** Immediately after the reviews list section header, before the first review card, or as a footer to the reviews section — whichever keeps it "in close proximity" to review content per the decision.

```astro
<!-- src/components/reviews/UGCDisclaimer.astro -->
---
// No props needed — static content
---
<p class="text-sm text-gray-500 italic mt-4 mb-2 border-t border-gray-100 pt-4">
  These reviews come from real tenants sharing their experiences. While we moderate
  for guidelines, we can't verify every detail.
  <a href="/terms" class="text-teal-600 hover:underline">Terms of Service</a>.
</p>
```

Usage in building page:
```astro
import UGCDisclaimer from '../../components/reviews/UGCDisclaimer.astro';

<!-- after reviews section header, before review cards -->
<UGCDisclaimer />
{reviews.map((review) => <ReviewCard review={review} />)}
```

### Pattern 2: Consent Checkbox — Update Existing ConfirmStep

**What:** The consent checkbox already exists in `ConfirmStep.tsx`. The text needs updating to match the locked decision: "I confirm this review reflects my honest personal experience and agree to the [Terms of Service] and [Review Guidelines]."

**Current state (lines 119-130 of ConfirmStep.tsx):** Checkbox with text about anonymity risk AND ToS/Guidelines links. The privacy-risk language can be kept but the primary checkbox text should lead with the honest-experience confirmation.

**ReviewEditForm.tsx** does not currently have a consent checkbox — it needs the same pattern added. The edit form is a separate React component. Add a `consentAcknowledged` state variable, render the checkbox above the submit button, and disable submit when unchecked.

### Pattern 3: Admin Expand-on-Click with Detail Fetch

**What:** When an admin clicks to expand a review row, fire `GET /api/admin/reviews/{id}` to fetch full detail (all 27 score fields, all text fields). Cache the result in component state to avoid re-fetching on collapse/re-expand.

**Current state:** `expandedReview` state exists and toggles. The expanded panel currently renders from the list-level `review` object (which has summary fields). The `GET /api/admin/reviews/[id]` endpoint already exists and returns `r.*`.

**New state needed in ReviewsTable.tsx:**
```typescript
// New state alongside existing expandedReview
const [reviewDetails, setReviewDetails] = useState<Record<string, ReviewDetail>>({});
const [loadingDetail, setLoadingDetail] = useState<string | null>(null);

// Called when expanding:
const handleExpand = async (reviewId: string) => {
  setExpandedReview(expandedReview === reviewId ? null : reviewId);
  if (!reviewDetails[reviewId]) {
    setLoadingDetail(reviewId);
    const res = await fetch(`/api/admin/reviews/${reviewId}`);
    const data = await res.json();
    if (res.ok) {
      setReviewDetails(prev => ({ ...prev, [reviewId]: data.review }));
    }
    setLoadingDetail(null);
  }
};
```

**ReviewDetail interface** needs to include all 27 score fields (unit_structural, unit_plumbing, unit_electrical, unit_climate, unit_ventilation, unit_pests, unit_mold, unit_appliances, unit_layout, unit_accuracy, building_common_areas, building_security, building_exterior, building_noise_neighbors, building_noise_external, building_mail, building_laundry, building_parking, building_trash, landlord_maintenance, landlord_communication, landlord_professionalism, landlord_lease_clarity, landlord_privacy, landlord_deposit, landlord_rent_practices, landlord_non_retaliation).

**Expanded panel layout (Claude's discretion — recommend grid):**
- Row 1: Unit scores (10 items) — small labeled badges
- Row 2: Building scores (9 items) — small labeled badges
- Row 3: Landlord scores (8 items) — small labeled badges
- Row 4: Written text (review_title, review_text, comments)
- Row 5: Metadata (move-in, rent, unit type, user email, verification status)
- Row 6: Action buttons (Approve, Reject, Flag, Reset, Edit, View Building)

### Pattern 4: Move-In Season/Year — Collect from User

**Root cause (HIGH confidence):** `src/pages/api/reviews.ts` lines 233-234 hardcode `move_in_year` to `new Date().getFullYear()` and `move_in_season` to `'winter'`. These fields are called "legacy fields" in a comment. The review form never collects or submits `move_in_year` or `move_in_season`.

**Fix approach:**
1. Add `moveInMonth` and `moveInYear` fields to the review form (likely in `UnitDetailsStep.tsx` or `AdditionalStep.tsx`)
2. Compute season from month using a new helper in `privacy.ts` with December-belongs-to-its-year rule
3. Submit these fields in the form and process them in the API (replace hardcoded defaults)
4. Write a migration to audit and correct existing rows

**Season-from-month logic:**
```typescript
// In src/lib/privacy.ts — new export
export function getSeasonFromMonth(month: number): string {
  // month: 1-12
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'fall';
  return 'winter'; // 12, 1, 2
}

// December rule: the year stored is the year December occurs in.
// If month=12 and user says year=2025 → store winter, 2025 (not 2025+1).
// This is already correct if we just use the user-provided year directly.
// The bug was that the API used new Date().getFullYear() (submission year, not move-in year).
```

**Form field:** A two-field input — month select (January–December) and year select (2000–current year). On the confirm step or unit details step. Store both to derive season+year for the API.

**Migration for existing rows:** Since all existing reviews have `move_in_season = 'winter'` (hardcoded) and `move_in_year` = submission calendar year, the stored data is systematically wrong. A migration to set all to NULL (which `formatFuzzyDate` can handle gracefully) or to leave them is valid — the CONTEXT.md says "if existing reviews have incorrect stored values, write a migration to correct them." Since we cannot know the true move-in date from stored data, the cleanest approach is to set `move_in_year = NULL` and `move_in_season = NULL` for all rows where these were set by the old hardcoded defaults. The ReviewCard doesn't currently display `move_in_season`/`move_in_year` at all (confirmed by grep), so nulling them has no public display impact.

### Anti-Patterns to Avoid

- **Don't add UGC disclaimer to BaseLayout.astro globally** — it only belongs on pages showing review content, not all pages (e.g., methodology, privacy, admin pages don't need it).
- **Don't rewrite the ConfirmStep checkbox from scratch** — the existing `privacyAcknowledged` prop and `onPrivacyChange` callback are correct; only the inner text needs updating.
- **Don't fetch all 27 score fields in the list API** — the list query already returns enough for summaries; the detail endpoint exists for a reason.
- **Don't use `new Date().getFullYear()` for move_in_year** — that's the root of FIX-01.
- **Don't apply winter-year correction at display time** — fix it at data storage time. `formatFuzzyDate` correctly just concatenates; it should stay that way.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Accordion/collapse UI | Custom accordion component | React `useState` toggle (already in ReviewsTable) | Pattern already established and working in the codebase |
| Season calculation | Complex date library | Simple month-to-season function in privacy.ts | Only 4 seasons, 12 months — pure function, trivially testable |
| ToS legal content | Original legal drafting | Expand existing sections | Existing Section 230 language is already solid; don't weaken it |

---

## Common Pitfalls

### Pitfall 1: Consent Checkbox Blocks Submit in EditForm
**What goes wrong:** If you add `consentAcknowledged` to ReviewEditForm and wire it to disable the submit button, users editing an existing review must re-consent each time they edit. This is correct behavior — they should re-acknowledge on resubmit.
**Why it happens:** Natural feature of adding a required checkbox.
**How to avoid:** Make sure the checkbox starts unchecked (do not initialize to `true`).
**Warning signs:** Submit button unexpectedly enabled on mount.

### Pitfall 2: ReviewDetails Cache Grows Without Bound
**What goes wrong:** `reviewDetails` state object accumulates entries for every expanded review in a long admin session.
**Why it happens:** No eviction policy on the cache.
**How to avoid:** For Phase 10 scope, this is acceptable — admin sessions are short and review counts are modest. Flag as tech debt if admin review counts grow large.
**Warning signs:** None for now.

### Pitfall 3: Move-In Form Fields Break Validation
**What goes wrong:** Adding `move_in_month` and `move_in_year` to the form without updating `validateReviewForm` in `validation.ts` causes either silent acceptance of bad data or validation errors on valid data.
**Why it happens:** `validateReviewForm` already checks `move_in_year` range (1900 to current year) and `move_in_season` values.
**How to avoid:** Update the validation to accept the new form fields and compute season+year from month+year before validating.
**Warning signs:** Test file `validation.test.ts` has explicit season/year tests — run them after changes.

### Pitfall 4: UGCDisclaimer Appears Inside Map Loop
**What goes wrong:** Placing the disclaimer component inside `{reviews.map(...)}` renders one disclaimer per review card.
**Why it happens:** Copy-paste error when integrating.
**How to avoid:** Disclaimer is placed once, before or after the map loop, as a section footer/header.

### Pitfall 5: About Page "How We Rate" Language
**What goes wrong:** The "How We Rate" section of about.astro leads with "Our comprehensive rating system" and lists what it covers — this reads as the platform evaluating properties, not tenants sharing experiences.
**Why it happens:** Marketing copy written before legal framing was considered.
**How to avoid:** Add a framing sentence: "These scores are calculated from tenant-submitted ratings. RateMyPlace does not independently evaluate properties." Check the "Scoring Transparency" box — it's accurate but could add "based on what tenants reported."

### Pitfall 6: ToS Removal Policy Gap
**What goes wrong:** The existing "Content Moderation" section (line 64-66) says "We reserve the right to remove reviews" but gives no removal timeline or process for requesting removal.
**Why it happens:** Section was written minimally.
**How to avoid:** Add: how to request removal (link to /dispute), that disputed content is reviewed within reasonable time, and that removal decisions are final at RateMyPlace's discretion.

---

## Code Examples

### Existing: ConfirmStep consent checkbox (to update text only)
```typescript
// src/components/reviews/form-steps/ConfirmStep.tsx lines 112-133
// Currently: privacy-risk acknowledgment + ToS/Guidelines links
// Change: lead with "honest personal experience" per locked decision
<label className="flex items-start gap-3 cursor-pointer">
  <input
    type="checkbox"
    checked={privacyAcknowledged}
    onChange={(e) => onPrivacyChange(e.target.checked)}
    className="mt-0.5 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
  />
  <span className="text-sm text-amber-800">
    I confirm this review reflects my honest personal experience and agree to the{' '}
    <a href="/terms" target="_blank" className="underline font-medium">Terms of Service</a>
    {' '}and{' '}
    <a href="/guidelines" target="_blank" className="underline font-medium">Review Guidelines</a>.
  </span>
</label>
```

### Existing: Admin reviews GET /api/admin/reviews/[id] (already exists)
```typescript
// src/pages/api/admin/reviews/[id].ts lines 105-163
// Returns r.* + user_email, building_address, building_city, building_neighborhood
// This is the endpoint to call on expand — no API changes needed for ADMIN-01/02
```

### Existing: expandedReview state toggle (already exists)
```typescript
// src/components/admin/ReviewsTable.tsx line 45
const [expandedReview, setExpandedReview] = useState<string | null>(null);
// onClick (line 306): setExpandedReview(expandedReview === review.id ? null : review.id)
// Only needs: add reviewDetails cache state + fetch-on-expand call
```

### New: Season helper with correct winter rule
```typescript
// src/lib/privacy.ts — add this export
export function getSeasonFromMonth(month: number): string {
  // month is 1-indexed (1=January, 12=December)
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'fall';
  return 'winter'; // covers month 12 (December), 1 (January), 2 (February)
}
// December 2025: getSeasonFromMonth(12) = 'winter', year stored as 2025 → "Winter 2025" ✓
// January 2026: getSeasonFromMonth(1) = 'winter', year stored as 2026 → "Winter 2026" ✓
```

### New: Migration template for existing row correction
```sql
-- migrations/0018_fix_move_in_season_year.sql
-- Existing reviews have hardcoded move_in_season='winter' and move_in_year=submission_year
-- Neither value was collected from users. Set both to NULL to avoid displaying wrong data.
-- ReviewCard does not display these fields publicly so this has no public impact.
UPDATE reviews SET move_in_season = NULL, move_in_year = NULL
WHERE move_in_season = 'winter'
  AND move_in_year IS NOT NULL;
-- Note: Only nulls rows where the old hardcoded defaults were applied.
-- After this migration, new submissions will use user-provided month/year.
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|---|---|---|
| Hardcoded `move_in_year = new Date().getFullYear()` at submission | User-provided move_in_month + move_in_year, derive season | FIX-01 resolved; displays correct "Winter YYYY" |
| Admin reads full review text only in separate edit page | Fetch-on-expand in ReviewsTable | ADMIN-01/02/03 resolved; no navigation required |
| Consent checkbox text focuses on anonymity risk | Consent text focuses on honest-experience confirmation | UGC-02 resolved |
| No UGC disclaimer on review-displaying pages | UGCDisclaimer.astro on 3 pages | UGC-01 resolved |

---

## Open Questions

1. **Should the new move-in month/year fields be required or optional?**
   - What we know: Current validation requires `move_in_year` and `move_in_season` — but these were always hardcoded, so "required" was technically misleading.
   - What's unclear: If the review form now collects month+year from users, should they be required? Or optional with a "prefer not to say" option?
   - Recommendation: Make them required (month + year) since they're already nominally required; the UX just needs to actually ask the user. Required fields are already in the validation schema.

2. **Are there public-facing pages that display `move_in_season`/`move_in_year`?**
   - What we know: ReviewCard.astro does NOT display these fields (confirmed by code search). ReviewEditForm.tsx shows them in a summary view for the tenant editing their review.
   - What's unclear: Whether any other views display them.
   - Recommendation: The only current display is in the admin panel (ReviewsTable.tsx line 392) and in ReviewEditForm (line 256). Both can be updated as part of the fix.

3. **Does the ToS content moderation section need a specific removal timeline?**
   - What we know: The existing section says disputes are investigated; no timeline given.
   - What's unclear: Whether "reasonable time" is legally sufficient or a specific timeframe is needed.
   - Recommendation: Keep vague ("within a reasonable timeframe") to avoid creating a binding commitment. Do not add a specific SLA.

---

## Validation Architecture

> `workflow.nyquist_validation` key is absent from `.planning/config.json` — treating as enabled.

### Test Framework
| Property | Value |
|---|---|
| Framework | Vitest (vitest run) |
| Config file | vitest.config.ts (or package.json scripts) |
| Quick run command | `npm test -- privacy` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| FIX-01 | `getSeasonFromMonth(12)` = 'winter', year stored = user's year not submission year | unit | `npm test -- privacy` | ❌ Wave 0 — needs `src/lib/__tests__/privacy.test.ts` |
| FIX-01 | `getSeasonFromMonth(3)` = 'spring', `getSeasonFromMonth(6)` = 'summer', `getSeasonFromMonth(9)` = 'fall' | unit | `npm test -- privacy` | ❌ Wave 0 |
| UGC-02 | Consent checkbox present and submit disabled when unchecked | manual | Browser smoke test | N/A — React UI |
| ADMIN-01/02/03 | Detail fetch on expand returns all 27 score fields | manual | Browser smoke test | N/A — React UI |
| UGC-01/03/04 | Disclaimer present on pages, ToS sections present | manual | Browser visual check | N/A — static content |

### Sampling Rate
- **Per task commit:** `npm test -- privacy` (new privacy tests) + `npm test -- validation` (existing)
- **Per wave merge:** `npm test` (full 171+ test suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/__tests__/privacy.test.ts` — covers `getSeasonFromMonth` for all 12 months, edge cases (Dec=winter, correct year semantics), existing `formatFuzzyDate` and `getCurrentSeason` functions

*(Existing `validation.test.ts` covers `move_in_season` and `move_in_year` validation — those tests may need updating once the form fields change from season to month.)*

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `src/pages/api/reviews.ts` — confirmed move_in hardcoding at lines 233-234
- Direct code inspection: `src/components/reviews/form-steps/ConfirmStep.tsx` — existing consent checkbox structure
- Direct code inspection: `src/components/admin/ReviewsTable.tsx` — existing accordion state and expanded panel
- Direct code inspection: `src/pages/api/admin/reviews/[id].ts` — existing detail endpoint returning `r.*`
- Direct code inspection: `src/lib/privacy.ts` — confirmed `formatFuzzyDate` just concatenates, `getCurrentSeason` uses correct winter logic
- Direct code inspection: `src/pages/terms.astro` — Section 230 at lines 53-60, content responsibility at lines 41-50, moderation at lines 64-66
- Direct code inspection: `src/pages/about.astro` — "How We Rate" section uses rating-agency language
- Code grep: ReviewCard.astro does NOT display `move_in_season`/`move_in_year` publicly

### Secondary (MEDIUM confidence)
- Section 230 of the Communications Decency Act (47 U.S.C. § 230) — existing ToS language is standard and correct; no changes to the safe harbor clause needed
- Standard UGC disclaimer patterns from platforms like Yelp, Zillow, Apartments.com — "shared experiences, cannot verify every detail" is the accepted phrasing

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all existing infrastructure
- Architecture: HIGH — code read directly, patterns confirmed from source
- Pitfalls: HIGH — identified from direct code inspection, not speculation
- FIX-01 root cause: HIGH — confirmed by reading reviews.ts lines 233-234

**Research date:** 2026-03-20
**Valid until:** 2026-04-20 (stable codebase, no external dependencies changing)
