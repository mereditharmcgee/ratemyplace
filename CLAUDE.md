# RateMyPlace Boston

**Read [`AGENTS.md`](AGENTS.md) first.** It is the canonical instruction file for this repo
— product context, non-negotiables, stack, commands, conventions, and traps.

This file used to be a full duplicate of `AGENTS.md`. The two drifted (a stale `getDB`
sample survived in both), so conventions now live in one place. Only Claude Code specifics
remain here.

## Nested guides

Directory-specific rules that override the root file where they overlap:

- [`src/lib/AGENTS.md`](src/lib/AGENTS.md) — scoring, survey items, validation
- [`src/components/AGENTS.md`](src/components/AGENTS.md) — Astro vs React, brand tokens
- [`migrations/AGENTS.md`](migrations/AGENTS.md) — schema changes, production migration trap

Read the nested guide for whatever directory you are working in. API route rules are in
root `AGENTS.md` — a nested guide there would be served as a public page, since Astro
routes any `.md` inside `src/pages/`.

## Claude Code specifics

- **`/qa`** runs the pre-deploy QA checklist as a skill (`.claude/commands/qa.md`). Other
  agents run the checklist in `AGENTS.md` manually.
- **`.planning/`** is a GSD milestone system — `/gsd:progress` to re-sync state,
  `/gsd:new-milestone` to scope the next one. `STATE.md` is accurate through April 2026
  only; work has shipped since outside the framework.
- **Browser preview** cannot exercise Turnstile or the map (sitekey not allowlisted for
  `pages.dev`, no Maps key in preview). Verify those on production.

## Before declaring work complete

```bash
npm test && npm run build
```

389 unit tests, ~13s. Both should be clean.
