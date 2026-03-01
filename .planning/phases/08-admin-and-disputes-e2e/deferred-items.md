# Deferred Items — Phase 08 Admin and Disputes E2E

## Pre-existing failures in admin-pages.spec.ts (from Plan 01)

These failures were discovered during Plan 02 (08-02) full E2E run but are NOT caused by Plan 02 changes. They exist in `e2e/admin-pages.spec.ts` (created by Plan 01). All 7 admin-actions.spec.ts tests pass.

### Failure 1: Admin Page Navigation - strict mode violation on verify nav link

**File:** `e2e/admin-pages.spec.ts:7`
**Test:** `admin navigation bar contains all page links`
**Issue:** `locator('nav a[href="/admin/verify"]')` resolves to 3 elements (strict mode violation). The verify link exists in both desktop nav and mobile nav, plus a header link.
**Fix needed:** Use `.first()` or a more specific locator scoped to the admin sidebar nav.

### Failure 2: Admin Dashboard - strict mode violation on 'Buildings' text

**File:** `e2e/admin-pages.spec.ts:25`
**Test:** `dashboard shows stats cards`
**Issue:** `locator('text=Buildings')` resolves to 3 elements. Text 'Buildings' appears in nav link, stats card, and another context.
**Fix needed:** Use a more specific locator like `locator('p.text-sm.font-medium', { hasText: 'Buildings' })` or scope to the stats section.

### Failure 3: Access Control - non-admin redirect timeout

**File:** `e2e/admin-pages.spec.ts:116`
**Test:** `non-admin user is redirected from admin pages`
**Issue:** `ResponseSentError` on the server, `waitForURL('/')` times out. The redirect mechanism may have changed or a server-side error prevents proper redirect.
**Fix needed:** Investigate redirect behavior; may need `page.waitForURL('/')` replaced with `page.waitForURL(/^\/$/)` or check for redirect with `expect(page).toHaveURL('/')`.

### Failure 4: Access Control - unauthenticated redirect timeout

**File:** `e2e/admin-pages.spec.ts:124`
**Test:** `unauthenticated user is redirected to signin`
**Issue:** `waitForURL(/auth\/signin/)` times out after 30s.
**Fix needed:** Check if auth middleware redirect is working; may need baseURL-relative URL pattern or longer timeout.

## Recommendation

These should be addressed in a Plan 03 or as part of future regression testing work. The admin-actions tests (Plan 02 scope) all pass.
