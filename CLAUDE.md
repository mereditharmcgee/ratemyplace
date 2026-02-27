# RateMyPlace Boston - Coding Conventions

> For project context, architecture, and scoring methodology, see `CLAUDE_CONTEXT.md`.

## Quick Reference

| Item | Convention |
|------|------------|
| Framework | Astro 5.x SSR + React islands |
| Database | Cloudflare D1 (SQLite) |
| Auth | Lucia v3 with D1 adapter |
| Styling | Tailwind CSS 4.x |
| Types | TypeScript strict mode |

## File Patterns

### Pages (Astro)
- **Public pages**: `src/pages/*.astro` - SSR, no client JS unless needed
- **Dynamic routes**: `src/pages/[slug].astro` - Use `Astro.params.slug`
- **Admin pages**: `src/pages/admin/*.astro` - Always check `locals.user?.isAdmin`

### API Routes
- **Location**: `src/pages/api/**/*.ts`
- **Auth check pattern**:
```typescript
if (!context.locals.user) {
  return new Response(JSON.stringify({ error: 'Authentication required' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  });
}
```
- **Admin check pattern**:
```typescript
if (!context.locals.user?.isAdmin) {
  return new Response(JSON.stringify({ error: 'Admin access required' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' }
  });
}
```

### Components
- **Astro components**: Static/SSR rendering, use for layouts and data display
- **React components**: Interactive islands only (forms, maps, dynamic UI)
- **React directive**: Always use `client:load` for immediate interactivity

```astro
<!-- Astro component with React island -->
<ReviewForm client:load buildingId={building.id} />
```

### Library Files (`src/lib/`)
- **Single responsibility**: One concern per file
- **Export types**: Always export interfaces for consumers
- **Critical files**:
  - `scoring.ts` - All scoring logic (weights, calculations)
  - `surveyItems.ts` - Survey questions and help text
  - `validation.ts` - Input validation
  - `audit.ts` - Admin action logging

## Database Patterns

### Getting DB Connection
```typescript
import { getDB } from '../../lib/db';

const db = getDB((context.locals as any).runtime);
```

### Query Patterns
```typescript
// Single row
const user = await db.prepare('SELECT * FROM users WHERE id = ?')
  .bind(userId)
  .first<User>();

// Multiple rows
const { results } = await db.prepare('SELECT * FROM reviews WHERE building_id = ?')
  .bind(buildingId)
  .all<Review>();

// Insert with generated ID
import { generateIdFromEntropySize } from 'lucia';
const id = generateIdFromEntropySize(10);
await db.prepare('INSERT INTO reviews (id, ...) VALUES (?, ...)')
  .bind(id, ...)
  .run();
```

### Timestamps
- Use `unixepoch()` for SQLite timestamps (not `datetime('now')`)
- Column type: `INTEGER DEFAULT (unixepoch())`

## Scoring System (Critical)

### Modifying Weights
1. Edit `ITEM_WEIGHTS` in `src/lib/scoring.ts`
2. Document justification with academic citation
3. Update `src/pages/methodology.astro`

### Adding Survey Items
1. Add column in new migration (`migrations/XXXX_name.sql`)
2. Add to `src/lib/surveyItems.ts` with help text
3. Add to domain array in `src/lib/scoring.ts` (UNIT_FIELDS, BUILDING_FIELDS, or LANDLORD_FIELDS)
4. Set weight in `ITEM_WEIGHTS`
5. Update `ReviewForm.tsx` and `ReviewCard.astro`

### Weight Guidelines
| Weight | Use For |
|--------|---------|
| 1.5x | Major health hazards (pests, mold) |
| 1.3x | Safety hazards (structural, climate) |
| 1.2x | Health-adjacent (plumbing, security) |
| 1.0x | Standard quality factors |

## Error Handling

### API Responses
```typescript
// Success
return new Response(JSON.stringify({ data: result }), {
  status: 200,
  headers: { 'Content-Type': 'application/json' }
});

// Client error
return new Response(JSON.stringify({ error: 'Validation failed', details: errors }), {
  status: 400,
  headers: { 'Content-Type': 'application/json' }
});

// Server error
return new Response(JSON.stringify({ error: 'Internal server error' }), {
  status: 500,
  headers: { 'Content-Type': 'application/json' }
});
```

### Audit Logging (Admin Actions)
```typescript
import { createAuditLog } from '../../lib/audit';

// Best-effort logging - failures don't break the action
await createAuditLog(db, {
  adminUserId: context.locals.user.id,
  actionType: 'review_approved',
  entityType: 'review',
  entityId: reviewId,
  oldValue: { status: 'pending' },
  newValue: { status: 'approved' }
});
```

## Styling

### Score Colors
```typescript
// Use these Tailwind classes for score display
const getScoreColor = (score: number) => {
  if (score >= 4) return 'bg-emerald-500 text-white';
  if (score >= 3) return 'bg-amber-500 text-white';
  if (score >= 2) return 'bg-orange-500 text-white';
  return 'bg-red-500 text-white';
};
```

### Brand Colors
- **Primary**: `text-teal-600` / `bg-teal-600`
- **Stars**: `text-amber-400`
- **Danger**: `text-red-600`

## Testing

### Run Tests
```bash
npm test              # All tests
npm test -- scoring   # Filter by name
```

### Test Location
- Unit tests: `src/lib/__tests__/*.test.ts`
- E2E tests: `e2e/*.spec.ts`

## Migrations

### Create Migration
```bash
# Create new migration file
touch migrations/XXXX_description.sql

# Apply locally
npx wrangler d1 migrations apply ratemyplace-db --local

# Apply to production
npx wrangler d1 migrations apply ratemyplace-db --remote
```

### Migration Naming
- Format: `XXXX_description.sql` (e.g., `0015_add_feature.sql`)
- Next number: Check existing migrations and increment

## Security Checklist

When adding new endpoints:
- [ ] Auth check if needed (`context.locals.user`)
- [ ] Admin check if admin-only (`context.locals.user?.isAdmin`)
- [ ] Input validation before processing
- [ ] Parameterized queries (never string interpolation)
- [ ] Rate limiting for public endpoints
- [ ] Audit logging for admin actions

## Common Mistakes to Avoid

1. **Don't use `datetime('now')`** - Use `unixepoch()` for timestamps
2. **Don't skip auth checks** - Every API route needs explicit auth handling
3. **Don't modify scoring without documentation** - Update methodology page
4. **Don't use `any` types** - Define interfaces in `types.ts`
5. **Don't put business logic in components** - Use `lib/` files

## Git Workflow

### Commit Prefixes
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation
- `chore:` - Maintenance
- `refactor:` - Code restructuring

### Branch Strategy
- `main` - Production (auto-deploys to Cloudflare)
- Feature branches for development

---
*See `CLAUDE_CONTEXT.md` for full project context and architecture.*
