# Review funnel fix: implementation plan (`fix/review-funnel`), revision 2

**This is the public-repo copy, and it is redacted.** Production row ids, admin user ids, row creation times and the addresses of rows that users created are replaced with placeholders such as `<crawford-dup-id>` and `<admin-id>`. Step 0 is described only as narrowing the columns. The lead keeps the unredacted plan, including the runnable section 4 SQL, outside the repo.

Branch from `main` at `1b8ca2b` (after the Step 0 hotfix has merged, branch from the new `main`). The work is TDD: for every step, write the listed tests first, watch them fail, then implement. Read `AGENTS.md`, `src/lib/AGENTS.md`, `src/components/AGENTS.md` and `migrations/AGENTS.md` before starting. Their traps apply to everything below.

**Staging warning:** the main checkout has three untracked paths: `.agents/`, `ops/content/instagram/` and `src/pages/api/admin/verification/[id] (1).ts`. Stage files by explicit path. Never use `git add -A` or `git add .`.

---

## What changed in this revision

Every blocking and important point in the critique is resolved. Each one was re-verified against the code before changing the plan.

| Critique point | Resolution |
|---|---|
| **BLOCKING: open redirect through dot segments** (`/.//evil.example` and 6 more returned `//evil.example`) | Confirmed in node. `safeRedirectPath` (Step 1) now rejects any `.`/`..`/`%2e` path segment, before and after decoding. It rejects a decoded path containing `//`, requires a fixed point (re-parsing the output must give the same string on the same origin), and re-checks the output shape. All 7 critic inputs and 40+ others are pinned. A 300,000-case fuzz over a hostile alphabet produced 0 off-site outputs. The reference script is `C:/Users/mmcge/AppData/Local/Temp/claude/C--Users-mmcge-ratemyplace-boston/e4bed66b-7eb9-44e3-aa17-a1ef131b648b/scratchpad/plan-oct26/rev2/redirect2.mjs`. `/a/../review/new` is now **rejected**, not normalized. |
| False "part of" note on directional streets | Confirmed: `100 West Broadway` and `100 W Broadway` both key `W BROADWAY 100-100`. The note now shows only when the matched row's `[st_num_lo, st_num_hi]` differs from the input's `[numLo, numHi]`. Tests cover both. |
| Goal (c) only partly met until item 4 | The plan now says this outright (Sections 1c and 7, the risks, and the PR text). It recommends merging item 4 before this branch or on the same day, and pins the gap with a test the second-merging branch flips. |
| Column-narrowing fix buried in step 6, and line 33 needs it too | Confirmed: `new.astro:33` also does `SELECT *`. The fix is now **Step 0**, a separate hotfix PR (`fix/review-form-select`) that ships first. It narrows both SELECTs and has a page-level HTML test. The repo is **public** (`gh repo view` → `PUBLIC`), so the hotfix PR description stays generic. |
| Server code in the review-form bundle | Client helpers live in leaf modules with no runtime imports (`src/lib/reviewPaths.ts`, `src/lib/reviewSubmitOutcome.ts`, `src/lib/authRedirect.ts`). A source-scan test enforces this, and a post-build grep checks the client chunks. |
| A 2xx with an unusable body navigates to `/building/undefined` | Submit outcomes are decided by a pure `submitOutcome()` in `src/lib`. A 2xx without a valid slug and id shows a "submitted, pending moderation" panel linking to `/profile`, with no reset and no re-enable. |
| Minors | All taken; each is marked "(minor)" where it lands. The loop guard checks the decoded path. A handoff `existing` result now 302s to `?building=`, so reloads are free, and the limiter only gates the Google call. Try again never loads `api.js` twice. A `submittingRef` guard is added. HomeSearch comments may change. The insertBuilding `updated_at` is spelled out. Option 2 audit rows get per-row values. Check 8d no longer creates a review. The `/profile` and edit-page redirect is noted. The logging rule is stated. The exact-tier gap is added to follow-ups. The preview OAuth outcome is specified. |

---

## 0. What I verified (code at 1b8ca2b; production D1 read-only, re-checked 2026-10-26)

| Brief claim | Verified location |
|---|---|
| AddressStep renders `<AddressAutocomplete>` without `onExistingBuildingSelect` | `AddressStep.tsx:137-141` (its only consumer; `ReviewForm.tsx:3` imports only the type) |
| `handleSelectDbMatch` only calls the callback if passed | `AddressAutocomplete.tsx:151-160` |
| Continue only renders when `selectedPlace` is set | `AddressStep.tsx:153-199` |
| `/review/new` redirects signed-out users with `redirect=` | `new.astro:9-12` |
| Nothing reads `redirect=` | `signin.astro:199`, `signup.astro:242` (brief said ~243), `callback.ts:152` |
| The placeId handoff inserts on GET | `new.astro:27-118` (insert at 91-108) |
| `handleSubmit` never resets Turnstile | `ReviewForm.tsx:228-317` (failure branch 307-311; `finally` re-enables even on success, 314-316) |
| ConfirmStep waits for the script with no timeout | `ConfirmStep.tsx:43-88`; Submit disabled at `:199` |

The `?building=` path works and starts at `unit-details`.

**The duplicates (re-checked 2026-10-26).**

| Duplicate (user row) | Seeded twin | Place id on the duplicate |
|---|---|---|
| `<crawford-dup-id>`: a single-number Crawford Street row, 02121 | `seed-1202188000` "86-88 Crawford Street", `CRAWFORD ST` 86-88, 02121, `updated_at` 1788983774 | `<crawford-place-id>` |
| `<appian-dup-id>`: a single-number Appian Way row, 02134 | `seed-2201144001` "9-11 Appian Wy", `APPIAN WY` 9-11, 02134, `updated_at` 1788983965 | `<appian-place-id>` |

- Both duplicates have 0 reviews, 0 saves, 0 pulls, 0 records, 0 corrections, 0 queue rows, and no landlord or property manager.
- Both duplicates have NULL `street_key`, `st_num_lo` and `st_num_hi`.
- Neither seed has a place id. Each seed has 12 record pulls of its own; that is irrelevant here, because nothing is moved off the seeds.

**New findings (beyond the brief):**

1. **The handoff is still creating rows.** There are 11 `source='user'` rows with NULL `street_key` since the seed (2026-09-09), the latest from late October. All have 0 reviews. `POST /api/buildings` writes `street_key` for any parseable address, so all 11 came from the GET handoff:
   - 2 are the Boston duplicates above.
   - 3 are in New Haven.
   - 6 are outside Boston and New Haven.
2. **Two suffix-table gaps affect dedupe** (checked with tsx against `identity.ts`):
   - `addressKey('9 Appian Way')` gives `APPIAN WAY`, but the seed key is `APPIAN WY`. `SUFFIX_SPELLINGS` has `['WAY']` and no `WY`.
   - The same miss applies to every parcel whose assessor suffix is absent from the table: about 375 parcels (`WY`, `HW`, `PW`, `LA`, `CI`, `RO`, ...), which item 4 (`fix/street-suffix-search`) targets.
   - `86 Crawford Street` gives `CRAWFORD ST` 86-86, which dedupes onto 86-88 today.
   - `100 West Broadway` and `100 W Broadway` both give `W BROADWAY` 100-100.
3. **Island props: fixed separately as Step 0.** `new.astro:23` (`?building=`) and `new.astro:33` (`?placeId=` tier 1) both `SELECT *` and pass the row to `<ReviewForm client:load>`.
   - The form reads only `id`, `address`, `neighborhood`, `city` (grep over `src/components/reviews/`). Step 0 narrows both SELECTs to those four.
   - The GitHub repo `mereditharmcgee/ratemyplace` is **PUBLIC**, so the details stay out of this repo.
4. **`new.astro:45` puts the raw `placeId` into the Google URL path** with no encoding and no format check. `details.ts` does encode it.
5. **The handoff skips `resolveBostonSubArea`**, which `details.ts:88-90` applies. Handoff rows store "Aberdeen" where other paths store "Brighton".
6. **ConfirmStep can leak a widget.** If the script was not loaded at mount, the effect returns only `clearInterval` (`:79`), so a widget rendered later is never removed.
7. **Preview deploys probably write to production.** `wrangler.jsonc` has one top-level `DB` binding and no preview override, so assume previews read and write production D1. (Pages secrets could not be listed: the API token lacks the Pages read scope.)
8. **`/api/reviews`** answers 401 and 429 before verifying Turnstile, and 400 with `turnstileResult.error` after. Success is `{ success, reviewId, buildingSlug, domainScores }` (`reviews.ts:293-298`), not the `{ data }` envelope; leave it.
9. **Existing senders of `?redirect=`:**
   - `profile.astro:9` and `review/edit/[id].astro:10` send `?redirect=/profile`. This branch starts honouring it.
   - `smoke.ts:383` checks only that the destination pathname is `/auth/signin`, so it is unaffected.
10. **Line anchors used below:**
    - `buildings.ts`: cleaning 157-176, tiers 189-232, insert 266-285.
    - `details.ts`: parsing 37-102; it logs with `console.error` at 30, 60 and 108.
    - `signin.astro`: frontmatter 1-8, sign-up link 17, Google link 25, form 47, success 199, `(window as any).turnstile` at 171 and 210-211.
    - `signup.astro`: same layout; sign-in link 17, success 242.
    - `google.ts`: state cookie 17-23.
    - `callback.ts`: 10 error redirects (30, 37, 44, 52, 74, 86, 92, 101, 121, 155) and success 152.
    - `HomeSearch.tsx` comments: 44-46 and 132-134.
    - `RecordCorrectionForm.tsx`: `submittingRef` 46/144/162/206; reset after failure 192-193 and 202.

---

## 1. Design decisions

**(a) Clicking an "Existing properties" row**
- The click navigates to `/review/new?building=<id>`, the proven server path, which opens at `unit-details`. Nothing is lost, because the writer is still on step 1.
- `onExistingBuildingSelect` becomes **required** on `AddressAutocomplete` and `AddressStep`, so dropping it again is a compile error.
- Navigation goes through `browserNav.go()` in the leaf `src/lib/reviewPaths.ts`, so tests can spy on it.
- Doing it in place was rejected: the match row has no `city`, which `Building` requires.

**(b) Returning to the form after sign-in**
- `src/lib/authRedirect.ts` holds the one validator, `safeRedirectPath` (algorithm in Step 1). It is a leaf module with no runtime imports, because the sign-in and sign-up client scripts import it.
- It accepts only same-origin relative paths with no dot segments, no `//` or `\` (raw or decoded), no control or whitespace characters, and no `%5c`. Its output must be a fixed point of WHATWG parsing, and it never points at `/auth*` or `/api*`, checked on the **decoded** path.
- Pages validate in frontmatter and render the result as `data-redirect`. The client validates again before navigating.
- Cross-links and the Google button carry `?redirect=` only when the path is not `/`. Bare pages keep `href="/auth/signup"`, which the e2e tests select on.
- **Google OAuth:** `/api/auth/google` stores the validated path in a sibling cookie, `oauth_return_to`:
  - httpOnly, SameSite=Lax, Secure in production, `Max-Age=600`;
  - `Path=/api/auth/google`, so it is sent only to the callback;
  - set in the same response as `oauth_state`.

  The callback reads and deletes it first, re-validates it, uses it on success, and appends it to every error redirect.
- **Departure from the brief, kept:** the brief said to use the state cookie. A separate cookie leaves the `oauth_state` value and its CSRF comparison (`callback.ts:34-38`) byte-for-byte unchanged. The path still travels only by cookie, never as a callback query param, and `redirect_uri` stays exactly `/api/auth/google/callback`.
- `review/edit/[id].astro:10` now passes its own path (`/review/edit/<id>`) instead of `/profile` (critique minor). `profile.astro:9` keeps `/profile`, which is already correct.

**(c) One shared resolver; the GET never writes**
- `src/lib/buildingResolve.ts` exports `findBuildingByPlaceId` and `findExistingBuilding`. Both are read-only. `findExistingBuilding` runs exactly the three tiers `POST /api/buildings` runs today, in the same order: place id, then `findBuildingByAddress`, then exact `(address, city)` only when there is no place id.
- POST is refactored onto it with identical behaviour. It still stamps only on the address-key tier, and only when something is missing (the `updated_at` trap).
- `src/lib/reviewHandoff.ts` exports `resolveReviewHandoff`. It is read-only, never throws, and has three outcomes:
  - **existing:** `new.astro` answers **302** to `/review/new?building=<id>` (plus `&partOf=1` when the city parcel spans a different number range). The handoff and the click then share one render path, and reloads cost nothing.
  - **confirm:** the form opens on the address step with the place pre-filled. Its Continue sends the existing `POST /api/buildings`, which dedupes and inserts with key columns.
  - **error:** an amber banner, with the address step still usable.
- **The "part of" note** shows only when the matched tier is `address_key` and the matched row's `[st_num_lo, st_num_hi]` differs from `addressKey(place.streetAddress)`'s `[numLo, numHi]`. Address spelling plays no part, so `100 West Broadway` onto `100 W Broadway` shows no note, and `86 Crawford Street` onto `86-88 Crawford Street` does.
- **Cost control:** the per-user limiter (`review-handoff`, 30/hour) is injected as `allowPlacesLookup` and runs only immediately before the paid Google call. A known place id never touches the limiter or Google. The limiter fails closed (a denial or error shows the `unavailable` banner, and the in-form search still works).
- Places parsing moves to `src/lib/places.ts`, shared with `details.ts`. That fixes finding 5 and validates the place id format (finding 4).
- **Logging rule (non-negotiable 1):** handoff and Places log lines carry only an event name and Google's `error.status`/`error.message` or the exception message. They never carry the user id, the place id or the address, so no line ties a reviewer to the building they are reviewing.
- **Limit of goal (c), stated plainly:** this branch removes every GET-time insert and every keyless insert, and dedupes any address whose suffix is in `SUFFIX_SPELLINGS`. Until item 4 lands, a homepage or in-form Google pick on one of the ~375 odd-suffix parcels (`WY`, `HW`, ...) still misses the address tier and creates a duplicate through confirm → Continue → POST. The in-form Google path already behaves this way today, so this branch does not make it worse. **Recommendation:** merge item 4 before this branch or on the same day (Section 7), and say so in the PR.

**(d) A failed submit can be retried**
- The ConfirmStep Turnstile callback only stores the token and never submits. That is the `RecordCorrectionForm` shape, the one the AGENTS trap allows to reset after a failed POST.
- `src/lib/reviewSubmitOutcome.ts` turns `(status, ok, body)` into one of `navigate | submitted | auth-expired | error`. A network failure is `null`. Business logic stays out of the component.
- After any failed attempt (`auth-expired`, `error`, network), ReviewForm clears the token first and then bumps `turnstileResetSignal`. ConfirmStep resets its own widget once per bump. The widget re-challenges, the callback stores a fresh token, and the writer presses Submit again with every answer in place.
- **No reset after any 2xx.** On `navigate`, Submit stays disabled ("Submitting...") through navigation. A 2xx with an unusable body (`submitted`) replaces the form with "Your review was submitted and is waiting for moderation", plus a `/profile` link. A `submittingRef` guard (as at `RecordCorrectionForm.tsx:144/162`) makes a double press a no-op.
- A 401 shows a "sign in in a new tab" link, so the answers survive.
- **Script wait:** bounded at 100 × 100 ms. On timeout ConfirmStep shows a message and a **Try again** button.
- **Try again never loads `api.js` twice.** `new.astro` adds a one-line capture-phase `error` listener before its Turnstile tag, and that listener removes any Turnstile `<script>` that fails to load. A Turnstile script still in the DOM therefore means "pending or loaded". Try again injects a retry script only when `window.turnstile` is unset and no Turnstile script is in the DOM; otherwise it just polls again. The retry script removes itself on `error` too.
- While a token is missing, a "Waiting for bot verification…" line shows, so Submit is never silently disabled.
- The cleanup is unified: a late-rendered widget is removed on unmount and its token dropped.
- **Rejected:** a sessionStorage draft. It is a privacy cost on shared devices, and a reload is no longer needed to retry.

---

## 2. Order of work (one commit per step; tests first in each)

### Step 0 (separate hotfix PR, ships first): narrow the review-form SELECTs

Branch `fix/review-form-select` from `main`. This is two lines of code plus one test file.

**Tests first: new `src/lib/__tests__/reviewNewPage.test.ts`**
- Use AstroContainer with the React server and client renderers, copied from `namedPartySsrVisibility.test.ts:107-122`. Guard with `const suite = sqliteAvailable ? describe : describe.skip`.
- **Setup:**
  - `db = createRecordsTestDb()`.
  - Add, with `ALTER TABLE`, the admin-only building columns the stub lacks.
  - `insertBuilding(db, { id: 'b-leak', address: '45 Melnea Cass Blvd', city: 'Boston', zip_code: '02119', google_place_id: 'gp-leak' })`.
  - Give every admin-only column of `b-leak` its own `SENTINEL-...` value.
- **Locals:** `{ user: { id: 'u-1', email: 'u@example.com', isAdmin: false }, session: { id: 's-1' }, runtime: { env: { DB: db } } } as unknown as App.Locals`.
- **Case A:** `renderToString` of `/review/new?building=b-leak`. The HTML contains `45 Melnea Cass Blvd`, and contains none of:
  - the sentinels;
  - the admin-only column names.
- **Case B:** `/review/new?placeId=gp-leak` (tier-1 path, `new.astro:33`). Same assertions.
- **Case C:** signed out (`user: null`). `renderToResponse` gives 302 with Location `/auth/signin?redirect=%2Freview%2Fnew%3FplaceId%3Dgp-leak`.
- Watch A and B fail on `main`.

**Fix**
- `new.astro:23`: `'SELECT id, address, neighborhood, city FROM buildings WHERE id = ?'`.
- `new.astro:33`: `'SELECT id, address, neighborhood, city FROM buildings WHERE google_place_id = ?'`.
- Nothing else changes.

**Commit and PR**
- Commit `fix: select only the columns the review form renders`.
- Keep the PR description generic, for example "The review form page now selects only the four columns the form uses." The repo is public. Section 5 step 0 covers deploy and verification.
- Then branch `fix/review-funnel` from the updated `main`. The Step 6 rewrite keeps this narrowing through `loadReviewFormBuilding`.

### Step 1: `src/lib/authRedirect.ts` (new, leaf, no runtime imports)

```ts
import type { AstroCookies } from 'astro'; // type-only: this module is imported by client scripts
export const OAUTH_RETURN_COOKIE = 'oauth_return_to';
export const OAUTH_RETURN_COOKIE_PATH = '/api/auth/google';
export function safeRedirectPath(raw: string | null | undefined, fallback = '/'): string; // fallback is always a code constant
export function redirectQuery(path: string): string;            // '/' -> '', else '?redirect=' + encodeURIComponent(path)
export function signinErrorPath(code: string, returnTo: string): string; // '/auth/signin?error=<code>' [+ '&redirect=<enc>' when returnTo !== '/']
type CookieJar = Pick<AstroCookies, 'get' | 'set' | 'delete'>;
export function rememberOAuthReturn(cookies: CookieJar, raw: string | null, secure: boolean): void; // safe & !== '/' -> set {path: OAUTH_RETURN_COOKIE_PATH, httpOnly, sameSite:'lax', secure, maxAge:600}; otherwise delete (clears a stale one)
export function takeOAuthReturn(cookies: CookieJar): string;    // read, delete (same path), safeRedirectPath, default '/'
```

`safeRedirectPath`, exactly. This is the algorithm verified in the scratch script:

```ts
const SENTINEL = 'https://return.invalid';
const UNSAFE_CHARS = /[\u0000-\u001f\u007f\s\\]/;
const DOT_SEGMENT = /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i;
const LOOP_TARGET = /^\/(?:auth|api)(?:\/|$)/i;
const hasSafeShape = (p: string) => p[0] === '/' && p[1] !== '/' && p[1] !== '\\';

export function safeRedirectPath(raw: string | null | undefined, fallback = '/'): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return fallback;
  if (UNSAFE_CHARS.test(raw) || !hasSafeShape(raw) || /%5c/i.test(raw)) return fallback;
  const rawPath = raw.split(/[?#]/, 1)[0];
  // Dot segments are never legitimate in a return path, and WHATWG dot-segment removal is
  // what turns '/.//evil.example' into the protocol-relative '//evil.example'.
  if (DOT_SEGMENT.test(rawPath)) return fallback;
  let decodedPath: string;
  try { decodedPath = decodeURIComponent(rawPath); } catch { return fallback; }
  if (!hasSafeShape(decodedPath) || UNSAFE_CHARS.test(decodedPath) || decodedPath.includes('//') || DOT_SEGMENT.test(decodedPath)) return fallback;
  let url: URL;
  try { url = new URL(raw, SENTINEL); } catch { return fallback; }
  if (url.origin !== SENTINEL) return fallback;
  const out = url.pathname + url.search + url.hash;
  // Fixed point: the value we hand to a redirect must parse back to itself, same origin, and
  // still start with exactly one slash. Belt and braces over the checks above.
  if (!hasSafeShape(out)) return fallback;
  const again = new URL(out, SENTINEL);
  if (again.origin !== SENTINEL || again.pathname + again.search + again.hash !== out) return fallback;
  if (LOOP_TARGET.test(decodedPath)) return fallback; // decoded, so '/%61uth/signin' is caught
  return out;
}
```

**Tests: `src/lib/__tests__/authRedirect.test.ts`**

- **Accepted, with exact output:**
  - `/review/new`
  - `/review/new?placeId=ChIJNx18GtF744kR6W7CM_iVm58`
  - `/review/new?building=seed-1202188000`
  - `/review/edit/abc123`
  - `/profile`
  - `/search?q=86%20Crawford`
  - `/building/86-88-crawford-street-boston#reviews`
  - `/building/st.-james-ave-boston` (a dot inside a segment is fine)
  - `/x/..y`
  - `/search?q=a/../b` (dots in the query are not path segments)
  - `/search?q=//x`
  - `/` returns `/`
  - `/%252F%252Fevil.example` returns itself (a same-origin 404)
- **Rejected, returns `/`:**
  - Empty or wrong type: null, undefined, `''`, `review/new`.
  - Protocol-relative and backslash: `//evil.example`, `///evil.example`, `/\evil.example`, `\\evil.example`, `/\/evil.example`.
  - Schemes: `https://evil.example`, `http:evil.example`, `javascript:alert(1)`, `data:text/html,x`.
  - Encoded slash or backslash: `/%2F%2Fevil.example`, `/%2fevil.example`, `/%5Cevil.example`, `/%5cevil.example`, `%2F%2Fevil.example`, `/x/%2F%2Fevil.example`.
  - Whitespace and control characters: `/\t/evil.example`, `/\n/evil.example`, `/%09/evil.example`, `/ /evil.example`, `/%20/evil.example`, `/\u2028/evil.example`, `/\u00a0x`.
  - Malformed encoding: `/%E0%A4%A`.
  - **Dot segments (the critique's blocking set):** `/.//evil.example`, `/..//evil.example`, `/a/..//evil.example`, `/x/../..//evil.example`, `/%2e//evil.example`, `/%2e%2e//evil.example`, `/%2e/%2e//evil.example`.
  - **More dot-segment forms:** `/%2E%2E//evil.example`, `/.%2F/evil.example`, `/review%2F..%2F..%2Fx`, `/a/../review/new`, `/./review/new`, `/review/.`, `/review/..`.
  - **Loop targets:** `/auth/signin`, `/auth/signin?redirect=%2Fprofile`, `/auth`, `/api/auth/google`, `/API/x`, `/%61uth/signin`, `/%61pi/auth/signout`, `/%41PI/x`, `/auth%2Fsignin`.
  - Too long: `'/' + 'a'.repeat(600)`.
- `safeRedirectPath('//evil.example', '/profile')` returns `/profile`.
- **Property test:** for every input above plus `/%2561uth/signin`, the output `out` satisfies all of:
  - `new URL(out, 'https://ratemyplace.org').origin === 'https://ratemyplace.org'`;
  - `out[0] === '/'`;
  - `out[1]` is neither `/` nor `\`;
  - `safeRedirectPath(out) === out` (idempotent).
- **Deterministic fuzz:** a seeded mulberry32 PRNG builds 20,000 strings. Each is `'/'` (90% of the time) plus 1-8 tokens from `['/', '\\', '.', '..', '%2e', '%2E', '%2e%2e', '%2f', '%2F', '%5c', 'a', 'evil.example', '%25', ':', '?', '#', '@', '\t', ' ', 'http', '%00']`. The same property must hold for every one.
- `redirectQuery`: `/` gives `''`; `/review/new?placeId=abc` gives `?redirect=%2Freview%2Fnew%3FplaceId%3Dabc`.
- `signinErrorPath('oauth_denied', '/')` gives `/auth/signin?error=oauth_denied`. With `/review/new` it appends `&redirect=%2Freview%2Fnew`.
- **Cookie helpers, using a Map-backed fake jar that records options:**
  - `remember` with a valid path sets exactly the attributes above.
  - `remember` with `/.//evil.example`, `//evil.example`, `/` or null deletes and does not set.
  - `take` returns the path and deletes with `path: '/api/auth/google'`.
  - `take` on a jar holding `//evil.example`, or `/.//evil.example`, returns `/`.
  - `take` on an empty jar returns `/`.
- **Leaf guard, new `src/lib/__tests__/clientLeafModules.test.ts`:**
  - Read the source text of `src/lib/authRedirect.ts`, `src/lib/reviewPaths.ts` and `src/lib/reviewSubmitOutcome.ts`.
  - Assert none matches `/^\s*import\s+(?!type\b)/m` or `/^\s*export\s+[^;]*\sfrom\s/m`.
  - The two later files are added to the list in Steps 6 and 8.

### Step 2: sign-in, sign-up and edit pages

**`src/pages/auth/signin.astro`**
- Frontmatter: `const redirectTo = safeRedirectPath(Astro.url.searchParams.get('redirect'));`.
- Signed-in visitors: `Astro.redirect(redirectTo)` instead of `'/'`.
- Line 17: `href={'/auth/signup' + redirectQuery(redirectTo)}`.
- Line 25: `href={'/api/auth/google' + redirectQuery(redirectTo)}`.
- Line 47: add `data-redirect={redirectTo}` to the form.
- Script line 199: `window.location.href = safeRedirectPath(form.dataset.redirect);` (import from `../../lib/authRedirect`).
- Replace `(window as any).turnstile` (171, 210-211) with the ambient `window.turnstile` (AGENTS: clean up what you touch).

**`src/pages/auth/signup.astro`**: the same changes. The cross-link is to `/auth/signin` (line 17) and the success line is 242.

**`src/pages/review/edit/[id].astro:10`**: `return Astro.redirect('/auth/signin?redirect=' + encodeURIComponent(Astro.url.pathname));`.

**Tests: `src/lib/__tests__/authRedirectPages.test.ts`** (AstroContainer, as in `authPageHeadings.test.ts`), with `describe.each` over sign-in and sign-up:
- With `?redirect=%2Freview%2Fnew%3FplaceId%3Dabc`:
  - the form's `data-redirect` is `/review/new?placeId=abc`;
  - the Google href is `/api/auth/google?redirect=%2Freview%2Fnew%3FplaceId%3Dabc`;
  - the cross-link carries the same query.
- With each of `%2F%2Fevil.example`, `%2F.%2F%2Fevil.example` and `%2F%252e%2F%2Fevil.example`: `data-redirect="/"`, the Google href is exactly `/api/auth/google`, and the cross-link is bare.
- With no redirect: the links are bare (this pins the e2e selectors).
- Signed-in visitor (`renderToResponse`, `locals.user` set): 302 with Location `/review/new?placeId=abc`. With `redirect=%2F.%2F%2Fevil.example`, Location is `/`.
- Edit page, signed out, `params: { id: 'abc' }`: 302 with Location `/auth/signin?redirect=%2Freview%2Fedit%2Fabc`.

### Step 3: Google OAuth

**`src/pages/api/auth/google.ts`**
- The not-configured branch (line 10) becomes `context.redirect(signinErrorPath('oauth_not_configured', safeRedirectPath(context.url.searchParams.get('redirect'))))`.
- After setting `oauth_state` (lines 17-23, unchanged): `rememberOAuthReturn(context.cookies, context.url.searchParams.get('redirect'), import.meta.env.PROD);`.

**`src/pages/api/auth/google/callback.ts`**
- The first statement in `GET` is `const returnTo = takeOAuthReturn(context.cookies);`.
- All 10 `/auth/signin?error=X` redirects become `context.redirect(signinErrorPath('X', returnTo))`.
- Line 152 becomes `context.redirect(returnTo)`.
- Do not touch the state comparison.

**Tests: `src/lib/__tests__/googleOAuthReturn.test.ts`**
- The context mock is `{ url, cookies: jar, locals: { runtime: { env } }, redirect: (to, s = 302) => new Response(null, { status: s, headers: { Location: to } }) } as unknown as APIContext`.
- **Start:**
  - sets `oauth_return_to = /review/new?placeId=abc` with the Step 1 attributes;
  - still sets `oauth_state` with path `/`;
  - the Location host is `accounts.google.com`, and its `redirect_uri` param equals exactly `https://ratemyplace.org/api/auth/google/callback`.
- **Start, unsafe redirect** (`//evil.example` and `/.//evil.example`): no `set` for the return cookie, and a `delete` of it.
- **Start, missing `GOOGLE_CLIENT_ID`:** Location is `/auth/signin?error=oauth_not_configured&redirect=%2Freview%2Fnew%3FplaceId%3Dabc`.
- **Callback, `?error=access_denied`** with the cookie set: Location is `/auth/signin?error=oauth_denied&redirect=%2Freview%2Fnew%3FplaceId%3Dabc`, and the cookie is deleted with path `/api/auth/google`.
- **Callback, state mismatch:** the redirect is kept the same way.
- **Callback, hostile cookie** (`//evil.example`, and separately `/.//evil.example`): Location is `/auth/signin?error=oauth_denied`.
- **Optional:** the success path, if the sqlite D1 double can host Lucia's `D1Adapter` (it needs `users` and `sessions`). Stub fetch for the token and userinfo calls and expect 302 to `/review/new?placeId=abc`. Otherwise rely on the `takeOAuthReturn` tests plus production check 8c.

### Step 4: `src/lib/places.ts` (new) and `details.ts`

```ts
export const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;
export const PLACE_DETAILS_FIELD_MASK = 'id,formattedAddress,addressComponents,location,displayName';
export interface GoogleAddressComponent { longText?: string; shortText?: string; types?: string[] }
export interface GooglePlaceResponse { id?: string; formattedAddress?: string; addressComponents?: GoogleAddressComponent[]; location?: { latitude?: number; longitude?: number }; error?: { status?: string; message?: string } }
export interface ParsedPlace { placeId: string; formattedAddress: string; streetAddress: string; neighborhood: string; city: string; state: string; zipCode: string; latitude?: number; longitude?: number }
export function placeDetailsUrl(placeId: string, sessionToken?: string): string;           // encodes both, as details.ts:41-43
export function parsePlaceDetails(data: GooglePlaceResponse, requestedPlaceId: string): ParsedPlace | null; // null iff data.error; body = details.ts:67-102 incl. resolveBostonSubArea; placeId = data.id || requestedPlaceId
export async function fetchPlaceDetails(placeId: string, apiKey: string, opts?: { sessionToken?: string; fetchImpl?: typeof fetch }): Promise<ParsedPlace | null>; // headers exactly as details.ts:48-53 incl. Referer; throws on network failure
```

**Logging:** on `data.error`, use `logError('places_details_error', { status: data.error.status, message: data.error.message })`. Never log the place id, address or user id.

**`details.ts`** keeps its rate limit and key check, then calls `fetchPlaceDetails`:
- null → `500 { error: 'Place details error' }`;
- a throw → `logError('places_details_failed', { error: message })` and `500 { error: 'Failed to get place details' }`;
- otherwise `{ place }`.

The `{ place }` envelope stays, and the `any` casts go.

**Tests: `src/lib/__tests__/places.test.ts`**
- **`parsePlaceDetails`:**
  - A Boston locality with neighborhood "Aberdeen" gives "Brighton".
  - A non-Boston "Aberdeen" is left as is.
  - `data.error` gives null.
  - Missing components give empty strings, not null.
  - With no `data.id`, `placeId` falls back to the requested id.
- **`placeDetailsUrl`** encodes the id and appends `sessionToken`.
- **`fetchPlaceDetails`** with an injected `fetchImpl`:
  - sends `X-Goog-Api-Key`, the field mask and `Referer`;
  - returns null on an error body;
  - with `console.error` spied, the logged line contains neither the place id nor the street.
- **`PLACE_ID_PATTERN`** accepts `ChIJNx18GtF744kR6W7CM_iVm58` and `gp-1`. It rejects `../x`, `a b`, the empty string, 513 characters and `ChIJ%2F`.

### Step 5: `src/lib/buildingResolve.ts` (new) and the POST refactor

```ts
export type ResolveTier = 'place_id' | 'address_key' | 'exact_address';
export interface ResolveInput { placeId: string | null; address: string; city: string; zip: string | null }
export interface ResolvedBuilding { id: string; slug: string; tier: ResolveTier }
/** sanitizeText + slice(0,500)/(0,120); zip via isValidZipCode; placeId kept only if string && PLACE_ID_PATTERN; null if address/city empty after cleaning */
export function resolveInputFrom(raw: { placeId?: unknown; streetAddress: string; city: string; zipCode?: unknown }): ResolveInput | null;
/** READ-ONLY. 'SELECT id, slug FROM buildings WHERE google_place_id = ?' — the one spelling of tier 1. */
export async function findBuildingByPlaceId(db: RecordsDb, placeId: string): Promise<{ id: string; slug: string } | null>;
/** READ-ONLY. Tier order is the route's: place id -> findBuildingByAddress -> exact LOWER(address)/LOWER(city) only when placeId is null. */
export async function findExistingBuilding(db: RecordsDb, input: ResolveInput): Promise<ResolvedBuilding | null>;
```

**`src/pages/api/buildings.ts` POST**
- Keep lines 85-151: auth, content-type guard, rate limit, body-shape 400, typeof 400.
- Replace the cleaning at 157-176 with `const input = resolveInputFrom({ placeId, streetAddress, city, zipCode })`. Null returns the same 400 message.
- Keep `cleanNeighborhood`, `cleanState` and the coordinates inline.
- Replace 194-232 with:

  ```ts
  const existing = await findExistingBuilding(db, input);
  if (existing) {
    if (existing.tier === 'address_key') {
      // unchanged stamp: same SQL, hasSomethingToStamp guard and comment as 207-220, bound to input.placeId
    }
    return found({ id: existing.id, slug: existing.slug });
  }
  ```

  Strip `tier` before responding. Existing tests assert exactly `{ id, slug }`.
- The insert binds `input.placeId` instead of `placeId || null`.
- Leave `GET` untouched.

**Tests**
- **New `src/lib/__tests__/buildingResolve.test.ts`** (`createRecordsTestDb` + `insertBuilding`).
  - Seed `seed-1202188000`: "86-88 Crawford Street", `city` Boston, `zip_code` 02121, `source` 'seed', `street_key` `CRAWFORD ST`, `st_num_lo` 86, `st_num_hi` 88.
  - `insertBuilding` has no `updated_at` column (`helpers/recordsDb.ts` `BUILDING_COLUMNS`), so after inserting run `UPDATE buildings SET updated_at = 1788983774 WHERE id = 'seed-1202188000'`, as `stampSeed` does in `recordsBuildingsRoute.test.ts:30-35`.
  - Cases:
    - A user row holding `gp-dup` wins as `place_id`.
    - "86 Crawford Street" with place id `gp-new` resolves to the seed as `address_key`.
    - "1 Elm St", New Haven, resolves as `exact_address` only when `placeId` is null.
    - An unparseable address returns null; a non-Boston miss returns null.
    - **Known gap, pinned:** seed `seed-appian` "9-11 Appian Wy" (`APPIAN WY` 9-11, 02134), then input "9 Appian Way", 02134, place id `gp-app`. On a base without item 4 the result is `null`, with the comment `// flips to seed-appian when fix/street-suffix-search adds WY`. Whichever of the two branches merges second flips it to expect `{ id: 'seed-appian', tier: 'address_key' }`.
    - **It never writes:** snapshot `COUNT(*)`, `MAX(updated_at)`, `group_concat(google_place_id)` and `(SELECT COUNT(*) FROM rate_limits)` before and after every call; they must be equal.
  - `findBuildingByPlaceId`: a hit and a miss.
  - `resolveInputFrom`: strips markup, drops an invalid zip, drops a non-string or `../x` place id, and returns null when the value is empty after cleaning.
- **Additions to `src/lib/__tests__/recordsBuildingsRoute.test.ts`:**
  - For a seeded-range hit, an exact manual entry and a new address, `findExistingBuilding` and `POST` agree: the same id on a hit, and null exactly when POST returns 201.
  - `placeId: '../x'` is treated as absent: 201, and the row's `google_place_id` is NULL.
- **All 13 existing cases in that file must pass unchanged.** These are called out by name:
  - `a manual entry with no place id and no coordinates does not bump updated_at` (`:121`): an address-tier hit with nothing to stamp leaves `updated_at` unchanged.
  - `never overwrites an already-stamped seeded row, and does not touch its updated_at` (`:97`).
  - `stamps only the columns the seeded row is missing, keeping the place id it already has` (`:108`).
  - `an exact place id wins over the address tier and leaves the seeded row alone` (`:88`).
  - `a slug collision gets -2, -3` (`:137`).

### Step 6: `reviewPaths.ts`, `reviewHandoff.ts`, `new.astro`, and ReviewForm `initialPlace`

**New `src/lib/reviewPaths.ts`** (leaf; add it to the leaf-guard test):

```ts
export function existingBuildingReviewPath(buildingId: string, opts?: { partOf?: boolean }): string; // '/review/new?building=' + encodeURIComponent(id) + (opts?.partOf ? '&partOf=1' : '')
/** The one place the review form leaves the page; tests spy on it. */
export const browserNav = { go(url: string): void { window.location.href = url; } };
```

**New `src/lib/reviewHandoff.ts`** (server-only; imported by `new.astro` frontmatter, **never** by a component):

```ts
export interface ReviewFormBuilding { id: string; address: string; neighborhood?: string; city: string }
export interface HandoffPlace { placeId: string; streetAddress: string; neighborhood: string; city: string; state: string; zipCode: string; latitude?: number; longitude?: number; existingBuilding: null }
export const HANDOFF_COPY = {
  unavailable: 'Address lookup is temporarily unavailable. Please search for your address below.',
  lookupFailed: 'We could not look up that address. Please search for it below.',
  incomplete: 'That address came back incomplete. Please enter it manually below.',
  failed: 'Something went wrong loading that address. Please search for it below.',
  notFound: 'We could not find that building. Please search for your address below.',
  partOf: (address: string) => `The city's property records list the address you picked as part of ${address}, so your review goes on that building's page.`,
} as const;
export type HandoffResult =
  | { kind: 'existing'; buildingId: string; matchedBy: ResolveTier; partOf: boolean }
  | { kind: 'confirm'; place: HandoffPlace }
  | { kind: 'error'; message: string };
export interface HandoffDeps {
  db: RecordsDb;
  fetchPlace: ((placeId: string) => Promise<ParsedPlace | null>) | null; // null = no API key
  allowPlacesLookup: () => Promise<boolean>;                            // rate limiter; false or throw = refuse
}
/** SELECT id, address, neighborhood, city ... ; null neighborhood -> undefined; null when no row. The only columns that reach the island. */
export async function loadReviewFormBuilding(db: RecordsDb, id: string): Promise<ReviewFormBuilding | null>;
/** READ-ONLY; never throws (the whole body is in try/catch -> failed, logged without ids or addresses). */
export async function resolveReviewHandoff(deps: HandoffDeps, placeId: string): Promise<HandoffResult>;
```

How `resolveReviewHandoff` decides, in order:

| # | Condition | Result |
|---|---|---|
| 1 | Place id fails `PLACE_ID_PATTERN` | `error: lookupFailed`; no DB, limiter or Google call |
| 2 | `findBuildingByPlaceId` hits | `existing`, `matchedBy 'place_id'`, `partOf false`; no limiter or Google call |
| 3 | `fetchPlace` is null | `error: unavailable`; limiter not called |
| 4 | `allowPlacesLookup()` resolves false **or throws** | `error: unavailable`; `fetchPlace` not called |
| 5 | `fetchPlace` resolves null / throws | `error: lookupFailed` / `error: failed` |
| 6 | Street address or city empty, or `resolveInputFrom` returns null | `error: incomplete` |
| 7 | `findExistingBuilding(db, input)` hits (with `input.placeId = place.placeId`) | `existing` with `matchedBy = hit.tier`. `partOf` is true only when the tier is `address_key` and the row's `SELECT st_num_lo, st_num_hi FROM buildings WHERE id = ?` is non-null and differs from `addressKey(place.streetAddress)`'s `numLo` or `numHi` |
| 8 | Otherwise | `confirm` with the parsed place (`existingBuilding: null`) |

**`src/pages/review/new.astro`** (rewrite the frontmatter)
- Keep lines 9-12 (the signed-out redirect).
- Drop the `lucia` import and `building: any`. Use `let building: ReviewFormBuilding | null = null`.
- `const env = Astro.locals.runtime.env; const db = env.DB;` This is the existing typed page convention; no cast.
- **`?building=`:** `building = await loadReviewFormBuilding(db, id)`.
  - On a miss, `resolveError = notFound`.
  - On a catch, `failed`, logged with `logError('review_form_load_failed', { error: message })` only.
  - When `building` is set and `Astro.url.searchParams.get('partOf') === '1'`, `resolveNote = HANDOFF_COPY.partOf(building.address)`.
- **`?placeId=`:**

  ```ts
  const apiKey = env.GOOGLE_PLACES_API_KEY || env.GOOGLE_MAPS_API_KEY;
  const result = await resolveReviewHandoff({
    db,
    fetchPlace: apiKey ? (id) => fetchPlaceDetails(id, apiKey) : null,
    allowPlacesLookup: async () => (await checkRateLimit(db, Astro.locals.user.id, 'review-handoff', 30, 3600)).allowed,
  }, placeIdParam);
  ```

  - `existing` → `return Astro.redirect(existingBuildingReviewPath(result.buildingId, { partOf: result.partOf }));` (302).
  - `confirm` → `initialPlace = result.place`.
  - `error` → `resolveError = result.message`.
- Render `resolveNote` in a teal box (`bg-teal-50 border border-teal-200 rounded-[6px] p-4 mb-6 text-teal-800 text-sm`) next to the amber one.
- Render `<ReviewForm client:load building={building} initialPlace={initialPlace} />`.
- Add a frontmatter comment: "GET never writes a `buildings` row; see AGENTS.md Traps".

**`ReviewForm.tsx`**
- Props become `{ building?: Building | null; initialPlace?: PlaceData | null }`.
- `useState<PlaceData | null>(initialPlace ?? null)` for `selectedPlace`.
- Pass `searchInitialValue={initialPlace?.streetAddress}` to AddressStep.
- **ReviewForm and `form-steps/*` import only leaf modules from `src/lib`:** `surveyItems`, `formOptions`, `reviewPaths`, `reviewSubmitOutcome`. Never `reviewHandoff`, `buildingResolve`, `places` or `records/*`. `PlaceData` is structurally compatible with `HandoffPlace`, so no type import from `reviewHandoff` is needed.

**`AddressStep.tsx`**: add the optional prop `searchInitialValue?: string`, passed through as `initialValue` to `AddressAutocomplete`.

**Tests**
- **New `src/lib/__tests__/reviewHandoff.test.ts`** (sqlite double; run `ALTER TABLE buildings ADD COLUMN admin_notes TEXT`; give the seed `admin_notes='internal'`). `fetchPlace` and `allowPlacesLookup` are `vi.fn`s.
  - `../../x` returns `lookupFailed`; no dep is called.
  - A known place id returns `existing`, `place_id`, `partOf false`. Neither `allowPlacesLookup` nor `fetchPlace` is called.
  - `fetchPlace: null` gives `unavailable`, and the limiter is not called.
  - **Rate limit:** `allowPlacesLookup` resolving false gives `unavailable`; rejecting also gives `unavailable`. `fetchPlace` is never called in either case.
  - `fetchPlace` resolving null gives `lookupFailed`; rejecting gives `failed`; an empty street or city gives `incomplete`.
  - "86 Crawford Street", 02121, against `seed-1202188000` (86-88) gives `existing`, `address_key`, **`partOf true`**.
  - **Directionals:** seed `seed-wb` "100 W Broadway", Boston, 02127, `W BROADWAY` 100-100. Google's "100 West Broadway", 02127, gives `existing` on `seed-wb`, `address_key`, **`partOf false`**.
  - "5 Oak St", Dorchester, gives `confirm`, with `place.streetAddress === '5 Oak St'` and `existingBuilding === null`.
  - **It never writes, whatever the outcome:** the buildings count, `MAX(updated_at)` and place ids are unchanged after every case above.
  - **Logging:** with `console.error` spied during the `failed` case, no logged argument contains the place id, `'86 Crawford'` or a user id.
  - `loadReviewFormBuilding`: `Object.keys(result).sort()` equals `['address','city','id','neighborhood']` (no `admin_notes`); an unknown id gives null.
- **New `src/lib/__tests__/reviewPaths.test.ts`:**
  - `existingBuildingReviewPath('a b')` gives `/review/new?building=a%20b`.
  - With `{ partOf: true }`, the same path plus `&partOf=1`.
  - Add `reviewPaths.ts` to the leaf-guard list.
- **Extend `reviewNewPage.test.ts` (from Step 0):**
  - Case B now expects `renderToResponse` 302 with Location `/review/new?building=b-leak` (the tier-1 hit redirects). Case A still guards the island props on the page that redirect lands on.
  - `?building=b-leak&partOf=1` shows the `partOf` copy with "45 Melnea Cass Blvd".
  - `?building=b-leak` without the flag has no teal note.
  - `?building=missing` shows `notFound`.
  - `?placeId=..%2Fx` shows `lookupFailed`; the buildings count is unchanged.
  - `?placeId=ChIJunknown00` with no Places key in env shows `unavailable`; the count is unchanged and `rate_limits` has 0 rows.
  - With `GOOGLE_PLACES_API_KEY: 'k'` in env and `vi.stubGlobal('fetch')` returning a Google body for "86 Crawford Street", 02121, Boston (seed 86-88 present): 302 to `/review/new?building=seed-1202188000&partOf=1`.
  - **Page-level rate limit:** first call `checkRateLimit(db, 'u-1', 'review-handoff', 30, 3600)` 30 times. Then the same request renders `unavailable`, and the stubbed fetch is **not** called.
  - **No write on any of these:** the count is unchanged.

### Step 7: the "Existing properties" click

- **`AddressAutocomplete.tsx:32`**: `onExistingBuildingSelect: (buildingId: string, slug: string) => void;` (required).
- **`handleSelectDbMatch`**: call it unconditionally (drop the `if`).
- **`AddressStep.tsx`**: add the required prop `onExistingBuildingSelect: (buildingId: string) => void` and pass `(id) => onExistingBuildingSelect(id)` at line 137.
- **`ReviewForm.tsx`**: `const handleExistingBuildingSelect = (id: string) => browserNav.go(existingBuildingReviewPath(id));`, passed at line 328.

**Tests: `src/lib/__tests__/reviewFormAddressStep.test.tsx`**
- Update the existing render to pass `onExistingBuildingSelect={vi.fn()}`.
- **New: clicking an "Existing properties" row hands up the id.**
  - Stub fetch: `/api/search/autocomplete` returns `{ results: [{ id: 'seed-1202188000', type: 'building', title: '86-88 Crawford Street', subtitle: 'Dorchester, Boston, MA', slug: '86-88-crawford-street-boston', reviewCount: 0 }] }`; `/api/places/autocomplete` returns `{ predictions: [] }`.
  - Type `86-88 Craw`, then `findByText('Existing properties')`.
  - Click `getByRole('button', { name: /86-88 Crawford Street/ })`.
  - Expect the spy to have been called with `'seed-1202188000'`.
- **New:** ArrowDown then Enter on the highlighted row does the same.
- **New, ReviewForm level:** render `<ReviewForm />` with the same stubs and `vi.spyOn(browserNav, 'go').mockImplementation(() => {})`. Clicking the row calls `go('/review/new?building=seed-1202188000')`.
- **New:** `<ReviewForm initialPlace={{ placeId: 'gp-5', streetAddress: '5 Oak St', neighborhood: 'Dorchester', city: 'Boston', state: 'MA', zipCode: '02124', existingBuilding: null }} />`:
  - the input value is "5 Oak St" and "This will be a new building in our system" is shown;
  - Continue POSTs `/api/buildings` with `placeId: 'gp-5'`;
  - a 201 `{ building: { id: 'n1', slug: 'x' }, created: true }` moves the form to unit details.

### Step 8: submit outcome, ConfirmStep and ReviewForm retry

**New `src/lib/reviewSubmitOutcome.ts`** (leaf; add it to the leaf-guard test):

```ts
export interface ReviewSubmitResponse { reviewId?: unknown; buildingSlug?: unknown; error?: unknown }
export type SubmitOutcome =
  | { kind: 'navigate'; url: string }   // 2xx with a usable slug + id
  | { kind: 'submitted' }               // 2xx, but the body is unusable: the review exists, there is no link
  | { kind: 'auth-expired' }            // 401
  | { kind: 'error'; message: string }; // any other non-2xx
export const SUBMIT_FAILED_COPY = 'Failed to submit review';
export const SUBMIT_NETWORK_COPY = 'An error occurred. Please try again.';
export const SUBMITTED_NO_LINK_COPY = 'Your review was submitted and is waiting for moderation. You can find it on your profile.';
/** navigate iff ok && typeof buildingSlug === 'string' && /^[a-z0-9-]+$/.test(slug) && typeof reviewId === 'string' && reviewId !== '';
 *  url = `/building/${slug}?submitted=true&reviewId=${encodeURIComponent(reviewId)}`. ok otherwise -> submitted.
 *  401 -> auth-expired. else error with body.error when it is a non-empty string, else SUBMIT_FAILED_COPY. */
export function submitOutcome(status: number, ok: boolean, body: ReviewSubmitResponse | null): SubmitOutcome;
/** A failed attempt spent its token: true for auth-expired, error, and null (network failure). Never for a 2xx. */
export function needsFreshToken(outcome: SubmitOutcome | null): boolean;
```

**`ConfirmStep.tsx`**
- New props: `turnstileResetSignal: number; authExpired: boolean`.
- Module constants:

  ```ts
  const TURNSTILE_SITEKEY = '0x4AAAAAACo4KpkxsacPhM2r';
  const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  const TURNSTILE_SCRIPT_SELECTOR = 'script[src^="https://challenges.cloudflare.com/turnstile/"]';
  const POLL_MS = 100;
  const POLL_TICKS = 100;
  ```

- Exported copy:
  - `TURNSTILE_LOAD_FAILED_COPY = "Bot verification didn't load. Check your connection, or allow challenges.cloudflare.com if you use a content blocker, then press Try again. Your answers stay on this page."`
  - `TURNSTILE_WAITING_COPY = 'Waiting for bot verification…'`
  - `SESSION_EXPIRED_COPY`
- **Effect A, deps `[loadAttempt]`:** render once, with the same options as today. The callback only calls `setTurnstileError(null)` and `onTurnstileToken(token)` and must never submit; add a comment citing the AGENTS trap. Poll up to `POLL_TICKS`; on timeout, `setLoadFailed(true)`. Cleanup clears the interval only.
- **Effect B, deps `[]`:** an unmount-only cleanup. If a widget exists, call `turnstile.remove(widgetIdRef.current)` and set the ref to null; then call `onTurnstileToken(null)`. `onTurnstileToken` is the parent's stable `setTurnstileToken`.
- **Effect C, deps `[turnstileResetSignal]`:**

  ```ts
  if (turnstileResetSignal === lastResetRef.current) return;
  lastResetRef.current = turnstileResetSignal;
  if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
  ```

  `lastResetRef` is initialised to the mount value, so a remount does not reset a fresh widget.
- **`handleRetryLoad`:**

  ```ts
  setLoadFailed(false);
  // A Turnstile <script> still in the DOM is pending or loaded: a failed one removes itself
  // (new.astro's capture listener, and the listener below). Inject only when none is left,
  // so api.js never executes twice.
  if (!window.turnstile && !document.querySelector(TURNSTILE_SCRIPT_SELECTOR)) {
    const s = document.createElement('script');
    s.src = TURNSTILE_SRC; s.async = true; s.dataset.rmpTurnstileRetry = '';
    s.addEventListener('error', () => s.remove(), { once: true });
    document.head.appendChild(s);
  }
  setLoadAttempt((n) => n + 1);
  ```

- **Banner:** shows `error || turnstileError || (loadFailed ? LOAD_FAILED : null)`, plus a "Try again" button (`h-11 ... rounded-[4px]`) when `loadFailed`.
- **Auth expired:** when `authExpired`, show `<p role="alert">You were signed out while writing this. <a href="/auth/signin" target="_blank" rel="noopener">Sign in in a new tab</a>, then come back and press Submit Review again. Your answers are still here.</p>`.
- **Waiting line:** under the button, `<p aria-live="polite">` with `WAITING_COPY` when `privacyAcknowledged && !turnstileToken && !turnstileError && !loadFailed && !loading`.

**`src/pages/review/new.astro`**: immediately **before** the existing Turnstile tag (line 147, kept as is), add:

```html
<script is:inline data-rmp-turnstile-guard>
  // A Turnstile script that fails to load removes itself, so ConfirmStep's "Try again" can tell a
  // failed load (no tag left) from a slow one (tag still pending) and never runs api.js twice.
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'SCRIPT' && typeof t.src === 'string' &&
        t.src.indexOf('https://challenges.cloudflare.com/turnstile/') === 0 && t.parentNode) {
      t.parentNode.removeChild(t);
    }
  }, true);
</script>
```

Resource `error` events do not bubble, but window capture listeners receive them. CSP already allows `'unsafe-inline'` (`middleware.ts:70`); note this tag in the CSP-tightening follow-up.

**`ReviewForm.tsx`**
- Add state `turnstileResetSignal` (number), `authExpired` (boolean) and `submittedNoLink` (boolean), plus `const submittingRef = useRef(false)`.
- `handleSubmit`:

  ```ts
  if (!selectedBuilding || submittingRef.current) return;
  // (existing no-rating early return stays here, before any token logic)
  submittingRef.current = true;
  setLoading(true); setError(null); setAuthExpired(false);
  let outcome: SubmitOutcome | null = null; // null = network failure
  try {
    // ...formData exactly as today (lines 244-298)...
    const response = await fetch('/api/reviews', { method: 'POST', body: formData });
    const body: ReviewSubmitResponse | null = await response.json().catch(() => null);
    outcome = submitOutcome(response.status, response.ok, body);
  } catch { outcome = null; }

  if (outcome?.kind === 'navigate') { browserNav.go(outcome.url); return; } // keep loading + submittingRef: no second press while leaving
  if (outcome?.kind === 'submitted') { setSubmittedNoLink(true); return; }  // the review exists: no reset, no re-enable
  if (outcome?.kind === 'auth-expired') setAuthExpired(true);
  else setError(outcome?.kind === 'error' ? outcome.message : SUBMIT_NETWORK_COPY);
  // The token went out with that POST and is spent. The ConfirmStep callback only stores tokens,
  // so resetting here is the RecordCorrectionForm shape and cannot loop (AGENTS.md Traps).
  // Clear first, then reset, so the fresh token the reset produces is never overwritten.
  if (needsFreshToken(outcome)) { setTurnstileToken(null); setTurnstileResetSignal((n) => n + 1); }
  setLoading(false);
  submittingRef.current = false;
  ```

- When `submittedNoLink`, render in place of the step content: `<div role="status" className="bg-teal-50 border border-teal-200 rounded-[6px] p-6 text-teal-800">{SUBMITTED_NO_LINK_COPY} <a href="/profile" className="underline font-medium">Go to your profile</a></div>`. `/profile` lists the user's reviews with status badges (`ReviewListItem.tsx:17-31`).
- Pass `turnstileResetSignal` and `authExpired` to ConfirmStep (line 399).

**Tests**
- **New `src/lib/__tests__/reviewSubmitOutcome.test.ts`** (table):

  | Input | Outcome |
  |---|---|
  | 200 `{buildingSlug:'45-melnea-cass-blvd', reviewId:'r1'}` | navigate to `/building/45-melnea-cass-blvd?submitted=true&reviewId=r1` |
  | 200 `{}` | submitted |
  | 200 with null body (json rejected) | submitted |
  | 200 `{buildingSlug:'../x', reviewId:'r1'}` | submitted |
  | 200 `{buildingSlug:'a', reviewId:''}` | submitted |
  | 401 | auth-expired |
  | 400 `{error:'Bot verification failed. Please try again.'}` | error with that message |
  | 500 `{}` | error, `Failed to submit review` |
  | 429 `{error:123}` | error, default copy |

  `needsFreshToken` is true for auth-expired, error and null, and false for navigate and submitted.
- **New `src/lib/__tests__/reviewFormConfirmStep.test.tsx`**, using a small harness component in the test file that holds the token state and reset signal. Remove every Turnstile `<script>` from `document` in `afterEach`.
  - Calling `options.callback` three times never calls `onSubmit`.
  - With no token and the box checked, the waiting line is visible.
  - **Timeout, no script in the DOM** (fake timers, no `window.turnstile`): advancing 10 s shows `LOAD_FAILED` and Try again. Pressing it appends exactly one `script[data-rmp-turnstile-retry]`. Advancing another 10 s and pressing Try again again still leaves one (it is pending). Then install a stub and advance 100 ms: `render` is called once and the message is gone.
  - **Timeout with a pending original tag:** add `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit">` to `document.head` first. Pressing Try again appends **no** script and polls again.
  - **A failed retry script removes itself:** after Try again, dispatch `new Event('error')` on the retry script. It is gone, and the next Try again appends a new one.
  - Bumping the signal to 1 calls `reset('widget-1')` once; re-rendering with the same signal does nothing more.
  - Remounting with signal 2 renders again and does not reset.
  - With the script arriving late, unmounting calls `remove('widget-1')` and `onTurnstileToken(null)`.
  - With `authExpired`, the link has href `/auth/signin`, `target="_blank"` and `rel` containing `noopener`.
- **New `src/lib/__tests__/reviewFormSubmitRetry.test.tsx`:**
  - Render `<ReviewForm building={{ id: 'b1', address: '45 Melnea Cass Blvd', city: 'Boston' }} />` and `vi.spyOn(browserNav, 'go').mockImplementation(() => {})`.
  - Walk the steps: Continue, the first "4", Continue ×3, "Review & Submit", tick the box.
  - Turnstile stub: `render` calls `callback('tok-1')`; `reset` queues `callback('tok-N+1')`.
  - Cases:
    - **First POST returns 400 "Bot verification failed. Please try again."** The error is shown, `reset` is called once with `'widget-1'`, and Submit is re-enabled. A second POST answering 429 sends `cf-turnstile-response` `'tok-2'`, and `reset` has been called twice. Fetch is called exactly twice; there is never a POST without a press.
    - **Answers survive the failure:** the summary still reads "Unit ratings: 1/10".
    - **401:** the sign-in link shows and `reset` is called.
    - **Fetch rejects:** `SUBMIT_NETWORK_COPY` is shown and `reset` is called.
    - **Non-OK whose `json()` rejects:** "Failed to submit review" is shown and `reset` is called.
    - **200 whose `json()` rejects, and separately a 200 `{ success: true }` with no slug:** the `SUBMITTED_NO_LINK_COPY` panel shows with a `/profile` link. `browserNav.go` is **not** called (no `/building/undefined`), `reset` is **not** called, and fetch is called once.
    - **Success:** `go('/building/45-melnea-cass-blvd?submitted=true&reviewId=r1')`. The button still reads "Submitting..." and is disabled, and `reset` is not called.
    - **Double press:** make the first fetch a pending promise, press Submit twice, and fetch is called once.
    - **No ratings:** the rating message shows; fetch and `reset` are not called.
- **Extend `reviewNewPage.test.ts`:** the HTML contains `data-rmp-turnstile-guard`, and its index is lower than the index of `turnstile/v0/api.js?render=explicit`.

### Step 9: e2e (yes, extend `review.spec.ts`)

Today it covers only `?building=` paths, and none of the address-step click, the sign-in return, the handoff, retry or the island-props check.

**`e2e/test-harness.ts`**
- Export `TURNSTILE_SCRIPT` (the regex at line 14) so specs can unroute it.
- **Turnstile stub:**
  - Keep the callbacks in a `Map` keyed by widget id.
  - `reset(id)`: increment `window.__e2eTurnstileResets` and `queueMicrotask(() => callbacks.get(id)?.(token))`. This mirrors real non-interactive behaviour.
  - `remove(id)`: delete the entry.
  - `reset()` with no id only counts, as today. This is safe: every callback in the repo either stores a token or is gated on a press, and the no-id `reset()` calls in `bug-report.astro` and `forgot-password.astro` keep today's behaviour.

**New `test.describe('Review form funnel')` in `e2e/review.spec.ts`:**

0. **No admin fields in the review form HTML** (`authedPage`):
   - `executeLocalD1("UPDATE buildings SET admin_notes = 'SENTINEL-E2E-NOTE', owner_name = 'SENTINEL-E2E-OWNER', google_place_id = 'e2e-place-30' WHERE id = 'building-30'")`.
   - `(await authedPage.request.get('/review/new?building=building-30')).text()` contains neither sentinel nor `admin_notes`.
   - `authedPage.request.get('/review/new?placeId=e2e-place-30', { maxRedirects: 0 })` gives 302 with Location `/review/new?building=building-30`.
   - In `afterAll`, set `admin_notes = NULL, owner_name = NULL` again (keep the place id for test 5).
1. **An "Existing properties" row opens the building at unit details** (`authedPage`):
   - Open `/review/new`.
   - Fill the "Start typing your address..." input with `45 Melnea`.
   - Expect "Existing properties", then click the `/45 Melnea Cass Blvd/` button.
   - `waitForURL(/\/review\/new\?building=building-30$/)`; the bedrooms select and the address are visible.
2. **Password sign-in returns to the form** (`page`):
   - `clearRateLimits()` first (sign-in allows 5 per 15 min).
   - Open `/review/new?building=building-30`, which lands on `/auth/signin?redirect=`.
   - Sign in as the seed user, then `waitForURL(/\/review\/new\?building=building-30$/)`.
3. **Sign-up returns to the form:**
   - `clearRateLimits()` first (sign-up allows 3 per hour, and `auth.spec` already uses 3).
   - From that sign-in page, click `main a[href^="/auth/signup?redirect="]`.
   - Sign up with a unique email, then wait for the same URL.
4. **Off-site and dot-segment redirects are ignored:**
   - (a) `authedPage` loops over `['//evil.example/', '/.//evil.example', '/..//evil.example', '/a/..//evil.example', '/x/../..//evil.example', '/%2e//evil.example', '/%2e%2e//evil.example', '/%2e/%2e//evil.example', '/%2F%2Fevil.example', '/\\evil.example', 'https://evil.example']`. For each, `goto('/auth/signin?redirect=' + encodeURIComponent(v))` ends with origin `http://localhost:8788` and path `/` (server-side `Astro.redirect`).
   - (b) Signed-out `page`, same list: `form` `data-redirect` is `/` and the Google link href is exactly `/api/auth/google`.
   - (c) `clearRateLimits()`, open `/auth/signin?redirect=%2F.%2F%2Fevil.example` and sign in. The final origin is `http://localhost:8788` and the path is `/` (client-side path).
5. **A handoff for a known place id redirects and writes nothing:**
   - Count buildings (the place id was set in test 0; set it again if test 5 runs alone).
   - Open `/review/new?placeId=e2e-place-30`, then `waitForURL(/\/review\/new\?building=building-30$/)`.
   - Unit details with "45 Melnea Cass Blvd" is shown; the count is unchanged.
6. **An unresolvable handoff writes nothing:**
   - Count, then open `/review/new?placeId=ChIJe2eNoSuchPlace0000000`. There is no Places key locally, so expect `/search for (your address|it) below/i` with the search input visible.
   - Then open `/review/new?placeId=..%2F..%2Fx` and expect "could not look up that address".
   - The count is unchanged.
7. **A failed submit is retried without losing answers:**
   - `clearRateLimits()` first: review-submit allows 10/hour per user, and `critical-flows` plus `review.spec` already spend about 6-7 on the seed user.
   - `authedPage.route('**/api/reviews', ...)` answers the first POST with 500 `{ error: 'Failed to submit review' }` and lets later requests continue.
   - Walk the form, rating all 10 unit items, and press Submit.
   - The error is visible, `__e2eTurnstileResets === 1`, Submit is enabled, and "10/10" still shows.
   - Press Submit again: `waitForURL(/\/building\/45-melnea-cass-blvd/)`, with 2 POSTs in total.
8. **Turnstile load failure, then Try again** (`authedPage`, `test.setTimeout(60_000)`):
   - `await authedPage.unroute(TURNSTILE_SCRIPT); await authedPage.route(TURNSTILE_SCRIPT, (r) => r.abort());`
   - Walk to the confirm step and tick the box. Within 12 s, the "didn't load" text and Try again are visible.
   - `script[src*="turnstile/v0/api.js"]` has count 0 (the guard removed the failed tag).
   - `await authedPage.unroute(TURNSTILE_SCRIPT); await installTurnstileStub(authedPage);`
   - Click Try again: Submit becomes enabled, and `script[src*="turnstile/v0/api.js"]` has count 1. Do not submit.

Use `JSON.parse(executeLocalD1('SELECT COUNT(*) AS n FROM buildings'))[0].results[0].n` for counts. e2e cannot cover Google Places Details, Google OAuth or real Turnstile.

### Step 10: docs and comments

**Root `AGENTS.md` Traps:** add three bullets.
- *"`GET /review/new` never writes a `buildings` row."* The `?placeId=` handoff resolves read-only through `findExistingBuilding` (`src/lib/buildingResolve.ts`). It either 302s to the existing building (`?building=`) or pre-fills the address step, whose Continue POSTs. Before October 2026 it inserted on page load, with no address tier and no key columns, and 11 zero-review rows came from it. Island props on that page come only from `loadReviewFormBuilding`'s four columns.
- *"Sign-in return paths go through `safeRedirectPath` (`src/lib/authRedirect.ts`)."* This covers `?redirect=` on `/auth/signin` and `/auth/signup`, and the `oauth_return_to` cookie. Any other reader of a return path must use it, or it is an open redirect. A naive "resolve with `new URL` and take the pathname" turns `/.//evil.example` into `//evil.example`.
- *"React islands import only leaf modules from `src/lib`."* `reviewPaths`, `reviewSubmitOutcome` and `authRedirect` have no runtime imports, which `clientLeafModules.test.ts` enforces. Importing a server module such as `reviewHandoff` or `records/*` into an island ships its module-level code to every browser.

**`src/lib/AGENTS.md`:** reword the `dedupe.ts` bullet (lines 272-282). The tier order now lives in `buildingResolve.ts` `findExistingBuilding`, shared by `POST /api/buildings` and the handoff. `findBuildingByPlaceId` is the one spelling of tier 1.

**`src/components/HomeSearch.tsx`** (comment-only, critique minor): change 44-46 and 132-134 to say the handoff "opens the building at unit details when we already have it, otherwise the address step pre-filled for one Continue".

### Step 11: local gate

1. Run `npm run check` (0 errors), `npm test`, `npm run build` and `npm run e2e`.
2. **Bundle check:** after the build, `grep -l "st_num_lo\|places.googleapis.com\|google_place_id = ?" dist/_astro/*.js` must print nothing (it prints nothing on `main` today).
3. Open the PR. Commit prefixes are `fix:`, `refactor:` and `docs:`.
4. The PR text must include:
   - nothing about which columns Step 0 stopped sending (owner decision, 2026-10-26);
   - the item-4 dependency for goal (c);
   - that `?redirect=/profile` from `profile.astro` is now honoured, and that the edit page now returns to itself.

---

## 3. What NOT to change

- **Response envelopes** of `GET`/`POST /api/buildings` (`{ building, created }`), `/api/places/details` (`{ place }`), `/api/search/autocomplete` (`{ results }`) and `POST /api/reviews` (`{ success, reviewId, buildingSlug }`). They are legacy shapes with live consumers; envelope migration is separate.
- **The stamping in POST** (COALESCE, the "only when missing" guard, `updated_at` bumped only on a real stamp). It moves; it does not change.
- **`GET /api/buildings?placeId`.** It stays place-id-only (see follow-ups).
- **`dedupe.ts` logic and the `identity.ts` suffix table.** Item 4 owns `WY`/`HW`/etc. Do not add `WY` here.
- **`src/pages/api/reviews.ts`.** Item 2 adds the new-review alert there; all of (d) is client-side.
- **The `oauth_state` cookie, its value and its comparison.** No new OAuth provider, so the CSRF re-audit is not triggered.
- **Turnstile:** the sitekey, the `?render=explicit` script tag in `new.astro` (kept, with the guard inserted before it), and the rule that the review widget's callback never submits.
- **`HomeSearch.tsx` behaviour.** Only the two comments change. The handoff URL stays `/review/new?placeId=`. Header and footer sign-in links stay as they are.
- **Slugs.** Never regenerate them. Seeded rows' `updated_at` is never touched by the data step.
- **The `Astro.locals.runtime.env` access in pages.** It is typed and already the page convention.
- **No sessionStorage drafts.** No scoring, survey item or methodology changes.

---

## 4. Production data: the two duplicates (owner decides; recommendation is MERGE)

Neither option should run without the owner's yes. Run it only **after** the main PR is deployed, so the old GET handoff cannot re-create a row in between.

The SQL below uses placeholders (`<crawford-dup-id>`, `<appian-dup-id>`, `<crawford-place-id>`, `<appian-place-id>`, `<admin-id>`). Run it from the lead's unredacted copy, where they are filled in.

**Why merge.** Deleting alone is fine for Crawford, because the address tier finds 86-88. For Appian it is not: until item 4 lands, a later Google pick of "9 Appian Way" misses the place-id and address-key tiers, and POST inserts a fresh row. Moving the place id onto the seeded parcel lets the place-id tier catch it today.

**Confirm-first SELECTs.** Run each with `npx wrangler d1 execute ratemyplace-db --remote --json --command "..."`:

```sql
-- A. Expect 4 rows: the two dups (source='user', street_key NULL, the two place ids) and the two seeds (google_place_id NULL). Record the seeds' updated_at (1788983774 / 1788983965 on 2026-10-26).
SELECT id, address, slug, city, zip_code, source, google_place_id, street_key, st_num_lo, st_num_hi, parcel_id, created_at, updated_at FROM buildings WHERE id IN ('<crawford-dup-id>','seed-1202188000','<appian-dup-id>','seed-2201144001');
-- B. Every count must be 0, and landlord_id/property_manager_id NULL.
SELECT b.id, (SELECT COUNT(*) FROM reviews WHERE building_id=b.id) AS reviews, (SELECT COUNT(*) FROM saved_buildings WHERE building_id=b.id) AS saves, (SELECT COUNT(*) FROM record_pulls WHERE building_id=b.id) AS pulls, (SELECT COUNT(*) FROM building_records WHERE building_id=b.id) AS records, (SELECT COUNT(*) FROM record_corrections WHERE building_id=b.id) AS corrections, (SELECT COUNT(*) FROM records_queue WHERE building_id=b.id) AS queue, b.landlord_id, b.property_manager_id FROM buildings b WHERE b.id IN ('<crawford-dup-id>','<appian-dup-id>');
-- C. Expect exactly the two dup rows (idx_buildings_place_id is a partial UNIQUE index).
SELECT id, google_place_id FROM buildings WHERE google_place_id IN ('<crawford-place-id>','<appian-place-id>');
-- D. The admin id to record as <admin-id>: any row this returns.
SELECT id, email FROM users WHERE is_admin = 1;
```

**Option 1: MERGE (recommended).**
1. Save the SQL below to a file outside the repo (the session scratchpad), never in `migrations/`.
2. Run it with `npx wrangler d1 execute ratemyplace-db --remote --file <path>`.

Every statement is guarded, so a partial run is safe to re-run. The block shown is for Crawford; repeat it for Appian with `<appian-dup-id>`, `seed-2201144001` and `<appian-place-id>` (spelled out in `data_ops`).

```sql
INSERT INTO audit_logs (admin_user_id, admin_ip, action_type, entity_type, entity_id, old_value, new_value, notes)
SELECT '<admin-id>', 'wrangler-cli', 'building_deleted', 'building', b.id,
  json_object('id',b.id,'address',b.address,'slug',b.slug,'city',b.city,'zip_code',b.zip_code,'google_place_id',b.google_place_id,'latitude',b.latitude,'longitude',b.longitude,'source',b.source,'created_at',b.created_at),
  json_object('merged_into','seed-1202188000','moved_google_place_id',b.google_place_id),
  'Hand merge (fix/review-funnel): duplicate made by the /review/new?placeId handoff before it deduped; place id moved to the seeded parcel.'
FROM buildings b
WHERE b.id = '<crawford-dup-id>' AND b.source = 'user'
  AND NOT EXISTS (SELECT 1 FROM reviews WHERE building_id = b.id)
  AND NOT EXISTS (SELECT 1 FROM saved_buildings WHERE building_id = b.id)
  AND NOT EXISTS (SELECT 1 FROM record_pulls WHERE building_id = b.id)
  AND NOT EXISTS (SELECT 1 FROM building_records WHERE building_id = b.id)
  AND NOT EXISTS (SELECT 1 FROM record_corrections WHERE building_id = b.id)
  AND NOT EXISTS (SELECT 1 FROM records_queue WHERE building_id = b.id)
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE action_type = 'building_deleted' AND entity_id = b.id);
DELETE FROM buildings
WHERE id = '<crawford-dup-id>' AND source = 'user'
  AND NOT EXISTS (SELECT 1 FROM reviews WHERE building_id = '<crawford-dup-id>')
  AND NOT EXISTS (SELECT 1 FROM saved_buildings WHERE building_id = '<crawford-dup-id>')
  AND NOT EXISTS (SELECT 1 FROM record_pulls WHERE building_id = '<crawford-dup-id>')
  AND NOT EXISTS (SELECT 1 FROM building_records WHERE building_id = '<crawford-dup-id>')
  AND NOT EXISTS (SELECT 1 FROM record_corrections WHERE building_id = '<crawford-dup-id>')
  AND NOT EXISTS (SELECT 1 FROM records_queue WHERE building_id = '<crawford-dup-id>');
-- updated_at deliberately untouched: a place id changes nothing on the page, and updated_at feeds sitemap lastmod.
UPDATE buildings SET google_place_id = '<crawford-place-id>'
WHERE id = 'seed-1202188000' AND google_place_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM buildings WHERE google_place_id = '<crawford-place-id>');
```

`admin_ip` is NOT NULL. `'wrangler-cli'` is a sentinel rather than an IP, so it does not widen IP storage. Any admin id from SELECT D will do; the owner picks.

**Option 2: DELETE only.** Run the INSERT and DELETE pairs with **per-row** `new_value`s and `notes`, and skip both UPDATEs:
- Crawford: `json_object('reason','duplicate of seed-1202188000; no dependents')`.
- Appian: `json_object('reason','duplicate of seed-2201144001; no dependents')`.
- `notes`: `'Hand delete (fix/review-funnel): duplicate made by the /review/new?placeId handoff before it deduped.'`

The cost: "9 Appian Way" can be re-created until item 4 merges.

**Post-checks.**

```sql
-- MERGE: expect 2 rows (the seeds) carrying the place ids, updated_at equal to SELECT A's values. DELETE-only: the seeds with google_place_id NULL.
SELECT id, google_place_id, updated_at FROM buildings WHERE id IN ('<crawford-dup-id>','<appian-dup-id>','seed-1202188000','seed-2201144001');
-- expect 2 rows
SELECT id, action_type, entity_id, new_value FROM audit_logs WHERE entity_id IN ('<crawford-dup-id>','<appian-dup-id>');
```

Then check with `curl -s -o /dev/null -w '%{http_code}' https://ratemyplace.org/building/<slug>` that each duplicate's slug (from SELECT A) returns 404 and `/building/86-88-crawford-street-boston` returns 200. The deleted slugs were never in the sitemap: no parcel and no approved review.

**Not in this branch (owner):** the other 9 handoff rows.
- The 6 outside Boston and New Haven are exactly what the audited "Delete orphan buildings" button in `/admin/buildings` removes.
- The 3 New Haven zero-review rows are a keep-or-delete call. None is a confirmed duplicate of a reviewed row.

---

## 5. Deploy and production verification

Merging to `main` auto-deploys the site. The records Worker is unaffected.

**Step 0 hotfix**, after its merge:
1. `curl -s https://ratemyplace.org/api/health` shows the merge SHA.
2. Run `npm run smoke -- --environment production --base-url https://ratemyplace.org --expected-release <40-char sha>`.
3. **Owner, signed in:** view-source of `https://ratemyplace.org/review/new?building=<id>` for a building with admin-only fields filled in (the id is in the lead's copy). The island props carry only `id`, `address`, `neighborhood` and `city`.

**Main PR**, after its merge:
1. **Release and smoke.** Run the same health and smoke checks with the new SHA.
2. **The signed-out redirect is unchanged.** Run `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' 'https://ratemyplace.org/review/new?placeId=ChIJNx18GtF744kR6W7CM_iVm58'`. Expect 302 to `/auth/signin?redirect=%2Freview%2Fnew%3FplaceId%3DChIJ…`.
3. **The sign-in page carries the path.** Run `curl -s 'https://ratemyplace.org/auth/signin?redirect=%2Freview%2Fnew%3Fbuilding%3Dseed-1202188000' | grep -o 'data-redirect="[^"]*"\|href="/api/auth/google[^"]*"\|href="/auth/signup[^"]*"'`. All three carry the path.
4. **Hostile paths are dropped.** Repeat step 3 with each of `redirect=%2F%2Fevil.example`, `redirect=%2F.%2F%2Fevil.example`, `redirect=%2F%2e%2e%2F%2Fevil.example` and `redirect=%2Fa%2F..%2F%2Fevil.example`. Each must show `data-redirect="/"`, a bare Google href and a bare sign-up href.
5. **OAuth start.** Run `curl -s -D - -o /dev/null 'https://ratemyplace.org/api/auth/google?redirect=%2Freview%2Fnew' | grep -i -E '^(location|set-cookie):'`. Expect:
   - a `set-cookie` for `oauth_return_to=%2Freview%2Fnew` that carries each of `Max-Age=600`, `Path=/api/auth/google`, `HttpOnly`, `Secure` and `SameSite=Lax`. Check each attribute, not the whole line: the order is the cookie serializer's. Astro 5.18 prints `oauth_return_to=%2Freview%2Fnew; Max-Age=600; Path=/api/auth/google; HttpOnly; Secure; SameSite=Lax`;
   - a Location at accounts.google.com with `redirect_uri=https%3A%2F%2Fratemyplace.org%2Fapi%2Fauth%2Fgoogle%2Fcallback`.

   With `redirect=%2F.%2F%2Fevil.example`, there is no `oauth_return_to` set-cookie, or only a deleting one (`oauth_return_to=deleted; Path=/api/auth/google; Expires=Thu, 01 Jan 1970 00:00:00 GMT`).
6. **OAuth callback error branch.** Run `curl -s -D - -o /dev/null -H 'Cookie: oauth_return_to=%2Freview%2Fnew' 'https://ratemyplace.org/api/auth/google/callback?error=access_denied' | grep -i '^location'`. Expect `/auth/signin?error=oauth_denied&redirect=%2Freview%2Fnew`. With `Cookie: oauth_return_to=%2F.%2F%2Fevil.example`, expect exactly `/auth/signin?error=oauth_denied`.
7. **Run the section 4 data step if the owner approved it.** Note the baseline `SELECT COUNT(*) FROM buildings WHERE source='user'`.
8. **Owner, in a real browser** (Claude must not complete Turnstile or sign in):
   - a) Signed out, on the homepage, type "86 Crawford Street" and pick the Google row. Sign in with a password. You land on `/review/new?building=seed-1202188000&partOf=1` at unit details, with the teal note naming 86-88 Crawford Street. Leave the page. The user-row count is unchanged.
   - b) On `/review/new`, type "86-88 Crawford" and click the "Existing properties" row. You reach `/review/new?building=seed-1202188000` at unit details.
   - c) Sign out, open `/review/new?building=seed-1202188000`, and choose Continue with Google. You land back on that URL. Google OAuth has been flaky on production; if it fails, record the `?error=` code (the redirect should still be on it).
   - d) **Retry, without creating a review:**
     1. Walk to Submit on any building.
     2. In DevTools → Network, block the request URL `/api/reviews` and press Submit.
     3. The error banner shows, the widget re-challenges, and Submit re-enables with the answers intact.
     4. **Stop there:** unblock and navigate away without pressing Submit.

     The successful second submit is covered by e2e test 7. A real submit would create a review row and, once item 2 ships, an alert email.
   - e) Block `challenges.cloudflare.com` and reload a review form. Walk to the confirm step: after about 10 s, the "didn't load" line and Try again appear. Unblock and press Try again; the widget renders. In DevTools → Elements, there is exactly one `api.js` script tag.
9. **Over the following days**, run `SELECT id, address, city, street_key, google_place_id, datetime(created_at,'unixepoch') FROM buildings WHERE source='user' AND created_at >= <deploy unixepoch> ORDER BY created_at`. Every numbered address should have a `street_key`. A row with a place id and NULL `street_key` means something still inserts on a GET. A keyed row that duplicates an odd-suffix seed is the item-4 gap.

## 6. What preview deploys cannot exercise

- **Turnstile:** the sitekey is not allowlisted for `pages.dev`.
- **The map.**
- **Google Places:** there is no key on preview, so the handoff shows "temporarily unavailable"; that is expected.
- **Google OAuth:** the preview origin is not a registered `redirect_uri`.

Treat preview as writing to production D1 (single top-level binding): do not sign up, add buildings or submit on a preview.

Preview is good for the curl checks in section 5 (main PR, steps 2-6) against the preview origin, and for `npm run smoke -- --environment preview`. For step 5 on preview, expect **either** a Google Location (if `GOOGLE_CLIENT_ID` is set for preview) **or** `/auth/signin?error=oauth_not_configured&redirect=%2Freview%2Fnew` with no `oauth_return_to` cookie. Both prove the path is carried. The Pages preview secrets could not be listed with the current token.

## 7. Cross-branch notes and merge order

**Recommended order:**
1. Step 0 hotfix (`fix/review-form-select`).
2. Item 4 (`fix/street-suffix-search`).
3. This branch (`fix/review-funnel`), the same day as item 4 or after it.

This branch can ship without item 4, but its PR must then say that goal (c) is complete only for suffixes in `SUFFIX_SPELLINGS`.

- **Item 4** changes `SUFFIX_SPELLINGS`, which `addressKey` uses. Once it adds `['WY','WAY']` (assessor spelling first), "9 Appian Way" keys to `APPIAN WY` and resolves to `seed-2201144001` through the address tier. The pinned gap test in `buildingResolve.test.ts` must be flipped by whichever branch merges second. The other tests here use ST streets and `W BROADWAY`, which item 4 does not re-key (its analysis shows only `NEPONSET FIELD LN` changing).
- **Item 2 (`fix/admin-alerts`)** edits `src/pages/api/reviews.ts` and `lib/email.ts`; this branch touches neither. Production check 8d deliberately avoids creating a review, so it fires no alert.
- **Item 3 (`fix/link-previews-seo`)** may add `noindex` or canonical props to `BaseLayout` in `new.astro`, `signin.astro` and `signup.astro`. Expect a trivial rebase conflict on the `<BaseLayout>` line.
- **Item 5 (Astro 7)** may need the AstroContainer tests adjusted (`reviewNewPage`, `authRedirectPages`), because the container API is experimental. It also triggers the CSRF re-audit, which should re-check the `oauth_return_to` cookie.

## 8. Follow-ups deliberately left out

- `GET /api/buildings?placeId` (the in-form Google path) still checks only the place id. For a seeded parcel the card says "This will be a new building", though Continue then lands on the right page. A read-only address tier there would fix the copy.
- **Pre-existing:** `findExistingBuilding` skips the exact `(address, city)` tier whenever a place id is present. A New Haven or other non-Boston manual-entry row can still be duplicated by a later Google pick of the same address through confirm → POST. A fix is a non-Boston address tier that also runs with a place id; it changes POST behaviour, so it gets its own branch.
- `/auth/signin` does not display `?error=` codes.
- Header sign-in links do not carry the current page.
- The "Existing properties" LIKE search misses a single number inside a range: "86 Crawford Street" does not match "86-88 Crawford Street". That belongs to search (item 4 territory).
- CSP tightening (deferred) must account for the new `data-rmp-turnstile-guard` inline script; move it into a hashed or external script then.
- Normalizing the response envelopes.