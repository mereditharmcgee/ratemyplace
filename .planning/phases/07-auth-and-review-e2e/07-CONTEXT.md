# Phase 7: Auth and Review E2E - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Write E2E specs covering all auth flows (signup, signin, signout, password reset) and the core review submission flow, including form validation, error states, and concurrent submission handling. Uses the Playwright infrastructure from Phase 6.

</domain>

<decisions>
## Implementation Decisions

### Test user strategy
- Signup test uses a unique timestamped email per run (e.g., `signup-1709123456@test.local`) — not a fixed email
- Signin/signout tests use seed users (`user@test.ratemyplace.local`) with known password — independent of signup test
- Review submission tests use the `authedPage` fixture (pre-authenticated seed user) — focuses test on the form, not re-testing auth
- Review submission targets a specific seed building (building-30 has 0 reviews in seed data) for deterministic assertions
- Password reset test uses a seed user — independent of signup test

### Review form testing depth
- Happy-path test fills ALL fields (required + optional) and submits — proves the form handles everything
- Validation tests focus on required fields only — Claude's discretion on specific fields to test and approach
- Test step transitions: verify Next/Back buttons work, step indicators update, and data persists when navigating between steps
- After submission, Claude decides what to verify (success message, building page, or both)

### Password reset approach
- Read reset token from local D1 via wrangler CLI: `npx wrangler d1 execute ratemyplace-db --local --command "SELECT token FROM password_resets..."`
- Full round-trip verification: request reset -> get token from D1 -> set new password -> sign in with new password
- Uses a seed user, not the freshly signed-up user

### Failure & edge cases
- Concurrent duplicate review: two authenticated browser contexts, same building, submit near-simultaneously — verify at least one succeeds, no 500 errors
- Validation assertions: check that a specific error message appears near the invalid field (proves UI communicates the problem)
- Auth error states included: wrong password shows error, duplicate email on signup shows error, expired/invalid reset token shows error
- Boundary values: test scores at min (1) and max (5) boundaries only — mid-range covered by happy path

### Claude's Discretion
- Exact review form field selection for validation tests (representative samples vs. comprehensive)
- What to verify after review submission (success message, building page appearance, or both)
- Test file organization within e2e/ (one file per auth flow vs. grouped)
- Specific selectors and wait strategies for form interactions
- How to handle email verification in signup flow (may need D1 token read similar to password reset)

</decisions>

<specifics>
## Specific Ideas

- Building-30 in seed data has 0 reviews — ideal target for the review submission test since assertions about "review appears" are unambiguous
- The `authedPage` fixture from Phase 6 is already authenticated as `user@test.ratemyplace.local` — review tests import this directly
- Wrangler CLI for D1 reads keeps tests infrastructure-free (no test helpers or API endpoints needed)
- The review form is multi-step with 27 fields — step navigation testing catches real UX bugs users would encounter

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-auth-and-review-e2e*
*Context gathered: 2026-02-28*
