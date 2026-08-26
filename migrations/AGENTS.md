# `migrations/` — D1 Schema Changes

Cloudflare D1 (SQLite). 27 migrations, `0001` through `0027`.

---

## Read this before running anything against production

**Migrations `0025`, `0026`, and `0027` were applied to production through the Cloudflare
dashboard console, not through wrangler.** Wrangler's migration tracking does not know
they ran.

`0027` is a non-idempotent `DROP COLUMN` batch — 15 columns. Re-running it fails, and
running `migrations apply --remote` blindly may attempt exactly that.

Before touching production schema: check the live schema directly, confirm what has
actually been applied, and apply deliberately. Do not assume wrangler's state is accurate.

```bash
# Local — safe, this is the normal loop
npx wrangler d1 migrations apply ratemyplace-db --local

# Remote — verify current schema first, and know what you are running
npx wrangler d1 migrations apply ratemyplace-db --remote
```

Remote D1 CLI access requires `CLOUDFLARE_API_TOKEN` in the environment. Without it you
get a 7403 error.

## Writing a migration

Format: `XXXX_description.sql`, zero-padded, incrementing. Check the directory for the
highest number.

Two filenames are misleading: `0021_reserved.sql` actually creates the `notifications`
table despite its name, and `0022_reserved.sql` is a genuine no-op (`SELECT 1;`). Do not
assume either is empty — read before touching.

### Rules

- **Timestamps are `unixepoch()`**, never `datetime('now')`:
  ```sql
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
  ```
- Use `CREATE TABLE IF NOT EXISTS` for new tables.
- Add `CHECK` constraints for enumerated values — the schema already does this for
  `status`, `unit_type`, and seasons. Keep it up.
- Foreign keys use `REFERENCES ... ON DELETE CASCADE` where a child row has no meaning
  without its parent.
- A migration is append-only once applied to production. Fix mistakes with a new
  migration, never by editing an applied file.

### Dropping a column safely

The 0025–0027 sequence is the pattern to copy:

1. Stop reading the column in code, ship it, verify in production.
2. Backfill the canonical column if you are consolidating two into one.
3. Only then drop, in a separate migration.

Dropping a column that deployed code still reads takes the site down.

## Schema overview

| Table | Holds |
|-------|-------|
| `users`, `sessions` | Lucia auth, `is_admin`, nullable password (OAuth accounts) |
| `buildings` | Address, geo, `place_id`, slug, landlord and manager links |
| `landlords`, `property_managers` | Separate entities — a building can have both |
| `reviews` | 27 rating columns + tenancy, unit type, rent, free text, status |
| `verification_images`, `verification_tokens` | Proof-of-address pipeline, email tokens |
| `disputes` | Landlord dispute submissions and resolutions |
| `audit_logs` | Destructive admin actions, old value → new value |
| `notifications` | In-app tenant notifications |
| `saved_buildings` | Bookmarks |
| `rate_limits` | Fail-closed rate limiting, keyed and windowed |
| `contact_messages`, `bug_reports` | Inbound forms with admin queues |
| `password_reset_tokens` | Reset flow |

The `building_scores`, `landlord_scores`, and `property_manager_scores` cache tables were
dropped in `0025` — do not reintroduce a table-level score cache without a deliberate
decision, the previous one drifted from live data.

`reviews.overall_score` is a different thing and **still exists**: a stored per-review
value that aggregate queries read. See [`src/lib/AGENTS.md`](../src/lib/AGENTS.md) for why
that makes a weight change diverge rather than propagate.

## Adding a survey column

A new rating item is a five-step change spanning this directory and `src/lib/`. See
[`src/lib/AGENTS.md`](../src/lib/AGENTS.md) — the migration is only step one, and a column
added without the other four steps is dead weight.

## Known cosmetic debt

`had_pests` and `had_pest_issues` both exist for the same concept. It works via fallback
logic and is harmless. Consolidating is fine; leaving it is also fine.

## Local development

```bash
npm run db:fresh    # drop and recreate local D1
npm run db:seed     # realistic seed data
npm run db:setup    # both
```

E2E tests (`npm run e2e`) run `db:setup` first. Seed scripts live in `scripts/` — when you
add a column that reviews depend on, update the seed script too or E2E breaks.
