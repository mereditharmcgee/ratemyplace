# Accessible contribution (Phase 28): implementation plan

**Date:** 2026-10-29. **Branch:** `feat/a11y-contribution`, in its own worktree (written `<worktree>` below), created from `origin/main` at `83086a2`.
**Milestone:** v1.6.0, requirements A11Y-01 to A11Y-08 (`.planning/milestones/v1.6.0-REQUIREMENTS.md`, Phase 28 section of `.planning/milestones/v1.6.0-ROADMAP.md`, design spec `docs/superpowers/specs/2026-08-26-trust-density-design.md` section 8).
**Evidence:** the 2026-10-29 axe baseline (`e2e/a11y.spec.ts`, 61 scans at 1280x900 and 375x812) and a read-only source audit of the same commit.

**Goal.** A renter can complete the public contribution journey (home address search, select or add an address, sign in or up, verification, every review step, submit, confirmation on the building page) by keyboard and with a screen reader, without any change to the rating instrument: survey wording, values, order, N/A behavior, scoring and the submitted payload all stay the same.

---

## Rules for every batch

- Read `AGENTS.md` (canonical), `src/components/AGENTS.md` and `src/lib/AGENTS.md` before editing. `migrations/AGENTS.md` does not apply: this phase has no schema change.
- The repo is public. No production identifiers, no real owner, landlord or person names, no real addresses in code, comments, tests, commits or PR text. Use the seed ids (`building-01`, `building-30`, `review-001`) and fictional examples. Never read for quoting, stage or commit anything under `ops/private/`.
- No production writes: no `--remote`, no deploys. Local D1 under the worktree's `.wrangler/state` only.
- Copy: no em dashes, no exclamation points in anything new. Visible public text is the owner's: do not reword it. Do not edit the About page or the homepage hero (`src/pages/index.astro`). New accessible-name strings are allowed only where this plan lists them (see "New accessible-name strings"); list every new string in your result.
- Do not change `surveyItems.ts`, `scoring.ts`, `scoring-colors.ts`, `ITEM_WEIGHTS` or `RECENCY_BANDS`. City records are shown as recorded. Reviews are never edited by hand.
- The contrast guards (`src/lib/__tests__/contrastTokens.test.ts`, `adminContrastTokens.test.ts`) and the records banned-words scan (`recordsPanelCopy.test.ts`) read raw source, comments included. Never write a banned token, even in a comment.
- Files use CRLF. Use the Edit tool for source edits, not `sed -i`. New files: write them, then make sure they are CRLF and ASCII before committing.
- Heavy commands (`npm test`, `npm run build`, `npm run check`, `npx playwright test`, `npm run e2e`) go through the lane's RAM semaphore, written `$HEAVY` below (the path is in each batch's instructions). After any full unit run: `git checkout -- src/lib/__tests__/__snapshots__/emailPayloads.test.ts.snap`.
- Stage by explicit path. Never `git add -A` or `git add .`. No force-push, no rebase, no amend of pushed commits. Conventional subject, plain ASCII body, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not merge any PR. Pushing and opening the PR are the lead's call.
- Concurrent lane `fix/review-edit-and-admin-cleanup` owns these hunks; do not touch them: `ReviewEditForm.tsx` tenure and move-out state and the tenure and move-out selects (about lines 755-795 today), `src/pages/api/reviews/[id].ts`, the N/A color in `ReviewsTable.tsx` (the header score at about line 288 and the expanded details), hover classes on five admin links, `NotificationsTab.tsx` row classes, the `@source` lines at the top of `global.css`, `UnitTypeSummary.astro` (being deleted) and some docs.
- Write paths in Markdown with forward slashes (Tailwind scans `docs/`; a backslash path can break the build).
- Every batch ends with all three clean, through `$HEAVY`: `npm test`, `npm run check`, `npm run build`. e2e is not in CI: say so in the batch result and list which specs you ran.

### Local e2e harness

```bash
cd <worktree>
npm run db:setup                         # local D1 only: fresh schema plus seed
$HEAVY npm run build                     # the webServer serves dist/
$HEAVY npx playwright test e2e/<spec>.ts # wrangler pages dev dist on port 8788
```

- `playwright.config.ts` starts `wrangler pages dev dist` on 8788 with the always-pass Turnstile test secret; the specs stub the Turnstile widget. Only one agent in this lane uses 8788 at a time. An ad-hoc server goes on 8797 with `--persist-to` pointing at a copy of `.wrangler/state` (for example `.wrangler/state-adhoc`), stopped and deleted afterwards.
- Seed users: `user@test.ratemyplace.local` and `admin@test.ratemyplace.local`; the password is in `e2e/global.setup.ts` (local only, never repeat it in results).
- `global.setup` signs in twice per run. A third back-to-back run can hit "Too many attempts". Clear it locally with `npx tsx -e "import('./e2e/test-harness.ts').then((m) => m.executeLocalD1('DELETE FROM rate_limits'))"`.
- Specs that submit reviews (`review.spec.ts`) write to local D1. Re-run `npm run db:setup` afterwards.
- Never call Google: the a11y spec refuses `maps|places.googleapis.com` and routes `/api/places/autocomplete` and `/api/places/details` to a fictional suggestion. New specs reuse `prepare()` from `e2e/review-helpers.ts` (it moved there from `e2e/a11y.spec.ts`, since one spec cannot import another).

---

## What the evidence shows

**axe (WCAG 2.0/2.1 A and AA tags, 61 scans, 0 scan errors).** Three rules fire:

| Rule | Impact | Nodes | Where | Source |
|---|---|---|---|---|
| `button-name` | critical | 16 | building after submit, profile, review address step | Four icon-only buttons: submitted-banner dismiss (`src/pages/building/[slug].astro` ~266), profile updated-banner dismiss (`src/pages/profile.astro` ~59), `AddressAutocomplete.tsx` clear button, `VerificationModal.tsx` close button |
| `select-name` | critical | 4 | `/search`, both states, both widths | `src/pages/search.astro` ~221, the unlabeled `<select name="type">` |
| `color-contrast` | serious | 54 | `/admin/reviews` expanded row only | Score badges from `getScoreColor` in `src/lib/scoring-colors.ts`, used by `ReviewsTable.tsx`. Owner decision (score palette), admin only, out of scope |

Clean at both widths: home, auth, landlord, every review step, the building page with every disclosure open, `/admin`, `/admin/buildings`.

**What axe cannot see (verified in source):**

- The building unit-card toggle is a click-only `div` (`[slug].astro` ~453, script ~543) with no role, keyboard support or state.
- Rating pills are bare `<button>`s named "1" to "5" and "N/A" with no group, no tie to the question and color-only selection (`RatingItem.tsx`; duplicated as `renderRatingItem` in `ReviewEditForm.tsx` ~221-271).
- Neither autocomplete has combobox or listbox semantics (`AddressAutocomplete.tsx`, `HomeSearch.tsx`). The review address input and the `/search` query input are named only by placeholder.
- No skip link, no `main` target (`BaseLayout.astro` ~52-54), no global focus or reduced-motion rule (`global.css`).
- Step changes in `ReviewForm.tsx` unmount the focused Continue button, so focus drops to `body`. Error banners in `AddressStep`, `ConfirmStep` and `ReviewEditForm` have no role.
- The verification modal has no dialog semantics, focus handling or Escape, and its file input is `display:none` behind a click-only `div`, so the keyboard cannot choose a file.
- Six admin row headers (`ReviewsTable` ~238, `BuildingsTable` ~330, `LandlordsTable` ~349, `ManagersTable` ~308, `DisputesQueue` ~216, `BugReportsTable` ~179) and the `AuditLogTable` row (~168) are click-only.
- `ReviewEditForm` has 16+ controls with sibling labels and no `htmlFor`/`id` (axe `label`, critical, on `/review/edit/[id]`, which the baseline did not scan).

**Non-axe finding.** The review form overflows horizontally at desktop widths: the `hidden lg:flex` circle row in `StepIndicator.tsx` is about 1079px wide inside a 704px column (overflow 215px at 1024, 87px at 1280, 7px at 1440), so the last step sits off-screen. No overflow at 375, 640 (1280 at 200% zoom) or 768.

**Payload safety for A11Y-04.** `ReviewForm` is a `div`, not a `form`, and builds its `FormData` from React state (`ReviewForm.tsx` ~278-332). `ReviewEditForm` sends `JSON.stringify` of state (~158-192). Native radio `name`/`value` attributes never reach either payload, so the same answers give the same bytes as long as the click handlers make the same state updates.

**Uncommitted work already in the worktree** (batch 1 commits it): `@axe-core/playwright` 4.14.0 exact-pinned in `package.json`/`package-lock.json`; `e2e/a11y.spec.ts` (records, asserts nothing yet; `ENFORCE_CONTRIBUTION_PATH = false`); `e2e/review-helpers.ts` (`rateAllItemsInStep`, moved from `review.spec.ts`); the one-import change in `e2e/review.spec.ts`; and this plan.

---

## Architecture: the patterns

Each pattern is built once and reused. Later batches must not invent a second version.

### P1. Global focus indicator and reduced motion (`src/styles/global.css`)

Append one block at the END of the file (the other lane edits the `@source` lines at the top):

```css
/* Phase 28: one visible focus indicator, and reduced motion, site-wide. */
@layer base {
  :root {
    --focus-ring: var(--color-teal-700);
  }
  /* Dark surfaces: the footer, and the homepage hero, which this phase does not edit. */
  footer,
  .from-slate-800 {
    --focus-ring: #fff;
  }
  :where(a, button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])):focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
}
```

- `:where()` has zero specificity, so any `focus-visible:outline-*` utility still wins. `focus:outline-none` utilities also win, which is why elements that rely on a ring need a ring of 3:1 or better: `focus:ring-2 focus:ring-teal-700` (teal-700 is 5.47:1 on white). The low-contrast `focus:ring-teal-500` / `focus:ring-teal-400` rings (142 occurrences) are swept file by file by the batch that owns each file, and batch 7 adds a guard.
- A dark container that is not `footer` or the hero sets `[--focus-ring:#fff]` as a class (for example the AdminLayout dark bar).
- `transition-all` and `animate-spin` are covered by the media query. Add `motion-reduce:transition-none` / `motion-reduce:animate-none` only where a component already states motion intent.

### P2. Skip link and main target (`BaseLayout.astro`)

- First child of `<body>`: `<a href="#main-content" class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:bg-white focus:px-4 focus:py-2 focus:text-teal-700 focus:rounded-[4px]">Skip to main content</a>` (new string).
- `<main id="main-content" tabindex="-1" class="flex-1 focus:outline-none">`. `main` is never a Tab stop, so removing its outline is safe.

### P3. Announcement and focus rule

One mechanism per message, never both (focus plus a live region makes NVDA speak twice):

1. **The press unmounts or disables the focused control** (step change, failed submit whose Submit then disables, dismissing a banner, closing a dialog whose trigger is gone): move focus deliberately. Step change: to the step heading. Error after a press: to the error container (`tabIndex={-1}`, then `scrollIntoView({ block: 'center' })`), with no live role on that container. Success that replaces the form: to the success panel.
2. **The message arrives without a press, or focus stays put** (combobox result counts, a lookup error while the user is still in the address input, Turnstile load or expiry, the bookmark toast, a resend result when the button re-enables): an always-rendered live region (`role="status"` for information, `role="alert"` for errors) whose content changes. The region exists before the message, or nothing is announced.
3. A control that disables itself during a request (`disabled={loading}`) loses focus in Chrome. When it re-enables and stays the right place to be, return focus to it after the request (`ref.current?.focus()` in `finally`) and announce the result through a live region (rule 2).
4. Guard every `scrollIntoView` call with optional chaining (`el.scrollIntoView?.(...)`); happy-dom may not implement it.

In-repo models: `RecordCorrectionForm.tsx` ~216-327 (`role="status"`/`"alert"`, `aria-invalid`, `aria-describedby`), `ShowAll.astro` ~54-69 (focus return after collapse).

### P4. Combobox with listbox popup (APG, list autocomplete without automatic selection)

Shared by `AddressAutocomplete.tsx` and `HomeSearch.tsx`:

- **Pure logic** in a new leaf module `src/lib/combobox.ts` (no runtime imports; add it to `LEAF_MODULES` in `clientLeafModules.test.ts`):
  - `comboboxKeyAction(key, state, opts)` returns one of `open-first`, `open-last`, `open-only` (Alt+Down), `move` (with the new index, wrapping), `select` (index), `close`, `clear`, `none`. Rules: Down opens and moves to the first option, or moves next with wrap; Up opens and moves to the last, or moves previous with wrap; Alt+Down opens without moving; Enter selects only when an option is active (otherwise `none`, so HomeSearch's form still submits); Escape closes when open, clears when closed and the input has text; Tab closes without selecting. Home and End are NOT handled: in an editable combobox they move the text caret (APG).
  - `clampActive(active, count)` returns -1 when `count` is 0, otherwise `min(active, count - 1)`.
  - `comboboxStatusText(count)` returns `No results`, `1 result available` or `${count} results available`.
- **React hook** `src/components/ui/useComboboxListbox.ts` (React state, ids from `useId`, refs): returns `inputProps` (`role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls` = listbox id, `aria-activedescendant` only while open and an option is active, `onKeyDown`, `onBlur` closing the popup), `listboxProps` (`role="listbox"`, `id`, `aria-labelledby` or `aria-label`), `getOptionProps(index)` (`role="option"`, `id`, `aria-selected`, `onMouseDown={(e) => e.preventDefault()}` so the input keeps focus, `onMouseEnter` to set the active index, `onClick` to select), `activeIndex`, `setActiveIndex`, and `statusText`. It scrolls the active option into view with `scrollIntoView?.({ block: 'nearest' })` and clamps the active index when the option count changes. Typing resets the active index to -1.
- **Status region:** an always-rendered `<div role="status" aria-live="polite" className="sr-only">` outside the popup. Its text is set about 700ms after the last results update, once nothing is loading, so the 150ms DB fetch and the 600ms Google fetch settle first. Empty input clears it. Spinner svgs get `aria-hidden="true"`.
- **Listbox structure.** The visual popup `div` stays as a wrapper. Inside it, one `role="listbox"` element whose owned children are only `role="group"` (labelled by its visible header via `aria-labelledby`; the header element itself gets `role="presentation"`) and `role="option"` elements. Wrappers needed for layout get `role="none"`. Non-choices (the API error sentence, the Google attribution) sit in the wrapper OUTSIDE the listbox. Options contain no interactive descendants and are not tabbable.
- **Active option visual.** Keep today's `bg-teal-50` and add an inset outline so the keyboard highlight does not rely on a 1.06:1 tint: `outline-2 -outline-offset-2 outline-teal-700` on the active option (owner-visible; see Decisions).

### P5. Rating question as a native radio group

`src/components/reviews/form-steps/RatingItem.tsx` becomes the only rating markup; `ReviewEditForm` uses it too.

- `useId` for `dimId` (on the existing dimension `span`) and `textId` (on the existing statement `p`).
- Pill row: `<div role="radiogroup" aria-labelledby={`${dimId} ${textId}`} aria-describedby={scaleId} className="flex items-center gap-2">`. `role="radiogroup"` (not `fieldset`/`legend`) keeps today's DOM and layout and keeps the HelpTooltip button out of the group's name; the requirement allows either.
- Each pill: `<label className="relative inline-flex">` containing `<input type="radio" name={`rating-${item.key}`} value={String(r)} checked={value === r} onChange={() => onChange(item.key, r)} className="peer sr-only" />` and a `<span>` carrying today's exact pill classes keyed on `value === r`, plus `inline-flex items-center justify-center` (a `button` centers its text and honors `w-10 h-10`; an inline `span` does neither), plus `peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-teal-700 motion-reduce:transition-none` and an invisible 44x44 hit area `before:absolute before:-inset-0.5 before:content-['']` (40px pill plus 2px each side; the `gap-2` spacing leaves room, so targets never overlap).
- N/A (only when `item.allowNA`): `value="na"`, `checked={value === null}`, `onChange={() => onChange(item.key, null)}`, visible text stays `N/A`, today's N/A classes.
- Unanswered (`undefined`) leaves every radio unchecked. Do NOT add `required` or `aria-required`: nothing enforces it, and inside the edit `<form>` a native `required` would block submission. The visible `*` gets `aria-hidden="true"` (owner may decide otherwise; see Decisions).
- `RatingScale` takes an `id` prop and keeps its markup. `RatingStep` creates `scaleId` with `useId` and passes it to `RatingScale` and every `RatingItem` (new optional prop `describedBy`).
- Native radios give arrow-key movement and selection, Tab into and out of the group, and the checked state for free. Handlers call the same `onChange(key, value)` as today, so state, and therefore payload, is unchanged.

### P6. One dialog (`src/components/ui/Dialog.tsx`)

APG modal dialog on a native `<dialog>`:

- Props: `onClose: () => void`, `labelledBy?: string`, `ariaLabel?: string` (exactly one of the two), `describedBy?: string`, `initialFocusRef?: RefObject<HTMLElement>`, `returnFocusFallback?: () => HTMLElement | null`, `className?: string` (the dialog box), `children`. The parent mounts it to open it and unmounts it to close it, matching today's `{show && <VerificationModal />}` usage.
- On mount (`useEffect`; the dialog only ever mounts after a click, never during server rendering): remember `document.activeElement` as the opener; call `dialog.showModal()` when available (otherwise `setAttribute('open', '')`); focus `initialFocusRef`, else the first focusable descendant, else the dialog itself (`tabIndex={-1}`).
- Close paths, all calling `onClose` once (guard against double calls): the native `cancel` event (`preventDefault()`, then `onClose`); a `keydown` Escape handler on the dialog (happy-dom and older browsers do not fire `cancel`); a click whose `target` is the `<dialog>` element itself (the backdrop).
- Focus trap: a `keydown` Tab handler that wraps from the last focusable descendant to the first and Shift+Tab the other way. Native `showModal` already makes the page inert in real browsers; the explicit wrap keeps focus inside the dialog rather than escaping to browser chrome, and is what the unit tests can see (happy-dom's `showModal` only sets `open`).
- On unmount: `dialog.close()` if still open, then restore focus to the opener if it is still connected and focusable, else `returnFocusFallback?.()`, else the page `h1` (give it `tabindex="-1"`), else `#main-content`.
- Styling keeps today's look: the `<dialog>` gets `m-auto w-[calc(100%-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] bg-transparent p-0 overflow-visible backdrop:bg-black/50`, and the existing panel `div` (with `relative bg-white rounded-xl shadow-xl p-6`, plus `overflow-y-auto max-h-[calc(100dvh-2rem)]`) goes inside. Compare screenshots at 1280 and 375 before and after.

### P7. Disclosure as an overlay button

For the building unit cards and the six admin row headers, keep the existing header `div`, its classes (including `cursor-pointer`, which the e2e specs select) and its inner markup unchanged, and add a native button over it:

```tsx
<div className="relative p-4 cursor-pointer hover:bg-gray-50 transition-colors">   {/* existing header, onClick removed */}
  ...existing content, the title element gets id={titleId}...
  <button
    type="button"
    className="absolute inset-0 z-10 w-full h-full cursor-[inherit] rounded-[inherit]"
    aria-labelledby={titleId}
    aria-expanded={expanded}
    aria-controls={expanded ? panelId : undefined}
    onClick={toggle}
  />
</div>
```

- Why an overlay and not "turn the div into a button": the header contains block elements and a heading, which a `button` may not contain; the unit tests query `.unit-card ... p.text-xs` (`buildingEarlyRating.test.ts`) and `P` tags in the admin header (`reviewsTableRowLayout.test.tsx`); and the e2e specs click `.cursor-pointer` and walk to the card with `locator('..')`. The overlay keeps all of that working, keeps the heading a heading, and still gives a native button with name, `aria-expanded` and `aria-controls`.
- Do NOT put the literal class `cursor-pointer` on the overlay button: `admin-actions.spec.ts` and `security.spec.ts` index `.cursor-pointer` elements (`nth(1)`), and a second match per row would shift every index. `cursor-[inherit]` keeps the pointer.
- Use `aria-controls` only while expanded when the panel is conditionally rendered (React tables). Where the panel is always in the DOM (the building page), set it always.
- The overlay blocks clicks on anything under it. Every header this applies to was audited to contain no other control; check again before applying it anywhere else.

### P8. Native `<details>` stays native

The records ledger rows (`LedgerRow.astro`), "Show all" (`ShowAll.astro`), "Report a record error" (`BuildingRecords.astro` ~403) and the six methodology weight cards (`methodology.astro`) are native `details`/`summary`. They already expose expanded state, work without JavaScript and need no `aria-controls`. They meet A11Y-07's "native control with expanded state"; this plan keeps them and adds a semantic test. The headings inside `summary` may be flattened by Safari with VoiceOver: an owner check, not a code change.

---

## Decisions taken here (owner-visible, flag in the PR)

| # | Decision | Why | Owner can reverse by |
|---|---|---|---|
| 1 | Rating pills keep the label "N/A"; the spec's "Not rated" is not adopted | The task fixes survey wording; changing a label is a copy change | Asking for "Not rated" (one string in `RatingItem.tsx`) |
| 2 | `role="radiogroup"` with `aria-labelledby` (dimension plus statement) instead of `fieldset`/`legend` | Same semantics, unchanged layout, HelpTooltip stays out of the group name | No action needed |
| 3 | 44x44 targets via an invisible hit area; the visible pill stays 40x40 | Spec section 8 asks for 44x44 without a look change | Asking for a larger visible pill |
| 4 | The required `*` is hidden from assistive technology | Nothing enforces it; announcing "star" misleads | Asking for it to be explained in text instead |
| 5 | Ledger rows, Show all, Report a record error and methodology cards stay native `details` | They already meet A11Y-07 and work without JS | Asking for button-plus-script disclosures |
| 6 | The desktop step indicator becomes an `<ol>` with each label under its circle (`text-xs`) | Fixes the 87-215px horizontal overflow at 1024-1440; copy unchanged | Choosing a different layout that fits 704px |
| 7 | The keyboard-active dropdown option gets a 2px inset teal outline as well as the tint | The tint alone is 1.06:1 against white | Choosing a different indicator of 3:1 or more |
| 8 | Site-wide focus indicator: 2px teal-700 outline, 2px offset; white on the footer and the dark hero | One consistent indicator of 3:1 or more | Choosing another color of 3:1 or more |
| 9 | "Write a review" in the home dropdown becomes its own option (no longer an `<a>`); Enter or click still goes to the same URL | An option cannot contain a link (axe `nested-interactive`) | Asking for the APG grid popup instead |
| 10 | Admin score-badge contrast (54 nodes) is left as is | It is the score palette the 10-27 contrast pass left to the owner; admin only | A separate palette decision |

---

## File ownership by batch

| Batch | Owns |
|---|---|
| 1 Foundations | `global.css` (end block), `BaseLayout.astro`, `Header.astro`, `Footer.astro`, `admin/AdminLayout.astro`, `pages/search.astro`, `pages/auth/{signin,signup,forgot-password,reset-password}.astro`, `pages/bug-report.astro`, `pages/profile.astro` (banner only), `pages/building/[slug].astro` (banner only), `contact/ContactForm.tsx`, `records/RecordCorrectionForm.tsx`, `disputes/DisputeForm.tsx`, `profile/SettingsTab.tsx` (focus rings only), `BuildingMap.tsx`, new `src/lib/motion.ts`, the committed axe spec and dependency, this plan |
| 2 Comboboxes | new `src/lib/combobox.ts`, new `src/components/ui/useComboboxListbox.ts`, `AddressAutocomplete.tsx`, `HomeSearch.tsx`, `reviews/form-steps/AddressStep.tsx` |
| 3 Rating radio groups | `form-steps/RatingItem.tsx`, `form-steps/RatingStep.tsx`, `reviews/ReviewEditForm.tsx` (all but the other lane's hunks), `e2e/review-helpers.ts` |
| 4 Review form flow | `reviews/ReviewForm.tsx`, `form-steps/StepIndicator.tsx`, `form-steps/ConfirmStep.tsx`, `form-steps/AdditionalStep.tsx`, `form-steps/UnitDetailsStep.tsx` |
| 5 Dialogs and popups | new `src/components/ui/Dialog.tsx`, `profile/VerificationModal.tsx`, `profile/PostSubmitVerification.tsx`, `profile/ProfileDashboard.tsx`, `admin/VerificationQueue.tsx`, `reviews/HelpTooltip.tsx`, `ui/VerifiedBadge.astro`, `ui/BookmarkButton.tsx` |
| 6 Disclosures and admin | `pages/building/[slug].astro` (unit cards, breadcrumb), `BuildingRecords.astro` (report link focus only), admin `ReviewsTable` (header, chips, search ring), `BuildingsTable`, `LandlordsTable`, `ManagersTable`, `DisputesQueue`, `BugReportsTable`, `AuditLogTable`, `RecordCorrectionsQueue`, `UsersTable` |
| 7 Gate | `e2e/a11y.spec.ts` enforcement, new guard test, residual fixes |

New e2e spec `e2e/a11y-keyboard.spec.ts` is created in batch 1; each later batch appends its own `test.describe` block.

Seven batches, not six: the review form is split into the rating instrument (batch 3, which must prove the payload unchanged on its own green checkpoint) and the step flow (batch 4), because `ReviewEditForm.tsx` alone is over 900 lines and both halves are large. Batches run one after another in the same worktree; each leaves `npm test`, `npm run check` and `npm run build` green and its own e2e specs passing.

---

## Batch 1: foundations (A11Y-01 harness, A11Y-02, the four unnamed buttons' page-level half, search labels)

**Files:** see the ownership table.

**Steps.**

1. **Commit the baseline harness first** (it is already written and verified): `package.json`, `package-lock.json`, `e2e/a11y.spec.ts`, `e2e/review-helpers.ts`, `e2e/review.spec.ts`, and this plan. Commit: `test: add the Phase 28 axe baseline spec and implementation plan`.
2. **Global CSS (P1).** Append the block at the end of `src/styles/global.css`.
3. **Skip link and main target (P2)** in `src/components/layout/BaseLayout.astro`.
4. **Banner dismissals.** In `src/pages/building/[slug].astro` (~266) and `src/pages/profile.astro` (~59): replace the inline `onclick` with `type="button" aria-label="Close" data-dismiss="submitted-banner"` (and `data-dismiss="updated-banner"`), and add `aria-hidden="true"` to the svg. Add one delegated script to `BaseLayout.astro`: on a click on `[data-dismiss]`, remove the element with that id, then move focus to the page `main h1` (set `tabindex="-1"` on it first), falling back to `#main-content`. Inline handlers also block the deferred CSP `unsafe-inline` tightening, so none may remain in `src/pages`.
5. **Header (`src/components/layout/Header.astro`).**
   - Mobile menu button: `aria-expanded="false" aria-controls="mobile-menu"`. Keep `aria-label="Toggle menu"`. In the script, set `aria-expanded` from the menu's open state on every toggle. Escape while the menu is open closes it and, if focus was in the menu or on the button, returns focus to the button.
   - `<nav aria-label="Main">`.
   - Desktop notifications link: `aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}` and `aria-hidden="true"` on the badge and the svg (the label now carries the count).
6. **Footer (`Footer.astro`).** Nothing needed if the P1 `footer` variable applies; check the focus outline is white on its links in the browser.
7. **AdminLayout (`src/components/admin/AdminLayout.astro`).** `<nav aria-label="Admin">`; `aria-current="page"` on the active item (the `currentPage === item.id` branch); `[--focus-ring:#fff]` on the dark header bar's outer element; `aria-hidden="true"` on the nav icon svgs.
8. **Search page (`src/pages/search.astro` ~214-225).** Input `aria-label="Search by address, neighborhood, or landlord"` (an existing string). Select `aria-label="Search type"` (new). Both rings to `focus:ring-2 focus:ring-teal-700`.
9. **Auth pages** (`signin`, `signup`, `forgot-password`, `reset-password`) and `bug-report.astro`:
   - Error containers `role="alert"`, success containers `role="status"`. In the scripts, remove `hidden` before setting `textContent`, so the change is announced.
   - Password toggles: `aria-pressed="false"` in markup; the existing toggle script sets it to `"true"` when the password is shown. Eye svgs `aria-hidden="true"`. Keep the label "Toggle password visibility".
   - Inputs: `focus:ring-teal-500` to `focus:ring-teal-700`, and add `focus:ring-2` where the ring has no width today (the signin inputs at ~90/~110 are the known case).
10. **Focus-ring sweep, batch 1 files only:** in `ContactForm.tsx`, `RecordCorrectionForm.tsx`, `DisputeForm.tsx` and `SettingsTab.tsx`, replace `focus:ring-teal-500` and `focus:ring-teal-400` with `focus:ring-teal-700`, and add `focus:ring-2` where a `focus:outline-none` element has a ring color with no width. No other class changes. `RecordCorrectionForm.tsx` is read by the banned-words scan: change classes only.
11. **Reduced motion for the map.** New leaf `src/lib/motion.ts`: `export function prefersReducedMotion(): boolean` returning `typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches`. Add it to `LEAF_MODULES`. In `BuildingMap.tsx` (~179, ~362) call `map.setCenter(...)` instead of `map.panTo(...)` when it returns true, and skip the inline marker transform transition (~260) when it returns true. The map only runs on production (owner check).

**Tests to add.**

- `src/lib/__tests__/a11yLayout.test.ts` (Astro container, the `baseLayoutHead.test.ts` pattern):
  - the first element in `body` is `a[href="#main-content"]` with text "Skip to main content";
  - `main#main-content` has `tabindex="-1"`;
  - the header nav has `aria-label="Main"`; `#mobile-menu-button` has `aria-expanded="false"` and `aria-controls="mobile-menu"`, and `#mobile-menu` exists;
  - with a signed-in user and a stub `locals.runtime.env.DB` whose `prepare().bind().first()` resolves `{ count: 3 }`, the notifications link's `aria-label` is `Notifications, 3 unread`.
- `src/lib/__tests__/noInlineHandlers.test.ts`: scans `src/pages/**/*.astro` and `src/components/**/*.astro` raw source; no `onclick=` attribute (case-insensitive).
- `src/lib/__tests__/buildingSubmittedBanner.test.ts` (reuse the sqlite helper from `buildingPageLayout.test.ts`): with `?submitted=true`, the dismiss button has `type="button"`, `aria-label="Close"`, `data-dismiss="submitted-banner"`, and an `aria-hidden` svg.
- `src/lib/__tests__/authPagesA11y.test.ts` (container, the `authPageHeadings.test.ts` pattern): on each auth page the error container has `role="alert"`, each `.toggle-password` has `aria-pressed="false"`, and no input class list contains `focus:ring-teal-500`.
- `src/lib/__tests__/searchPageLabels.test.ts`: the search page's `input[name=q]` and `select[name=type]` have the two `aria-label`s (render with the sqlite helper if the page needs D1; otherwise assert on the source).
- `src/lib/__tests__/motion.test.ts`: stub `window.matchMedia` for true, false and missing.
- `src/lib/__tests__/globalCssA11y.test.ts`: `global.css` contains a `:focus-visible` rule using `--focus-ring` and a `prefers-reduced-motion: reduce` block.

**e2e.** Create `e2e/a11y-keyboard.spec.ts` (local only; reuse `prepare()` so Google is refused):

- `/` at 1280: the first Tab focuses the skip link and it is visible (non-zero bounding box); Enter, then `document.activeElement.id` is `main-content`.
- `/` at 375: `#mobile-menu-button` toggles `aria-expanded` between `false` and `true`; with the menu open, Escape closes it and focus is on the button.
- Signed in, `/building/<building-01 slug>?submitted=true&reviewId=review-001`: activate "Close" by keyboard; the banner is gone and focus is on the page `h1`.

Run `e2e/a11y-keyboard.spec.ts` and `e2e/a11y.spec.ts`. The a11y spec should now record zero `select-name` nodes and 4 fewer `button-name` nodes (8 on profile, 6 on building after submit; the dialog and clear buttons remain for batches 2 and 5).

**Checks.** `$HEAVY npm test`, `$HEAVY npm run check`, `$HEAVY npm run build`, then the two e2e specs.

**Commit.** `feat: add skip link, focus indicator, reduced motion and named controls (A11Y-02)`. Body lists the new strings: "Skip to main content", "Close", "Search type", "Main", "Admin", "Notifications, {n} unread".

---

## Batch 2: both address autocompletes as APG comboboxes (A11Y-03)

**Files:** new `src/lib/combobox.ts`, new `src/components/ui/useComboboxListbox.ts`, `src/components/AddressAutocomplete.tsx`, `src/components/HomeSearch.tsx`, `src/components/reviews/form-steps/AddressStep.tsx`, `src/lib/__tests__/clientLeafModules.test.ts`, tests listed below, and the e2e selectors listed below.

**Steps.**

1. **Pure logic and hook (P4).** Write `combobox.test.ts` first (see Tests), then `src/lib/combobox.ts`, then the hook.
2. **AddressAutocomplete.**
   - New props: `inputId?: string`, `labelledBy?: string`, `describedBy?: string`. The input gets `id={inputId}`, `aria-describedby={describedBy}` and the hook's `inputProps`. Keep `placeholder` (e2e and unit tests select by it) and `autoComplete="off"`.
   - Option list, in keyboard order: DB matches (group "Existing properties"), then predictions (in group "Other addresses" when DB matches exist, bare options otherwise), then the manual-entry row "Can't find your address? Enter it manually" as the last option (kind `manual`) whenever it shows today (`onManualEntry && inputValue.length >= 3`). Select runs today's handlers: `handleSelectDbMatch`, `handleSelectPrediction`, or close and call `onManualEntry`.
   - The popup renders when it does today; the `apiError` sentence and the "Powered by Google" footer stay in the wrapper, outside the listbox. The listbox has `aria-labelledby={labelledBy}`.
   - The popup shows when there are options OR `apiError`. When only `apiError` shows, the listbox has no options: render the listbox element only when it has at least one option.
   - Clear button: `aria-label="Clear address"` (new), `type="button"`, svg `aria-hidden="true"`; onClick also resets the active index to -1 and `setApiError(false)`, then refocuses the input (as today). Spinner svg `aria-hidden="true"`.
   - Status region (P4) with the 700ms settle rule: the count excludes the manual-entry option; when `apiError` is true the text is the existing sentence "Address search is temporarily unavailable. You can still enter your address manually below."
   - Escape with the popup closed and text present clears the input (same effect as the clear button, without moving focus).
   - Input ring: `focus:ring-teal-700`.
3. **HomeSearch.**
   - Input: the hook's `inputProps`; keep `aria-label="Search by address, neighborhood, or landlord"` and the placeholder. Listbox: `aria-label` with the same existing string.
   - Options: flatten `items` so each `building` item yields two options, `open` (today's button content: "See this building ->", score chip and count) and `review` (today's "Write a review" text, positioned exactly as today inside a `role="none"` relative row wrapper). The `review` option gets `aria-labelledby={`${reviewOptId} ${titleId}`}` so it reads "Write a review" plus the building title (no new string). Landlord and address items yield one option each. Flatten in the component; `homeSearchItems.ts` keeps its shapes and stays a leaf.
   - Groups: "On RateMyPlace" around the building and landlord options when `hasOwnRows`, "Other addresses" around the address options (the header element moves from inside the first address row to the group).
   - Decorative glyphs: wrap the `+` circle and the `->`-style arrows in `<span aria-hidden="true">` with the visible characters unchanged. Attribution svg `aria-hidden="true"`; the attribution stays outside the listbox.
   - Navigation goes through `browserNav.go(url)` from `src/lib/reviewPaths.ts` (already imported for `existingBuildingReviewPath`), not `window.location.href`, so tests can spy on it. `open` uses `homeItemHref(item)`; `review` uses today's `reviewHref(item.review)`.
   - Enter with no active option still submits the form to `/search?q=` (the hook returns `none`, and `handleSubmit` keeps its fallback). Escape-to-clear on a closed popup is HomeSearch's accessible clear behavior (no new visible button).
   - Status region and spinner `aria-hidden` as in AddressAutocomplete. Keep the hero ring classes (`focus:ring-teal-300` is a light ring on the dark hero and is correct). The Search button already gets a white outline from P1, because HomeSearch renders inside the hero's `.from-slate-800` container (the only element with that class).
4. **AddressStep.**
   - `const inputId = useId(), labelId = useId(), helpId = useId()`. The search label becomes `<label id={labelId} htmlFor={inputId}>`; the help paragraph gets `id={helpId}`; pass all three to AddressAutocomplete.
   - Lookup errors in search mode (they arrive while focus is still in the input): render inside an always-present `<div role="alert">`, with the visible red box only when there is an error.
   - Manual mode: the orphan `<label>` "Enter your building address" becomes `<p id={manualHeadingId}>` with identical classes, and the four inputs' container gets `role="group" aria-labelledby={manualHeadingId}`. The manual Continue disables itself while loading, so its error follows P3 rule 1: the error container gets `tabIndex={-1}` and is focused (and scrolled into view) when `error` becomes non-null in manual mode.
   - The selected-place card: wrap the region that holds it in an always-rendered `<div aria-live="polite">`, so "This building is already in our system" or "This will be a new building in our system" is announced after a pick.
   - Rings in this file to `focus:ring-teal-700`.

**Tests.**

- `src/lib/__tests__/combobox.test.ts`: every key path above (open-first and open-last from closed, wrap both ways, Alt+Down, Enter with and without an active option, Escape open versus closed-with-text versus closed-empty, Tab, Home and End returning `none`), `clampActive`, and the three status strings.
- `src/lib/__tests__/addressAutocompleteCombobox.test.tsx` (render AddressStep with stubbed fetch as `reviewFormAddressStep.test.tsx` does):
  - `getByRole('combobox', { name: 'Search for your building address' })` exists with `aria-expanded="false"` and `aria-autocomplete="list"`;
  - after typing, `aria-expanded="true"`, `aria-controls` points at the `listbox`, the group "Existing properties" holds options, and the manual-entry option is last;
  - ArrowDown sets `aria-activedescendant` to the first option's id and that option has `aria-selected="true"`; ArrowUp from the first wraps to the manual option;
  - Enter on the manual option calls the manual-entry path;
  - Tab closes without selecting; Escape closes, then a second Escape clears;
  - `getByRole('button', { name: 'Clear address' })` clears and refocuses the input;
  - with fake timers, the status region reads `{n} results available` (n = the rendered option count, manual-entry option excluded) only after both fetches settle and about 700ms pass, and `No results` for an empty response;
  - no option is tabbable (`tabIndex` is not 0) and none contains a `button` or `a`.
- Update `reviewFormAddressStep.test.tsx` (~151, ~170): `getByRole('button', { name: /.../ })` becomes `getByRole('option', { name: /.../ })`. Keep its placeholder queries.
- Update `homeSearch.test.tsx`:
  - the `type()` helper uses `getByRole('combobox')`;
  - the "lists buildings we have first" and "another state" cases assert options instead of `button`/`a`: two `open` options containing "See this building", two `review` options named /Write a review/; clicking each `review` option calls a `browserNav.go` spy with `/review/new?building=b1` and `/review/new?placeId=gp-match`;
  - the address option contains "Start a review";
  - the placeholder test reads the combobox.
- Add to `homeSearch.test.tsx`: ArrowDown moves `aria-activedescendant` through building-open, building-review, landlord, address in order; Enter on the active option calls `browserNav.go`; Enter with no active option leaves `browserNav.go` uncalled (the form submit path); the status region text after results; the `+` glyph is inside an `aria-hidden` span.
- `clientLeafModules.test.ts`: add `'src/lib/combobox.ts'` to `LEAF_MODULES`.

**e2e selector updates (same commit).**

- `e2e/navigation.spec.ts` ~81, `e2e/pages.spec.ts` ~8, `e2e/a11y.spec.ts` ~508: `getByRole('textbox', { name: 'Search by address, neighborhood, or landlord' })` becomes `getByRole('combobox', { name: ... })`.
- `e2e/a11y.spec.ts` review walk: `getByRole('button', { name: /Enter it manually/ })` becomes `getByRole('option', { name: /Enter it manually/ })`.
- `e2e/review.spec.ts` ~393: the "Existing properties" row `locator('button', { hasText: ... })` becomes `getByRole('option', { name: ... })`.
- Append to `e2e/a11y-keyboard.spec.ts`, both comboboxes with the routed fictional suggestion: type, ArrowDown, `aria-activedescendant` names a visible option, Enter selects (home: the URL changes; review form: the selected card appears), Escape closes, Escape again clears, and the status region text matches `/result/`.

Run `e2e/a11y-keyboard.spec.ts`, `e2e/a11y.spec.ts`, `e2e/navigation.spec.ts`, `e2e/pages.spec.ts`, `e2e/review.spec.ts` (then `npm run db:setup`). In the a11y output, check that no `aria-required-children`, `aria-required-parent`, `nested-interactive` or `scrollable-region-focusable` finding appears on home or the review address step; the clear button's `button-name` nodes are gone.

**Checks.** `$HEAVY npm test`, `$HEAVY npm run check`, `$HEAVY npm run build`, then the e2e specs above.

**Commit.** `feat: give both address searches combobox and listbox semantics (A11Y-03)`. New strings: "Clear address", "{n} results available", "1 result available", "No results".

---

## Batch 3: rating questions as native radio groups in both forms (A11Y-04, edit-form labels)

**Files:** `src/components/reviews/form-steps/RatingItem.tsx`, `src/components/reviews/form-steps/RatingStep.tsx`, `src/components/reviews/ReviewEditForm.tsx`, `e2e/review-helpers.ts`, `e2e/review.spec.ts`, tests below.

**Step 1: prove the payload before touching the markup (TDD).**

Write `src/lib/__tests__/reviewFormPayload.test.tsx` against TODAY's button markup, with a `choose(groupIndex, label)` helper that clicks `getAllByRole('button', { name: label })` in the current step:

- **New form.** Reuse the Turnstile stub and `walkToConfirm` shape from `reviewFormSubmitRetry.test.tsx`, with `ReviewForm building={{ id: 'b1', address: '12 Example Rd', city: 'Boston' }}`. Answer, in this order: unit step items 1 to 3 as 5, 1 and 3; one building item that allows N/A as N/A; one landlord item as 4; leave everything else unanswered. Submit with a stubbed `fetch` and capture `Array.from((init.body as FormData).entries())`. Assert it equals a literal array written out in the test (the full entry list, `building_id` first, `cf-turnstile-response` last). Run it: it must pass on the old markup. That literal is the proof.
- **Edit form.** Render `ReviewEditForm` with a fixture built like the one in `reviewEditFormMoveOut.test.tsx` (fictional address), with `unit_structural: 4` and two more stored scores. Change two scores by clicking, tick the consent checkbox, submit with a never-settling `fetch` (as that test does) and capture `init.body`. Assert (a) the 27 score keys of `JSON.parse(body)`, in order, equal a literal `[key, value]` list including `null`s, and (b) the full body string equals the body produced by a second render whose fixture already holds the two new values and is submitted untouched. Part (b) proves the click path changes nothing else, and stays true when the other lane changes the tenure and move-out fields. Run it green on the old markup.

**Step 2: implement P5.**

- `RatingItem.tsx`: P5 exactly. Keep the outer `py-4 border-b ...` wrapper, the code, dimension, `*` and HelpTooltip header, and the statement paragraph byte-for-byte apart from the added ids and `aria-hidden` on `*`.
- `RatingStep.tsx`: `scaleId` via `useId`, passed to `RatingScale` and each `RatingItem`.
- `ReviewEditForm.tsx`: delete `renderRatingScale` and `renderRatingItem` and render `<RatingScale id={...} />` and `<RatingItem item={item} value={scores[item.key]} onChange={(k, v) => setScores({ ...scores, [k]: v })} describedBy={...} />` in their place, one `useId` per section. Remove imports that become unused (`HelpTooltip` and `SurveyItem` if nothing else uses them).
- Switch the payload test's `choose` helper to radios: `within(getAllByRole('radiogroup')[groupIndex]).getByRole('radio', { name: label })`, then `fireEvent.click`. The two literals must still pass unchanged.

**Step 3: the rest of ReviewEditForm (A11Y-08 on the edit page, P3).**

- Labels: give every control an `id` with the `review-edit-` prefix and its `<label>` a matching `htmlFor`: the controls at about lines 311, 327, 340, 355, 370, 458, 480, 496, 520, 597, 625, 723 (the move-in month and year pair at ~727 and ~747), 861 and 875. Verify each against the source; the code wins over these numbers.
- Group captions written as `<label>` around groups (~392, ~424, ~537, ~798, ~818) become `<span id=...>` with the same classes, and the group container gets `role="group" aria-labelledby`. Follow `UnitDetailsStep.tsx` ~30-37 for the move-in pair, whose selects take `aria-label="Move-in month"` and `aria-label="Move-in year"` (existing strings there).
- **Do not touch** the tenure select and the move-out select and their labels (~761-795): the other lane owns them. They stay unlabeled until main is merged (see Follow-ups).
- Save error: the error container gets `tabIndex={-1}`; keep an `errorSeq` counter incremented on every `setError(...)` in `handleSubmit`, and an effect on it focuses the container and scrolls it into view (P3 rule 1).
- Success panel: `tabIndex={-1}` on the panel, focused on mount. Copy unchanged, including the existing redirect.
- Rings: `focus:ring-teal-500` to `focus:ring-teal-700` on every line of this file EXCEPT the tenure and move-out selects (~767 and ~784 today).

**Tests.**

- `src/lib/__tests__/ratingItemRadioGroup.test.tsx`:
  - `getByRole('radiogroup')` has an accessible name containing the item's dimension and statement, and a description containing "Strongly Disagree";
  - five radios named "1" to "5", plus "N/A" only when `allowNA`;
  - nothing checked when `value` is `undefined`; "N/A" checked when `null`; "3" checked when `3`;
  - clicking "4" calls `onChange(key, 4)`; clicking "N/A" calls `onChange(key, null)`;
  - every radio has the same `name`;
  - the HelpTooltip button is outside the radiogroup;
  - the `*` has `aria-hidden="true"`;
  - the selected pill span carries today's color classes (`bg-red-600`, `bg-amber-400`, `bg-emerald-700`, `bg-gray-500` for N/A).
- `src/lib/__tests__/reviewEditFormA11y.test.tsx`:
  - every `input`, `select` and `textarea` other than the tenure and move-out selects has a non-empty accessible name (query each and check `getByLabelText` or the computed label), with an explicit, commented list of the two skipped controls;
  - the rating sections render radiogroups;
  - a Save with every rating cleared focuses the error container;
  - a successful Save (fetch resolves ok, fake timers so the redirect never runs) focuses the success panel.
- Update `reviewFormSubmitRetry.test.tsx` ~56: `getAllByRole('button', { name: '4' })[0]` becomes `getAllByRole('radio', { name: '4' })[0]`.

**e2e.**

- `e2e/review-helpers.ts`: `rateAllItemsInStep(page, score)` iterates `page.getByRole('radiogroup')` and, in each, clicks the visible label (`group.locator('label').filter({ hasText: new RegExp(`^${score}$`) })`), then asserts `group.getByRole('radio', { name: String(score) })` is checked. Return the group count. Clicking the label is what a user does; the input itself is visually hidden and Playwright's click on it would be intercepted.
- `e2e/review.spec.ts`: the direct `button[type="button"]` rating locators (~98-118 and ~207-219) move to the same radiogroup and label pattern, and assert `toBeChecked()` on the radios instead of counting buttons. Leave Continue, Back, Review & Submit and Submit Review selectors alone (still buttons).
- Append to `e2e/a11y-keyboard.spec.ts`: on `/review/new?building=building-30`, Continue to the unit rating step and Tab until focus enters the first radiogroup (it lands on radio "1", unchecked, because nothing is answered). Press ArrowRight twice: radio "3" is checked and focused. Press Tab: the focused element is not a radio of the same group (one Tab stop per group).

Run `e2e/review.spec.ts` (then `npm run db:setup`), `e2e/a11y.spec.ts`, `e2e/a11y-keyboard.spec.ts`.

**Checks.** As always. Also run `npm test -- reviewEditFormMoveIn reviewEditFormMoveOut` and confirm they pass untouched.

**Commit.** `feat: render every rating question as a native radio group (A11Y-04)`. The body states that the payload literals were captured on the old markup and pass unchanged. No new strings.

---

## Batch 4: review form progress, focus and errors (A11Y-05)

**Files:** `src/components/reviews/ReviewForm.tsx`, `src/components/reviews/form-steps/StepIndicator.tsx`, `src/components/reviews/form-steps/ConfirmStep.tsx`, `src/components/reviews/form-steps/AdditionalStep.tsx`, `src/components/reviews/form-steps/UnitDetailsStep.tsx`, tests below.

**Steps.**

1. **Step heading focus (ReviewForm).** Render `<h2 ref={stepHeadingRef} tabIndex={-1} className="sr-only">{`Step ${n} of ${STEPS.length}: ${STEPS[i].title}`}</h2>` directly under `<StepIndicator />`, built from `STEPS` in `types.ts` (existing words; the composition is a new sr-only string). A `useEffect` on `[step]` that skips the first render focuses it and scrolls the form's root element into view (`rootRef.current?.scrollIntoView?.({ block: 'start' })`), so the new step starts on screen after a Continue pressed at the bottom of a long step. Focus alone announces; do not add a live region.
2. **StepIndicator.**
   - Keep the `lg:hidden` compact text and progressbar unchanged (its test pins them).
   - Replace the `hidden lg:flex` row with `<ol aria-label="Review progress" className="hidden lg:flex items-start">`, one `<li className="relative flex-1 flex flex-col items-center text-center">` per step: the numbered circle (today's classes), then the title in `mt-1 text-xs text-gray-600` under it. The current step's `li` has `aria-current="step"`.
   - Connectors become an `aria-hidden="true"` span per non-last `li`: `absolute top-4 left-[calc(50%+1.25rem)] right-[calc(-50%+1.25rem)] h-1` with today's colors. Remove the `title` attributes and `whitespace-nowrap`.
   - The row must fit the 704px column: no horizontal overflow at 1024, 1280 or 1440.
3. **ConfirmStep.**
   - Split today's single banner into two containers with today's red-box classes. (a) Submit errors (the `error` prop): `tabIndex={-1}`, focused and scrolled into view when the new `errorSeq` prop changes and `error` is non-null. In `ReviewForm.handleSubmit`, increment `errorSeq` with every `setError(...)`, including the "Please rate at least one item before submitting your review." path. (b) Turnstile messages (`turnstileError`, the load-failed copy and its "Try again" button): inside an always-rendered `role="alert"` wrapper.
   - Submit button: `aria-describedby` pointing at an id on the privacy checkbox's text span and an id on the existing `aria-live` waiting paragraph.
   - The decorative warning svg (~163): `aria-hidden="true"`.
4. **AdditionalStep.**
   - Pest-type chips (~192-210): the `<label>` gets `has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-teal-700`.
   - The chip container gets `role="group" aria-labelledby` pointing at the "What pests did you encounter?" `<p>`, which gets an `id`.
   - Rings to `focus:ring-teal-700`.
5. **UnitDetailsStep.** Rings to `focus:ring-teal-700`, nothing else.

**Tests.**

- `src/lib/__tests__/reviewFormFocus.test.tsx`:
  - render `ReviewForm` with a building; click Continue; `document.activeElement` is an `h2` whose text is `Step 3 of 7: Your Unit`; Back returns focus to `Step 2 of 7: Unit Details`;
  - on first render nothing is focused by the form;
  - walk to confirm without rating anything, press Submit: the focused element contains "Please rate at least one item before submitting your review.";
  - with the Turnstile stub and a 500 response: the focused element contains the server error text;
  - the Turnstile load-failed copy renders inside `[role="alert"]`.
- Update `reviewFormStepIndicator.test.tsx`: keep both progressbar cases. Add: `getByRole('list', { name: 'Review progress' })` has 7 `listitem`s, exactly one with `aria-current="step"`, and for `unit-rating` it is the third and contains "Your Unit"; connector spans are `aria-hidden`.
- `reviewFormConfirmStep.test.tsx` and `reviewFormAdditionalStep.test.tsx` must stay green; extend the latter with the chip group's accessible name.

**e2e.** Append to `e2e/a11y-keyboard.spec.ts`:

- on `/review/new?building=building-30`, Continue by keyboard, and `document.activeElement` is the step `h2`;
- at viewports 1024x768, 1280x900 and 1440x900, every step from unit details to confirm has `scrollWidth <= clientWidth`.

Run it, `e2e/review.spec.ts` (then `npm run db:setup`) and `e2e/a11y.spec.ts`. The a11y record should show `horizontalOverflow: false` for every review scan at 1280.

**Checks.** As always.

**Commit.** `feat: announce review steps and move focus to errors predictably (A11Y-05)`. New sr-only string: "Step {n} of {total}: {title}" (built from existing step titles).

---

## Batch 5: one dialog, applied, plus the toggletip and status messages (A11Y-06, A11Y-05 resend state)

**Files:** see the ownership table.

**Steps.**

1. **Dialog (P6).** Write `dialog.test.tsx` first, then `src/components/ui/Dialog.tsx`.
2. **VerificationModal.**
   - Wrap in `<Dialog labelledBy={titleId} describedBy={introId} initialFocusRef={uploadRef} onClose={onClose} returnFocusFallback={...}>`; the `h2` and intro paragraph get the ids. Remove the hand-rolled backdrop and fixed wrapper.
   - Close button: `type="button" aria-label="Close"`, svg `aria-hidden="true"`. Cancel and Submit: `type="button"`.
   - Upload control: make the zone a `<label htmlFor={inputId}>` with today's classes and content; the file input becomes `className="sr-only"` with `id={inputId}` (not `hidden`, which is `display:none`); `uploadRef` points at the input. Keep the drag handlers on the label. Give the label `has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-teal-700` so keyboard focus shows on the zone.
   - After Remove, focus the upload input (via an effect when `file` becomes null after having been set). The preview `img` gets `alt=""` (the file name is shown beside it).
   - The error box goes inside an always-rendered `role="alert"` wrapper. The uploading spinner svg gets `aria-hidden="true"` (the "Uploading..." text stays).
   - Test documents: fictional `File` objects only, never real documents.
3. **PostSubmitVerification.** "Verify Now" gets `type="button"`. The success `<p>` gets `tabIndex={-1}` and is focused when `submitted` becomes true (the trigger is gone; P3 rule 1). Pass a `returnFocusFallback` that returns that paragraph.
4. **ProfileDashboard.**
   - The resend result renders inside an always-rendered wrapper: `role="status"` for success, `role="alert"` for failure (two wrappers, or one whose role is chosen before the text appears; never swap the role on a node that already holds text).
   - After the request, return focus to the resend button (P3 rule 3).
   - The VerificationModal opened from the reviews list gets `returnFocusFallback` that focuses the reviews tab button, because `fetchReviews()` after success may remove the "Verify" button.
   - Loading spinners (~347, ~379): wrap each in `role="status"` with an sr-only "Loading..." (existing string) and `aria-hidden` on the svg.
5. **Admin VerificationQueue.**
   - The thumbnail trigger (~162) becomes `<button type="button" aria-expanded={expanded}>` around the image, keeping its classes and the "Click to expand"/"Click to shrink" hint text.
   - The full-screen overlay (~239) becomes `<Dialog ariaLabel="Verification document" onClose={() => setExpandedImage(null)} className="...full-screen classes...">` with a visible close button `aria-label="Close"` focused first; Escape closes; focus returns to the thumbnail button.
6. **HelpTooltip (APG disclosure popover, not a modal).**
   - Drop `role="tooltip"`. The panel gets `id={useId()}`; the trigger gets `aria-controls` (while open) next to its `aria-expanded`.
   - Escape and the Close button set `isOpen(false)` and return focus to the trigger (`buttonRef.current?.focus()`).
   - Trigger focus style: replace `focus:outline-none focus:text-teal-700` with `rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700`, and add `p-1 -m-1` for a bigger hit area with no visual change.
   - Panel width: `w-80 sm:w-96 max-w-[calc(100vw-2rem)]` so it cannot cause horizontal scroll at 375.
   - Keep "Help for {dimension}" and "Close help".
7. **VerifiedBadge.astro (low priority, small).** The explanation span gets a per-instance `id` and `role="tooltip"`, and the focusable badge span gets `aria-describedby` pointing at it. A tiny `<script>` hides the visible tooltip on Escape while the badge has focus (a `data-dismissed` attribute that forces `opacity-0`, cleared on blur). Check `reviewCardTrustLabel.test.ts` stays green.
8. **BookmarkButton.** The toast text renders inside an always-rendered `<div role="status" className="...">`, with the visible pill only when there is a toast. Keep the swapping `aria-label` (no new strings).

**Tests.**

- `src/lib/__tests__/dialog.test.tsx` (happy-dom):
  - renders `role="dialog"` named by `labelledBy`;
  - initial focus goes to `initialFocusRef`, or the first focusable, or the dialog;
  - Tab on the last focusable moves to the first; Shift+Tab on the first moves to the last;
  - Escape keydown calls `onClose` once; a dispatched `cancel` event calls it once and is default-prevented; a click on the dialog element calls it, and a click inside the panel does not;
  - on unmount, focus returns to the opener; with the opener removed, to `returnFocusFallback()`, otherwise to the page `h1` or `#main-content`.
- `src/lib/__tests__/verificationModalA11y.test.tsx`:
  - the dialog is named "Verify Your Tenancy";
  - `getByRole('button', { name: 'Close' })` exists;
  - `getByLabelText(/Click to upload/)` resolves to the file input, which is not `display:none` (no `hidden` class);
  - choosing a fictional PNG then Remove returns focus to the file input;
  - an invalid type shows its message inside `[role="alert"]`.
- `postSubmitVerificationCopy.test.tsx` and `profileDashboardTabs.test.tsx` stay green. Add to the first: after a successful upload (stubbed fetch), the success paragraph has focus.
- `src/lib/__tests__/helpTooltip.test.tsx`: no `role="tooltip"`; `aria-controls` points at the open panel; Escape and Close each close it and focus the trigger.
- `src/lib/__tests__/verificationQueueOverlay.test.tsx`: stub the queue fetch with one fictional image row; the thumbnail button toggles `aria-expanded`; the overlay is a dialog named "Verification document"; Escape closes and focuses the thumbnail button.
- `src/lib/__tests__/bookmarkButtonStatus.test.tsx`: the toast text appears inside `[role="status"]`.

**e2e.** Append to `e2e/a11y-keyboard.spec.ts`:

- signed in, on the building page with `?submitted=true&reviewId=review-001`, activate "Verify Now" by keyboard; focus is inside the dialog; 15 Tab presses never leave it; Escape closes it; focus is back on "Verify Now";
- the same from `/profile` with the list's "Verify" button.

Run it and `e2e/a11y.spec.ts`: no `button-name` nodes should remain anywhere.

**Checks.** As always.

**Commit.** `feat: add one accessible dialog and apply it to verification (A11Y-06)`. New string: "Close" (VerificationModal and the admin image overlay; already introduced in batch 1).

---

## Batch 6: disclosures and admin expanders as native buttons (A11Y-07)

**Files:** see the ownership table, plus e2e specs only if a selector breaks (P7 is designed so none should).

**Steps.**

1. **Building unit cards (`src/pages/building/[slug].astro` ~453-566).** Apply P7:
   - the `.unit-card` div gets `relative` and keeps everything else, including `data-expanded`;
   - the unit name `h4` gets `id={`unit-name-${index}`}`;
   - an overlay `<button type="button" class="absolute inset-0 z-10 w-full h-full cursor-[inherit] rounded-[6px]" aria-labelledby={`unit-name-${index}`} aria-expanded={index === 0 ? 'true' : 'false'} aria-controls={`unit-reviews-${index}`}>` is the card's last child;
   - the panel gets `id={`unit-reviews-${index}`}`;
   - the chevron svg gets `aria-hidden="true"` and `motion-reduce:transition-none`.
   - Rewrite the script to listen on the overlay buttons: find the panel by `aria-controls`, toggle its `hidden` class, the button's `aria-expanded`, the card's `data-expanded` and the chevron rotation.
   - The breadcrumb `nav` gets `aria-label="Breadcrumb"` (new).
2. **Report a record error (`BuildingRecords.astro` ~436-454).** When the `#report-record` link opens the `details`, move focus to its `summary`. Class and script changes only: the banned-words scan reads this file, comments included.
3. **Admin row headers.** Apply P7 to the six headers:
   - `ReviewsTable` ~238-310: change only the header `div` opening (remove `onClick`, add `relative`), the `h3` id, and the added button at the end of the header. Leave the score and status block (~286-292) and the chevron alone: the other lane edits the N/A color there.
   - `BuildingsTable` ~330, `LandlordsTable` ~349, `ManagersTable` ~308, `DisputesQueue` ~216, `BugReportsTable` ~179: the same.
   - The expanded panel `div` in each gets `id={`<kind>-panel-${row.id}`}`. Move each header's existing `onClick` body (ReviewsTable's fetch-on-expand included) into the button's `onClick`, unchanged.
4. **AuditLogTable (~168).** Keep the `tr` click for mouse users. In the first cell, wrap today's date text in `<button type="button" className="text-left" aria-expanded={isExpanded} aria-controls={isExpanded ? `audit-details-${log.id}` : undefined} onClick={(e) => { e.stopPropagation(); toggle(); }}>`, so the always-visible date is the toggle in both states and its accessible name (no new string, no visual change). The expanded details `div` in the last cell gets the id. Keep the "Click to expand" hint text as it is.
5. **RecordCorrectionsQueue (~258).** Add `aria-controls={`correction-panel-${item.id}`}` (while expanded) and the matching id on the expanded `div` (~270). Keep its labels (owner choice).
6. **Filter and sort chips.** Add `aria-pressed={selected}` (no visual change): `UsersTable.tsx` ~124, `ReviewsTable.tsx` ~217, `DisputesQueue.tsx` ~167/~182/~192, `BugReportsTable.tsx` ~159, `RecordCorrectionsQueue.tsx` ~189.
7. **Rings** in the admin files this batch edits: `focus:ring-teal-500` to `focus:ring-teal-700`, except inside the other lane's ReviewsTable hunks. The admin contrast guard must stay green.

**Tests.**

- `src/lib/__tests__/buildingUnitDisclosure.test.ts` (Astro container with the sqlite helper; seed a building with reviews in two unit types):
  - each `.unit-card` contains exactly one `button[aria-controls]` whose target id exists;
  - the first is `aria-expanded="true"` with a visible panel, the rest `"false"` with the `hidden` class;
  - each button's `aria-labelledby` points at the unit name;
  - the breadcrumb nav is labelled.
  - `buildingEarlyRating.test.ts` must pass unchanged.
- `src/lib/__tests__/adminExpanders.test.tsx`: for each of the six tables (stub its list fetch with one fictional row; reuse the existing stubs in `reviewsTableRowLayout.test.tsx`, `adminBuildingsTable.test.tsx`, `landlordsTableDeepLink.test.tsx` and `adminNamedPartyVisibility.test.tsx`):
  - `getByRole('button', { name: <row title>, expanded: false })`; clicking it gives `expanded: true` and `aria-controls` naming an element in the document;
  - Enter on the focused button (via `userEvent.keyboard`) toggles it too;
  - AuditLogTable's button toggles and `stopPropagation` prevents a double toggle;
  - chips report `aria-pressed`.
  - `reviewsTableRowLayout.test.tsx` must pass unchanged.
- `src/lib/__tests__/nativeDisclosures.test.ts`: `LedgerRow.astro`, `ShowAll.astro`, the report form in `BuildingRecords.astro` and `methodology.astro` render `details > summary` (container render where cheap, source scan otherwise). This records decision 5.

**e2e.**

- `e2e/a11y.spec.ts` building walk: `.unit-card[data-expanded="false"]` clicks keep working (the click lands on the overlay button inside the card); keep it, or switch to `getByRole('button', { expanded: false })` scoped to `#unit-list`.
- Admin specs (`admin-actions.spec.ts`, `critical-flows.spec.ts`, `security.spec.ts`) should pass unchanged because the `.cursor-pointer` header and its parent card are unchanged. Run them to prove it.
- Append to `e2e/a11y-keyboard.spec.ts`: on the building page, Tab to the second unit card's button, press Enter, `aria-expanded` is `true` and its panel is visible; press Space, collapsed again. As the seed admin on `/admin/reviews`, Tab to the first row button and press Enter; "Reset to Pending" or another expanded control appears.

Run `e2e/a11y-keyboard.spec.ts`, `e2e/a11y.spec.ts`, `e2e/admin-actions.spec.ts`, `e2e/critical-flows.spec.ts`, `e2e/security.spec.ts` (then `npm run db:setup`; these write locally).

**Checks.** As always.

**Commit.** `feat: make unit cards and admin rows native disclosure buttons (A11Y-07)`. New string: "Breadcrumb".

---

## Batch 7: the gate (A11Y-01 and A11Y-08)

**Files:** `e2e/a11y.spec.ts`, new `src/lib/__tests__/focusIndicatorTokens.test.ts`, and the smallest fixes for whatever the gate finds.

**Steps.**

1. **Enforce.** In `e2e/a11y.spec.ts`:
   - `ENFORCE_CONTRIBUTION_PATH = true`;
   - mark the profile scans `contributionPath: true` (email and residency verification are on the path in spec section 8);
   - when enforcing, also `expect.soft(horizontalOverflow).toBe(false)` for contribution-path scans;
   - update the header comment (it now asserts).
2. **200% zoom.** Add a third viewport `{ name: 'zoom-200', width: 640, height: 450 }` (1280x900 at 200%) to `VIEWPORTS`, scanned like the others.
3. **Edit page.** Add a scan of `/review/edit/review-001` (seed user) with `contributionPath: false` and a comment: flip to `true` after main is merged and the tenure and move-out selects are labelled (Follow-ups). It is still recorded and reported.
4. **Reduced motion.** Append to `e2e/a11y-keyboard.spec.ts`: with `page.emulateMedia({ reducedMotion: 'reduce' })` on the unit rating step, the computed `transition-duration` of a pill span is at most `0.01ms`, and the HomeSearch spinner (while a routed request is pending) has `animation-duration` at most `0.01ms`.
5. **Guard.** `focusIndicatorTokens.test.ts` scans `src/**/*.{astro,tsx,ts,css}` outside `__tests__` and `src/pages/api/` for `focus:ring-teal-400`, `focus:ring-teal-500`, `focus-visible:ring-teal-400` and `focus-visible:ring-teal-500`, building the patterns from plain strings as `contrastTokens.test.ts` does. Expected count: zero everywhere, except an explicit allowance of 2 for `src/components/reviews/ReviewEditForm.tsx` (the other lane's two selects), with a comment saying to set it to 0 when main is merged. If a file outside the batches still has occurrences (admin files not edited in batch 6, for example), sweep them here; the sweep is mechanical and these files are not the other lane's hunks (check first).
6. **Run the full gate.** `npm run db:setup`, `$HEAVY npm run build`, `$HEAVY npx playwright test e2e/a11y.spec.ts e2e/a11y-keyboard.spec.ts`. Fix every serious or critical finding on a contribution-path scan with the smallest change in the owning file, following the patterns above. Expected remaining findings: admin `color-contrast` on the score badges (decision 10), not enforced. Anything else gets fixed or, if it needs an owner call, is listed in the result with its rule, node count and source.
7. **Full regression.** `npm run db:setup`, then `$HEAVY npx playwright test` (all specs), then `npm run db:setup` again. If sign-in rate-limits, clear `rate_limits` locally (see the harness section) and re-run only the failed specs.
8. Write the batch result with the per-rule summary from `test-results/a11y-baseline.json` (copy the file to the lane scratchpad first; Playwright wipes `test-results/` on the next run), the list of new strings from every batch, and the owner checklist below.

**Checks.** `$HEAVY npm test`, `$HEAVY npm run check`, `$HEAVY npm run build`, the full Playwright run.

**Commit.** `test: enforce zero serious or critical axe findings on the contribution path (A11Y-08)`.

---

## Done when

- `npm test`, `npm run check` and `npm run build` are clean on the branch head.
- `e2e/a11y.spec.ts` passes with enforcement on at 1280x900, 375x812 and 640x450: zero serious or critical axe violations and no horizontal overflow on every contribution-path scan (home, search, auth, every review step, building, building after submit with the dialog open, profile with the dialog open).
- `e2e/a11y-keyboard.spec.ts` passes: skip link, mobile menu state, both comboboxes by keyboard, radio groups by arrow keys, step-heading focus, dialog trap, Escape and restore, unit cards and admin rows by Enter and Space, reduced motion.
- The whole Playwright suite passes locally. e2e is not in CI.
- The payload literals in `reviewFormPayload.test.tsx`, captured on the pre-change markup, pass unchanged.

## Manual checks only the owner can do

Seed data or fictional files only; never real verification documents.

1. **NVDA with Firefox and Chrome** (cannot run here):
   - both address comboboxes announce their label, expanded and collapsed, the result count, and the active option as you arrow; Escape closes, Escape again clears; "Clear address" works;
   - each rating question reads its dimension and statement on entry, then "1" to "5" and "N/A" with checked state and position, in browse and focus mode;
   - Continue and Back announce "Step N of 7: ..." and land there; a failed submit reads the error; the edit form's Save error and success panel are read;
   - the verification dialog is announced by name, Tab stays inside, Escape closes, focus returns to "Verify Now" or "Verify" (or to the success text);
   - unit cards and admin rows say expanded or collapsed; records ledger rows (native `details`) do too;
   - the skip link reaches main; the mobile menu button reports expanded state; the bookmark toast and the resend result are announced once, not twice.
2. **VoiceOver with Safari:** whether headings inside `summary` (records ledger, methodology cards, report form) still appear in the headings list (decision 5).
3. **Production only:** the real Google Places dropdown with the combobox (result count timing with real latency, attribution outside the list); the map with OS reduced motion on (no `panTo` animation, no marker transition); the Turnstile widget's own keyboard and screen-reader behavior.
4. **Manual passes:** browser zoom at 200% and 400% on home, review steps and the building page; a 375px phone with the HelpTooltip opened on a right-edge question; OS-level reduced motion on.
5. **Owner decisions** in the table above (1-10), especially the desktop step indicator layout (6), the dropdown active outline (7) and the admin score-badge palette (10).

## Out of scope and follow-ups

- **Follow-up after main is merged into this branch (lead):** the other lane's tenure and move-out selects in `ReviewEditForm.tsx` need `htmlFor`/`id` and `focus:ring-teal-700`; then set the guard allowance for that file to 0 and flip the edit-page scan to `contributionPath: true`.
- Admin score-badge contrast (`scoring-colors.ts` palette): owner decision; not changed.
- Survey wording, the "Not rated" label, visible 44x44 pills, explaining the `*`: owner decisions.
- Converting native `details` disclosures to button-plus-script disclosures.
- An APG grid popup for the home dropdown.
- Map marker keyboard access beyond reduced motion (production-only; needs its own review).
- `NotificationsTab.tsx` spinner semantics (the other lane is editing that file; the global reduced-motion rule already covers its animation).
- CSP `unsafe-inline` tightening (this phase only removes the two inline handlers that blocked it).
- `UnitTypeSummary.astro` (being deleted by the other lane).

## New accessible-name strings

| String | Where | Batch |
|---|---|---|
| Skip to main content | BaseLayout skip link | 1 |
| Close | building and profile banner dismiss, VerificationModal close, admin image overlay close | 1, 5 |
| Search type | `/search` type select | 1 |
| Main | header nav | 1 |
| Admin | AdminLayout nav | 1 |
| Notifications, {n} unread | header notifications link when unread | 1 |
| Clear address | AddressAutocomplete clear button | 2 |
| {n} results available / 1 result available / No results | combobox status regions (sr-only) | 2 |
| Step {n} of {total}: {title} | review form step heading (sr-only, built from existing step titles) | 4 |
| Breadcrumb | building page breadcrumb nav | 6 |

Reused, not new: "Search by address, neighborhood, or landlord", "Loading...", "Review progress", "Help for {dimension}", "Close help", "Toggle menu", "Toggle password visibility", "Verification document", "Move-in month", "Move-in year", the existing address-search error sentence.
