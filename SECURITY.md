# Security Documentation - RateMyPlace

## Overview

This document outlines security considerations, implemented measures, and known areas for improvement in the RateMyPlace application.

## Authentication Security

### Password Hashing
- **Algorithm:** PBKDF2-SHA256
- **Iterations:** 100,000
- **Salt:** 128-bit random per password
- **Key Length:** 256 bits
- **Format:** `base64(salt)$base64(hash)`
- **Legacy Support:** Old SHA-256 hashes are supported for backward compatibility during migration

### Session Management
- **Library:** Lucia v3 with D1 SQLite adapter
- **Cookie Attributes:**
  - `HttpOnly`: true (prevents JavaScript access)
  - `Secure`: true in production (HTTPS only)
  - `SameSite`: lax (CSRF protection)
- **Session Validation:** Performed on every request via middleware

### OAuth (Google Sign-In)
- **CSRF Protection:** State parameter with HMAC validation
- **State Storage:** HttpOnly cookie with 10-minute expiration

## Authorization

### Admin Access
- All `/api/admin/*` endpoints require:
  1. Valid session (401 if missing)
  2. Admin role (`isAdmin: true`) (403 if not admin)

### User Data Access
- Users can only view/edit their own reviews
- Ownership verified before any update operations

## Input Validation

### Review Form Validation (`src/lib/validation.ts`)
- Building ID presence
- Year ranges (1900 to current year)
- Valid seasons (winter, spring, summer, fall)
- Valid unit types (studio, 1br, 2br, etc.)
- Rent amount bounds (0-50,000)
- Score ranges (1-5)
- Text length limits (200 chars title, 5000 chars text)

### Text Sanitization
- HTML tags stripped from user input
- Whitespace normalized

## SQL Injection Prevention
- All database queries use parameterized statements via D1's `.bind()` method
- No string concatenation in SQL queries

## File Upload Security

### Verification Images
- **Allowed Types:** JPEG, PNG, HEIC/HEIF, PDF
- **Size Limit:** 10 MB
- **Storage:** Cloudflare R2 (not directly accessible)
- **Filename:** Timestamp-based, not user-controlled

## Known Limitations & Recommendations

### Rate Limiting
**Status:** Not implemented
**Risk:** Brute force attacks, spam

**Recommended Implementation:**
```typescript
// Use Cloudflare's rate limiting or implement via D1:
// - /api/auth/signin: 5 attempts per IP per 15 minutes
// - /api/auth/signup: 3 accounts per IP per hour
// - /api/verification/upload: 10 uploads per user per day
```

### CSRF Protection
**Status:** Partial (SameSite cookies)
**Recommendation:** Consider adding explicit CSRF tokens for additional protection

### API Key Security
**Google Maps API Key:**
- Exposed to client (required for frontend Maps)
- **Action Required:** Configure HTTP referrer restrictions in Google Cloud Console

### Content Security
- User-generated content (review text) is stored without additional escaping
- React auto-escapes in JSX, but ensure all output contexts are safe

## Security Headers

Add these headers via Cloudflare Pages settings or `_headers` file:
```
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  X-XSS-Protection: 1; mode=block
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://maps.googleapis.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.googleapis.com https://*.gstatic.com; connect-src 'self' https://maps.googleapis.com
```

## Incident Response

If a security vulnerability is discovered:
1. Do not disclose publicly
2. Contact: security@ratemyplace.org
3. Provide details and steps to reproduce

## Audit History

| Date | Auditor | Findings |
|------|---------|----------|
| 2026-01-27 | Claude | Initial audit - upgraded password hashing, documented recommendations |

## Resources

- [OWASP Top 10](https://owasp.org/Top10/)
- [Lucia Auth Documentation](https://lucia-auth.com/)
- [Cloudflare Security Best Practices](https://developers.cloudflare.com/workers/configuration/security/)
