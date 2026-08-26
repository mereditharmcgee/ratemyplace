# `src/lib/` — Business Logic

Everything in here is shared logic consumed by pages, API routes, and components.
Components must not contain business logic; it belongs here.

Rules: one concern per file, always export the interfaces consumers need, no `any` types.

---

## Scoring is load-bearing — read this before touching it

Scoring changes are **retroactive**. There is no score cache (the `*_scores` tables were
dropped in migration 0025); every score is computed on read. Change a weight and every
score on the site changes on the next page load, including scores users have already seen.

Never adjust scoring as a side effect of another change. It needs explicit sign-off.

### `scoring.ts`

- `UNIT_FIELDS` (10), `BUILDING_FIELDS` (9), `LANDLORD_FIELDS` (8) — the 27 scored items.
- `ITEM_WEIGHTS` — health/safety multipliers, each justified with a citation in the file.
  1.5× pests and mold · 1.3× structural and climate · 1.2× plumbing and security ·
  1.0× everything else.
- `RECENCY_BANDS` — age decay for aggregates. 1.0 for 0–2y, 0.95 at 3y, 0.90 at 4y,
  floor 0.85 beyond.
- Aggregation is a weighted arithmetic mean. Unrated reviews return `null`, **not 0.0** —
  returning 0 poisons aggregates, which was a real bug fixed in the August 2026 sweep.

### `RECENCY_BANDS` has two consumers and must not fork

`scoring-sql.ts` generates the SQL `CASE` expression from the same `RECENCY_BANDS` array
that the JS path uses, so list views and detail views cannot drift. There is a parity test
(`__tests__/scoring-sql-parity.test.ts`) that fails if they do.

If you change recency behavior, change the array — never hand-edit the generated SQL or
add a second copy of the bands.

### `scoring-colors.ts` is the only home for score bands

Four bands: Good 4.0–5.0, Mixed 3.0–3.9, Concerning 2.0–2.9, Poor 1.0–1.9.

Use the helpers — never hardcode a threshold or a color:

- `getScoreColor(score)` → `{ bg, text, label }` for filled badges and pills
- `getScoreTextColor(score)` → Tailwind class for a colored score number
- `getScoreBgTint(score)` → soft-tinted background for score detail tiles
- `getScoreHex(score)` / `SCORE_HEX` → hex for non-Tailwind contexts (Maps markers, OG images)

### `surveyItems.ts` is the canonical survey definition

32 items: 27 scored + 5 ancillary (`would_recommend`, `tenure_months`, `move_out_year`,
`accepts_housing_vouchers`, `safely_lit_at_night`). The ancillary five are **not scored**.

The docs describe the instrument; this file *is* the instrument. Where they disagree, this
file wins.

### Adding a survey item — all five steps or none

1. Add the column in a new migration (`migrations/XXXX_name.sql`)
2. Add the item to `surveyItems.ts` with help text (including what a 3 looks like)
3. Add the field to the right domain array in `scoring.ts`
4. Set its weight in `ITEM_WEIGHTS`
5. Update `components/reviews/ReviewForm.tsx` and `components/reviews/ReviewCard.astro`

Then update `src/pages/methodology.astro` — the published methodology must match the code.

---

## Other critical modules

### `runtime.ts` — the only way to reach the Cloudflare runtime

```typescript
import { getEnv, fireAndForget } from './runtime';

const apiKey = getEnv(context).RESEND_API_KEY;
```

`getEnv(context: APIContext)` throws a clear error outside Wrangler. **Never write
`(context.locals as any).runtime`** — v1.5.0 removed 89 such casts across the codebase.

`fireAndForget(context, promise)` registers work with `ctx.waitUntil` so the Worker isolate
stays alive after the response is sent, and swallows rejections into structured logs. An
unhandled rejection inside `waitUntil` crashes the isolate in production, so the internal
`.catch` is not optional. It returns `void` specifically so callers cannot `await` it.

Use it for every outbound email. One known holdout: `pages/api/disputes/[id].ts` still
blocks on `await sendDisputeUpheldEmail` — convert it if you are in that file.

### `privacy.ts` — fuzzing is a safety control

`formatRecency()` and the season/year formatters exist so exact tenancy dates never reach
a public surface. Do not add a display path that bypasses them, and do not "improve"
precision here — the imprecision is the point.

### `validation.ts` — use the shared primitives

`isValidEmail`, `isSafeHttpUrl`, `validateReviewText`, `enforceMaxLength`,
`escapeLikePattern`, `sanitizeText`, plus per-form validators (`validateReviewForm`,
`validateDisputeForm`, `validateBugReport`, `validateContactForm`, `validateSearch`).

`isSafeHttpUrl` exists because a `javascript:` URL in a bug report could take over an admin
session — that was a real finding. Any user-supplied URL that will be rendered as a link
must pass through it.

Known drift to fix if you are nearby: `pages/api/auth/signup.ts` uses an inline
`email.includes('@')` instead of `isValidEmail`, and `disputes.ts` exports a duplicate
`validateDisputeForm` consumed only by its own test (production imports the one here).

### `audit.ts` — every destructive admin action

```typescript
import { createAuditLog } from '../../lib/audit';

await createAuditLog(db, {
  adminUserId: context.locals.user.id,
  actionType: 'review_approved',
  entityType: 'review',
  entityId: reviewId,
  oldValue: { status: 'pending' },
  newValue: { status: 'approved' },
});
```

Best-effort by design — a logging failure must never break the action it is logging.
Admin grant/revoke went untracked until August 2026; do not let a new destructive action
ship without a log entry.

### `enrichment/` — municipal property data

Adapter pattern: `dispatcher.ts` routes to `adapters/boston.ts` (Boston Assessing, CKAN),
`adapters/new-haven.ts` (CT CAMA, Socrata), or `adapters/null.ts`. Adding a city means
adding an adapter, not branching the dispatcher's callers.

Enrichment is **human-in-the-loop**. Fetched data is surfaced to an admin for review and
is never auto-saved.

---

## Tests

Unit tests live in `__tests__/` alongside the modules. 389 tests, ~13s — run them.

```bash
npm test
npm test -- scoring
```

Scoring, validation, and privacy changes need test coverage. The SQL/JS parity test is a
guardrail, not a formality; if it fails, you have forked the scoring logic.
