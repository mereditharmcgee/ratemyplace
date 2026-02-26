# Phase 1: Email Verification - Research

**Researched:** 2026-02-26
**Domain:** Transactional email delivery and verification token security
**Confidence:** HIGH

## Summary

Email verification for RateMyPlace requires integrating a transactional email service (Resend) with Cloudflare Workers, implementing secure token generation and storage, and adding UI badges for verified users. The existing codebase already uses Astro SSR on Cloudflare Workers with D1 database and Lucia auth, providing a solid foundation.

Resend is the recommended email provider for Cloudflare Workers deployments, offering native Worker integration, React Email template support, and straightforward API. The implementation requires secure token generation (using @oslojs/crypto already in dependencies), database schema extension for verification tokens, rate limiting (existing infrastructure present), and careful handling of edge cases like email client preview pane token consumption.

**Primary recommendation:** Use Resend with cryptographically secure tokens (64-128 characters), implement tokens as single-use with 24-hour expiration, add verification_tokens table to D1 schema, and protect verification endpoints with existing rate limiting infrastructure.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EMAIL-01 | User receives verification email after signup with secure token link | Resend API, @oslojs/crypto token generation, Astro API endpoints |
| EMAIL-02 | User can click verification link to mark email as verified | Verification endpoint pattern, D1 database update, token validation |
| EMAIL-03 | Verified users display "Verified" badge on their reviews | email_verified field exists, UI badge patterns |
| EMAIL-04 | Unverified users can still submit reviews (no blocking) | Current signup flow doesn't block, verification is optional |
| EMAIL-05 | User can request new verification email if original expired | Token regeneration pattern, rate limiting for resend requests |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| resend | 6.9.2 | Transactional email API | Official Cloudflare Workers integration, React Email support, developer-focused API |
| @oslojs/crypto | 1.0.1 | Secure random token generation | Already in dependencies, runtime-agnostic, cryptographically secure random generator |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @react-email/components | Latest stable | Email template components | Building responsive verification email templates (optional, can use plain HTML) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Resend | Cloudflare Email Service (beta) | Native Cloudflare integration but in private beta as of Feb 2026, not production ready |
| Resend | SendGrid / Mailgun | More mature but require API keys, less optimized for Workers runtime |
| React Email | Plain HTML strings | Simpler but harder to maintain, no type safety, inconsistent rendering |

**Installation:**
```bash
npm install resend
# Optional: for React Email templates
npm install @react-email/components
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── lib/
│   ├── email.ts              # Email service wrapper (Resend initialization)
│   ├── tokens.ts             # Token generation and validation
│   └── __tests__/
│       ├── email.test.ts
│       └── tokens.test.ts
├── pages/api/
│   ├── auth/
│   │   ├── verify-email.ts   # GET endpoint for clicking verification link
│   │   └── resend-verification.ts  # POST endpoint for requesting new email
│   └── emails/
│       └── verification.ts    # Email template (optional)
└── components/
    └── VerifiedBadge.tsx     # Verified user badge component
```

### Pattern 1: Secure Token Generation
**What:** Generate cryptographically secure random tokens using @oslojs/crypto
**When to use:** During signup and when user requests new verification email
**Example:**
```typescript
// Source: https://crypto.oslojs.dev/examples/random-values
import { generateRandomString } from "@oslojs/crypto/random";

export function generateVerificationToken(): string {
  // 64-128 character random string (alphanumeric)
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  // Use 64 characters for balance of security and URL length
  return generateRandomString(crypto, alphabet, 64);
}
```

### Pattern 2: Astro API Endpoint for Email Sending
**What:** Server-side API route that sends verification emails via Resend
**When to use:** After user signup, when user requests new verification email
**Example:**
```typescript
// Source: Existing src/pages/api/auth/signup.ts pattern + https://resend.com/docs/send-with-cloudflare-workers
import type { APIContext } from 'astro';
import { Resend } from 'resend';

export async function POST(context: APIContext): Promise<Response> {
  const runtime = (context.locals as any).runtime;
  const resend = new Resend(runtime.env.RESEND_API_KEY);

  const { data, error } = await resend.emails.send({
    from: 'RateMyPlace <verify@ratemyplace.com>',
    to: userEmail,
    subject: 'Verify your email address',
    html: `<p>Click to verify: <a href="${verificationUrl}">Verify Email</a></p>`
  });

  if (error) {
    console.error('Email send error:', error);
    return new Response(JSON.stringify({ error: 'Failed to send email' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ success: true }), { status: 200 });
}
```

### Pattern 3: Token Verification Endpoint
**What:** Endpoint that validates token, marks email as verified, invalidates token
**When to use:** User clicks verification link from email
**Example:**
```typescript
// Source: https://thecopenhagenbook.com/email-verification
import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';

export async function GET(context: APIContext): Promise<Response> {
  const token = context.url.searchParams.get('token');

  if (!token) {
    return new Response('Invalid verification link', { status: 400 });
  }

  const db = getDB((context.locals as any).runtime);

  // Find and validate token
  const verificationRecord = await db.prepare(
    'SELECT user_id, expires_at FROM verification_tokens WHERE token = ?'
  ).bind(token).first();

  if (!verificationRecord) {
    return new Response('Invalid or expired verification link', { status: 400 });
  }

  // Check expiration
  if (verificationRecord.expires_at < Math.floor(Date.now() / 1000)) {
    return new Response('Verification link has expired', { status: 400 });
  }

  // Mark email as verified
  await db.prepare(
    'UPDATE users SET email_verified = 1 WHERE id = ?'
  ).bind(verificationRecord.user_id).run();

  // Delete token (single-use)
  await db.prepare(
    'DELETE FROM verification_tokens WHERE token = ?'
  ).bind(token).run();

  // Redirect to success page
  return context.redirect('/email-verified');
}
```

### Pattern 4: Database Schema Extension
**What:** Add verification_tokens table to store tokens separately from users table
**When to use:** Initial migration for Phase 1
**Example:**
```sql
-- Source: https://www.red-gate.com/blog/how-to-store-authentication-data-in-a-database-part-2-email-confirmation-and-recovering-passwords
CREATE TABLE IF NOT EXISTS verification_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at INTEGER NOT NULL
);

CREATE INDEX idx_verification_tokens_user ON verification_tokens(user_id);
CREATE INDEX idx_verification_tokens_token ON verification_tokens(token);
CREATE INDEX idx_verification_tokens_expires ON verification_tokens(expires_at);
```

### Pattern 5: Verified Badge Component
**What:** UI component that displays "Verified" badge on reviews from verified users
**When to use:** Rendering review cards, review lists
**Example:**
```tsx
// Source: https://mobbin.com/glossary/badge UI patterns
interface VerifiedBadgeProps {
  isVerified: boolean;
}

export function VerifiedBadge({ isVerified }: VerifiedBadgeProps) {
  if (!isVerified) return null;

  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
      </svg>
      Verified
    </span>
  );
}
```

### Anti-Patterns to Avoid
- **Auto-verifying on link click without session check:** Email clients may scan links and consume tokens. Instead, check for active session; if none exists, redirect to a page with a "Verify" button
- **Storing tokens in plain text:** Always store verification tokens directly (they're already random and single-use)
- **Long-lived tokens without regeneration:** Tokens older than 24 hours should be deleted and new ones generated on request
- **Blocking review submission for unverified users:** Requirements explicitly state unverified users can still submit reviews (EMAIL-04)
- **Client-side only validation:** Always validate email verification server-side; never trust client state

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Email delivery infrastructure | Custom SMTP server, email queue | Resend API | Deliverability, spam filtering, bounce handling, reputation management |
| Token generation | `Math.random()` or timestamp-based tokens | @oslojs/crypto `generateRandomString()` | Cryptographically secure randomness, prevents prediction attacks |
| Email templates | String concatenation with HTML | Plain HTML or React Email components | XSS protection, maintainability, cross-client compatibility |
| Rate limiting for verification emails | Custom token bucket implementation | Existing `checkRateLimit()` from src/lib/rateLimit.ts | Already implemented, tested, consistent with rest of app |
| Session invalidation on verification | Manual cookie deletion | Lucia's session management | Prevents session fixation attacks, consistent with auth flow |

**Key insight:** Email delivery is deceptively complex - edge cases include greylisting, SPF/DKIM/DMARC configuration, bounce handling, unsubscribe management, and reputation monitoring. Resend handles all of this.

## Common Pitfalls

### Pitfall 1: Email Client Preview Pane Token Consumption
**What goes wrong:** Email clients (Outlook, Apple Mail) automatically scan links for security, visiting the verification URL and consuming the one-time token before user clicks
**Why it happens:** Automated link scanning for malware/phishing protection
**How to avoid:** Implement verification page that checks for active session - if no session, show "Click to verify" button instead of auto-verifying on page load
**Warning signs:** Users reporting "link already used" errors immediately after receiving email

### Pitfall 2: Token Expiration Without Cleanup
**What goes wrong:** verification_tokens table grows indefinitely with expired tokens
**Why it happens:** No cleanup process for expired tokens
**How to avoid:** Add cron job or scheduled Worker to delete tokens where `expires_at < unixepoch()`, or implement cleanup on verification attempt
**Warning signs:** Slow token lookups, growing database size

### Pitfall 3: Missing Referrer Policy on Verification Pages
**What goes wrong:** Token exposed in HTTP Referrer header when user navigates away from verification page
**Why it happens:** Default referrer policy sends full URL including query parameters
**How to avoid:** Set Referrer-Policy header to "strict-origin" on verification endpoint responses
**Warning signs:** Tokens appearing in analytics, logs from external sites

### Pitfall 4: Rate Limiting Bypass via Multiple Emails
**What goes wrong:** Attacker creates accounts with slight email variations (user+1@example.com, user+2@example.com) to spam verification emails
**Why it happens:** Email normalization not applied before rate limiting check
**How to avoid:** Normalize email addresses (lowercase, remove dots for Gmail, strip plus-addressing) before rate limit key
**Warning signs:** Spike in verification email sends, complaints about spam

### Pitfall 5: Verification Link in Test/Local Environment
**What goes wrong:** Verification emails sent from local dev contain localhost URLs that don't work in production email
**Why it happens:** Using `context.url.origin` without environment check
**How to avoid:** Use environment variable for base URL (SITE_URL), fallback to request origin only in production
**Warning signs:** Developers can't test verification flow end-to-end locally

### Pitfall 6: Missing Email Verification on Password Reset
**What goes wrong:** User changes email, then resets password without verifying new email
**Why it happens:** email_verified flag not checked during password reset flow
**How to avoid:** Include email_verified check in password reset endpoint, require reverification if email changed
**Warning signs:** Account takeover reports, unauthorized email changes

### Pitfall 7: Resend API Key in Source Control
**What goes wrong:** API key committed to git repository, exposed publicly
**Why it happens:** Developer tests with hardcoded key instead of environment variable
**How to avoid:** Use Cloudflare Workers secrets (`wrangler secret put RESEND_API_KEY`), .dev.vars for local, add .dev.vars to .gitignore
**Warning signs:** API key visible in commits, unexpected email sends from compromised key

## Code Examples

Verified patterns from official sources:

### Environment Variable Access in Astro API Endpoint
```typescript
// Source: Existing pattern from src/pages/api/auth/signup.ts
import type { APIContext } from 'astro';

export async function POST(context: APIContext): Promise<Response> {
  const runtime = (context.locals as any).runtime;
  const apiKey = runtime.env.RESEND_API_KEY;
  const db = getDB(runtime);
  // ... use apiKey and db
}
```

### Rate Limiting for Verification Email Resend
```typescript
// Source: Existing pattern from src/lib/rateLimit.ts + src/pages/api/auth/signup.ts
import { checkRateLimit, getClientIP } from '../../../lib/rateLimit';

// In resend-verification endpoint
const clientIP = getClientIP(context);
const rateLimit = await checkRateLimit(db, clientIP, 'verify_email_resend', 3, 3600);

if (!rateLimit.allowed) {
  return new Response(JSON.stringify({
    error: `Too many verification emails requested. Please try again in ${Math.ceil(rateLimit.retryAfterSeconds / 60)} minutes.`
  }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': rateLimit.retryAfterSeconds.toString()
    }
  });
}
```

### Token Generation with @oslojs/crypto
```typescript
// Source: https://crypto.oslojs.dev/examples/random-values
import { generateRandomString } from "@oslojs/crypto/random";

export function generateVerificationToken(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return generateRandomString(crypto, alphabet, 64);
}

export function generateTokenExpiry(): number {
  // 24 hours from now in Unix epoch seconds
  return Math.floor(Date.now() / 1000) + (24 * 60 * 60);
}
```

### Sending Verification Email with Resend
```typescript
// Source: https://resend.com/docs/send-with-cloudflare-workers
import { Resend } from 'resend';

const resend = new Resend(runtime.env.RESEND_API_KEY);

const verificationUrl = `${runtime.env.SITE_URL}/api/auth/verify-email?token=${token}`;

const { data, error } = await resend.emails.send({
  from: 'RateMyPlace Boston <verify@ratemyplace.com>',
  to: user.email,
  subject: 'Verify your email address',
  html: `
    <h2>Welcome to RateMyPlace Boston!</h2>
    <p>Please verify your email address to get the verified badge on your reviews.</p>
    <p><a href="${verificationUrl}">Click here to verify your email</a></p>
    <p>This link will expire in 24 hours.</p>
    <p>If you didn't create an account, you can safely ignore this email.</p>
  `
});

if (error) {
  throw new Error(`Email send failed: ${error.message}`);
}
```

### Storing Verification Token in D1
```typescript
// Source: D1 API pattern from existing codebase + verification token design
import { generateIdFromEntropySize } from 'lucia';

const tokenId = generateIdFromEntropySize(10);
const token = generateVerificationToken();
const expiresAt = generateTokenExpiry();

await db.prepare(
  'INSERT INTO verification_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)'
).bind(tokenId, userId, token, expiresAt).run();
```

### Updating User Email Verified Status
```typescript
// Source: D1 update pattern from existing codebase
await db.prepare(
  'UPDATE users SET email_verified = 1 WHERE id = ?'
).bind(userId).run();

// Delete used token (single-use requirement)
await db.prepare(
  'DELETE FROM verification_tokens WHERE token = ?'
).bind(token).run();
```

### Existing email_verified Field Access
```typescript
// Source: src/lib/auth.ts lines 19-21
// The email_verified field already exists in users table and is exposed via Lucia
getUserAttributes: (attributes) => {
  return {
    email: attributes.email,
    emailVerified: attributes.email_verified === 1, // D1 stores as INTEGER
    name: attributes.name,
    // ...
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SendGrid, Mailgun SMTP | Resend API-first design | ~2023 | Simpler integration, better DX, native Workers support |
| Manual HTML email templates | React Email components | 2023-2024 | Type-safe, component-based, better rendering |
| Plain random tokens | Oslo.js crypto library | 2024-2025 | Runtime-agnostic, security-focused, Lucia ecosystem |
| Email + password only auth | OAuth + optional email verification | 2024-2025 | Better UX, less friction, verification as trust signal not gate |

**Deprecated/outdated:**
- **MailChannels for Workers:** Was free tier for Workers email, shut down in 2023, now recommend Resend
- **Verification as signup blocker:** Modern pattern is verify-after-signup with optional features for verified users (like badge)
- **JWT-based verification tokens:** Single-use random tokens in database preferred over signed JWTs for email verification

## Open Questions

1. **From Email Domain**
   - What we know: Resend requires verified domain for sending emails
   - What's unclear: Does project have domain ready? Need to verify DNS records (SPF, DKIM) in Resend dashboard
   - Recommendation: Use Resend's test domain (onboarding@resend.dev) initially, document domain verification as deployment prerequisite

2. **Email Template Complexity**
   - What we know: Can use plain HTML or React Email components
   - What's unclear: Is React Email complexity justified for simple verification email?
   - Recommendation: Start with plain HTML template, migrate to React Email if email complexity grows (e.g., digest emails, notifications)

3. **Cleanup Strategy for Expired Tokens**
   - What we know: Tokens should expire after 24 hours
   - What's unclear: Active cleanup job or lazy deletion on verification attempt?
   - Recommendation: Implement lazy deletion (check expiry on verification, delete if expired), add scheduled Worker cleanup later if table grows

4. **Session Handling on Verification**
   - What we know: Copenhagen Book recommends invalidating all sessions on email verification
   - What's unclear: Should user stay logged in or require re-login?
   - Recommendation: Keep current session active (better UX), invalidate sessions on password change instead

5. **Verification Badge Placement**
   - What we know: Badge should appear on reviews from verified users
   - What's unclear: Also show on user profile, review submission form, search results?
   - Recommendation: Start with review cards only (per EMAIL-03), expand to profile/other areas in future phases if desired

## Validation Architecture

> Skipped - workflow.nyquist_validation not enabled in .planning/config.json

## Sources

### Primary (HIGH confidence)
- [Resend Cloudflare Workers Documentation](https://resend.com/docs/send-with-cloudflare-workers) - Official integration guide, setup instructions, code examples
- [Cloudflare Workers Secrets Documentation](https://developers.cloudflare.com/workers/configuration/secrets/) - Environment variable management, local development setup
- [The Copenhagen Book - Email Verification](https://thecopenhagenbook.com/email-verification) - Security best practices, token generation, verification flow patterns
- [@oslojs/crypto Documentation](https://crypto.oslojs.dev/) - Random value generation, cryptographic utilities
- [Cloudflare Workers Astro Guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/) - Astro SSR integration, runtime access patterns

### Secondary (MEDIUM confidence)
- [Resend npm Package](https://www.npmjs.com/package/resend) - Version 6.9.2, last published Feb 10, 2026
- [SuperTokens Email Verification Flow](https://supertokens.com/blog/implementing-the-right-email-verification-flow) - Edge case handling (preview pane), multi-token strategies
- [Red Gate Authentication Database Design](https://www.red-gate.com/blog/how-to-store-authentication-data-in-a-database-part-2-email-confirmation-and-recovering-passwords) - Token table schema design, field specifications
- [React Email Integration with Resend](https://react.email/docs/integrations/resend) - Email template component patterns (optional)
- [Badge UI Design Patterns](https://mobbin.com/glossary/badge) - Verification badge design, positioning, format best practices

### Tertiary (LOW confidence)
- [Cloudflare Email Service Announcement](https://www.infoq.com/news/2025/10/cloudflare-email-service/) - Alternative to Resend, still in private beta as of Feb 2026
- WebSearch results on email verification UX anti-patterns - General guidance, needs validation against current design

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Resend is official Cloudflare-recommended solution, @oslojs/crypto already in dependencies, both well-documented
- Architecture: HIGH - Patterns verified from official docs and existing codebase (signup.ts, rateLimit.ts, auth.ts)
- Pitfalls: MEDIUM-HIGH - Preview pane issue verified from multiple sources, other pitfalls derived from security best practices and common mistakes
- Code examples: HIGH - All examples adapted from official documentation and existing codebase patterns

**Research date:** 2026-02-26
**Valid until:** 2026-03-26 (30 days - stable domain with mature tooling)
