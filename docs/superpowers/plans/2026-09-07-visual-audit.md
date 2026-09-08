# Visual audit fixes and records panel redesign (proposal A)

**Date:** 2026-09-07 · **Branch:** `feat/visual-audit` (from `origin/main` at 60cbd35)
**Source:** the visual audit of ratemyplace.org at 375px and 1280px (report published 2026-09-07). The owner picked proposal A for the public records panel and asked for every finding to be fixed.

Rules that hold for every task: run `npm test` before committing; keep every string the records panel renders in `src/lib/records/display.ts` (the banned-words test scans the templates); never introduce score colors or judgment language into the records panel; no new dependencies; commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## Task 1 — Records panel redesign (proposal A)

**Files:** `src/components/BuildingRecords.astro`, new `src/components/records/*.astro` as needed, `src/lib/records/display.ts`, `src/lib/records/__tests__/display.test.ts` (or a new test file), `src/lib/records/__tests__/recordsPanelCopy.test.ts` (keep it green; extend its template list to any new component).

**Shape (from the mockup, built on real 1027 Commonwealth Ave data):**

1. **Panel header:** `h2` "Public records" · muted "City of Boston · pulled {date}" · "Report a record error" link (44px tap target). Keep `PANEL_FRAMING_COPY` under it as one short line.
2. **Facts strip** (assessor, only when the current assessment exists and is not a condominium): 4 cells on desktop, 2×2 under 640px, separated by hairlines (no cards): Owner of record (+ "Assessor FY{year} · parcel {id}"), Built {yearBuilt} (+ "Last remodel {yearRemodel} · units {n|not recorded}"), Assessed value (compact `$9.51M` style via a new `formatDollarsCompact`, + inline SVG sparkline of all fiscal years on one linear scale, + "FY{min}–FY{max}, range {lo}–{hi}"), Land use. Tax mailing address, when `showMailingAddress` allows it, becomes a small line under the owner cell using `mailingAddressLine`. Condominium → today's `CONDOMINIUM_COPY` in place of the strip. Never pulled / unavailable / no record → today's copy.
3. **Source ledger:** four `<details>` rows (311 housing requests, Building permits, Code enforcement tickets, ISD violations), each `<summary>` a 3-column grid: name + muted coverage line ("{firstYear}–{lastYear} · as of {date}" plus for 311 "{n} other requests not shown"), big count, small sub-count ("{n} open" / "all closed" / "none on record" / "{n} open · {declared} declared"), chevron. `<summary>` is the whole row (≥44px), keyboard focusable, `list-style: none` with the marker hidden. The 311 row is `open` by default; the others closed. Rows for sources that are never pulled or unavailable still render with today's copy inside and "—" for the count.
4. **Inside 311 and permits:** two-column body (`1fr` under 640px): left "Requests by year opened" / "Permits by year issued" as CSS bars (one neutral ink, `bg-gray-700`-ish, zero years in `bg-gray-200`, 2px min height, `title="{year}: {n}"`, an `aria-label` on the container, year axis labels every year for 311 and every 5th for permits when the span is long); right "What was reported" / "Type of work" as the top 6 categories with a proportional track and count, then "{k} more types · {m} requests" when there are more. Then for 311: "Open now ({n})" list of open rows (date · type · outlined "Open" pill), then `<details>` "Show all {n} requests" holding today's full list. For permits: `<details>` "Show all {n} permits" holding today's list. Keep `DECLARED_VALUATION_CAVEAT`, the "How requests are classified" text (now a plain small paragraph), the RentSmart disagreement note, the `ROW_CAP` notes, and `CorrectionNotes` per kind.
5. **Code enforcement:** category list (top 6 by description) + "Show all {n} tickets". **Violations:** open first list as today; when empty, the existing "No violations on record." copy plus one sentence that this is a record of the feed, not proof of compliance (add it to `display.ts`).
6. **Footer line:** border-top, the existing correction copy and `RecordCorrectionForm` with `id="report-record"`.

**Logic lives in `display.ts`** (pure, tested): `countByYear(rows, dateField, {from, to})` returning a dense year→count array across the span, `countByKey(rows, keyFn)` sorted desc with a `topN` split returning `{top, restTypes, restCount}`, `formatDollarsCompact(n)` (`$9.51M`, `$630K`, `$950`), `assessmentSeries(assessments)` returning `{points, min, max, firstYear, lastYear}` for the sparkline, `sparklinePoints(values, width, height)` returning the SVG `points` string. Categories for 311 use `request.type ?? request.title`; permits use `permit.description ?? permit.permitType ?? permit.workType`; enforcement uses `description`.

**Tests:** unit tests for every helper above (empty input, single year, gaps, ties, cap); a container render test of `BuildingRecords.astro` with a fixture view covering: facts strip values, ledger counts and sub-counts, 311 open by default, "Open now" list, "Show all" details present, condominium branch, never-pulled branch, and that the banned-words scan still passes. Page height is not testable; the reviewer checks it in the browser.

**Done when:** `npm test` green, `npm run build` clean, the panel renders on `http://localhost:4322/building/<slug>` for a building with a pull (seed a pull with `POST /api/admin/buildings/<id>/records/pull` as the local admin, session cookie `auth_session=auditsession0000000000000000000000000001`) and the collapsed panel is under ~2,000px at 375px.

---

## Task 2 — Building page layout

**Files:** `src/pages/building/[slug].astro`.

1. Render the "Building details" card only when at least one `dt` would render (type, year built, units, or whatever it currently lists). No empty white card.
2. Phone order: header + score, rating breakdown and common issues, units/reviews, records. Desktop keeps the two-column grid; make the sidebar column `lg:sticky lg:top-24 lg:self-start` so it does not leave 5,000px of empty space beside the left column. Use CSS `order` inside the grid rather than duplicating markup.
3. Records panel moves out of the two-column grid to full width below it (`max-w-3xl` content width so lines stay readable).

**Tests:** the existing container render test for the building page if one exists; otherwise add one that asserts the details card is absent when the building has no details and present when it has a year built.

---

## Task 3 — Review card header and admin review row

**Files:** `src/components/reviews/ReviewCard.astro`, `src/components/admin/ReviewsTable.tsx`.

1. `ReviewCard.astro` header (`flex justify-between items-start`): under `sm` stack it: title + verified badge, stars + score + "overall", domain chips, then a single wrapping meta line (unit · `SeasonChip` · recency · rent) with `flex-wrap gap-x-3`. From `sm` up keep the two columns, and give the right column `min-w-0` with `max-w-[45%]` so the chip can never overlap the left column.
2. `ReviewsTable.tsx` row: left column `min-w-0 flex-1`, email line `truncate`, right cluster `shrink-0`.

**Tests:** container render of `ReviewCard` asserting the meta line contains the season chip and recency text (structure, not pixels).

---

## Task 4 — Review form

**Files:** `src/components/reviews/form-steps/StepIndicator.tsx`, `src/components/reviews/form-steps/*Step.tsx` (unit-details step with the selects and amenity checkboxes), tests under `src/components/reviews/__tests__/`.

1. `StepIndicator`: under `lg` render "Step {i} of {n} · {title}" plus a full-width progress bar (`role="progressbar"` with `aria-valuenow/min/max`); the circle row only at `lg` and up. No horizontal overflow at 375px.
2. Amenity checkboxes: `h-5 w-5` and each wrapped in its `<label>` with `py-2` so the tap target is ≥40px tall.
3. Every `<select>` and `<input>` on the unit-details step gets an `id` and its label a matching `htmlFor` (month, year, unit number, square footage, bedrooms, bathrooms, rent, laundry, parking).

**Tests:** Testing Library: `getByLabelText('Bedrooms')` etc. resolve; step indicator renders the progress bar with the right `aria-valuenow`.

---

## Task 5 — Auth pages, bug report, forms consistency, headings, tap targets

**Files:** `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`, the auth form components they use, `src/components/BugReportForm.tsx` (or wherever the bug report form lives), `src/components/contact/ContactForm.tsx`, `src/components/disputes/DisputeForm.tsx`, `src/pages/{contact,bug-report,dispute,map,404}.astro`, `src/components/layout/{Header,Footer}.astro`.

1. Sign-in / sign-up: the Turnstile slot must not reserve height before the widget mounts (`min-h-0`, render the container only once the script is ready, or place it after the password field like the review form). Add the same top padding the other pages use (`py-12`). Promote the heading to `h1` with the same size classes.
2. Bug report: move the Turnstile widget next to the submit button, `data-size="flexible"` (or compact under 400px); the page must open on the first field, not "Verifying…".
3. One submit-button height across contact, bug report, dispute, review form, sign-in, sign-up: `h-11` (44px). Dispute and review-form checkboxes `h-5 w-5` in a padded label.
4. Sentence case for the five Title Case headings: "Contact us", "Report a bug", "Submit a dispute", "Explore buildings", "Page not found" (also update `<title>` text and any test that asserts these strings).
5. Footer links get `py-2 inline-block`; the header menu toggle `h-10 w-10` with the icon centered.

**Tests:** existing form tests stay green; update string assertions; add a Footer container test asserting links carry the padding class only if a Footer test already exists (do not create one just for a class).

---

## Task 6 — Search, profile, methodology, map

**Files:** `src/pages/search.astro`, `src/components/search/*` if the result card is a component, `src/components/profile/ProfileDashboard.tsx`, `src/pages/methodology.astro`, `src/pages/map.astro`, `src/components/BuildingMap.tsx`.

1. Search results: a `displayLocality(building)` helper in `src/lib/` that returns the neighborhood unless it is empty or equals a word of the street address (case-insensitive, e.g. "Commonwealth" for "1027 Commonwealth Avenue"), in which case it returns the city. Use it on the search results card and anywhere else the neighborhood line is built (landlord page building list, building page subtitle). Unit tests.
2. Search results column: `max-w-3xl` on the results list at `lg` and up so cards stop stretching to 1,200px.
3. Profile tabs: the tab row scrolls horizontally (`overflow-x-auto`, `whitespace-nowrap`, no wrapping); remove the duplicated "My Reviews (n)" heading directly under the tab of the same name (keep the "Write a review" action).
4. Methodology: an in-page contents list (`nav aria-label="Contents"`) under the intro linking to each `h2`; wrap each of the six weighting sections' body in `<details>` with the `h3` in the `<summary>` (open the first). Do not change any methodology wording.
5. Map: remove the four legend cards below the map (keep the in-map legend); keep the "n in view" badge.

**Tests:** `displayLocality` unit tests; existing page tests green.

---

## Final

Full-suite run, `npm run build`, a browser pass over building page, review form, sign-in, and search at 375px on the local server, then a final review subagent and a PR to `main`.
