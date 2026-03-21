---
phase: 11-schema-survey-fields-and-contact-form
verified: 2026-03-21T18:26:44Z
status: human_needed
score: 12/12 must-haves verified
re_verification: false
human_verification:
  - test: "Submit a review with both survey fields set"
    expected: "Values 'yes'/'no'/'unsure' stored in reviews.accepts_housing_vouchers and reviews.safely_lit_at_night"
    why_human: "Cannot run Playwright in this environment; DB write requires live Turnstile bypass"
  - test: "View a review card for a review with survey field data"
    expected: "Colored pills appear: green for yes, red for no, gray for unsure (Section 8); green/amber/gray (lighting)"
    why_human: "Visual rendering cannot be verified by grep"
  - test: "View a review card for an older review (null survey fields)"
    expected: "No pill section rendered at all — null guard works"
    why_human: "Requires live render to confirm conditional block truly hides"
  - test: "Submit the contact form at /contact"
    expected: "Success message shown; record appears in D1 contact_messages; confirmation email sent to submitter"
    why_human: "Requires live Turnstile widget and Resend API credentials"
  - test: "Visit /admin/contact as admin"
    expected: "Table shows submitted messages with date, name, email, category, message preview, status"
    why_human: "SSR admin page requires live session"
  - test: "Visit /admin/contact as non-admin or unauthenticated"
    expected: "Redirected to / (non-admin) or /auth/signin (unauthenticated)"
    why_human: "Requires live session to verify redirect behavior"
  - test: "Verify remote migration sequence for 0019_ prefix collision"
    expected: "Both 0019_reserved.sql and 0019_survey_fields.sql apply correctly to remote D1 without ordering errors"
    why_human: "Remote migration state cannot be verified locally; duplicate prefix is a known deployment risk"
---

# Phase 11: Schema, Survey Fields, and Contact Form — Verification Report

**Phase Goal:** Two new public health survey dimensions are collected from new reviews, a working contact form replaces the static mailto link, and all migration numbers for the milestone are pre-assigned to prevent collisions
**Verified:** 2026-03-21T18:26:44Z
**Status:** human_needed (all automated checks passed; 7 items require human or remote verification)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | New review form shows Section 8 / Housing Choice Voucher acceptance question with Yes/No/Unsure options | VERIFIED | `AdditionalStep.tsx` renders `supplementaryItems.housingVouchers` options mapped to radio inputs |
| 2 | New review form shows safely lit at night question with Yes/No/Unsure options | VERIFIED | `AdditionalStep.tsx` renders `supplementaryItems.safelyLit` options mapped to radio inputs |
| 3 | Submitted values for both fields stored via both POST (create) and PATCH (edit) | VERIFIED | `api/reviews.ts` INSERT includes `accepts_housing_vouchers, safely_lit_at_night`; `api/reviews/[id].ts` UPDATE SET clause includes both columns |
| 4 | Edit form loads existing values and includes them in PATCH payload | VERIFIED | `ReviewEditForm.tsx` initializes state from `review.accepts_housing_vouchers` and `review.safely_lit_at_night`; both appear in `handleSubmit` JSON body |
| 5 | New fields display on public review cards with color-coded pills | VERIFIED (automated) | `ReviewCard.astro` lines 457-475: conditional renders colored pills per value |
| 6 | Older reviews without data show no field | VERIFIED (automated) | `ReviewCard.astro` wraps pill block in `(review.accepts_housing_vouchers != null \|\| review.safely_lit_at_night != null)` guard |
| 7 | Contact page shows a working form with name, email, category dropdown, and message body | VERIFIED | `contact.astro` mounts `<ContactForm client:load />`; `ContactForm.tsx` renders all four fields plus Turnstile widget |
| 8 | Form submission stores the message in D1 contact_messages table | VERIFIED | `api/contact.ts` line 72: `INSERT INTO contact_messages (id, name, email, category, message)` after Turnstile + rate limit checks |
| 9 | Submitter receives a confirmation email | VERIFIED (automated) | `api/contact.ts` calls `sendContactConfirmationEmail` best-effort; function defined in `email.ts` line 253 |
| 10 | Admin panel has a Contact tab showing all submissions | VERIFIED | `admin/contact.astro` queries `contact_messages` directly via D1; `AdminLayout.astro` union type includes `'contact'`; nav item present |
| 11 | Contact form rejects submissions without valid Turnstile token | VERIFIED | `api/contact.ts` calls `verifyTurnstile()` before processing; returns 400 on failure |
| 12 | Contact form rate-limits to 3 submissions per hour per IP | VERIFIED | `api/contact.ts` line 31: `checkRateLimit(db, ip, 'contact', 3, 3600)` |

**Score:** 12/12 truths verified (automated) — 7 require human/remote confirmation

### Required Artifacts

#### Plan 01 — Survey Fields

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `migrations/0019_survey_fields.sql` | ALTER TABLE adding both columns | VERIFIED | Contains two `ALTER TABLE reviews ADD COLUMN` statements |
| `src/lib/surveyItems.ts` | `housingVouchers` and `safelyLit` entries | VERIFIED | Lines 561-578: both entries with Yes/No/Unsure options |
| `src/components/reviews/form-steps/types.ts` | `ReviewData.housingVouchers` and `safelyLit` fields | VERIFIED | Lines 62-63: `housingVouchers: string \| null` and `safelyLit: string \| null` |
| `src/pages/api/reviews.ts` | INSERT SQL includes new columns | VERIFIED | Lines 158, 250-251: columns in INSERT list and bind call |
| `src/components/reviews/ReviewEditForm.tsx` | Edit form state, UI, and PATCH payload | VERIFIED | Lines 104-105 (state), 167-168 (payload), 775-807 (UI) |
| `src/pages/api/reviews/[id].ts` | PATCH UPDATE SQL and ReviewDetail interface | VERIFIED | Lines 81-82 (interface), 309-310 (SET), 375-376 (bind) |
| `src/components/reviews/ReviewCard.astro` | Null-guarded pill display | VERIFIED | Lines 457-476: full conditional with per-value color logic |

#### Plan 02 — Contact Form

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `migrations/0020_contact_messages.sql` | CREATE TABLE contact_messages with indexes | VERIFIED | Full schema with 2 indexes; applied locally |
| `migrations/0021_reserved.sql` | SELECT 1 placeholder | VERIFIED | `SELECT 1;` — slot reserved |
| `migrations/0022_reserved.sql` | SELECT 1 placeholder | VERIFIED | `SELECT 1;` — slot reserved |
| `src/pages/api/contact.ts` | POST handler with Turnstile, rate limit, D1 insert, emails | VERIFIED | 99-line file; all four mechanisms confirmed present |
| `src/components/contact/ContactForm.tsx` | React island with Turnstile widget | VERIFIED | 186-line file; all fields + `.cf-turnstile` div present |
| `src/pages/admin/contact.astro` | Admin page with auth gate and messages table | VERIFIED | Double auth gate (user check + isAdmin); direct D1 query |
| `src/lib/email.ts` | `sendContactConfirmationEmail` and `sendContactNotificationEmail` | VERIFIED | Lines 253 and 328 respectively |

### Key Link Verification

#### Plan 01

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `AdditionalStep.tsx` | `surveyItems.ts` | `import supplementaryItems` | WIRED | Line 1 import; `supplementaryItems.housingVouchers` used at line 106 |
| `ReviewForm.tsx` | `/api/reviews` | `formData.append` for new fields | WIRED | Lines 218-219 append both fields with `?? ''` coercion |
| `api/reviews.ts` | reviews table | INSERT SQL with both columns | WIRED | Columns in INSERT list (line 158) and bind values (lines 250-251) |
| `ReviewEditForm.tsx` | `/api/reviews/[id]` | JSON body includes both fields | WIRED | Lines 167-168 in `handleSubmit` |
| `api/reviews/[id].ts` | reviews table | UPDATE SET clause with both columns | WIRED | Lines 309-310 in SET; lines 375-376 in bind |
| `ReviewCard.astro` | reviews table | null-guard on `review.accepts_housing_vouchers` | WIRED | Line 457: `(review.accepts_housing_vouchers != null \|\| ...)` |

#### Plan 02

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ContactForm.tsx` | `/api/contact` | `fetch('/api/contact', ...)` POST | WIRED | Line 53: `fetch('/api/contact', { method: 'POST', body: formData })` |
| `api/contact.ts` | `email.ts` | `sendContactConfirmationEmail` call | WIRED | Line 78: best-effort call with `.catch()` |
| `api/contact.ts` | D1 contact_messages | INSERT INTO contact_messages | WIRED | Line 72: full INSERT with all fields |
| `admin/contact.astro` | contact_messages | SSR direct D1 query | WIRED | Line 19: `SELECT * FROM contact_messages ORDER BY created_at DESC` (intentional deviation from plan — plan specified API endpoint fetch, implementation uses SSR direct query; goal is equivalent) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| SURVEY-01 | 11-01 | Review form includes Section 8 / Housing Choice Voucher acceptance question (yes/no/unsure) | SATISFIED | `AdditionalStep.tsx` renders full radio group from `supplementaryItems.housingVouchers` |
| SURVEY-02 | 11-01 | Review form includes "safely lit at night" question | SATISFIED | `AdditionalStep.tsx` renders full radio group from `supplementaryItems.safelyLit` |
| SURVEY-03 | 11-01 | New fields displayed on public review cards (omitted for older reviews without data) | SATISFIED | `ReviewCard.astro` null guard + colored pills confirmed |
| CONTACT-01 | 11-02 | Contact page has a working form with name, email, category dropdown, message body | SATISFIED | `ContactForm.tsx` 186 lines; all four fields + Turnstile confirmed |
| CONTACT-02 | 11-02 | Submissions stored in D1; notification email sent | SATISFIED | INSERT confirmed; `sendContactNotificationEmail` called at line 83 |
| CONTACT-03 | 11-02 | Submitter receives confirmation email | SATISFIED | `sendContactConfirmationEmail` called best-effort at line 78 |
| CONTACT-04 | 11-02 | Contact submissions visible in admin panel alongside bug reports | SATISFIED | `/admin/contact` page with direct D1 query; nav item in AdminLayout |

No orphaned requirements detected — all 7 requirement IDs (SURVEY-01/02/03, CONTACT-01/02/03/04) are claimed in plan frontmatter and verified in the codebase.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `migrations/0019_reserved.sql` + `migrations/0019_survey_fields.sql` | Duplicate `0019_` prefix in migration filenames | WARNING | Both applied locally (wrangler shows no pending), but ambiguous alphabetical ordering (`0019_reserved` < `0019_survey_fields`) could cause confusion on remote re-apply or future migration tooling |

No stub implementations, empty handlers, TODO/FIXME comments, or placeholder components found in phase files.

### Human Verification Required

#### 1. Survey field data round-trip

**Test:** Submit a new review via the review form; navigate to the Additional step and set "Section 8: Yes" and "Safely lit: No". Complete submission.
**Expected:** Review card shows a green "Accepted" pill (Section 8) and an amber "Poorly lit" pill (lighting); both values retrievable via `wrangler d1 execute ... --command "SELECT accepts_housing_vouchers, safely_lit_at_night FROM reviews ORDER BY created_at DESC LIMIT 1"`
**Why human:** Cannot submit form or verify DB writes without live Turnstile bypass and active session

#### 2. Survey field pill display on review cards

**Test:** View any published review card that was submitted with survey field data.
**Expected:** Colored pills render correctly; the container div is absent for reviews with null values in both fields
**Why human:** Visual rendering — grep confirms logic but not CSS class correctness or final appearance

#### 3. Edit form survey field round-trip

**Test:** Edit an existing review that has survey field values. Change one value and save.
**Expected:** PATCH request succeeds; updated value persists on reload; fields correctly pre-populated from existing review data
**Why human:** Requires live session and DB write

#### 4. Contact form submission end-to-end

**Test:** Visit `/contact`, fill all fields (name, email, category, message), complete Turnstile widget, submit.
**Expected:** Success message shown ("We've received your message..."); record appears in D1 contact_messages; confirmation email arrives at submitter's inbox; admin notification sent to contact@ratemyplace.org
**Why human:** Requires live Turnstile widget completion and Resend API key in production/preview environment

#### 5. Admin contact tab visibility and data

**Test:** Sign in as admin, visit `/admin/contact`
**Expected:** Table with columns Date, Name, Email, Category, Message (truncated), Status; category and status shown as colored badges
**Why human:** SSR admin page requires live authenticated session

#### 6. Admin auth gate

**Test:** Visit `/admin/contact` while not signed in, and while signed in as a non-admin user
**Expected:** Unauthenticated: redirect to `/auth/signin`; non-admin: redirect to `/`
**Why human:** Requires live session testing

#### 7. Duplicate 0019 prefix — remote migration safety

**Test:** Run `npx wrangler d1 migrations list ratemyplace-db --remote` and verify both `0019_reserved.sql` and `0019_survey_fields.sql` show as applied in the correct order
**Expected:** Both applied; `accepts_housing_vouchers` and `safely_lit_at_night` columns present in remote reviews table; contact_messages table present
**Why human:** Remote DB state requires production credentials and cannot be verified locally

### Gaps Summary

No blocking gaps found. All 12 observable truths pass automated verification:

- All 7 required artifacts from Plan 01 exist, are substantive, and are wired into the data flow
- All 7 required artifacts from Plan 02 exist, are substantive, and are wired
- All 12 key links are confirmed present (fetch calls, SQL statements, import chains)
- All 7 requirement IDs satisfied with implementation evidence
- Build clean (`ok (no errors)`)
- 189 tests passing (up from 171 baseline — no regressions)

The one notable deviation from Plan 02: `admin/contact.astro` uses a direct SSR D1 query rather than fetching from `/api/admin/contact-messages`. The API route exists and is admin-gated — this is a documented intentional decision (simpler, avoids extra client JS for read-only table). The goal is achieved either way.

The `0019_` prefix collision is the only risk item: `migrations/0019_reserved.sql` and `migrations/0019_survey_fields.sql` both exist. Wrangler applied both locally (alphabetical: `reserved` before `survey_fields`), and local DB contains both new columns. Remote deployment order should be verified.

---

_Verified: 2026-03-21T18:26:44Z_
_Verifier: Claude (gsd-verifier)_
