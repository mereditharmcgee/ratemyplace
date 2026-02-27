# Phase 3: Security Hardening - Research

**Researched:** 2026-02-26
**Domain:** Rate limiting fail-closed behavior, structured logging, audit trail architecture, admin observability
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Fail-closed behavior:**
- Return 503 Service Unavailable on rate limit DB errors (not 429)
- User message: "Service temporarily unavailable. Please try again in a few minutes."
- Include Retry-After header with fixed interval (e.g., 60 seconds)
- Apply to all rate-limited endpoints — consistent behavior

**Logging & alerts:**
- Log to console/stdout — works with Vercel/hosting log aggregation
- Structured JSON format: timestamp, endpoint, IP, error type, request ID
- Log level: error — triggers external monitoring/alerting
- No in-app alerting — rely on log monitoring services

**Audit trail scope:**
- Audit all admin state changes: approve/reject review, resolve/dismiss dispute, any status change
- Standard fields: timestamp, admin user ID, action type, target entity (review/dispute ID), old value, new value
- Capture admin's IP address for security investigations
- Store in database table (audit_logs) — queryable, viewable in dashboard

**Audit dashboard:**
- Dedicated /admin/audit page with full log viewer
- Essential filters: action type, date range, admin user
- Standard pagination (25-50 entries per page)
- No export functionality for now — view only

### Claude's Discretion

- Exact Retry-After interval value
- Audit log table schema details
- Pagination size (within 25-50 range)
- Filter UI implementation details

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEC-01 | Rate limiting fails closed (blocks requests on DB error, not allows) | Fail-closed pattern research, 503 vs 429 status codes, error handling architecture |
| SEC-02 | Rate limit failures logged with alerts | Structured JSON logging patterns, Cloudflare Workers logging best practices, error-level logging |
| SEC-03 | Admin actions logged with audit trail (who, what, when) | Audit log table schema, React admin table patterns (existing DisputesQueue component), filtering/pagination architecture |

</phase_requirements>

## Summary

Phase 3 hardens existing infrastructure by converting rate limiting from fail-open to fail-closed and adding comprehensive audit logging for admin actions. The technical challenges are: (1) modifying checkRateLimit() to return errors instead of allowing on DB failure, (2) implementing structured JSON logging without dependencies (console.log is sufficient for Cloudflare), and (3) creating an audit_logs table with React admin viewer following existing pattern (DisputesQueue, ReviewsTable).

The project already has rate limiting infrastructure (src/lib/rateLimit.ts) and admin table components (ReviewsTable, DisputesQueue). This phase extends those patterns with security hardening and observability.

Industry best practice (2026) is fail-closed for security-critical endpoints (auth, admin actions) and structured JSON logging for observability. Cloudflare Workers documentation explicitly recommends console.log with JSON objects for automatic indexing and filtering.

**Primary recommendation:** Modify checkRateLimit() catch block to return {allowed: false, error: true}, add lightweight JSON logging helper (no dependencies needed), create audit_logs migration with immutable schema, and build /admin/audit page following DisputesQueue component pattern with filters and pagination.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native console.log | Built-in | Structured logging | Cloudflare Workers best practice — automatic indexing |
| Cloudflare D1 | Latest | SQLite database | Existing project database for audit_logs table |
| Astro | 5.16.11 | API routes, pages | Existing framework for /admin/audit endpoint |
| React | 18.3.1 | Admin UI components | Existing admin tables (ReviewsTable, DisputesQueue) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | 4.0.18 | Unit testing | Test fail-closed logic, JSON logger helper |
| TypeScript | Latest | Type safety | All new code (project standard) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| console.log JSON | Pino logger | Pino adds 5x performance but unnecessary for current scale; console.log sufficient for Cloudflare |
| DB audit table | External service | DB table simpler, queryable in admin dashboard, no external dependencies |
| 503 status | 429 status | 429 = client error (rate limit), 503 = server error (DB failure) — semantically correct |

**Installation:**
No new dependencies required — using native console.log and existing stack.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── lib/
│   ├── rateLimit.ts           # Modify fail-open → fail-closed
│   ├── logger.ts              # NEW: JSON logging helper
│   └── audit.ts               # NEW: Audit log creation helper
├── components/admin/
│   └── AuditLogTable.tsx      # NEW: Follow DisputesQueue pattern
└── pages/
    ├── api/
    │   └── admin/
    │       └── audit.ts       # NEW: GET endpoint for audit logs
    └── admin/
        └── audit.astro        # NEW: Admin audit viewer page
```

### Pattern 1: Fail-Closed Rate Limiting
**What:** Return error result instead of allowing requests when DB fails
**When to use:** All security-critical endpoints (auth, admin actions)
**Example:**
```typescript
// Current (fail-open) - WRONG for security
catch (error) {
  console.error('Rate limit check error:', error);
  return { allowed: true, remaining: maxAttempts, retryAfterSeconds: 0 };
}

// Updated (fail-closed) - CORRECT for security
catch (error) {
  console.error('Rate limit check error:', error);
  return {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: 60,
    error: true  // NEW: signals DB failure vs rate limit hit
  };
}
```

### Pattern 2: Structured JSON Logging
**What:** Log objects instead of strings for automatic indexing
**When to use:** All error conditions, security events, audit trails
**Example:**
```typescript
// Source: Cloudflare Workers Best Practices 2026
// https://developers.cloudflare.com/workers/best-practices/workers-best-practices/

// BAD: String logging (not queryable)
console.error('Rate limit error:', error);

// GOOD: Structured JSON (automatically indexed by Cloudflare)
console.error(JSON.stringify({
  level: 'error',
  timestamp: new Date().toISOString(),
  event: 'rate_limit_failure',
  endpoint: endpoint,
  ip: identifier,
  error: error.message,
  request_id: crypto.randomUUID()
}));

// Helper pattern:
export function logError(event: string, context: Record<string, any>) {
  console.error(JSON.stringify({
    level: 'error',
    timestamp: new Date().toISOString(),
    event,
    ...context
  }));
}
```

### Pattern 3: Audit Log Table Schema
**What:** Immutable table storing who did what when
**When to use:** All admin state changes (review approval, dispute resolution)
**Example:**
```sql
-- Source: Database audit logging best practices
-- https://www.bytebase.com/blog/database-audit-logging/

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    admin_user_id TEXT NOT NULL REFERENCES users(id),
    admin_ip TEXT NOT NULL,
    action_type TEXT NOT NULL CHECK (action_type IN (
        'review_approved', 'review_rejected', 'review_flagged',
        'dispute_resolved', 'dispute_dismissed'
    )),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('review', 'dispute')),
    entity_id TEXT NOT NULL,
    old_value TEXT,  -- JSON: previous state
    new_value TEXT,  -- JSON: new state
    notes TEXT       -- Admin's reason/notes
);

CREATE INDEX idx_audit_admin ON audit_logs(admin_user_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
CREATE INDEX idx_audit_action ON audit_logs(action_type);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
```

### Pattern 4: HTTP Status Code Selection
**What:** Use semantically correct status codes for different failure modes
**When to use:** Rate limit enforcement
**Example:**
```typescript
// Source: HTTP Status Code Best Practices 2026
// https://httpstatus.com/codes/compare/429-vs-503

// 429 Too Many Requests — CLIENT ERROR (user sent too many requests)
if (!rateLimit.allowed && !rateLimit.error) {
  return new Response(JSON.stringify({
    error: 'Too many attempts. Please try again later.'
  }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(rateLimit.retryAfterSeconds)
    }
  });
}

// 503 Service Unavailable — SERVER ERROR (rate limiter DB failed)
if (!rateLimit.allowed && rateLimit.error) {
  return new Response(JSON.stringify({
    error: 'Service temporarily unavailable. Please try again in a few minutes.'
  }), {
    status: 503,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': '60'  // Fixed interval for DB errors
    }
  });
}
```

### Pattern 5: Retry-After Header Best Practices
**What:** Tell clients exactly when to retry failed requests
**When to use:** Both 429 (rate limit) and 503 (service error) responses
**Example:**
```typescript
// Source: Rate Limiting Best Practices 2026
// https://oneuptime.com/blog/post/2026-01-30-api-rate-limit-headers/

// Format options:
// 1. Integer (seconds to wait) — RECOMMENDED for simplicity
headers: { 'Retry-After': '60' }

// 2. HTTP date — alternative for specific timestamp
headers: { 'Retry-After': new Date(Date.now() + 60000).toUTCString() }

// Best practice: Use seconds for dynamic rate limits, fixed intervals for errors
if (rateLimit.error) {
  // DB error: fixed 60 second retry
  headers: { 'Retry-After': '60' }
} else {
  // Rate limit: dynamic retry based on window
  headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) }
}
```

### Pattern 6: Admin Audit Viewer Component
**What:** React table with filters and pagination for audit logs
**When to use:** /admin/audit page
**Example:**
```typescript
// Source: Existing DisputesQueue.tsx pattern

export default function AuditLogTable() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('all');
  const [adminFilter, setAdminFilter] = useState('all');
  const [page, setPage] = useState(1);
  const pageSize = 50;  // Within 25-50 range

  useEffect(() => {
    fetchLogs();
  }, [actionFilter, adminFilter, page]);

  const fetchLogs = async () => {
    const params = new URLSearchParams({
      action: actionFilter,
      admin: adminFilter,
      page: String(page),
      limit: String(pageSize)
    });
    const response = await fetch(`/api/admin/audit?${params}`);
    // ... handle response
  };

  // Render: filters → table → pagination
  // Follow ReviewsTable styling and structure
}
```

### Anti-Patterns to Avoid
- **Fail-open for security endpoints:** Allowing requests when security checks fail creates attack vectors
- **String-only logging:** Unstructured logs aren't queryable in Cloudflare dashboard
- **Mutable audit logs:** Audit tables must be INSERT-only (no UPDATE/DELETE triggers)
- **Missing Retry-After headers:** Clients need guidance on when to retry
- **Inconsistent status codes:** 429 vs 503 must match failure type (client vs server)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON logger | Custom logging library | console.log + JSON.stringify | Cloudflare Workers auto-indexes JSON from console.log |
| UUID generation | Custom ID function | crypto.randomUUID() | Native Web Crypto API, cryptographically secure |
| Date formatting | moment.js | Intl.DateTimeFormat | Native, smaller bundle, better i18n |
| Admin table pagination | Custom pagination logic | Existing ReviewsTable pattern | Proven pattern, consistent UX |

**Key insight:** Cloudflare Workers environment provides native primitives (console.log indexing, Web Crypto API) that eliminate need for external dependencies. Don't add libraries when platform provides functionality.

## Common Pitfalls

### Pitfall 1: Logging Sensitive Data
**What goes wrong:** Audit logs capture passwords, tokens, or PII in old_value/new_value fields
**Why it happens:** Logging entire request bodies or user objects without filtering
**How to avoid:** Only log status changes and IDs, never passwords/tokens/emails
**Warning signs:** Audit log JSON contains "password", "token", "email" fields

### Pitfall 2: Inconsistent Fail-Closed Enforcement
**What goes wrong:** Some endpoints fail-open, others fail-closed, creating security gaps
**Why it happens:** Modifying one usage of checkRateLimit() but missing others
**How to avoid:** Grep for all checkRateLimit() calls, verify consistent error handling
**Warning signs:** Test with DB disconnected — some endpoints allow, others block

### Pitfall 3: Missing Request IDs in Logs
**What goes wrong:** Can't correlate rate limit failures with specific user requests
**Why it happens:** Each log entry creates new UUID instead of using request ID
**How to avoid:** Pass request ID through context (from Cloudflare cf-ray header or generate once per request)
**Warning signs:** Multiple log entries for same request have different IDs

### Pitfall 4: Audit Log Performance Degradation
**What goes wrong:** Audit log queries slow down as table grows to 100K+ rows
**Why it happens:** Missing indexes on filter columns (created_at, action_type, admin_user_id)
**How to avoid:** Create indexes in migration, test queries with EXPLAIN QUERY PLAN
**Warning signs:** /admin/audit page loads slowly, D1 query timeouts

### Pitfall 5: Timezone Confusion in Audit Logs
**What goes wrong:** Audit log timestamps display in server timezone, not admin's local time
**Why it happens:** Storing UTC timestamps but displaying without conversion
**How to avoid:** Store as unixepoch (UTC), display with JavaScript Date.toLocaleString() for local timezone
**Warning signs:** Timestamps off by hours, admins confused about event timing

### Pitfall 6: Race Conditions in Audit Logging
**What goes wrong:** Admin action succeeds but audit log fails, creating gaps in trail
**Why it happens:** Two separate transactions — action UPDATE + audit INSERT
**How to avoid:** Not solvable with D1 (no multi-statement transactions), accept best-effort logging
**Warning signs:** Actions succeed but audit logs missing entries (monitor audit_logs count vs admin actions)

### Pitfall 7: Overly Broad Action Types
**What goes wrong:** Single action type "review_updated" doesn't distinguish approve/reject/flag
**Why it happens:** Trying to use fewer enums, losing audit granularity
**How to avoid:** Specific action types (review_approved, review_rejected) enable precise filtering
**Warning signs:** Can't filter audit log to "show only approvals" — too generic

## Code Examples

Verified patterns from official sources and existing codebase:

### Fail-Closed Rate Limit Integration
```typescript
// In API endpoint (e.g., /api/auth/signin.ts)
// Source: Existing pattern + fail-closed modification

const clientIP = getClientIP(context);
const rateLimit = await checkRateLimit(
  db,
  clientIP,
  'signin',
  5,      // max attempts
  900     // 15 minute window
);

if (!rateLimit.allowed) {
  // NEW: Distinguish DB error (503) from rate limit (429)
  const status = rateLimit.error ? 503 : 429;
  const message = rateLimit.error
    ? 'Service temporarily unavailable. Please try again in a few minutes.'
    : 'Too many attempts. Please try again later.';

  // NEW: Structured error logging
  if (rateLimit.error) {
    console.error(JSON.stringify({
      level: 'error',
      timestamp: new Date().toISOString(),
      event: 'rate_limit_db_failure',
      endpoint: 'signin',
      ip: clientIP,
      request_id: crypto.randomUUID()
    }));
  }

  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(rateLimit.retryAfterSeconds)
    }
  });
}
```

### Audit Log Creation Helper
```typescript
// src/lib/audit.ts

interface AuditLogEntry {
  adminUserId: string;
  adminIp: string;
  actionType: string;
  entityType: 'review' | 'dispute';
  entityId: string;
  oldValue?: Record<string, any>;
  newValue?: Record<string, any>;
  notes?: string;
}

export async function createAuditLog(
  db: any,
  entry: AuditLogEntry
): Promise<void> {
  await db.prepare(`
    INSERT INTO audit_logs (
      admin_user_id, admin_ip, action_type, entity_type, entity_id,
      old_value, new_value, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    entry.adminUserId,
    entry.adminIp,
    entry.actionType,
    entry.entityType,
    entry.entityId,
    entry.oldValue ? JSON.stringify(entry.oldValue) : null,
    entry.newValue ? JSON.stringify(entry.newValue) : null,
    entry.notes || null
  ).run();
}

// Usage in admin endpoint:
// PATCH /api/admin/reviews/[id].ts - after updating review status

const oldStatus = review.status;  // Fetch before update
// ... perform update ...
const newStatus = body.status;

await createAuditLog(db, {
  adminUserId: context.locals.user.id,
  adminIp: getClientIP(context),
  actionType: `review_${newStatus}`,  // review_approved, review_rejected
  entityType: 'review',
  entityId: reviewId,
  oldValue: { status: oldStatus },
  newValue: { status: newStatus },
  notes: body.moderation_notes
});
```

### Admin Audit Log API Endpoint
```typescript
// src/pages/api/admin/audit.ts

export async function GET(context: APIContext): Promise<Response> {
  if (!context.locals.user?.isAdmin) {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const url = new URL(context.request.url);
  const actionFilter = url.searchParams.get('action') || 'all';
  const adminFilter = url.searchParams.get('admin') || 'all';
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = 50;
  const offset = (page - 1) * limit;

  try {
    const db = getDB((context.locals as any).runtime);

    // Build query with filters
    let whereClause = '1=1';
    const params: any[] = [];

    if (actionFilter !== 'all') {
      whereClause += ' AND action_type = ?';
      params.push(actionFilter);
    }

    if (adminFilter !== 'all') {
      whereClause += ' AND admin_user_id = ?';
      params.push(adminFilter);
    }

    const logs = await db.prepare(`
      SELECT
        a.*,
        u.email as admin_email
      FROM audit_logs a
      JOIN users u ON a.admin_user_id = u.id
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();

    const total = await db.prepare(`
      SELECT COUNT(*) as count
      FROM audit_logs
      WHERE ${whereClause}
    `).bind(...params).first();

    return new Response(JSON.stringify({
      logs: logs.results,
      total: total.count,
      page,
      pages: Math.ceil(total.count / limit)
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch audit logs' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fail-open rate limiting | Fail-closed for security endpoints | 2024-2025 industry shift | Prevents bypass via DB attacks |
| String logging | Structured JSON logging | 2023+ (OTEL/cloud-native) | Queryable logs, better observability |
| External audit services | In-database audit tables | Ongoing preference | Lower latency, no external deps |
| Pino/Winston | Native console.log (Cloudflare) | 2025-2026 Workers best practice | Simpler, auto-indexed by platform |

**Deprecated/outdated:**
- **Fail-open everywhere:** 2023 guidance was "fail-open for availability" — now nuanced per endpoint
- **Regex for URL validation:** Native URL constructor more robust, handles edge cases
- **moment.js:** Deprecated in favor of native Intl APIs and date-fns

## Open Questions

1. **Request ID propagation**
   - What we know: Cloudflare provides cf-ray header with request ID
   - What's unclear: Whether cf-ray persists through API route context
   - Recommendation: Use context.request.headers.get('cf-ray') or generate with crypto.randomUUID()

2. **Audit log retention**
   - What we know: Best practice is 90-365 days
   - What's unclear: D1 storage limits and cleanup automation
   - Recommendation: Start with no cleanup, monitor table size, implement cron if needed

3. **Concurrent audit log writes**
   - What we know: D1 supports concurrent writes but no multi-statement transactions
   - What's unclear: Failure scenarios if audit log write fails after action succeeds
   - Recommendation: Accept best-effort logging, monitor for gaps via alert on audit log write failures

## Validation Architecture

> Note: workflow.nyquist_validation is not enabled in .planning/config.json — skipping test framework details

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-01 | Rate limiting fails closed on DB error | unit | `npm test -- src/lib/__tests__/rateLimit.test.ts -t "gracefully handles database errors"` | ✅ Needs update |
| SEC-02 | Rate limit failures logged with JSON | unit | `npm test -- src/lib/__tests__/logger.test.ts` | ❌ Wave 0 |
| SEC-03 | Admin actions create audit log entries | unit | `npm test -- src/lib/__tests__/audit.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test` (runs all unit tests, < 10 seconds)
- **Per wave merge:** `npm test` (same — no E2E needed for backend logic)
- **Phase gate:** Full test suite green + manual verification of audit log UI

### Wave 0 Gaps
- [ ] `src/lib/__tests__/logger.test.ts` — covers structured JSON logging helper
- [ ] `src/lib/__tests__/audit.test.ts` — covers audit log creation and queries
- [ ] Update `src/lib/__tests__/rateLimit.test.ts` — change test expectation from `allowed: true` to `allowed: false` on DB error
- [ ] Framework install: Not needed — Vitest already configured

## Sources

### Primary (HIGH confidence)
- Cloudflare Workers Best Practices (2026) — https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
- Cloudflare Workers Logs Documentation — https://developers.cloudflare.com/workers/observability/logs/workers-logs/
- HTTP 429 vs 503 Status Codes — https://httpstatus.com/codes/compare/429-vs-503
- Fail Open vs Fail Closed Cybersecurity — https://authzed.com/blog/fail-open

### Secondary (MEDIUM confidence)
- Audit Logging Best Practices (2026) — https://www.bytebase.com/blog/database-audit-logging/
- Rate Limiting Best Practices — https://oneuptime.com/blog/post/2026-01-30-api-rate-limit-headers/view
- Structured Logging Best Practices — https://oneuptime.com/blog/post/2026-01-25-structured-logging-best-practices/view
- Pino Logger Guide (2026) — https://signoz.io/guides/pino-logger/
- Node.js Logging Best Practices — https://betterstack.com/community/guides/logging/nodejs-logging-best-practices/

### Tertiary (LOW confidence)
- React Admin Dashboard Templates (2026) — https://refine.dev/blog/react-admin-dashboard/
- SQLite Audit Trail Examples — https://medium.com/@dgramaciotti/creating-audit-tables-with-sqlite-and-sql-triggers-751f8e13cf73

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Using existing project stack (console.log, D1, React), no new dependencies
- Architecture patterns: HIGH — Fail-closed pattern well-documented, Cloudflare Workers logging official guidance, audit schema standard
- Pitfalls: MEDIUM-HIGH — Identified from best practices docs and SQLite limitations (no transactions)
- Validation: MEDIUM — Test framework exists, need new test files for logger and audit helpers

**Research date:** 2026-02-26
**Valid until:** ~30 days (stable domain, security best practices evolve slowly)
