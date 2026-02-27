# Phase 3: Security Hardening - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Rate limiting fails safely (blocks on DB error, not allows) and admin actions are audited with a viewable trail. This phase hardens existing infrastructure and adds accountability — no new user-facing features.

</domain>

<decisions>
## Implementation Decisions

### Fail-closed behavior
- Return 503 Service Unavailable on rate limit DB errors (not 429)
- User message: "Service temporarily unavailable. Please try again in a few minutes."
- Include Retry-After header with fixed interval (e.g., 60 seconds)
- Apply to all rate-limited endpoints — consistent behavior

### Logging & alerts
- Log to console/stdout — works with Vercel/hosting log aggregation
- Structured JSON format: timestamp, endpoint, IP, error type, request ID
- Log level: error — triggers external monitoring/alerting
- No in-app alerting — rely on log monitoring services

### Audit trail scope
- Audit all admin state changes: approve/reject review, resolve/dismiss dispute, any status change
- Standard fields: timestamp, admin user ID, action type, target entity (review/dispute ID), old value, new value
- Capture admin's IP address for security investigations
- Store in database table (audit_logs) — queryable, viewable in dashboard

### Audit dashboard
- Dedicated /admin/audit page with full log viewer
- Essential filters: action type, date range, admin user
- Standard pagination (25-50 entries per page)
- No export functionality for now — view only

### Claude's Discretion
- Exact Retry-After interval value
- Audit log table schema details
- Pagination size (within 25-50 range)
- Filter UI implementation details

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 03-security-hardening*
*Context gathered: 2026-02-26*
