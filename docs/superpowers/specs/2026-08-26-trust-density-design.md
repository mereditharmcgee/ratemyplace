# Trust + Density Design

**Date:** 2026-08-26
**Milestone:** v1.6.0 "Trust + Density"
**Status:** Approved by owner 2026-08-27
**Requirements:** `.planning/milestones/v1.6.0-REQUIREMENTS.md`
**Roadmap:** `.planning/milestones/v1.6.0-ROADMAP.md`

## Purpose

RateMyPlace already has the core product: structured tenant reviews, public building and named-party pages, moderation, disputes, account management, and verification. v1.6 closes the gaps between the product's privacy/integrity promises and its enforceable behavior, repairs the contribution path, adds release and accessibility guardrails, fixes basic discoverability, and then runs one bounded review-density pilot.

This is a program of independently deployable subsystems. It is not one feature branch, one database migration, or one production action.

## Current source anchors

The design is based on the current source, not the older claims in `MASTER.md`:

| Area | Current source evidence |
|---|---|
| Private unit number | `ReviewForm.tsx` and `POST /api/reviews` collect it; the owner edit route/form and admin review API/table read it. Public building, landlord, and property-manager detail queries still select broad `r.*` rows, so v1.6 replaces those with explicit public columns even though templates do not currently render the value. `MASTER.md` still promises a future column drop. |
| IP and profile data | `src/lib/rateLimit.ts` persists the identifier supplied by endpoints, several auth routes include raw client IP in structured error context, and `src/lib/audit.ts` persists `admin_ip`. Google OAuth currently requests `openid email profile` and writes name/avatar. |
| Verification lifecycle | `src/pages/api/verification/upload.ts`, `src/lib/storage.ts`, and `src/pages/api/admin/verification/[id].ts` implement upload/view/decision and immediate best-effort deletion, but there is no durable deletion queue, scheduled retry, or R2 reconciliation. |
| Contribution continuity | `src/pages/review/new.astro` retains a target only for the initial sign-in link; signup, Google callback, and email verification ultimately redirect to home/profile. `POST /api/reviews` checks authentication but not `email_verified`. |
| Review integrity | `POST /api/reviews` has an hourly account limiter but the schema has no account/building uniqueness authority, durable claim, daily allowance, velocity signal, or content-priority signal. |
| Trust copy | `src/pages/index.astro` says “Verified tenants,” while residency-document verification is optional. Signup HTML advertises and enforces six characters while the API requires eight. |
| Release and discovery | `package.json` has no `check` script, no GitHub workflow is present, and the repository has neither the referenced default social image nor sitemap/robots routes. |
| Accessibility | The source has isolated labels and controls, but no automated axe gate; the two address-autocomplete implementations, rating controls, dialogs, disclosures, and focus transitions require end-to-end semantics review. |

## Product decisions

### Confirmed direction

1. Apartment/unit number remains optional, is entered by the reviewer, is stored privately for moderation, and is never publicly displayed or used for scoring, grouping, search, metadata, analytics, or audit evidence.
2. Email verification authorizes review contribution. Proof-of-residency verification remains optional and controls only the verification badge.
3. Reviewer rate-limit identifiers are stored as endpoint-purpose-scoped HMACs, not raw IPs. Reviewer IP remains request-local for Turnstile and is not retained; an acting admin's IP is separately retained for authorized admin-action auditing under the disclosed retention policy.
4. Verification deletion is attempted immediately. A remote-storage failure does not undo the moderation decision; it creates durable, visible retry work until absence is confirmed.
5. Verification documents have no backup or restoration path. A lost pending document is re-uploaded rather than restored from a private copy.
6. Ordinary users receive working export, individual-review deletion, and account-deletion paths rather than unqualified promises for unbuilt capabilities. Account deletion retains score-bearing reviews as permanently ownerless records.
7. One account/building review authority and an edit-existing path prevent duplicate contribution.
8. Automated PII, prohibited-language, and velocity signals prioritize human moderation only.
9. v1.6 introduces no per-user behavioral analytics and no external review-text classifier.
10. The density pilot uses one bounded Boston geography/building list and launches only after the full trust/accessibility gate.
11. A destructive admin D1 mutation never commits without its required audit row; remote side effects remain durable post-commit work and do not roll back an already audited decision.

### Approved owner decisions (2026-08-27)

- the owner may see, edit, and export their own unit number after submission, while authorized admins may view it for moderation;
- Google OAuth drops `profile` scope and stops writing new Google-sourced reviewer name/avatar data; existing profile values and manual display-name behavior remain unchanged unless separately approved;
- undecided verification documents enter deletion after 30 days;
- admin audit IP is cleared after 180 days;
- five new claims per account daily, with human-review velocity flags at the fifth building or tenth landlord submission; this design interprets "daily" as a rolling 24-hour window for deterministic enforcement;
- an account/building claim survives individual review deletion but is removed with the account;
- account deletion hard-deletes the account and private account-owned data but retains each review with `user_id = NULL`, unchanged content, private unit number, moderation state, and score contribution; the retained review is permanently ownerless and cannot be reclaimed or owner-edited;
- identified legacy audit JSON is minimized through a separately action-time-approved, itself-audited operation that preserves non-identifying action evidence.

## Cross-cutting invariants

- `ITEM_WEIGHTS`, `RECENCY_BANDS`, the aggregation formula, the 32-item instrument, and building-score behavior do not change.
- `NAMED_PARTY_MIN_REVIEWS` remains the only threshold source for landlord and property-manager public score visibility, including SSR, APIs, metadata, and future structured data.
- Exact tenancy dates, exact submission timestamps, reviewer identity, and private moderation fields never reach public surfaces.
- Public routes select explicit columns and serialize narrow public view models. `SELECT *` is never used at a public boundary.
- Every new endpoint follows the repository auth, content-type, rate-limit, Turnstile, validation, parameterization, response, and audit rules.
- Every destructive admin route includes the domain mutation, required audit insert, and any required external-cleanup intent in one D1 batch. Failure of any required statement rolls the batch back; only the remote cleanup attempt is best-effort after commit.
- Migration history/files are append-only once applied. Schema evolution is tested against a fresh local D1 and reaches production only through the documented expand/deploy/verify/contract sequence after live-schema and ledger verification.
- Every phase passes `npm run check`, `npm test`, and `npm run build`; touched flows receive targeted component, route, SQL, SSR-leak, and Playwright coverage.
- External configuration and production mutation remain separate action-time approval gates.
- Public documentation never describes a planned control as already built. Phase 23 corrects current falsehoods; verification and account-rights copy co-deploys with Phases 24 and 27.

## 1. Private apartment/unit-number boundary

### Access matrix

| Context | Read | Write | Status and notes |
|---|---:|---:|---|
| Review create form for signed-in reviewer | Yes | Yes | Confirmed; optional input is necessary to collect it |
| Owner's authenticated review edit flow | Yes | Yes | Approved; ownership is checked before any response/update |
| Owner's authenticated data export | Yes | No | Approved; response is private/no-store |
| Authorized admin review detail | Yes | No | Confirmed moderation purpose; explicit admin check |
| Public HTML/API/search/map/OG/JSON-LD | No | No | Confirmed; property is absent, not present as `null` |
| Logs, analytics, integrity flags, audit old/new JSON | No | No | Confirmed; audit may record that a private field changed, never its value |
| Another user's authenticated response/export | No | No | Confirmed; cross-user access is forbidden |

### Normalization

Shared library logic trims the value, converts blank/whitespace-only input to `NULL`, rejects control characters, and caps length at 32 characters. Create and edit routes use that one helper. The field remains unrelated to scoring and review-claim uniqueness.

Public regression tests inspect complete JSON objects and complete rendered SSR HTML—including serialized island props, scripts, metadata, map payloads, and structured data—for both the `unit_number` property name and a distinctive fixture value. This makes the privacy boundary enforceable rather than dependent on today's templates.

Retention is tied to the review lifecycle. Individual review deletion removes the value. Account deletion retains it with the otherwise unchanged ownerless review, after which it is admin-only because no account can satisfy ownership. It is never copied into an immutable audit snapshot.

## 2. IP pseudonymization and profile minimization

### Rate-limit identifiers

Add a Worker-compatible shared helper that produces:

```text
{endpoint}:v1:{base64url(HMAC-SHA-256(
  RATE_LIMIT_HMAC_KEY,
  "rate-limit:v1:" + endpoint + ":" + canonical_identifier
))}
```

`RATE_LIMIT_HMAC_KEY` is a dedicated Cloudflare secret with at least 32 random bytes. IPv4, IPv6, authenticated user IDs, and the development fallback all pass through the helper. The endpoint remains a queryable prefix and is also inside the digest, so the same client cannot be correlated across endpoint purposes by comparing suffixes.

Production behavior is fail-closed: an absent or malformed secret returns service unavailable rather than falling back to a raw identifier. Rotation uses a new version prefix and intentionally resets active windows at an approved off-peak time; dual-key lookup is unnecessary at current scale.

Raw reviewer IPs are removed from structured application logs. Log events keep request ID, endpoint, subsystem, outcome, and normalized error category. `audit_logs.admin_ip` becomes nullable and remains an access-controlled accountability field for 180 days, after which scheduled maintenance clears the IP while retaining the admin user, action, entity, and timestamp.

Legacy raw `rate_limits` rows are purged only after HMAC code is live. Expired HMAC rows continue to be removed opportunistically and receive a daily physical cleanup.

### Google profile data

Google OAuth requests `openid email`, verifies Google's `email_verified` claim, and writes only the provider ID and normalized email required for authentication. New Google-sourced name/avatar writes stop. Existing profile values and manual display-name behavior are unchanged by this approval; any later retention, migration, or deletion decision for them requires separate owner approval.

## 3. Verification-document lifecycle

### State model

Moderation state and object state are separate:

```text
Moderation: pending -> approved | rejected | expired

Object: pending_upload -> stored -> delete_pending -> deleted
                    \-> upload_failed
```

At most one active (`pending_upload` or `stored`) verification exists per review. Object lifecycle lives in a non-cascading registry that holds the opaque key, state, upload token hash, and lease expiry independently of the user/review/moderation row. Terminal moderation transitions use compare-and-set semantics requiring both `moderation_state = pending` and `object_state = stored`, so a document cannot be decided while its PUT is in flight and concurrent approve/reject requests cannot both succeed.

New object keys are opaque random identifiers:

```text
verifications/{128-bit-random-id}
```

They contain no user ID, review ID, address, email, or filename. R2 custom metadata never stores the original filename. D1 may retain the original filename only while the document is operationally pending; it is cleared after confirmed deletion.

### Upload flow

1. Authenticate the reviewer and verify review ownership.
2. Apply rate limit before body processing.
3. Validate file size and MIME type.
4. Generate verification ID and opaque key.
5. Insert the non-cascading D1 object-registry row as `pending_upload` with a bounded upload lease, and link the pending moderation row to it.
6. Upload bytes to R2 with conditional create (`If-None-Match: *` through `R2PutOptions.onlyIf`), so an existing fence can never be overwritten by document bytes.
7. Conditionally promote the row to `stored`.
8. Return success only after `stored` is durable.

A D1 insert failure performs no R2 write. An R2 failure marks `upload_failed` and permits retry. A conditional-put precondition failure means deletion already fenced the key; it never retries against that key. The request retains the opaque key until the final compare-and-set succeeds. If that promotion does not update exactly one pending-upload row—because of a concurrent review/building deletion, account-unlink quarantine, replacement, or D1 error—the request attempts to upsert a deletion job and immediately delete; regardless of that request's fate, the independent registry remains durable for reconciliation. A crash immediately after PUT therefore leaves `pending_upload`, not untracked document bytes. The Workers binding's conditional-put result is checked explicitly rather than assuming success: [R2 Workers API conditional operations](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#conditional-operations).

Review/building deletion or account-unlink preparation marks the registry `delete_pending` but cannot cascade it away. If a PUT might still be in flight, the worker conditionally creates a zero-byte upload-fence object **at the exact opaque key** with fixed non-sensitive metadata. If the fence wins, every real conditional PUT loses. If conditional fence creation loses because document bytes won first, the worker deletes those bytes and retries until a head read confirms the fence; it never treats a transient absence as terminal. Upload completion observes the deletion request and deletes rather than promoting for moderation. Once the fence is confirmed, sensitive bytes are gone and cannot reappear; the tenant-linked moderation record clears its object metadata, while an unlinked fence-cleanup job retains only the opaque key. The fence remains for 30 days—far beyond an invocation—and is then removed by application cleanup plus the prefix lifecycle/reconciliation backstop. Replacement uploads always receive a new random key. Fence-win, document-win, immediate-post-PUT crash, retry, and cleanup are required concurrency tests against real R2 semantics before activation.

### Decision and deletion flow

The decision path commits one D1 batch containing the required audit row, two-state conditional moderation transition, review verification state, and deletion-outbox job. A unique request-scoped operation ID is inserted into the audit row through a conditional `INSERT ... SELECT` with the pending/stored predicate; every later statement is gated by existence of that exact audit operation ID and reuses only the same bound predicate values. D1 executes the batch sequentially without an interleaving request. If the predicate matches zero rows, no operation guard exists, every downstream effect is zero, the route returns 409, and no audit is written. If the audit insert or any other required statement fails, the whole decision rolls back and the route emits a structured server error. Only after commit is R2 deletion attempted before the response; that remote cleanup remains best-effort and cannot undo the now-audited decision.

- Confirmed deletion records `document_deleted_at`, marks the tenant-linked record `deleted`, and clears key/filename/content-type/size metadata. A normal stored object compacts the outbox after confirmed absence; a pending-upload race compacts only the document-deletion work and leaves its non-cascading, opaque fence-cleanup job until the fence expires.
- Object-not-found is idempotent success only when no writer can remain; otherwise the worker installs/confirms the exact-key fence.
- A transient failure keeps the decision, marks `delete_pending`, and returns HTTP 202 with explicit deletion-pending state. Request `waitUntil` may finish only work already attempted in that invocation; the persisted outbox—not the execution context—is the authority for every later retry.
- A concurrent stale decision or a decision against `pending_upload` returns 409 and creates no audit event.

Review/building deletion and account deletion/unlink include every associated deletion key in durable D1 work before cascades can remove verification lookup rows; destructive admin variants include their required audit row in the same batch. The independent registry/upload tombstone survives until sensitive bytes are absent, the exact key is fenced where necessary, and bounded fence cleanup is confirmed.

### Retry and reconciliation

The separately deployed maintenance Worker is scaffolded in Phase 22 with a narrow D1 heartbeat record, alert delivery, and no destructive job enabled by default. Phase 24 adds the verification-bucket binding and these jobs:

- every five minutes: claim and process due deletion jobs in bounded batches;
- daily: reconcile registered D1 states against an R2 listing and expire old pending submissions;
- every run: write a heartbeat and aggregate outcome.

Retries are idempotent with exponential backoff capped at 24 hours. Three failed attempts or 60 minutes pending creates an admin-visible warning and critical operational event. Document-deletion jobs remain active until sensitive bytes are absent or replaced by a confirmed fence. Fence-cleanup jobs retain only the opaque key until lifecycle/application deletion and confirmed absence; completed rows then discard the key and retain only non-identifying outcome/timing fields for 30 days.

Undecided documents enter deletion after 30 days and move to `expired`; the reviewer may submit a replacement. Before a lifecycle rule is enabled, the project inventories current `users/...` keys, reconciles every legacy row/object (especially anything already older than 30 days), deploys missing-object handling, and obtains separate approval for the exact affected set. New opaque `verifications/...` keys receive a prefix-scoped 30-day lifecycle rule only after those preconditions pass; legacy prefixes are handled deliberately rather than exposed to a surprise bucket-wide expiry. Because R2 lifecycle removal is asynchronous, public copy describes 30 days as the application retention limit and says physical deletion may complete shortly afterward. R2 document bytes are never copied into backups, D1 exports, incident archives, or analytics.

### Strictly journaled, no-store viewing

The view route executes:

```text
authenticate -> require moderation=pending and object=stored
-> insert access outcome=authorized
-> fetch R2
-> update access outcome=served
-> stream private/no-store response
```

A dedicated verification-access journal and strict helper do not swallow errors. The initial row means authorization was granted, not that bytes were viewed. A successful R2 fetch is updated to `served` before the response can stream; missing/error outcomes are recorded accurately. If the pre-fetch insert or pre-stream served update fails, no bytes are returned and the route responds 503. Processed, upload-incomplete, expired, or deletion-pending documents return 410. Missing records return 404. The journal stores admin user ID, admin IP for 180 days, verification ID, request ID, outcome, and timestamps only—never filename, R2 key, tenant email, unit number, or contents. Scheduled maintenance clears the IP while retaining the remaining access evidence.

Responses include `Cache-Control: private, no-store, max-age=0`, `Pragma: no-cache`, `X-Content-Type-Options: nosniff`, and a restrictive document CSP. Active formats download as attachments; inline images remain no-store.

## 4. Contribution and authentication continuity

### Return-target authority

One server-compatible `src/lib` module is the only constructor/consumer for post-authentication destinations. It accepts only registered review routes:

- `/review/new` with allowlisted `building` or `placeId` query parameters;
- `/review/edit/{review-id}`.

It rejects absolute URLs, protocol-relative URLs, backslashes, control characters, fragments, credentials, `/api`, `/admin`, `/auth`, unknown query parameters, malformed encodings, and encoded values over 1,024 characters. Invalid or expired input falls back to `/`.

A short-lived HttpOnly, SameSite=Lax, production-Secure cookie carries the normalized target through password sign-in/signup. Each Google attempt gets its own opaque attempt ID, per-attempt HttpOnly state cookie, and expiring server-side record containing separate CSRF nonce/hash and normalized navigation target fields. The callback resolves the target from that exact verified attempt, so a second tab cannot overwrite the first tab's destination. Email-verification token records receive an optional normalized `return_to` value so cross-device verification can resume through sign-in without putting a selected property in the emailed URL.

The verification link verifies email ownership but never creates a session. If another user is signed in, it shows neutral success and requires the verified account to sign in; it never transfers the target into the wrong account.

### Authorization order

Both review creation and editing enforce:

```text
authentication -> email_verified -> ownership (edit)
-> request/Turnstile validation -> review validation
-> integrity enforcement -> database write
```

New/edit pages check verified email before Place Details lookup, building creation, or owner data rendering. Both create and edit APIs independently return 403 with an actionable reason, including when an account becomes unverified after changing its email. An unverified user sees a verification/resend state with the retained target.

Expected status contracts are 401 unauthenticated, 403 email verification required, 409 existing claim, 429 daily limit, 503 integrity/rate-limit infrastructure unavailable, and generic 500 for unknown failures. No SQL or internal field names are returned.

Signup UI/API both require eight password characters. Public trust copy distinguishes verified email, human moderation, and optional residency verification.

## 5. Review claims, limits, and moderation signals

### Claim authority

A `review_claims` table, not a unique index on live reviews alone, is the authority for one account/building review:

```text
PRIMARY KEY (user_id, building_id)
review_id UNIQUE NULLABLE -> reviews(id) ON DELETE SET NULL
user_id -> users(id) ON DELETE CASCADE
building_id -> buildings(id) ON DELETE CASCADE
created_at INTEGER NOT NULL DEFAULT (unixepoch())
```

The claim remains if the review is individually deleted, preventing resubmission under the same account; account deletion removes it even though the review remains ownerless. A 409 for a claim with a live `review_id` includes the authorized edit-existing route. A tombstoned claim with `review_id = NULL` returns a distinct consumed-claim explanation and never links to a missing review. Before backfill, a read-only production query identifies every duplicate pair among user-linked reviews; any result blocks migration until the owner explicitly decides which content remains. No duplicate is silently deleted. Backfilled claims copy `reviews.created_at`, never the migration timestamp, so the rolling 24-hour allowance and historical reporting are not distorted. Reviews whose `user_id` is already `NULL` receive no claim and cannot be reclaimed.

### Zero-gap production cutover

The claim/scan transition uses two compatible deploys plus brief, explicitly approved submission and approval gates:

1. Add claim, integrity-job, flag, and feature-gate tables without enabling enforcement.
2. Deploy compatibility code that honors both gates. Transitional submission atomically checks `review_claims` **and** live user-linked reviews, counts both claims and not-yet-backfilled recent reviews for the allowance, and writes the claim/job for every accepted review. Every review-deletion path materializes that claim before removing a legacy review. The approval path immediately blocks approval unless that review has a completed scan; rejection and diagnosis remain available.
3. Backfill all historical user-linked reviews into claims using original review timestamps; leave ownerless reviews unclaimed and enqueue every existing pending review for a content scan. Velocity backfill is bounded to the preceding 24 hours.
4. Close new/edit submissions briefly, wait for in-flight requests, run final idempotent catch-up, and require parity: every user-linked review has the intended claim, every ownerless review has none, no claim maps to multiple reviews, and every pending review has a completed or pending scan job. Approval remains scan-gated throughout.
5. Deploy/enable the final atomic claim writer, drain or account for every legacy pending scan, rerun parity, and reopen submissions only after separate action-time approval. No review approval is reopened separately because the completed-scan invariant has already been continuously enforced.

If compatibility writing or backfill fails, the gate remains closed only for review submission/editing; public browsing, auth, admin diagnosis/rejection, and receipt-safe deletion remain available. Approval stays blocked for unscanned reviews. Rollback returns to the compatible writer without dropping the expanded tables.

### Atomic creation and daily limit

Creation uses one D1 batch and D1's sequential transactional semantics:

1. conditionally insert the pending review only when no account/building claim exists and the rolling-window claim count is below the bound limit;
2. insert the claim by selecting the just-created review;
3. insert a pending integrity-scan job by selecting that same review.

If the first statement inserts nothing, later statements also insert nothing; post-batch classification returns 409 for an existing claim or 429 for the allowance. Any unexpected constraint failure rolls the whole batch back. Concurrent batches serialize, so exactly one review/claim wins without a SQL trigger.

The approved allowance is five new claims per account daily. For deterministic enforcement across time zones and reset boundaries, this design interprets "daily" as a rolling 24-hour window; that window shape is an implementation assumption, not an additional owner-approved product decision. Exported shared constants define the limit/window and are bound into the conditional statement; there is no second literal in migration SQL. A friendly preflight improves UX but is not authoritative. Editing/resubmitting the claimed review consumes no new allowance. The existing hourly endpoint limiter remains a technical flood guard.

### Moderation signals

`src/lib/reviewIntegrity.ts` returns typed, versioned signal codes. A dedicated table stores review ID, kind, rule version, safe evidence counts/field names, detection/clear/expiry timestamps, and never copies the matched text.

Signals are:

- possible email;
- possible phone number;
- possible external link;
- possible prohibited language;
- fifth-or-later building submission within 24 hours;
- tenth-or-later canonical-landlord submission within 24 hours.

Velocity counts include all submitted statuses. Landlord velocity uses `buildings.landlord_id`, never renter-entered name text. When an admin links or changes a building's landlord, a bounded recomputation enqueues only affected reviews/submissions from the preceding 24 hours so the common link-after-submission flow cannot miss the signal. Detection is deterministic and local; no free text leaves the platform.

Each review carries a monotonic content revision, and every scan job/result names that revision. After the core creation batch commits, the request attempts the pending integrity job immediately. A signal write failure does not reject the renter's pending review: the job stays durable, a structured event fires, and the maintenance Worker retries. Approval is a conditional D1 transition that requires a completed scan for the review's **current** content revision in the same operation; no signal result decides approval or rejection. Editing atomically increments the revision, marks prior signals stale, and enqueues the matching rescan while preserving the claim; it does not count as a new velocity event. Because D1 serializes the edit and approval batches, an edit that wins makes stale approval fail, while an approval that wins prevents an ineligible edit. Concurrency tests cover both orders and request retries. Claim/allowance infrastructure still fails closed. Signals sort pending reviews for admins and display as accessible private badges. They never enter public APIs, HTML, metadata, exports, or score calculations.

## 6. Account export and deletion

### Recent reauthentication

Export and deletion require a purpose-bound reauthentication completed within ten minutes:

- password accounts verify the current password;
- OAuth-only accounts complete a fresh Google authorization round trip bound to the initiating user ID, current session ID/version, purpose, nonce, and CSRF state. The callback requires Google's verified `sub` to equal the provider ID already attached to that account; it never links or switches accounts during reauthentication.

Single-use reauthentication records are hashed in D1, expire automatically, and are never logged.

### Versioned JSON export

`POST /api/user/export` accepts no target user ID. It generates a `schema_version: 1` JSON response directly, uses a non-identifying filename, and sets private/no-store headers. No export artifact is written to D1 or R2.

The allowlist contains account fields, the owner's reviews including private unit number, saved buildings, notifications, votes, prospectively linked authenticated contact/bug reports, and verification decision metadata. It excludes password hashes, sessions, tokens, rate-limit rows, raw IPs, audit internals, R2 keys, admin notes, unrelated records, and verification bytes.

Historic email-only contact/bug-report records are handled manually rather than attributed by email matching. Future authenticated submissions link prospectively by user ID.

### Deletion and retention matrix

The deletion migration does not rely on today's accidental foreign-key behavior:

| Data relationship | Own-review deletion | Account deletion |
|---|---|---|
| Review and user-authored review content | Hard-delete selected review | Retain unchanged except set `user_id = NULL`; content, status, private unit number, and score contribution remain; no reclaim or owner edit/export |
| Account/building claim | Preserve with `review_id = NULL` | Cascade with account; the retained ownerless review has no claim |
| Sessions and auth/verification/reset/reauth tokens | Unchanged | Cascade/invalidate all; clear session cookie |
| Votes cast, saved buildings, notifications | Delete review-dependent rows as applicable | Delete account-owned rows; other users' votes on retained reviews remain |
| Verification document bytes and metadata | Copy opaque keys to non-cascading outbox, then delete metadata | Enqueue every pending object before account deletion; retain only non-sensitive review decision/badge state |
| Integrity flags and scan jobs | Cascade with review | Retain with the retained review |
| Prospectively linked authenticated contact/bug reports | Unchanged unless review-linked | Delete; historic email-only submissions remain manual because they are not attributed by email matching |
| Landlord disputes | Retain the independently submitted dispute, set `review_id = NULL`, and retain no copied review text, address, unit, or reviewer identity | Retain linked to the ownerless review; no reviewer identity is available |
| `verified_by`, `reviewed_by`, `resolved_by` moderator references | Unchanged | `ON DELETE SET NULL`; an admin must first lose privileges through the audited admin flow |
| Audit/action history | Retain action/entity/status evidence; no unit number or new user-authored text | Preserve non-identifying evidence; separately inventory and action-time approve one idempotent, itself-audited minimization of legacy target-user IDs/title/free text; clear admin IP after 180 days |

Current source is incompatible with this matrix: `reviews.user_id` is `NOT NULL REFERENCES users(id) ON DELETE CASCADE`, multiple admin queries inner-join `users`, and several TypeScript interfaces require a string author. Phase 27 first deploys nullable-author-compatible readers, owner checks, notifications, exports, moderation, and admin labels; it then rebuilds `reviews` with `user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL`, preserving every column, constraint, and index. Row counts, `PRAGMA foreign_key_check`, export/ownership denial, aggregate parity, and public-leak tests cover the rebuild and every line of the matrix. No shared “deleted user” sentinel is created, and any table added later must choose an explicit behavior in its migration and account-rights tests.

Legacy audit minimization is not implied by this design approval. The implementation first produces a read-only inventory and digest of affected rows/fields, defines the exact idempotent transformation that removes target-user IDs, titles, and free text while preserving action type, non-identifying entity/status evidence, actor accountability, and timestamps, and displays that scope for separate production action approval. The mutation runs only after atomic audit infrastructure is live, records its own required audit event without copying the removed values, verifies post-state against the approved digest, and never rewrites unrelated immutable history.

### Own-review deletion

The owner delete path requires ownership and recent reauthentication. Under the approved deletion matrix, it first creates the versioned erasure intent/write quarantine described below, then prepares a review-level receipt, enqueues verification-object cleanup, deletes the frozen review and dependent private rows, and preserves the account/building claim with `review_id = NULL`. Public aggregates recompute from remaining approved reviews. Repeated deletion is idempotent and non-enumerating. The receipt prevents Time Travel from restoring the deleted review or its private unit number; the lifetime claim remains until account deletion.

### Account deletion

Account deletion requires recent reauthentication, typed confirmation, and clear pre-confirmation copy that reviews remain public/score-bearing, lose their owner, keep private moderation fields, and cannot later be edited; a user who wants a review removed must delete it first. Admin accounts receive 409 until privileges are revoked through the audited admin path. The account and frozen set of owned reviews are first versioned and write-quarantined. The commit batch revalidates that set, enqueues every verification object into non-cascading work, writes one local account-unlink job, sets every frozen review's `user_id = NULL`, deletes private account-owned rows and claims, then deletes the user. It writes no descendant review-deletion job because those reviews remain live. A D1 failure leaves the quarantined account intact for conclusive abort/completion rather than reopening it implicitly. After commit, every session is invalidated, the cookie is cleared, and immediate R2 cleanup is attempted; pending document cleanup does not resurrect the account or author link.

### Coverage across deletion paths

The receipt protocol is a shared prerequisite for every operation that can delete a review or delete an account/remove author links: owner review deletion, account deletion, admin review deletion, admin building deletion, and any future parent cascade. A first D1 batch creates a non-cascading `erasure_intent`, captures the target version and complete descendant digest, and marks the target `erasure_pending` so every mutating route rejects new edits/children for that request. Only then are external receipts prepared. The commit batch requires the same intent, version, quarantine token, and descendant digest; a changed set produces no operation. Review-kind intents authorize review deletion. Account-kind intents authorize only account deletion plus unlinking the frozen reviews, never deleting those reviews. For an authorized replacement set, the old intent must be explicitly aborted and a newly displayed set separately approved rather than inheriting stale authorization. The batch also includes the required admin audit row where applicable and every verification-object deletion intent.

Receipt instrumentation deploys to all existing deletion paths before the restore guarantee is advertised. The project then waits one full currently configured Time Travel window plus the two-day safety margin—or separately proves complete receipt coverage for every still-restorable legacy deletion—before calling the guarantee active. During that warm-up, a production restore remains a closed, incident-specific manual decision.

### Crash-consistent erasure ledger

Every covered review deletion or account-unlink operation uses the same external state protocol with type-specific replay semantics. A separate private R2 bucket stores markers under `erasure/v1/{key-version}/{request-id}/{state}`. Each marker contains only `kind` (`review` or `account`), `HMAC(versioned ERASURE_LEDGER_KEY, kind + internal_id)`, request ID, state, and timestamps—never the raw ID, email, review text, address, or unit number. `review` means delete that review; `account` means delete that account and ensure its frozen reviews have null authors. Marker writes use conditional create (`If-None-Match: *` or the Workers API equivalent), and a prefix-scoped [R2 Bucket Lock](https://developers.cloudflare.com/r2/buckets/bucket-locks/) for the reverified Time Travel window plus two days prevents overwrite or early deletion even if application code is wrong.

1. In D1, atomically create the erasure intent/quarantine with request ID, target version, and descendant digest. Every relevant mutation path checks the quarantine. If this batch fails, no external marker or type-specific operation runs.
2. Write `prepared` externally. If this fails, no type-specific operation runs; a conclusive absence check lets a separate D1 batch abort the intent and remove quarantine.
3. In the D1 commit batch, require the exact intent/quarantine/version/descendant digest, write a non-cascading local erasure/unlink job with the same request ID/digest, include the required admin audit where applicable, and commit the type-specific operation. Zero-match is unresolved—not permission to unfreeze.
4. After D1 commit, write the immutable `committed` marker containing `operation_committed_at` from the local job. If that write fails, return accepted/pending and let the local job plus scheduled Worker retry until it exists; a later successful marker upload only extends physical lock coverage beyond the required deadline.
5. Write `aborted` and remove quarantine in one D1 batch only after a consistent read proves the type-specific deletion/unlink operation did not commit and the target still matches the frozen version/set. Timeout, conflict, or unverifiable outcome leaves `prepared` plus quarantine in place rather than guessing.
6. Internal user/review IDs are never reused. For a committed operation, `protect_until = operation_committed_at + reverified Time Travel maximum + two days` (currently 32 days); only then does receipt cleanup begin. Terminal-prefix lifecycle rules and daily reconciliation provide asynchronous backstops until absence of deleted data and removed account links is confirmed. There is intentionally no renewable marker state. A `prepared` marker has no expiry rule until resolved: one hour unresolved is critical, 24 hours requires manual incident ownership, and within seven days a resolver must produce `committed` or `aborted`. Forced completion or manual abort requires separate action-time approval and atomically revalidates the frozen target version/descendant set; an admin-origin completion writes the required recovery audit in that batch. A mismatch never inherits the stale authorization: it remains quarantined until a replacement set is shown and separately approved. Missing the seven-day terminal deadline closes affected deletion/recovery operations and pages the maintainer rather than allowing normal writes around an indefinite tombstone. Retain each marker key version and verification secret until cleanup plus bucket inventory confirm no live marker for that version remains; then destroy the retired secret. Rotation creates a new version and never rewrites live receipts.

Production restore is an ordered maintenance procedure with an external-to-D1 write fence:

1. Obtain separate action-time approval for the target bookmark and maintenance window. Enable a temporary deny-all maintenance policy at Cloudflare's edge for every custom, production `pages.dev`, and preview hostname that can reach production; pause the maintenance Worker, deploy hooks, and every other scheduled writer.
2. Verify mutation probes fail on every hostname, wait for in-flight requests to drain, and confirm the write watermark is stable. A crash leaves the external fence enabled.
3. Before the destructive restore, write a minimized pre-restore manifest to a separate private R2 prefix. It contains only release/schema/bookmark metadata, purpose-scoped HMAC membership for live accounts/reviews, still-live receipt states, and deletion-job digests—never raw IDs or user data. Conditional create plus a prefix-scoped seven-day lock/lifecycle makes the manifest immutable for the runbook and bounded afterward; a day-five alert requires resolution or a separately approved replacement before expiry.
4. Restore D1, apply the current migration chain, and verify `reviews.user_id` is nullable with `ON DELETE SET NULL` before receipt replay. Then replay before any public traffic: `committed` review receipts remove the review; `committed` account receipts remove any restored account and re-null ownership across the frozen review set without deleting those reviews; `aborted` without `committed` permits the target; and the only nonterminal state, `prepared`, is resolved against the manifest and the same seven-day terminal rule. Anonymous reviews remain in the live-membership set. Any restored account/review absent from that set is handled according to the type-specific matrix, and any unknown state/key shape fails closed.
5. Run migration/schema/FK checks, row/digest reconciliation, deletion-outbox replay, R2 missing-object reconciliation, and read-only production smoke through an emergency maintainer path.
6. Obtain separate approval to reopen, remove the write fence, resume scheduled writers/deploys, run post-open smoke, and confirm the manifest is queued for lifecycle expiry. If evidence conflicts, the manifest expires before resolution, or the pre-restore database could not be captured, traffic stays closed for manual incident resolution—ambiguity never silently reactivates data.

Crash-injection tests stop execution after marker preparation, immediately before/after D1 commit, during committed/aborted writes, during retry registration, while writing the response, during receipt/manifest expiry, at every maintenance-fence transition, and during type-specific replay—including a pre-change-schema restore upgraded before account replay. Committed logical retention ends at `operation_committed_at + platform window + two days`; unresolved preparation becomes a terminal state within seven days, and terminal asynchronous cleanup remains observable/retriable until deleted bytes/data are absent and removed links are confirmed. Receipts and manifests are never used for analytics or account matching. No indefinite email tombstone or general-purpose identity hash is created.

## 7. Release, observability, recovery, and admin perimeter

This foundation ships in Phase 22, before verification retries, integrity scan jobs, or account erasure depend on it.

### CI and deploy path

GitHub CI runs `npm ci`, `npm run check`, `npm test`, and `npm run build` with least-privilege permissions and concurrency cancellation. A stable required status check protects `main`; the existing Cloudflare Pages Git integration remains the sole deployer.

After a production deployment, a workflow verifies the deployed commit and runs the smoke suite against `https://ratemyplace.org`. Phase 22 covers current public pages/APIs, protected-route denial, release, and health. Phase 24 extends it with maintenance freshness; Phase 29 adds healthy/fallback sitemap, social image, robots, noindex, and canonical checks only after those surfaces exist. Turnstile and Maps remain explicit production-only touched-flow checks.

### Atomic destructive-admin auditing

Phase 22 inventories every destructive admin route and adds a nullable-legacy, unique `operation_id` to `audit_logs`; every new destructive action must supply it. Shared audit library code builds a parameterized conditional `INSERT ... SELECT` statement and never fires the required audit after the domain change. That audit row is the request-scoped operation guard: it is inserted first from the exact authorization/current-state predicate, and the mutation plus durable external-side-effect intents execute only where that unique operation ID exists. Bound predicate values are captured once and D1 runs the batch sequentially, so a missing/stale target creates neither guard nor downstream effects; a concurrent loser sees the winner's changed state and also creates zero effects. Any statement/constraint failure rolls back the guard and action together. External R2/email work starts only after commit and remains independently retriable. Tests assert exact audit/mutation/outbox counts for winner, stale, missing, replayed-token, and injected audit-failure cases. Once every route has cut over, the same release updates `src/lib/AGENTS.md` and the legacy `createAuditLog` comment so future work is no longer instructed to swallow required destructive-audit failures.

### Health and structured events

A public health endpoint initially returns generic status and release identifier; maintenance freshness is added when the scheduled Worker ships. It never exposes table names, counts, provider messages, or secrets. Human operational detail stays behind both Cloudflare Access and Lucia `isAdmin` and shows maintenance heartbeat, oldest deletion job, and oldest pending moderation item.

GitHub synthetic smoke uses a separate, narrow machine-only ops-health route outside `/api/admin`. Cloudflare Access requires a dedicated service token, and the application independently verifies a timestamped HMAC request signature with a separate `OPS_HEALTH_HMAC_KEY`; neither credential can create a Lucia session or call an admin route. The response contains only release match plus healthy/degraded booleans and coarse ages for heartbeat/alert backlog—no counts, IDs, names, table details, or provider errors. Tests cover valid access, replay/stale signature, either credential missing, secret/token rotation and revocation, and denial to an ordinary browser or authenticated non-admin.

Structured events use typed names plus subsystem, operation, outcome, request ID, release, opaque job/entity identifier, attempt count, and normalized error code. They never contain unit number, email, reviewer IP, filename, review content, or legacy identifying R2 keys. Threshold-bearing outcomes also increment a bounded `operational_counters` row keyed only by event code and time bucket; actionable one-off failures insert or update a deduplicated `alert_outbox` row with no user content. Counter buckets and delivered/resolved alert rows are retained for 30 days and then physically deleted; pending/dead-letter rows remain only until resolution, after which the same 30-day expiry applies.

The maintenance Worker evaluates counters, creates deduplicated alerts, and drains `alert_outbox` every five minutes to a provider-neutral HTTPS maintainer webhook stored as a secret. Delivery failure keeps the row pending with bounded backoff; after ten attempts or 24 hours it is marked dead-letter, remains visible, and causes every machine-health check to fail until acknowledged/resolved. A GitHub workflow is scheduled on a five-minute cadence away from the top of the hour and calls the dedicated machine route; its own tested GitHub failure notification is an independent **best-effort** fallback when the Worker, D1, or webhook path is unavailable. GitHub documents that scheduled runs may be delayed or dropped under load, so a hard dead-man SLA would require a separately approved uptime provider: [GitHub scheduled-workflow timing](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows#scheduled-workflows-running-at-unexpected-times). Pages deployment notifications remain a separate deployment channel. Cloudflare traffic error-rate alerts are enabled only if the account plan exposes them; the roadmap does not depend on an Enterprise-only feature.

The testable objective under normal Worker/webhook availability is: a critical one-off event is durable in the outbox during its request, the Worker attempts delivery within five minutes, and successful webhook delivery occurs within ten minutes. Under normal GitHub scheduler availability, a D1 outage, missed Worker heartbeat, or aged/dead-letter webhook row targets detection within ten minutes; tests verify the route and notification behavior, not GitHub's queue latency. Failure-injection tests cover each source, processor, destination, and fallback independently.

Immediate alert conditions include required-access-journal failure, destructive-audit transaction failure, aged/exhausted verification deletion, orphan detection, missed maintenance heartbeat, schema mismatch, and post-deploy smoke failure. Provider/auth/Turnstile/email signals alert on abnormal bucketed thresholds rather than expected individual user failures. The exact webhook provider, service token, thresholds, and recipients require configuration-time approval and a delivered test alert. Workers Logs remain diagnostic rather than being mistaken for a custom-field alerting system; current notification availability is rechecked before configuration: [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) and [Cloudflare available notifications](https://developers.cloudflare.com/notifications/notification-available/).

### Migration reconciliation and recovery

Before migration `0029`, inspect live `d1_migrations`, `sqlite_master`, PRAGMA columns/indexes/FKs, and final-state predicates for 0025–0028. Capture a Time Travel bookmark, record file hashes/evidence, and—only under a separate production-mutation approval—insert ledger rows for verified out-of-band migrations using the live ledger schema. Confirm Wrangler reports 0001–0028 applied, update root and migration agent guidance with the reconciled state, and retire the stale sync script. Ledger reconciliation never shares a deploy with a feature migration.

Each subsystem follows its own expand/deploy/verify/contract cycle. The milestone does not accumulate all additive schemas and then perform one large code deploy. Table rebuilds preserve all rows/indexes/constraints and pass row counts plus `PRAGMA foreign_key_check`. Destructive production migration or restore always has a separate explicit approval.

D1 restore is rehearsed only on a synthetic remote database, whose creation, restore, and deletion are separate external-action gates. Phase 22 rehearses the external write fence, durable minimized manifest, crash-closed behavior, synthetic receipt fixtures, and ordered reopen steps. Phase 27 reruns the full drill with the implemented receipt writer/replayer and warm-up rules before the restore guarantee activates. Verification documents have no R2 recovery: deleted or lost bytes are never recreated. A D1 restore that resurrects metadata pointing to an absent document is reconciled to missing/deleted, not repopulated. The restored database is migrated to nullable `reviews.user_id ... ON DELETE SET NULL` before review-erasure/account-unlink receipts are replayed and before production traffic resumes.

These retention assumptions are tied to current platform behavior: Cloudflare documents a 30-day D1 Time Travel window on Workers Paid (7 days on Free), while R2 lifecycle deletion is asynchronous and typically completes within 24 hours of expiry. The implementation plan must re-verify both limits immediately before configuring retention: [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) and [R2 object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

### Admin perimeter

The activation inventory covers `ratemyplace.org`, any `www` alias, the production `ratemyplace-64y.pages.dev` hostname, branch aliases, and immutable hash-based preview deployments. Cloudflare Access protects `/admin/*` and `/api/admin/*` on every reachable production hostname with an explicit maintainer allowlist, MFA, and a short administrative session; Pages preview Access protects every preview deployment. The production `pages.dev` hostname redirects ordinary traffic to the canonical domain, while direct admin/API requests remain protected rather than relying on the redirect. Preview deployments use isolated non-production bindings and receive no production D1/R2 secrets. Lucia and `isAdmin` checks remain mandatory inside every route. Activation tests unauthorized/authorized browser access, direct API calls, production `pages.dev`, a branch alias, an old immutable preview URL, and emergency recovery. Cloudflare documents that preview Access alone does not protect the production `pages.dev` or custom domain, so each hostname is tested explicitly: [Pages preview deployments](https://developers.cloudflare.com/pages/configuration/preview-deployments/) and [Pages Access known issue](https://developers.cloudflare.com/pages/platform/known-issues/).

## 8. Accessible contribution

The public critical path is:

```text
home address search -> select/add address -> auth -> email verification
-> retained address -> all review steps -> submit -> confirmation/building
```

It must be operable without pointer, hover, color perception, or unlabeled placeholders.

- Home and review address controls implement labeled combobox/listbox semantics, stable options, active descendant, result-count status, Up/Down/Enter/Escape behavior, and named clear buttons.
- Each rating question uses native `fieldset`/`legend` and radio controls for 1–5 and Not rated; selected state is not color-only and targets meet 44×44.
- Step progress is an ordered list with `aria-current="step"`; step headings receive focus and validation failures focus a linked error summary.
- Verification/resend state explains email versus residency verification and announces result without exposing the full email unnecessarily.
- A shared dialog pattern provides name, initial focus, trap, Escape close, and focus restoration.
- Public disclosures and admin expanders use native buttons with expanded/controlled state.
- Global layout gains a skip link, main target, visible focus, and reduced-motion behavior.

Automated axe and semantic component tests cover regressions. Manual keyboard, NVDA, 200% zoom, contrast, reduced-motion, and 375px checks validate the complete flow with seed data only.

## 9. Discoverability

`BaseLayout` receives a narrow SEO contract: title, description, canonical path, optional noindex, image path, and safe JSON-LD nodes. Canonical origin comes from Astro's configured `site = https://ratemyplace.org`, never an untrusted Host header. One shared serializer applies `JSON.stringify` and then escapes `<`, `>`, `&`, U+2028, and U+2029 before any `set:html`; SSR tests use a named-party sentinel containing `</script><script>` and require it to remain inert data.

v1.6 adds:

- the referenced 1200×630 default OG image;
- absolute canonical, Open Graph, and Twitter metadata;
- noindex control for auth/profile/admin/search-query/low-value variants;
- `robots.txt` pointing to a dynamic sitemap;
- a dynamic sitemap containing static public pages and entities with approved public content;
- Organization, WebSite, WebPage, and BreadcrumbList structured data.

Named-party AggregateRating markup is deliberately deferred. Metadata uses a narrow public model and the existing named-party visibility helper; a below-threshold numeric score must be absent from complete SSR HTML, scripts, and JSON-LD. Building scores retain their current one-review behavior.

In healthy mode the sitemap includes allowlisted entities with approved content. On D1 failure it returns a valid static-only document and logs the failure privately; route and smoke tests distinguish those two contracts. SEO instructions never substitute for authorization.

## 10. Bounded density pilot

The pilot is an operating experiment, not a campaign platform. Before outreach, the owner approves one fixed Boston geography or building list plus duration, approved-review target, building-density target, moderation-capacity limit, and stop/go rule. A partner may distribute the request but is never a cohort identifier or attribution key. Targets do not change mid-pilot.

The product work is deliberately small:

- Web Share with copy-link fallback on eligible public entity pages;
- reuse of the existing approved-count/three-review UI with factual deficit-specific request actions (for example, one or two more reviews needed) on landlord/property-manager pages;
- deep links that survive the complete auth/verification flow;
- an aggregate report generated from claims, approved reviews, coverage, integrity flags, and moderation age.

The primary outcome is approved review density: approved additions, buildings with at least one and at least three approved reviews, and named parties reaching threshold. No raw funnel-event table is introduced. Optional counters, if later justified, are daily aggregate rows with a pre-enumerated pilot code and no user, review, IP, raw address, query, or cross-session identifier.

Outreach pauses if moderation age exceeds the approved guardrail, integrity signals materially rise, a critical flow regresses, the partner asks to stop, or measurement would require identity-level tracking. The closeout records continue, adjust, or stop from approved-review evidence.

## Error-handling principles

- Privacy and authorization failures fail closed.
- Expected client conflicts use stable typed reasons and never expose SQL or internal column names.
- Moderation decisions may succeed while R2 cleanup remains pending, but the pending state is persisted, returned, observable, and retried.
- Sensitive-document access fails if its required access journal cannot be written; a destructive admin mutation fails atomically if its required audit row cannot be written.
- Review deletion or account deletion/unlink never rolls back solely because post-commit verification-object cleanup is pending.
- Missing R2 objects are deletion success, never a reason to reconstruct private bytes.
- Claim/limit enforcement fails closed. Advisory-signal failure leaves a pending review plus durable scan job and never creates an automated content decision.
- Best-effort metrics and operational notification delivery never block signup, review submission, moderation, export, or deletion.

## Migration shape and deployment order

Exact filenames are assigned only after Phase 22 makes production history authoritative. The expected sequence is:

1. Reconcile production migration ledger through 0028; no feature migration in the same release.
2. For each subsystem, add only its compatible schema/configuration and tests.
3. Deploy dual-compatible code for that subsystem, verify production behavior/data distribution, and only then apply its separate contract migration if needed.
4. Repeat the expand/deploy/verify/contract cycle for the next subsystem; never batch all v1.6 schema expansion into one release.
5. Nullable/cleared audit metadata lands only after all readers/writers and retention jobs have switched. Existing profile columns/values remain unchanged unless a future owner approval adds a separately planned migration. The Phase 27 review-table rebuild likewise lands only after every reader, writer, ownership check, notification path, admin view, and type accepts a null author; row counts, indexes, constraints, and `PRAGMA foreign_key_check` must pass.

No migration drops `reviews.unit_number`.

## Acceptance summary

v1.6 is complete only when:

1. Unit number remains useful to moderation, follows the approved owner-access decision, and is mechanically absent from every public and operationally prohibited surface.
2. Reviewer rate-limit keys and ordinary logs contain no raw IP, and rate-key digests do not correlate clients across endpoint purposes.
3. Every verification object has lifecycle state; every failed deletion is durable, visible, retried, and reconciled.
4. Every served sensitive document has a strict authorized/served access journal and no-store response; missing/error fetches are labeled accurately, and no destructive admin decision commits without its required audit row.
5. Review intent survives password, signup, OAuth, and email-verification flows without an open redirect.
6. Unverified email cannot create or edit a review.
7. Concurrent duplicate submissions produce one account/building claim and one review.
8. Daily/velocity/content rules prioritize human moderation without changing review status automatically.
9. A reauthenticated owner can export data, hard-delete an owned review, or delete the account while retaining ownerless score-bearing reviews; the table-by-table contract passes, and restore procedures replay review erasure separately from account deletion/author unlinking.
10. CI, production smoke, independently backed alert delivery, atomic destructive auditing, a crash-closed recovery drill, and hostname-complete Cloudflare Access protect the single-maintainer release/admin path.
11. The critical contribution flow passes automated and manual accessibility gates.
12. Social image, canonicals, sitemap, and structured data work without private or under-threshold leakage.
13. One bounded pilot can be measured by approved-review density without per-user analytics.
14. Tests, build, touched-flow QA, production verification, and all explicit action gates pass.

## Out of scope

- Public or cross-tenant unit-number display.
- Scoring, survey, recency, building-score, or named-party-threshold changes.
- Automated approval, rejection, redaction, verification, OCR, or external text classification.
- Landlord replies, real-time push, referral rewards, campaign accounts, paid acquisition, or additional cities.
- Programmatic neighborhood/city SEO pages or named-party AggregateRating markup.
- Bulk admin tenant-data exports, verification-document backup, or account recovery after deletion.
- Replacing the primary Astro/Lucia/D1/R2/Pages stack.
- Broad component refactors unrelated to a touched v1.6 surface.
- Legal certification; public policy receives separate legal review when available.

## Approval record

On 2026-08-27 the owner approved:

1. reviewer read/edit/export of their own unit number, with admin-only access after the review becomes ownerless;
2. a 30-day application expiry for undecided verification documents, with honest copy about asynchronous R2 removal;
3. removal of Google profile name/avatar collection for new OAuth writes, with existing profile values and manual display-name behavior left unchanged pending any separate decision;
4. clearing admin audit IP after 180 days while retaining non-IP evidence;
5. five new review claims per account daily, with human-review velocity flags at the fifth building or tenth landlord submission; the rolling 24-hour implementation interpretation is documented separately rather than treated as an additional owner-approved choice;
6. lifetime account/building claims that survive individual review deletion and disappear with the account;
7. account deletion that removes the account and author links while retaining each review, its private unit number, moderation state, and score contribution as a permanently ownerless record; and
8. a separately action-time-approved and itself-audited minimization of identified legacy audit payloads rather than indefinite retention.

Implementation is decomposed into separate task-by-task plans matching the roadmap's subsystem boundaries. No implementation plan may combine migration-ledger reconciliation with a feature migration or bundle a production/external action into an implicit step. Approval of a policy choice does not authorize its production data mutation or external configuration; those remain action-time gates.
