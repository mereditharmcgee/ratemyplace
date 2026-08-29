# Dependency security plan

**Status:** Agreed. Canonical. Supersedes the Codex consensus brief (2026-08-28) and the
Claude independent review (2026-08-29) in full.
**Agreed:** 2026-08-29 by Codex and Claude after two reconciliation rounds.
**Implementation:** not started.

This is the single source of truth. Where an earlier document disagrees with this one,
this one wins. Do not work from the brief or the review.

---

## 1. Decision

| | |
|---|---|
| **Stage 1** | Compatible dependency refresh within Astro 5, plus a critical-severity CI audit gate |
| **Stage 2** | Astro 7.2.9 framework migration, with **7.1.0 as the absolute security floor** |
| **Migration guides** | Review **both** 5→6 and 6→7. One step across two majors is not one set of breaking changes. |
| **Re-audit scope** | CSRF, Cloudflare runtime and `waitUntil`, fail-closed rate limiting, audit logging |
| **Standing rule** | Remaining on the current Astro major is an operational security requirement |

**Rejected:** patching only Vitest and Resend (leaves avoidable work undone, retains audit
noise). **Rejected:** a single combined dependency-and-framework change (mixes low-risk
maintenance with a double-major migration).

**Considered and rejected during review:** stopping at Astro 6.4.6. Three advisories affect
6.4.6 with no backport (§4). Stopping there would cost a full major migration and a CSRF
re-audit and still leave the project on a line that cannot receive the fixes.

---

## 2. Risk assessment

**Maintenance risk. Not an active incident.**

The critical label is real at the package level. The exploit preconditions are absent from
the deployed application, and the strongest evidence is structural rather than
argumentative: **Vitest is `"dev": true` in `package-lock.json`** and never enters the
deployed Worker graph.

Every advisory examined is either dev-scoped, architecturally excluded, or gated on a
feature this codebase does not use. **Verified absent from source:** `astro:assets`,
`<Image>`, `<Picture>`, `define:vars`, dynamic slot names, `transition:*` directives,
`ViewTransitions` / `ClientRouter` imports, spread attributes in `.astro` files, and any
`image.domains` / `image.remotePatterns` configuration.

This justifies controlled remediation with release verification. It does not justify an
emergency unreviewed migration, and it does not justify indefinite deferral.

---

## 3. Verified state

Confirmed against `package-lock.json` at `origin/main`:

| Package | Version | Scope |
|---|---|---|
| astro | 5.16.11 | production |
| @astrojs/cloudflare | 12.6.13 | production |
| @astrojs/react | 3.6.3 (exact pin, no caret) | production |
| @astrojs/check | 0.9.6 | declared production, actually build-only |
| resend | 6.9.2 → `svix` 1.84.1 → `uuid` ^10.0.0 | production |
| vitest | 4.0.18 | **dev** |
| happy-dom | 20.5.1 | **dev** |
| react / react-dom | 18.3.1 | production |

Node pinned at 22.16.0 in `.node-version`, which satisfies Astro 7's 22.12 floor.
CI (`.github/workflows/ci.yml`) runs `npm ci` → `npm run check` → `npm test` →
`npm run build`. **No audit gate exists yet.**

---

## 4. Advisory evidence

All version ranges verified against the GitHub Advisory Database and the npm registry.

### Resolved by Stage 1

| Advisory | Package | Affected | Patched | Severity |
|---|---|---|---|---|
| GHSA-5xrq-8626-4rwp (CVE-2026-47429) | vitest | `>= 4.0.0, < 4.1.0` | 4.1.0 | Critical 9.8 |
| `uuid` chain via `svix` | resend | 6.9.2 | resend 6.25.0 drops `svix` for `standardwebhooks` | — |

The Vitest advisory requires `--api.host` / `api.host`, or Vitest UI / Browser Mode.
`vitest.config.ts` enables none of these. Note the Windows precondition applies to this
maintainer's environment, so a future `vitest --ui` would meet it. That is a
developer-workstation risk, and a better reason to patch than low cost.

### Requires Astro 6 — not fixed on the 5.x line

| Advisory | Affected | Patched | Severity | Why unreachable here |
|---|---|---|---|---|
| GHSA-2pvr-wf23-7pc7 (CVE-2026-54299) | `< 6.4.6` | 6.4.6 | High 7.5 | Advisory's own "Not affected" list names `@astrojs/cloudflare` (uses the ASSETS binding) |
| GHSA-8hv8-536x-4wqp (CVE-2026-50146) | `< 6.3.3` | 6.3.3 | High 7.1 | Requires attacker-controlled slot name on a `client:*` component; none exist |

### Requires Astro 7 — not fixed on the 6.x line

| Advisory | Affected | Patched | Severity | Why unreachable here |
|---|---|---|---|---|
| GHSA-f48w-9m4c-m7f5 (CVE-2026-59729) | `< 7.0.6` | 7.0.6 | Moderate 5.1 | Requires spread props on HTMLElement-subclass components; no spread attributes in `.astro` |
| GHSA-7pw4-f3q4-r2p2 (CVE-2026-59727) | `>= 3.10.0, < 7.0.4` | 7.0.4 | Low | Requires untrusted input in `transition:persist` / `scope` / `persist-props`; no transition directives |
| GHSA-4g3v-8h47-v7g6 (CVE-2026-73422) | `>= 2.9.0, <= 7.0.9` | **7.1.0** | Moderate 5.3 | Requires attacker-controlled View Transition animation values; no View Transitions in use |

**GHSA-4g3v affects 7.0.9 inclusive. Any 7.0.x is exposed. 7.1.0 is the floor; 7.2.9 is the target.**

### Not a driver

| Advisory | Affected | Patched | Severity | Status |
|---|---|---|---|---|
| GHSA-88gm-j2wx-58h6 (CVE-2026-41321) | @astrojs/cloudflare `< 13.1.10` | 13.1.10 | **Low 2.2** | Requires configured `image.domains` / `image.remotePatterns`, plus an open redirect on an allowlisted domain. No image config exists. Carries no scheduling weight. |

`@astrojs/cloudflare` 12.6.13 is the **last** 12.x release, and 13.1.10 peers `astro: ^6.0.0`.
There is no adapter-only patch available on Astro 5. Verified via `npm view`.

### The pattern

Across all six Astro-family advisories, **every fix landed on the then-current major and
none was backported.** This is why Astro 6 is not a valid intermediate, and why §7 makes
staying current an operational requirement rather than hygiene.

---

## 5. Stage 1 — compatible security refresh

Branch: `codex/dependency-security-refresh`. Do not use `npm audit fix --force`.

### 5.1 Dependency reclassification

**Precondition, blocking:** confirm the Cloudflare Pages build installs devDependencies.
CI uses plain `npm ci` (which does), but the Pages build configuration is not visible in
the repository. If Pages skips dev dependencies, **do not make this change** — record why
and move on.

Once confirmed, move these six from `dependencies` to `devDependencies`. None ships in the
Worker:

`@astrojs/check` · `typescript` · `@types/react` · `@types/react-dom` ·
`@tailwindcss/vite` · `tailwindcss`

**Why it matters:** while build tooling is declared as production, `npm audit --omit=dev`
reports on packages that are not in production — which is why that figure (27) is nearly
identical to the full-graph figure (29) and currently means nothing. §5.4's gate design
depends on fixing this.

### 5.2 Version updates

| Package | To | Note |
|---|---|---|
| vitest | 4.1.x | Clears the critical advisory |
| resend | 6.25.0 | Drops `svix`/`uuid`. Satisfies existing `^6.9.2`, so a lockfile refresh alone reaches it |
| happy-dom | 20.11.x | |
| @astrojs/check | 0.9.10 | |
| astro | 5.18.2 | **Hygiene, not remediation.** See below |

**Do not add** `@astrojs/cloudflare` or `@astrojs/react`. Both belong to Stage 2.

**The Astro 5.18.2 bump must not be described as addressing the Astro advisories.** It does
not, and cannot — no 5.x fix exists. Keep it for bug fixes and to reduce drift before the
major migration, and say so plainly in the branch summary.

### 5.3 package.json and lockfile

Change **both**. A lockfile-only refresh reaches Resend 6.25.0 but leaves the declared
floor at a known-vulnerable version, so a future resolution could legitimately go
backwards. Reproducibility comes from committing the lockfile; *intent* comes from the
declared range.

Review the lockfile diff line by line. Do not accept an opaque forced rewrite.

### 5.4 CI audit gate

Add to `.github/workflows/ci.yml`:

```
npm audit --audit-level=critical
```

**Full graph, critical only.** This is the correct first ratchet because critical is at
zero after Stage 1, so it can never require an exception and therefore cannot normalize
one.

- **Not `--omit=dev`** until §5.1 lands. Before that, the production graph is not the
  production graph.
- **Not `high`.** It would fail on day one against the permanent Astro findings, and a gate
  that always fails is a gate that gets bypassed permanently.
- **Sequence:** critical gate now → reclassification → reconsider a
  `--omit=dev --audit-level=high` gate after Stage 2.
- If an allowlist ever becomes necessary, require an expiry date per entry and fail the
  build when it passes. Exceptions must not become permanent through inattention.

### 5.5 Dependabot

Two independent mechanisms, configured in two different places. GitHub's documentation is
explicit: *"There is no interaction between the settings specified in the `dependabot.yml`
file and Dependabot security alerts."*

| | Configured | Trigger | Setting |
|---|---|---|---|
| **Security updates** | Repository Settings → Code security | **Advisory publication.** Not scheduled. | Enable. No cadence to choose. |
| **Version updates** | `.github/dependabot.yml` | `schedule.interval` | **Monthly, grouped.** |

Enable security updates. Configure version updates monthly and grouped.

Weekly ungrouped version updates on a single-maintainer repository produce more pull
requests than one person will review, and unreviewed dependency PRs are worse than none:
they train the maintainer to merge without reading, which is the exact failure this work
exists to prevent.

### 5.6 Evidence required before merge

1. Clean install from the committed lockfile
2. `npm run check`
3. Full Vitest suite
4. Production build
5. Full local Playwright suite (build and runtime libraries changed)
6. Before/after audit output and a reviewed lockfile diff
7. Production-graph audit recorded **separately**, after reclassification
8. Immutable preview smoke tied to the exact branch SHA
9. Separate user approval before merge
10. Post-merge exact-SHA production smoke and custom-domain verification

### 5.7 Rollback criteria

Revert the branch rather than patching forward if any of:

- `npm run check` fails for anything beyond a trivial reviewed type-import change
- A Vitest failure that is not an obvious, reviewed test-framework API change
- Any new build error
- Any Playwright regression in auth, session, or moderation
- Preview smoke fails at the exact branch SHA
- Any lockfile change that cannot be explained

`main` auto-deploys, so post-merge rollback is `git revert` plus a re-verified deploy,
never a force-push.

---

## 6. Stage 2 — Astro 7 migration

Separate branch, separate review. Do not begin until Stage 1 is merged and verified.

### 6.1 Target

| Package | Target |
|---|---|
| astro | **7.2.9** (floor: 7.1.0 — see §4) |
| @astrojs/cloudflare | 14.2.5 |
| @astrojs/react | 6.0.4 (supports React 18) |
| @cloudflare/workers-types | 5.x |
| react / react-dom | stay at 18.3.1 |

Node 22.16.0 already satisfies the 22.12 floor.

Review **both** the 5→6 and 6→7 migration guides. A single step across two majors carries
two majors' worth of breaking changes.

### 6.2 Required audit

One comprehensive pass covering both majors' changes.

**CSRF** (required by `AGENTS.md` on any Astro major; baseline is
`.planning/audits/csrf-2026-04.md`): `security.checkOrigin` behavior, authenticated and
unauthenticated POST paths, the `application/json` gap on `/api/disputes`, middleware and
session cookie attributes (`SameSite=Lax`).

**Runtime and bindings:** Cloudflare bindings (`DB`, `VERIFICATION_BUCKET`), SSR output,
image endpoint exposure, error behavior.

**Three checks that no type check or build will catch:**

1. **`getEnv` / `fireAndForget`.** `src/lib/runtime.ts` depends on
   `context.locals.runtime` and `ctx.waitUntil`. An adapter major is the likeliest place
   for that shape to change, and a silent `waitUntil` regression breaks outbound email with
   no test failure and no user-visible error.
2. **Rate limiter fail-closed.** Confirm a limiter DB error still yields 503 and not an
   open pass.
3. **Audit-log writes.** Confirm they still succeed, given migration 0028 only recently
   repaired the CHECK constraints.

### 6.3 Verification

Full pre-deploy QA checklist (`AGENTS.md`) — this is exactly the change class it exists
for. Turnstile and the map cannot be exercised on preview and must be verified on
production after deploy.

Any source or configuration change required by Astro 7 is a functional change and gets
reviewed as one. It does not ride along inside the package update.

---

## 7. Standing rules

Adopted as outcomes of this review.

1. **Stay on the current Astro major.** Every advisory examined was fixed only on the
   then-current major; none was backported. Falling a major behind means accumulating
   unfixable findings.
2. **Never adopt a change because it lowers an `npm audit` count.** Justify by
   reachability, supported upgrade path, or reproducibility.
3. **Record architectural mitigations as conditions being relied upon.** Several advisories
   are neutralized by what this codebase does not do — no View Transitions, no
   `astro:assets`, no dynamic slot names, no remote image allowlist, the Cloudflare
   adapter's ASSETS binding. If any of those changes, the risk changes that day. A future
   `<ClientRouter />` import is a security event, not a feature.
4. **Distinguish remediation from hygiene in every branch summary.** A version bump that
   fixes nothing must not be described as fixing something.

---

## 8. Open items

Establish before or during implementation:

| # | Item | Blocks |
|---|---|---|
| 1 | Does the Cloudflare Pages build install devDependencies? | §5.1 |
| 2 | Is the Playwright suite green **today**? A pre-existing failure would be misread as a dependency regression. | §5.6 item 5 |
| 3 | Is `@astrojs/react`'s exact pin (3.6.3, no caret) deliberate? If it was a workaround, record why before Stage 2 changes it. | §6.1 |
| 4 | Can the Astro image endpoint be removed or made inert by configuration? If so, GHSA-88gm is neutralized independently of any upgrade. | Nothing — opportunistic |
| 5 | Astro 5→6 and 6→7 breaking-change review against the official guides | §6 |

The 29 / 27 / 10 / 1 audit counts come from Codex's resolution simulation and its
reproduction run. Claude verified advisory metadata and reachability but did not
independently reproduce the counts. The real branch must reproduce them.

---

## 9. Provenance

- **Codex consensus brief**, 2026-08-28 — audit snapshot, exposure assessment, two-stage
  proposal. *Superseded by this document.*
- **Claude independent review**, 2026-08-29 — verified claims against lockfile, source, and
  primary advisory sources; corrected the Astro 5 remediation framing; identified the
  dependency misclassification; recommended Astro 6 as the Stage 2 target.
  *Superseded by this document.*
- **Codex reconciliation**, 2026-08-29 — accepted the Stage 1 corrections; produced the
  three Astro 7 advisories that defeat the Astro 6 target; corrected the Dependabot
  security-update cadence.
- **Claude concurrence**, 2026-08-29 — verified all three advisories and the Dependabot
  mechanism against primary sources; withdrew the Astro 6 recommendation.

Both reviewers concur on the whole of this document. Implementation has not started.
