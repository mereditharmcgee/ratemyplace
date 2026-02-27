# Phase 2: Landlord Disputes - Research

**Researched:** 2026-02-26
**Domain:** Form submission workflows, URL validation, admin queue management, transactional email
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Dispute Form Design:**
- Collect landlord info: name, email, phone (all required)
- No ownership verification — trust-based, admin reviews legitimacy manually
- Structured form with checkboxes for dispute reasons + optional text details
- Send confirmation email after submission with dispute details

**Review Matching:**
- Landlord must select a specific review to dispute (required, not optional)
- Identification method: paste the review URL into the form
- Validate URL — block submission if URL doesn't match a valid review
- One dispute per review — block duplicate submissions for same review

**Admin Queue Workflow:**
- Sort toggle: oldest first or newest first (user choice)
- Queue row shows: building, date, status, dispute reason snippet (full preview)
- Filter by status only: Pending / Resolved / All
- Side-by-side view when clicking a dispute: dispute details on left, review on right

**Resolution Actions:**
- Three resolution outcomes: Uphold / Dismiss / Partially valid
- Admin decides action per case: remove review, flag as disputed, or edit review
- Notify landlord by email only if dispute is upheld
- Resolution notes are required — admin must explain the decision

### Claude's Discretion

- Form layout and styling
- Exact checkbox options for dispute reasons
- Admin queue pagination behavior
- Email content and formatting
- Error message wording

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DISP-01 | Landlord can submit dispute form with building selection and explanation | Form patterns, validation architecture, URL parsing for review identification |
| DISP-02 | Dispute form requires landlord contact information | Form validation patterns, email format validation |
| DISP-03 | Disputes appear in admin queue for review | Admin queue patterns (existing ReviewsTable component), D1 database table design |
| DISP-04 | Admin can view disputed review alongside dispute submission | Side-by-side layout patterns, data fetching for joined review data |
| DISP-05 | Admin can mark dispute as resolved/dismissed with notes | State management patterns, resolution outcome enum, email notification triggers |

</phase_requirements>

## Summary

This phase implements a dispute submission and management system using the existing Astro + React + D1 + Resend stack. The core technical challenges are: (1) URL parsing and validation to match review URLs to database records, (2) preventing duplicate disputes via database unique constraints, (3) building an admin queue following existing patterns (ReviewsTable), and (4) conditional email notifications via Resend.

The project already has strong patterns for forms (ReviewForm), admin queues (ReviewsTable), and transactional email (verification emails). This phase extends those patterns to dispute management.

**Primary recommendation:** Use native URL constructor for URL validation, UNIQUE constraint on `(review_id)` to prevent duplicates, follow existing ReviewsTable component pattern for admin queue, and extend email.ts with dispute confirmation function following verification email pattern.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Astro | 5.16.11 | SSR pages, API routes | Project framework, existing codebase |
| React | 18.3.1 | Interactive components | Existing admin tables, forms |
| Cloudflare D1 | Latest | SQLite database | Project database, existing tables |
| Resend | 6.9.2 | Transactional email | Existing email service |
| TailwindCSS | 4.1.18 | Styling | Project styling framework |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | 4.0.18 | Unit testing | Validation logic, helper functions |
| Happy-DOM | 20.5.1 | DOM environment | Component testing |
| TypeScript | Latest | Type safety | All new code (project standard) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native URL constructor | Regex validation | URL constructor more robust, handles edge cases |
| Resend | SendGrid/Mailgun | Resend already integrated, developer-friendly |
| Unique constraint | Application-level check | DB constraint prevents race conditions |

**Installation:**
No new dependencies required — all necessary libraries already in package.json.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── pages/
│   ├── dispute.astro                  # Public dispute submission form
│   ├── admin/
│   │   └── disputes.astro             # Admin queue page
│   └── api/
│       ├── disputes.ts                # POST new dispute, GET disputes list
│       └── disputes/
│           └── [id].ts                # PATCH resolve dispute
├── components/
│   ├── disputes/
│   │   └── DisputeForm.tsx            # Public form component
│   └── admin/
│       └── DisputesQueue.tsx          # Admin queue component
└── lib/
    └── email.ts                       # Add dispute email functions
```

### Pattern 1: URL Validation and Review Extraction

**What:** Parse review URL from form input, extract review ID, validate against database
**When to use:** Dispute form submission
**Example:**
```typescript
// URL format: https://domain.com/building/some-slug#review-abc123
// Alternative: https://domain.com/review/edit/abc123

function extractReviewIdFromUrl(urlString: string, siteUrl: string): string | null {
  try {
    const url = new URL(urlString);

    // Must be same origin
    const site = new URL(siteUrl);
    if (url.origin !== site.origin) {
      return null;
    }

    // Pattern 1: #review-{id} hash
    if (url.hash.startsWith('#review-')) {
      return url.hash.slice(8); // Remove '#review-'
    }

    // Pattern 2: /review/edit/{id}
    const editMatch = url.pathname.match(/^\/review\/edit\/([^\/]+)$/);
    if (editMatch) {
      return editMatch[1];
    }

    return null;
  } catch {
    return null; // Invalid URL
  }
}

// In API handler:
const reviewId = extractReviewIdFromUrl(submittedUrl, siteUrl);
if (!reviewId) {
  return new Response(JSON.stringify({ error: 'Invalid review URL' }), { status: 400 });
}

// Verify review exists
const review = await db.prepare('SELECT id FROM reviews WHERE id = ?').bind(reviewId).first();
if (!review) {
  return new Response(JSON.stringify({ error: 'Review not found' }), { status: 404 });
}
```

### Pattern 2: Prevent Duplicate Disputes

**What:** Database-level unique constraint to prevent multiple disputes for same review
**When to use:** Database migration and dispute submission
**Example:**
```sql
-- Migration: 0012_disputes.sql
CREATE TABLE IF NOT EXISTS disputes (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    landlord_name TEXT NOT NULL,
    landlord_email TEXT NOT NULL,
    landlord_phone TEXT NOT NULL,
    dispute_reasons TEXT NOT NULL, -- JSON array of selected reasons
    dispute_explanation TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
    resolution_outcome TEXT CHECK (resolution_outcome IN ('uphold', 'dismiss', 'partially_valid')),
    resolution_notes TEXT,
    resolved_at INTEGER,
    resolved_by TEXT REFERENCES users(id),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(review_id) -- Prevents duplicate disputes
);

CREATE INDEX idx_disputes_status ON disputes(status);
CREATE INDEX idx_disputes_review ON disputes(review_id);
CREATE INDEX idx_disputes_created ON disputes(created_at);
```

```typescript
// In API handler, catch constraint violation:
try {
  await db.prepare(
    'INSERT INTO disputes (id, review_id, ...) VALUES (?, ?, ...)'
  ).bind(id, reviewId, ...).run();
} catch (err: any) {
  if (err.message?.includes('UNIQUE constraint failed')) {
    return new Response(
      JSON.stringify({ error: 'A dispute already exists for this review' }),
      { status: 409 }
    );
  }
  throw err;
}
```

**Source:** [Cloudflare D1 Unique Constraints](https://developers.cloudflare.com/d1/best-practices/use-indexes/)

### Pattern 3: Admin Queue Component

**What:** Follow existing ReviewsTable pattern for disputes queue
**When to use:** Admin disputes page
**Example:**
```typescript
// src/components/admin/DisputesQueue.tsx
import { useState, useEffect } from 'react';

interface Dispute {
  id: string;
  review_id: string;
  building_address: string;
  landlord_name: string;
  landlord_email: string;
  landlord_phone: string;
  dispute_reasons: string; // JSON array
  dispute_explanation: string;
  status: 'pending' | 'resolved';
  resolution_outcome?: 'uphold' | 'dismiss' | 'partially_valid';
  resolution_notes?: string;
  created_at: number;
  // Review data for side-by-side view:
  review_text?: string;
  review_overall_score?: number;
}

export default function DisputesQueue() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [sortOrder, setSortOrder] = useState<'oldest' | 'newest'>('oldest');
  const [expandedDispute, setExpandedDispute] = useState<string | null>(null);

  // Follow ReviewsTable patterns: fetch, filter, expand, action handlers
  // ...
}
```

### Pattern 4: Transactional Email

**What:** Extend existing email.ts patterns for dispute confirmations
**When to use:** After dispute submission, after resolution (if upheld)
**Example:**
```typescript
// src/lib/email.ts (add to existing file)

export async function sendDisputeConfirmationEmail(
  apiKey: string,
  siteUrl: string,
  toEmail: string,
  disputeDetails: {
    landlordName: string;
    buildingAddress: string;
    disputeReasons: string[];
    disputeExplanation?: string;
  }
): Promise<EmailResult> {
  if (!apiKey) {
    return { success: false, error: 'Email service not configured' };
  }

  const resend = new Resend(apiKey);

  try {
    const { data, error } = await resend.emails.send({
      from: 'RateMyPlace Boston <noreply@ratemyplace.org>',
      to: toEmail,
      subject: 'Dispute Submitted - RateMyPlace Boston',
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #0d9488;">Dispute Submitted</h2>

  <p>Thank you for submitting your dispute. We have received the following information:</p>

  <div style="background-color: #f3f4f6; border-radius: 8px; padding: 16px; margin: 20px 0;">
    <p><strong>Building:</strong> ${disputeDetails.buildingAddress}</p>
    <p><strong>Dispute Reasons:</strong></p>
    <ul>
      ${disputeDetails.disputeReasons.map(r => `<li>${r}</li>`).join('')}
    </ul>
    ${disputeDetails.disputeExplanation ? `<p><strong>Explanation:</strong><br>${disputeDetails.disputeExplanation}</p>` : ''}
  </div>

  <p>Our admin team will review your dispute and take appropriate action. You will be notified if the dispute is upheld.</p>

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

**Source:** Project existing patterns in `src/lib/email.ts`, [Resend documentation](https://resend.com/docs)

### Anti-Patterns to Avoid

- **Regex URL validation:** Browser URL constructor is more robust and handles edge cases better than regex
- **Application-level duplicate checks:** Race conditions possible; use database UNIQUE constraint
- **Skipping email on failure:** Always attempt email send, but don't fail request if email fails (log error instead)
- **Building custom queue from scratch:** Follow existing ReviewsTable patterns for consistency

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| URL parsing | Custom regex patterns | Native URL constructor | Handles encoding, edge cases, validation automatically |
| Email templates | String concatenation | HTML with inline styles (existing pattern) | Resend handles rendering, existing email.ts pattern works |
| Duplicate prevention | Application-level checks | Database UNIQUE constraint | Prevents race conditions, atomic guarantee |
| Admin table state | Custom state management | React useState patterns (existing) | Project patterns already proven, consistent UX |
| Form validation | Custom validators | Existing validation.ts patterns | Project already has sanitizeText, validation utilities |

**Key insight:** URL parsing is deceptively complex (encoding, special characters, fragment identifiers, query params). The URL constructor API handles all edge cases. Custom regex will miss cases and create security vulnerabilities.

## Common Pitfalls

### Pitfall 1: Case-Sensitive URL Comparison

**What goes wrong:** URL validation fails because of protocol/domain casing differences (HTTP vs http, Domain.com vs domain.com)
**Why it happens:** Direct string comparison of URLs without normalization
**How to avoid:** Use URL constructor which automatically normalizes URLs; compare `url.origin` which is lowercase
**Warning signs:** Form rejection for valid URLs, inconsistent validation results

**Example:**
```typescript
// WRONG:
if (submittedUrl !== expectedUrl) { /* ... */ }

// RIGHT:
const url = new URL(submittedUrl);
const site = new URL(siteUrl);
if (url.origin !== site.origin) { /* ... */ }
```

### Pitfall 2: Forgetting Email Send Failures Shouldn't Block Request

**What goes wrong:** Dispute submission fails when email service is down, even though dispute was saved to database
**Why it happens:** Treating email send as critical path instead of best-effort notification
**How to avoid:** Save dispute first, send email after, log email failures but return success
**Warning signs:** "Dispute submission failed" errors when database write succeeded

**Example:**
```typescript
// Save dispute first
const result = await db.prepare('INSERT INTO disputes ...').run();

// Email is best-effort
const emailResult = await sendDisputeConfirmationEmail(...);
if (!emailResult.success) {
  console.error('Failed to send confirmation email:', emailResult.error);
  // Don't throw — dispute is saved
}

return new Response(JSON.stringify({ success: true }), { status: 201 });
```

**Source:** [Resend best practices](https://resend.com/docs/knowledge-base/what-sending-feature-to-use)

### Pitfall 3: Not Indexing Sort/Filter Columns

**What goes wrong:** Admin queue becomes slow as disputes accumulate
**Why it happens:** Sorting by `created_at` and filtering by `status` without indexes
**How to avoid:** Create indexes on `status` and `created_at` during migration
**Warning signs:** Page load times increasing over time, database query timeouts

**Example:**
```sql
-- REQUIRED indexes for admin queue performance:
CREATE INDEX idx_disputes_status ON disputes(status);
CREATE INDEX idx_disputes_created ON disputes(created_at);
```

**Source:** [Cloudflare D1 Index Best Practices](https://developers.cloudflare.com/d1/best-practices/use-indexes/)

### Pitfall 4: Review ID Extraction Without Hash Fragment Support

**What goes wrong:** Review URLs with `#review-{id}` fragments fail validation
**Why it happens:** Only checking pathname, not hash property of URL
**How to avoid:** Check both `url.hash` and `url.pathname` patterns
**Warning signs:** Users report "Review not found" for valid building page URLs with review anchors

### Pitfall 5: Missing Resolution Notes Validation

**What goes wrong:** Admin resolves dispute without explanation, no audit trail
**Why it happens:** Frontend doesn't enforce required notes field
**How to avoid:** Server-side validation: if status becomes 'resolved', resolution_notes must be non-empty
**Warning signs:** Resolved disputes with empty notes in database

## Code Examples

Verified patterns from official sources and project conventions:

### Public Dispute Form Page

```astro
---
// src/pages/dispute.astro
import BaseLayout from '../components/layout/BaseLayout.astro';
import DisputeForm from '../components/disputes/DisputeForm';

const siteUrl = Astro.url.origin;
---

<BaseLayout title="Submit a Dispute">
  <div class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <h1 class="text-3xl font-bold text-gray-900 mb-2">Submit a Dispute</h1>
    <p class="text-gray-600 mb-8">
      If you believe a review contains inaccurate information, you can submit a dispute for admin review.
    </p>

    <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8">
      <h2 class="font-semibold text-blue-800 mb-2">Dispute Process</h2>
      <ul class="text-sm text-blue-700 space-y-1">
        <li>You must provide a link to the specific review you are disputing</li>
        <li>Our admin team will review your dispute and the original review</li>
        <li>You will be notified by email if the dispute is upheld</li>
      </ul>
    </div>

    <DisputeForm client:load siteUrl={siteUrl} />
  </div>
</BaseLayout>
```

### Dispute Submission API

```typescript
// src/pages/api/disputes.ts
import type { APIRoute } from 'astro';
import { getDB } from '../../lib/db';
import { sanitizeText } from '../../lib/validation';
import { sendDisputeConfirmationEmail } from '../../lib/email';

function extractReviewIdFromUrl(urlString: string, siteUrl: string): string | null {
  try {
    const url = new URL(urlString);
    const site = new URL(siteUrl);

    if (url.origin !== site.origin) {
      return null;
    }

    // Pattern 1: #review-{id}
    if (url.hash.startsWith('#review-')) {
      return url.hash.slice(8);
    }

    // Pattern 2: /review/edit/{id}
    const editMatch = url.pathname.match(/^\/review\/edit\/([^\/]+)$/);
    if (editMatch) {
      return editMatch[1];
    }

    return null;
  } catch {
    return null;
  }
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const db = getDB((locals as any).runtime);
    const body = await request.json();

    // Validate required fields
    const { reviewUrl, landlordName, landlordEmail, landlordPhone, disputeReasons, disputeExplanation } = body;

    if (!reviewUrl || !landlordName || !landlordEmail || !landlordPhone || !disputeReasons?.length) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400 }
      );
    }

    // Extract and validate review ID
    const siteUrl = new URL(request.url).origin;
    const reviewId = extractReviewIdFromUrl(reviewUrl, siteUrl);

    if (!reviewId) {
      return new Response(
        JSON.stringify({ error: 'Invalid review URL. Please paste the URL from the browser address bar.' }),
        { status: 400 }
      );
    }

    // Verify review exists
    const review = await db.prepare(
      'SELECT r.id, b.address FROM reviews r JOIN buildings b ON r.building_id = b.id WHERE r.id = ?'
    ).bind(reviewId).first();

    if (!review) {
      return new Response(
        JSON.stringify({ error: 'Review not found. Please check the URL and try again.' }),
        { status: 404 }
      );
    }

    // Create dispute
    const disputeId = crypto.randomUUID();

    try {
      await db.prepare(`
        INSERT INTO disputes (
          id, review_id, landlord_name, landlord_email, landlord_phone,
          dispute_reasons, dispute_explanation, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', unixepoch())
      `).bind(
        disputeId,
        reviewId,
        sanitizeText(landlordName),
        sanitordEmail.toLowerCase().trim(),
        sanitizeText(landlordPhone),
        JSON.stringify(disputeReasons),
        disputeExplanation ? sanitizeText(disputeExplanation) : null
      ).run();
    } catch (err: any) {
      if (err.message?.includes('UNIQUE constraint failed')) {
        return new Response(
          JSON.stringify({ error: 'A dispute already exists for this review.' }),
          { status: 409 }
        );
      }
      throw err;
    }

    // Send confirmation email (best-effort)
    const resendApiKey = (locals as any).runtime?.env?.RESEND_API_KEY;
    if (resendApiKey) {
      const emailResult = await sendDisputeConfirmationEmail(
        resendApiKey,
        siteUrl,
        landlordEmail,
        {
          landlordName,
          buildingAddress: review.address,
          disputeReasons,
          disputeExplanation,
        }
      );

      if (!emailResult.success) {
        console.error('Failed to send confirmation email:', emailResult.error);
      }
    }

    return new Response(
      JSON.stringify({ success: true, disputeId }),
      { status: 201 }
    );

  } catch (err) {
    console.error('Dispute submission error:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to submit dispute' }),
      { status: 500 }
    );
  }
};

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;

  if (!user || !user.isAdmin) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const db = getDB((locals as any).runtime);

    const disputes = await db.prepare(`
      SELECT
        d.*,
        b.address as building_address,
        r.review_text,
        r.review_title,
        r.overall_score as review_overall_score
      FROM disputes d
      JOIN reviews r ON d.review_id = r.id
      JOIN buildings b ON r.building_id = b.id
      ORDER BY d.created_at ASC
    `).all();

    return new Response(
      JSON.stringify({ disputes: disputes.results }),
      { status: 200 }
    );

  } catch (err) {
    console.error('Fetch disputes error:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch disputes' }),
      { status: 500 }
    );
  }
};
```

### Admin Resolution API

```typescript
// src/pages/api/disputes/[id].ts
import type { APIRoute } from 'astro';
import { getDB } from '../../../lib/db';
import { sendDisputeUpheldEmail } from '../../../lib/email';

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;

  if (!user || !user.isAdmin) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const db = getDB((locals as any).runtime);
    const disputeId = params.id;
    const body = await request.json();

    const { resolutionOutcome, resolutionNotes } = body;

    // Validate resolution
    const validOutcomes = ['uphold', 'dismiss', 'partially_valid'];
    if (!resolutionOutcome || !validOutcomes.includes(resolutionOutcome)) {
      return new Response(
        JSON.stringify({ error: 'Invalid resolution outcome' }),
        { status: 400 }
      );
    }

    if (!resolutionNotes || resolutionNotes.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Resolution notes are required' }),
        { status: 400 }
      );
    }

    // Get dispute details for email
    const dispute = await db.prepare(
      'SELECT landlord_email, landlord_name FROM disputes WHERE id = ?'
    ).bind(disputeId).first();

    if (!dispute) {
      return new Response(JSON.stringify({ error: 'Dispute not found' }), { status: 404 });
    }

    // Update dispute
    await db.prepare(`
      UPDATE disputes
      SET status = 'resolved',
          resolution_outcome = ?,
          resolution_notes = ?,
          resolved_at = unixepoch(),
          resolved_by = ?,
          updated_at = unixepoch()
      WHERE id = ?
    `).bind(resolutionOutcome, resolutionNotes.trim(), user.id, disputeId).run();

    // Send email if upheld
    if (resolutionOutcome === 'uphold') {
      const resendApiKey = (locals as any).runtime?.env?.RESEND_API_KEY;
      if (resendApiKey) {
        const emailResult = await sendDisputeUpheldEmail(
          resendApiKey,
          dispute.landlord_email,
          dispute.landlord_name,
          resolutionNotes
        );

        if (!emailResult.success) {
          console.error('Failed to send upheld email:', emailResult.error);
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200 }
    );

  } catch (err) {
    console.error('Resolve dispute error:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to resolve dispute' }),
      { status: 500 }
    );
  }
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Regex URL validation | URL constructor API | Standard since ~2015 | More robust, handles encoding automatically |
| Application duplicate checks | Database UNIQUE constraints | Database best practice | Prevents race conditions |
| Sync form libraries | Native HTML + fetch | Astro v4.15+ Actions | Simpler, progressive enhancement |
| SendGrid/Mailgun | Resend | 2023+ | Better DX, React Email support |

**Deprecated/outdated:**
- Complex URL regex patterns: Use URL constructor instead (handles all edge cases)
- Application-level duplicate prevention: Database constraints are atomic and race-condition-free

## Open Questions

1. **Dispute reason checkbox options**
   - What we know: User wants checkboxes for structured reasons + optional text explanation
   - What's unclear: Specific reason options (e.g., "Factually incorrect", "Defamatory", "Outdated information")
   - Recommendation: Start with 5-6 common options based on review disputes elsewhere, allow planner to define specific labels

2. **Admin queue pagination**
   - What we know: User left pagination behavior to Claude's discretion
   - What's unclear: Number of disputes per page, whether to implement infinite scroll or page numbers
   - Recommendation: Follow ReviewsTable pattern (no pagination initially — simple enough to load all), add pagination later if queue grows large

3. **Email rate limiting**
   - What we know: Resend has rate limits, confirmation emails sent on every submission
   - What's unclear: Whether to implement form submission rate limiting to prevent abuse
   - Recommendation: Implement basic rate limiting (1 submission per email per hour) to prevent spam, leverage existing rateLimit.ts utilities

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 with happy-dom |
| Config file | vitest.config.ts |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DISP-01 | URL parsing extracts review ID correctly | unit | `npm test src/lib/__tests__/disputes.test.ts` | ❌ Wave 0 |
| DISP-01 | Invalid URLs rejected with clear error | unit | `npm test src/lib/__tests__/disputes.test.ts` | ❌ Wave 0 |
| DISP-02 | Form validation requires all contact fields | unit | `npm test src/lib/__tests__/disputes.test.ts` | ❌ Wave 0 |
| DISP-03 | Dispute submission creates database record | integration | `npm test src/pages/api/__tests__/disputes.test.ts` | ❌ Wave 0 |
| DISP-03 | Duplicate dispute blocked by unique constraint | integration | `npm test src/pages/api/__tests__/disputes.test.ts` | ❌ Wave 0 |
| DISP-04 | Admin queue fetches disputes with review data | integration | `npm test src/pages/api/__tests__/disputes.test.ts` | ❌ Wave 0 |
| DISP-05 | Resolution requires outcome and notes | unit | `npm test src/lib/__tests__/disputes.test.ts` | ❌ Wave 0 |
| DISP-05 | Resolution updates status and sends email if upheld | integration | `npm test src/pages/api/__tests__/disputes.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test` (runs full suite, < 5 seconds currently)
- **Per wave merge:** `npm test` (same — suite is fast enough)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/__tests__/disputes.test.ts` — covers URL parsing, validation logic (DISP-01, DISP-02, DISP-05)
- [ ] `src/pages/api/__tests__/disputes.test.ts` — covers API endpoints, database operations (DISP-03, DISP-04, DISP-05)
- [ ] No framework install needed — Vitest already configured

## Sources

### Primary (HIGH confidence)
- Project codebase: `src/lib/email.ts`, `src/components/admin/ReviewsTable.tsx`, `src/lib/validation.ts` — existing patterns
- Project database: `migrations/0001_initial.sql`, `wrangler.jsonc` — D1 setup
- [Cloudflare D1 Index Best Practices](https://developers.cloudflare.com/d1/best-practices/use-indexes/)
- [Cloudflare D1 Unique Constraints](https://developers.cloudflare.com/d1/best-practices/use-indexes/)

### Secondary (MEDIUM confidence)
- [Astro Forms Documentation](https://docs.astro.build/en/recipes/build-forms/) — form handling patterns
- [Resend Transactional Emails](https://resend.com/products/transactional-emails) — email service features
- [Resend 2025 Features](https://resend.com/blog/new-features-in-2025) — idempotency keys, templates
- [JavaScript URL Validation - FreeCodeCamp](https://www.freecodecamp.org/news/how-to-validate-urls-in-javascript/) — URL constructor approach
- [Turing URL Validation Guide](https://www.turing.com/kb/how-to-validate-urls-in-javascript) — URL API patterns

### Tertiary (LOW confidence)
- [Dispute Management Best Practices - Kolleno](https://www.kolleno.com/what-is-dispute-management-process-tools-and-best-practices/) — general principles (not specific to this tech stack)
- [Prevent Duplicate Submissions - Formsite](https://www.formsite.com/blog/prevent-duplicate/) — general patterns (verified with D1 docs)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in use, versions confirmed from package.json
- Architecture: HIGH - Patterns verified against existing codebase (email.ts, ReviewsTable.tsx, validation.ts)
- Pitfalls: HIGH - URL validation and unique constraints verified with official Cloudflare D1 docs and MDN
- Validation: MEDIUM - Test framework exists, specific test files need creation in Wave 0

**Research date:** 2026-02-26
**Valid until:** 2026-03-28 (30 days — stack is stable)
