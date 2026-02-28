# Phase 5: Seed Data - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Populate local D1 with realistic, volume-appropriate data ready for E2E and stress tests. Delivers `npm run db:seed` and `npm run db:setup` (fresh + seed). Score aggregation tables must be pre-computed and verified. Creating or modifying the review form, scoring logic, or any user-facing features is out of scope.

</domain>

<decisions>
## Implementation Decisions

### Data realism
- Use real Boston neighborhoods and plausible street addresses (Allston, Back Bay, Dorchester, etc.)
- Review scores follow a realistic bell curve — most clustered around 2.5–3.5, few outliers at 1 and 5
- Review text should be realistic varied-length paragraphs that read like real tenant feedback — some detailed, some brief
- At least one building must have 20+ reviews; at least one must have 0 reviews (per success criteria)

### Test user setup
- All test users share the same password: `TestPassword123!`
- Passwords stored as bcrypt hashes (matching production auth flow)
- 3 test users required per success criteria — one with `email_verified = 1`, one with `is_admin = 1`

### Script behavior
- `db:seed` fails with a clear error if data already exists — forces user to run `db:fresh` first (no silent appending or auto-wiping)
- Seed data is fully deterministic — same buildings, reviews, scores every run (E2E tests can assert on specific values)
- `npm run db:setup` = `db:fresh` + `db:seed` — one command from zero to fully ready database
- TypeScript script at `scripts/db-seed.ts`, run via `npx tsx` (matches Phase 4 pattern)

### Score computation
- Use the actual `scoring.ts` logic to compute `building_scores` and `landlord_scores` aggregate rows — guarantees consistency with production
- After seeding, verify scores by re-computing from seeded reviews and comparing against stored values
- Exit code 1 if score verification fails

### Data volume
- Increased beyond minimum success criteria to support Phase 10 stress testing
- Minimum: 30 buildings, 10 landlords, 100+ reviews, 10 disputes (success criteria floor)
- Claude picks the exact increased volume that stress tests well without making the seed script slow

### Claude's Discretion
- Landlord name mix (company names vs individual names — a realistic Boston rental market mix)
- Test user email format and exact role assignments (regular, admin, third user type)
- Whether test users have pre-loaded review activity
- Console output style (match Phase 4 or simpler summary)
- Exact data volume increase above minimum criteria
- Script structure (single file or split into data definitions + insertion logic)

</decisions>

<specifics>
## Specific Ideas

- Data should look authentic in E2E screenshots — real Boston feel, not "test data"
- Deterministic seeding means E2E tests in Phase 7+ can assert on specific building names, review counts, and score values
- `db:setup` is the "just works" developer experience — new contributor runs one command and has a fully populated local database

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-seed-data*
*Context gathered: 2026-02-28*
