# Phase 11: Schema, Survey Fields, and Contact Form - Research

**Researched:** 2026-03-21
**Domain:** Cloudflare D1 schema migration, Astro/React form patterns, Resend email, Turnstile spam protection
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Section 8 field: standalone context field (not scored), placed in supplementary section alongside would_recommend, tenure, and move-out timing
- Section 8 options: Yes / No / Unsure (tristate)
- Section 8 question text: "To your knowledge, does this property accept Housing Choice Vouchers (Section 8)?"
- Safely lit field: Yes/No/Unsure (tristate), not scored, optional
- Safely lit question text: "Was the building and surrounding area safely lit at night?"
- Both fields optional, DB columns nullable (D1 rejects NOT NULL on ALTER TABLE)
- Contact form open to anyone, no login required; name + email fields on form
- Turnstile + rate limiting (3 per hour per IP) for spam protection
- All categories notify contact@ratemyplace.org (single address)
- Category dropdown: General, Privacy, Support, Landlord
- Submitter confirmation from noreply@ratemyplace.org
- Submissions stored in D1 `contact_messages` table
- Separate "Contact" tab in admin panel (not combined with bug reports)
- Migrations 0019-0022 pre-assigned

### Claude's Discretion
- Placement of "safely lit" in the form (supplementary section or after building section — pick best flow)
- DB column names for both new fields
- Whether to add to `supplementaryItems` in surveyItems.ts or create a new structure
- Contact form field validation rules (min/max lengths)
- Admin contact tab UI layout and sorting
- Confirmation email template design (follow existing Resend email patterns in email.ts)
- Whether to add admin notification email or rely on D1 storage + admin panel only

### Deferred Ideas (OUT OF SCOPE)
- None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SURVEY-01 | Review form includes Section 8 / Housing Choice Voucher acceptance question (yes/no/unsure) | AdditionalStep.tsx tristate radio pattern confirmed; supplementaryItems structure is the right extension point |
| SURVEY-02 | Review form includes "safely lit at night" question for building and surrounding area | Same tristate pattern; placement in supplementary section keeps building-related context near building questions |
| SURVEY-03 | New fields displayed on public review cards (omitted for older reviews without data) | ReviewCard.astro already uses `review[key] != null` guard pattern (`availableUnitScores.filter(s => review[s.key] != null)`) — same pattern applies |
| CONTACT-01 | Contact page has working form with name, email, category dropdown, message body | contact.astro is currently static mailto links — needs full replacement with React island |
| CONTACT-02 | Submissions stored in D1 (contact_messages table) with notification email via Resend to contact@ratemyplace.org | bug_reports.ts is the direct analogue; email.ts has Resend pattern |
| CONTACT-03 | Submitter receives confirmation email acknowledging receipt | sendVerificationEmail pattern in email.ts is the template to follow |
| CONTACT-04 | Contact submissions visible in admin panel alongside bug reports | AdminLayout.astro currentPage union type needs "contact" added; separate page /admin/contact follows bug-reports.astro pattern |
</phase_requirements>

---

## Summary

Phase 11 has three distinct workstreams: (1) two new tristate survey fields on the review form and display, (2) a working contact form with spam protection and email confirmation, and (3) pre-assigning migration numbers 0019-0022 to prevent cross-phase collisions.

All three workstreams have extremely close analogues already in the codebase. The survey fields follow the exact same pattern as `would_recommend` (supplementary item, tristate option, nullable DB column via ALTER TABLE, null-guarded display in ReviewCard). The contact form is a near-clone of the bug report flow: Turnstile verify, rate limit check, D1 insert, return JSON — with Resend confirmation email added. The admin contact page mirrors bug-reports.astro exactly.

**Primary recommendation:** Copy-adapt existing patterns. Don't invent new structures. The `supplementaryItems` object in surveyItems.ts is the right home for both new survey fields. The bug report API + admin table is the contact form blueprint.

---

## Standard Stack

### Core (already installed, no new installs needed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Cloudflare D1 (SQLite) | — | Persistent storage for contact_messages and new review columns | Project database |
| Resend | Already in package.json | Transactional email (confirmation + notification) | Existing email.ts infrastructure |
| Cloudflare Turnstile | Already wired | Bot protection for contact form | Already in turnstile.ts and bug report flow |
| React (Astro island) | Already installed | Contact form interactive island | Project pattern for all interactive forms |

### No new dependencies required
All needed infrastructure (Turnstile, Resend, D1 rate limiting, Lucia ID generation) already exists and is proven in the bug report flow.

---

## Architecture Patterns

### Recommended File Layout for Phase 11

```
migrations/
├── 0019_survey_fields.sql         # ALTER TABLE reviews ADD COLUMN for both new fields
├── 0020_contact_messages.sql      # CREATE TABLE contact_messages
├── 0021_[reserved].sql            # Pre-assigned placeholder
└── 0022_[reserved].sql            # Pre-assigned placeholder

src/
├── lib/
│   ├── surveyItems.ts             # Add housingVoucher + safelyLit to supplementaryItems
│   └── email.ts                   # Add sendContactConfirmationEmail function
├── components/
│   ├── reviews/
│   │   ├── form-steps/
│   │   │   ├── AdditionalStep.tsx # Add two new tristate fields
│   │   │   └── types.ts           # Add housingVoucher + safelyLit to ReviewData
│   │   └── ReviewCard.astro       # Add null-guarded display block for new fields
│   ├── admin/
│   │   ├── AdminLayout.astro      # Add 'contact' to currentPage union; add nav item
│   │   └── ContactMessagesTable.tsx  # New React table component (mirrors BugReportsTable)
│   └── contact/
│       └── ContactForm.tsx        # New React island for the contact form
└── pages/
    ├── contact.astro              # Replace static content with ContactForm island
    ├── api/
    │   ├── contact.ts             # POST handler (Turnstile + rate limit + D1 + Resend)
    │   └── admin/
    │       └── contact-messages.ts  # GET handler for admin table
    └── admin/
        └── contact.astro          # New admin page following bug-reports.astro pattern
```

### Pattern 1: Tristate Survey Field (surveyItems.ts + AdditionalStep.tsx)

**What:** Add new optional fields to `supplementaryItems` in surveyItems.ts; render them in AdditionalStep.tsx as radio groups; add fields to ReviewData type in types.ts.

**DB columns:** Use `TEXT` (nullable) — stores 'yes', 'no', 'unsure', or NULL for skipped.

**Recommended column names:**
- `accepts_housing_vouchers` TEXT — for Section 8 question
- `safely_lit_at_night` TEXT — for lighting question

**Why TEXT not INTEGER:** The three-value set ('yes'/'no'/'unsure') maps cleanly to TEXT. INTEGER would require a mapping layer. Existing `would_recommend_new` column uses TEXT for the same reason.

**When to use:** Any optional context field with 2-3 discrete options that is not scored.

**surveyItems.ts addition:**
```typescript
// Source: existing supplementaryItems pattern in src/lib/surveyItems.ts
export const supplementaryItems = {
  // ... existing items ...
  housingVouchers: {
    key: 'accepts_housing_vouchers',
    text: 'To your knowledge, does this property accept Housing Choice Vouchers (Section 8)?',
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
      { value: 'unsure', label: 'Unsure' },
    ],
  },
  safelyLit: {
    key: 'safely_lit_at_night',
    text: 'Was the building and surrounding area safely lit at night?',
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
      { value: 'unsure', label: 'Unsure' },
    ],
  },
};
```

**ReviewData type addition:**
```typescript
// Source: src/components/reviews/form-steps/types.ts
export interface ReviewData {
  // ... existing fields ...
  housingVouchers: string | null;   // 'yes' | 'no' | 'unsure' | null
  safelyLit: string | null;         // 'yes' | 'no' | 'unsure' | null
}
```

**Initial state in ReviewForm.tsx:**
```typescript
const [review, setReview] = useState<ReviewData>({
  // ... existing ...
  housingVouchers: null,
  safelyLit: null,
});
```

### Pattern 2: Null-Guarded Display in ReviewCard.astro

**What:** Display the new context fields only when the value is non-null. Older reviews lacking the column will have `null` in the query result — the guard ensures they render nothing.

**When to use:** Any review field that may be absent on legacy rows.

**ReviewCard.astro display block (recommended placement: near the footer, after "Would recommend"):**
```astro
<!-- Source: existing null-guard pattern in ReviewCard.astro line 80-82 -->
{(review.accepts_housing_vouchers || review.safely_lit_at_night) && (
  <div class="flex flex-wrap gap-2 mt-3">
    {review.accepts_housing_vouchers && (
      <span class={`px-2 py-1 text-xs rounded-full ${
        review.accepts_housing_vouchers === 'yes'
          ? 'bg-green-100 text-green-800'
          : review.accepts_housing_vouchers === 'no'
            ? 'bg-red-100 text-red-800'
            : 'bg-gray-100 text-gray-600'
      }`}>
        Section 8: {review.accepts_housing_vouchers === 'yes' ? 'Accepted' : review.accepts_housing_vouchers === 'no' ? 'Not accepted' : 'Unsure'}
      </span>
    )}
    {review.safely_lit_at_night && (
      <span class={`px-2 py-1 text-xs rounded-full ${
        review.safely_lit_at_night === 'yes'
          ? 'bg-green-100 text-green-800'
          : review.safely_lit_at_night === 'no'
            ? 'bg-amber-100 text-amber-800'
            : 'bg-gray-100 text-gray-600'
      }`}>
        Lighting: {review.safely_lit_at_night === 'yes' ? 'Well lit' : review.safely_lit_at_night === 'no' ? 'Poorly lit' : 'Unsure'}
      </span>
    )}
  </div>
)}
```

### Pattern 3: Contact Form API (mirrors bug-reports.ts)

**What:** POST handler at `/api/contact.ts` following the exact bug report pattern: parse formData, verify Turnstile, check rate limit, validate input, insert into D1, send Resend emails (confirmation to submitter, notification to contact@ratemyplace.org), return JSON.

**When to use:** Any public-facing form that stores to D1 and sends email.

```typescript
// Source: adapted from src/pages/api/bug-reports.ts
export async function POST(context: APIContext): Promise<Response> {
  const formData = await context.request.formData();

  // 1. Turnstile verification (same pattern as bug-reports.ts)
  const turnstileToken = formData.get('cf-turnstile-response') as string;
  const runtime = (context.locals as any).runtime;
  const turnstileResult = await verifyTurnstile(
    turnstileToken,
    runtime.env.TURNSTILE_SECRET_KEY,
    getClientIP(context)
  );
  if (!turnstileResult.success) {
    return new Response(JSON.stringify({ error: turnstileResult.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 2. Rate limit check (3 per hour = 3600 seconds)
  const db = getDB(runtime);
  const rateLimitResult = await checkRateLimit(
    db,
    getClientIP(context),
    'contact',
    3,
    3600
  );
  if (!rateLimitResult.allowed) {
    return new Response(JSON.stringify({ error: 'Too many submissions. Please try again later.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 3. Validate + sanitize
  // 4. D1 insert
  // 5. Resend confirmation to submitter
  // 6. Return success
}
```

### Pattern 4: Admin Contact Page (mirrors bug-reports.astro)

**What:** `/src/pages/admin/contact.astro` SSR page with auth check + React island for the table. AdminLayout.astro needs `'contact'` added to the `currentPage` union type and a new nav item.

**AdminLayout.astro changes:**
1. Add `'contact'` to the `Props` interface union: `currentPage: '...' | 'bugs' | 'contact' | 'audit'`
2. Add nav item: `{ id: 'contact', label: 'Contact', href: '/admin/contact', icon: 'mail' }`
3. Add mail SVG icon case in the nav render block

### Pattern 5: Migration Strategy

**Migration 0019 — Survey Fields:**
```sql
-- D1 requires nullable columns for ALTER TABLE (no NOT NULL on existing rows)
ALTER TABLE reviews ADD COLUMN accepts_housing_vouchers TEXT;
ALTER TABLE reviews ADD COLUMN safely_lit_at_night TEXT;
```

**Migration 0020 — Contact Messages:**
```sql
CREATE TABLE contact_messages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at INTEGER,
  admin_notes TEXT
);

CREATE INDEX idx_contact_messages_status ON contact_messages(status);
CREATE INDEX idx_contact_messages_created ON contact_messages(created_at DESC);
```

**Migrations 0021 and 0022 — Placeholder files:**
```sql
-- Migration 0021: Reserved for Phase 11 milestone (placeholder)
SELECT 1;
```
(Creates the files in the migrations/ directory to hold the slot assignments. Same pattern as 0017 which was a no-op.)

### Anti-Patterns to Avoid

- **NOT NULL on ALTER TABLE:** D1 rejects `ALTER TABLE reviews ADD COLUMN accepts_housing_vouchers TEXT NOT NULL`. All new columns on existing tables must be nullable. Confirmed by existing migration pattern across 0004-0017.
- **Re-reading ALL reviews to check null:** Filter at display time using `review.field != null` in Astro — do not use separate queries or conditional fetches.
- **Sending notification email before D1 insert:** Insert first, email second. If email fails, the submission is still recorded.
- **Separate rate_limit table per endpoint:** The existing `rate_limits` table uses the `rate_key = endpoint:ip` composite key — pass `'contact'` as the endpoint string to `checkRateLimit`, no schema changes needed.
- **Tristate as INTEGER:** Don't store 0/1/2 for yes/no/unsure. Use TEXT ('yes'/'no'/'unsure') for clarity and to match the existing `would_recommend_new` pattern.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bot detection | Custom CAPTCHA | `verifyTurnstile()` from `src/lib/turnstile.ts` | Already wired, proven with bug reports |
| Rate limiting | In-memory counter | `checkRateLimit()` from `src/lib/rateLimit.ts` | Uses D1 `rate_limits` table — survives Cloudflare instance restarts |
| Email sending | Raw fetch to Resend | `sendXxxEmail()` functions in `src/lib/email.ts` | Consistent from/to pattern, error handling, result interface |
| ID generation | `crypto.randomUUID()` | `generateIdFromEntropySize(10)` from Lucia | Project standard, consistent ID format across all tables |
| Admin auth check | Custom middleware | `user.isAdmin` guard in Astro frontmatter + AdminLayout.astro | Double-checked: AdminLayout also redirects non-admins |

---

## Common Pitfalls

### Pitfall 1: surveyItems.ts supplementaryItems Structure Mismatch
**What goes wrong:** Attempting to add new fields as `SurveyItem` objects (with code, dimension, help.examples) when the supplementary structure is simpler (just key, text, options array).
**Why it happens:** The file has two distinct structures: `SurveyItem[]` (the scored Likert items) and `supplementaryItems` (the context-only object). They are not interchangeable.
**How to avoid:** Add new fields to `supplementaryItems` object (not to `unitItems`/`buildingItems`/`landlordItems` arrays). Do not add `code`, `dimension`, or `help` properties.
**Warning signs:** TypeScript errors about missing `code` or `help.examples` properties.

### Pitfall 2: Forgetting to Pass New Fields Through the API Submit Handler
**What goes wrong:** New fields appear in the form and types but never reach the D1 reviews table because they aren't appended to formData in `ReviewForm.tsx`'s submit handler.
**Why it happens:** The submit function explicitly calls `formData.append(...)` for each field — it's not automatic.
**How to avoid:** After adding fields to `ReviewData` type and `AdditionalStep.tsx`, search for the submit block in `ReviewForm.tsx` (around line 181-210) and add corresponding `formData.append('accepts_housing_vouchers', review.housingVouchers ?? '')` calls.
**Warning signs:** DB row shows NULL for new fields even when the form submitter chose an option.

### Pitfall 3: AdminLayout.astro currentPage Type Not Updated
**What goes wrong:** `currentPage="contact"` on the new admin page causes TypeScript error because the union type doesn't include `'contact'`.
**Why it happens:** The Props interface in AdminLayout.astro has an exhaustive union. Adding a page without updating the type breaks the build.
**How to avoid:** Update the Props `currentPage` union AND add the nav item in the same edit.
**Warning signs:** Build error: `Type '"contact"' is not assignable to type 'dashboard' | 'users' | ... | 'audit'`.

### Pitfall 4: D1 ALTER TABLE with NOT NULL Constraint
**What goes wrong:** Migration fails on existing database with `Cannot add a NOT NULL column with no default value`.
**Why it happens:** D1 (SQLite) cannot add a NOT NULL column to an existing table that already has rows unless a default value is specified.
**How to avoid:** Always use nullable columns (no NOT NULL, no DEFAULT required) for ALTER TABLE on existing tables. This is documented in STATE.md.
**Warning signs:** Migration apply command errors with constraint violation message.

### Pitfall 5: Contact Form Email Sent to Wrong Address
**What goes wrong:** Category-based routing sends privacy inquiries to general inbox and vice versa.
**Why it happens:** The user decided ALL categories notify contact@ratemyplace.org (single address via Cloudflare catch-all). There is no per-category routing to implement.
**How to avoid:** Hard-code the notification destination as `contact@ratemyplace.org` regardless of category. The category is for admin organization, not email routing.
**Warning signs:** Unnecessarily complex switch/case on category for email destination.

### Pitfall 6: Turnstile Sitekey vs Secret Key Confusion
**What goes wrong:** The Turnstile sitekey (public, used in frontend widget) is mistakenly used in the backend `verifyTurnstile()` call instead of `TURNSTILE_SECRET_KEY`.
**Why it happens:** Two different keys serve different roles.
**How to avoid:** Frontend ContactForm.tsx uses `data-sitekey` from a public env or hardcoded site key. Backend `/api/contact.ts` uses `runtime.env.TURNSTILE_SECRET_KEY`. Check existing `bug-reports.astro` for the frontend pattern.

---

## Code Examples

### Contact Messages Table Schema
```sql
-- Source: mirrors src/migrations/0018_bug_reports.sql structure
CREATE TABLE contact_messages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at INTEGER,
  admin_notes TEXT
);

CREATE INDEX idx_contact_messages_status ON contact_messages(status);
CREATE INDEX idx_contact_messages_created ON contact_messages(created_at DESC);
```

### sendContactConfirmationEmail (add to src/lib/email.ts)
```typescript
// Source: follows sendVerificationEmail pattern in src/lib/email.ts
export async function sendContactConfirmationEmail(
  apiKey: string,
  toEmail: string,
  toName: string,
  category: string
): Promise<EmailResult> {
  if (!apiKey) {
    console.error('RESEND_API_KEY not configured');
    return { success: false, error: 'Email service not configured' };
  }

  const resend = new Resend(apiKey);

  try {
    const { data, error } = await resend.emails.send({
      from: 'RateMyPlace Boston <noreply@ratemyplace.org>',
      to: toEmail,
      subject: 'We received your message - RateMyPlace Boston',
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #0d9488;">We received your message</h2>

  <p>Hi ${toName},</p>

  <p>Thanks for reaching out. We've received your ${category} inquiry and will follow up within 2-3 business days.</p>

  <p style="color: #666; font-size: 14px;">For urgent matters, please note "URGENT" in your follow-up.</p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

  <p style="color: #999; font-size: 12px;">
    This is an automated confirmation. Please do not reply to this email.
  </p>
</body>
</html>
      `,
    });

    if (error) {
      console.error('Resend error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    console.error('Email send exception:', err);
    return { success: false, error: 'Failed to send email' };
  }
}
```

### Contact Form Validation Rules (Claude's Discretion recommendation)
```typescript
// Consistent with existing bug-reports.ts validation approach
const name = formData.get('name') as string;
const email = formData.get('email') as string;
const message = formData.get('message') as string;
const category = formData.get('category') as string;

const validCategories = ['general', 'privacy', 'support', 'landlord'];
const safeCategory = validCategories.includes(category) ? category : 'general';

// Validation rules
if (!name || name.trim().length < 2) → 400 'Name is required (at least 2 characters)'
if (name.length > 100) → 400 'Name is too long (max 100 characters)'
if (!email || !email.includes('@')) → 400 'Valid email address required'
if (!message || message.trim().length < 10) → 400 'Message must be at least 10 characters'
if (message.length > 3000) → 400 'Message is too long (max 3000 characters)'
```

### AdditionalStep.tsx: "Safely Lit" Placement Decision
The field sits logically after the building section of the form. However, it is asked on the "Additional" step (same step as tenure, move-out, would_recommend). Placement recommendation: **add both new tristate fields as a group, immediately before the "Would you recommend" question**, since they are quick yes/no/unsure responses and keep the question cluster cohesive. "Safely lit" belongs logically near security-related context; "Section 8" is policy context — both fit between tenure and would_recommend.

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Static mailto links on contact.astro | React island form with D1 + Resend | Submissions are tracked, searchable, and admin-actionable |
| No Section 8 data | Voluntary tristate field | Future aggregate: "% of reviewed buildings accepting HCV" |

---

## Open Questions

1. **Migration 0021 and 0022 placeholder SQL**
   - What we know: Slots 0019-0022 are pre-assigned to Phase 11 per STATE.md
   - What's unclear: Whether placeholder files should be empty or `SELECT 1;` no-ops
   - Recommendation: Use `SELECT 1;` — same pattern as 0017_review_property_manager_name.sql which explicitly documents it as a no-op

2. **Admin notification email for contact submissions**
   - What we know: Submissions go to D1; user decided separate "Contact" admin tab
   - What's unclear: Whether a notification email to contact@ratemyplace.org is also desired
   - Recommendation: Send notification email to contact@ratemyplace.org at submission time (keeps admin informed without requiring active panel checks). This is low cost with existing Resend infrastructure and aligns with the catch-all email setup.

3. **ContactForm Turnstile sitekey source**
   - What we know: Turnstile sitekey is public; bug-report form uses it
   - What's unclear: Whether sitekey is hardcoded in bug report form or passed as a prop
   - Recommendation: Check existing `/src/pages/bug-report.astro` to see how the sitekey is injected into the frontend; mirror that pattern exactly.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (inferred from `npm test` — see package.json) |
| Config file | See package.json scripts |
| Quick run command | `npm test -- --run` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SURVEY-01 | Section 8 field submitted and stored | manual-only | — review form is React, E2E | N/A |
| SURVEY-02 | Safely lit field submitted and stored | manual-only | — review form is React, E2E | N/A |
| SURVEY-03 | Null fields omitted from ReviewCard display | unit | `npm test -- --run privacy` (existing privacy.test.ts) | ❌ Wave 0 — add display guard test |
| CONTACT-01 | Contact form renders with all fields | manual-only | — React island | N/A |
| CONTACT-02 | Contact API stores to D1, rate-limits correctly | unit | `npm test -- --run contact` | ❌ Wave 0 |
| CONTACT-03 | Confirmation email sent on submission | unit (mock Resend) | `npm test -- --run email` | ❌ Wave 0 — add to email.test.ts |
| CONTACT-04 | Admin contact page auth-gated | manual-only | — SSR auth | N/A |

### Sampling Rate
- **Per task commit:** `npm test -- --run`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite (171+ tests) green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/__tests__/email.test.ts` — add `sendContactConfirmationEmail` test with mocked Resend
- [ ] Contact API rate limiting behavior — can mirror `rateLimit.test.ts` patterns for the 3/hour rule
- [ ] ReviewCard null-guard behavior for new fields — verify `accepts_housing_vouchers: null` renders nothing

*(The 171 existing unit tests cover scoring, validation, audit, disputes, and rate limiting. New tests needed only for the new email function and any utility logic added in this phase.)*

---

## Sources

### Primary (HIGH confidence)
- Direct codebase reading — `src/lib/surveyItems.ts`, `src/lib/email.ts`, `src/lib/rateLimit.ts`, `src/lib/turnstile.ts`
- Direct codebase reading — `src/pages/api/bug-reports.ts` (contact form analogue)
- Direct codebase reading — `src/components/admin/AdminLayout.astro` (nav pattern)
- Direct codebase reading — `src/components/reviews/ReviewCard.astro` (null-guard pattern, line 80-82)
- Direct codebase reading — `src/components/reviews/form-steps/AdditionalStep.tsx` (supplementary field pattern)
- Direct codebase reading — `migrations/0004_survey_scores.sql`, `migrations/0018_bug_reports.sql`
- `.planning/phases/11-schema-survey-fields-and-contact-form/11-CONTEXT.md` — locked user decisions

### Secondary (MEDIUM confidence)
- `STATE.md` — confirms migration 0019-0022 pre-assignment, D1 NOT NULL constraint behavior
- `CLAUDE.md` — project conventions for auth checks, DB patterns, timestamp handling

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all tools are already installed and proven in production
- Architecture patterns: HIGH — direct analogue files exist in codebase and were read
- Pitfalls: HIGH — derived from actual code patterns and documented D1 constraints
- Migration numbering: HIGH — 0019-0022 explicitly pre-assigned in STATE.md

**Research date:** 2026-03-21
**Valid until:** 2026-04-21 (stable stack, no version changes expected)
