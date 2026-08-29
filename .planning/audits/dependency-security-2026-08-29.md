# Dependency security residual risk and Astro 7 handoff — 2026-08-29

## Status and scope

Stage 1 reduced the vulnerable dependency graph without crossing the approved
Astro/Cloudflare major-version boundary. The remaining findings are maintenance
risk, not evidence of an active incident. The source conditions described below
make the examined direct advisories currently unreachable or inapplicable, but
those conditions are conditional mitigations, not upstream patches. The project
still needs the separately reviewed Stage 2 migration.

This record was checked against the committed `package-lock.json`, the installed
graph, live npm audit output, repository source, and the linked primary GitHub
Advisory Database records on 2026-08-29.

## Stage 1 evidence

`npm audit` reports vulnerable package keys, not unique advisories. One package
key can aggregate several advisory records and dependency effects.

| Graph | Before Stage 1 | After corrected Stage 1 |
| --- | ---: | ---: |
| Full | 29 keys: 1 low, 12 moderate, 15 high, 1 critical | 10 keys: 0 low, 4 moderate, 6 high, 0 critical |
| `--omit=dev` | 27 keys: 1 low, 12 moderate, 14 high, 0 critical | 10 keys: 0 low, 4 moderate, 6 high, 0 critical |

The corrected full and `--omit=dev` audits now agree because six build-only
packages were reclassified as development dependencies: `@astrojs/check`,
`@tailwindcss/vite`, `@types/react`, `@types/react-dom`, `tailwindcss`, and
`typescript`. That makes the production audit graph meaningful rather than
allowing build tooling to be counted as deployed application dependencies.

Stage 1 removed the Vitest critical path. It also updated Resend and removed the
reported `svix`/`uuid` chain; neither package is present in the current installed
graph or lockfile. The ten residual vulnerable keys are:

- `@astrojs/cloudflare`
- `@astrojs/react`
- `astro`
- `esbuild`
- `miniflare`
- `sharp`
- `undici`
- `vite`
- `wrangler`
- `ws`

Astro 5.18.2 is an interim compatibility update, not remediation of the Astro
advisories. A live standard, non-forced `npm audit fix --dry-run --json` reported
zero packages added, changed, or removed. Further audit remediation therefore
crosses the approved Stage 1 major-version boundaries.

## Direct residual advisories

The live audit reports the following direct Astro and Cloudflare-adapter
advisories. "Current condition" is repository-specific reachability evidence,
not a claim that the vulnerable dependency code has been patched locally.

| Advisory | Primary title | Severity | Affected / patched | Current repository condition |
| --- | --- | --- | --- | --- |
| [GHSA-j687-52p2-xcff](https://github.com/advisories/GHSA-j687-52p2-xcff) | Astro: XSS in `define:vars` via incomplete `</script>` tag sanitization | Moderate | Astro `<6.1.6` / `6.1.6` | No `define:vars` directive is used. The `define` key in `astro.config.mjs` is Vite build configuration and is unrelated. |
| [GHSA-xr5h-phrj-8vxv](https://github.com/advisories/GHSA-xr5h-phrj-8vxv) | Astro: Server island encrypted parameters vulnerable to cross-component replay | Low | Astro `<6.1.10` / `6.1.10` | No server islands (`server:defer`) are used. |
| [GHSA-jrpj-wcv7-9fh9](https://github.com/advisories/GHSA-jrpj-wcv7-9fh9) | Astro: XSS via Unescaped Attribute Names in Spread Props | Moderate | Astro `<6.4.6` / `6.4.6` | No spread attributes occur in `.astro` templates. |
| [GHSA-f48w-9m4c-m7f5](https://github.com/advisories/GHSA-f48w-9m4c-m7f5) | Astro: XSS via unescaped spread attribute names in `renderHTMLElement` (incomplete fix for CVE-2026-54298) | Moderate | Astro `<7.0.6` / `7.0.6` | No spread attributes occur in `.astro` templates, so the advisory's untrusted-keyed spread-prop path is absent. |
| [GHSA-7pw4-f3q4-r2p2](https://github.com/advisories/GHSA-7pw4-f3q4-r2p2) | Astro: Cross-site scripting via unescaped `transition:*` directive values on hydrated islands | Low | Astro `>=3.10.0 <7.0.4` / `7.0.4` | No Astro `transition:*` directive is used. |
| [GHSA-4g3v-8h47-v7g6](https://github.com/advisories/GHSA-4g3v-8h47-v7g6) | Astro: Reflected XSS via unescaped View Transition animation properties | Moderate | Astro `>=2.9.0 <=7.0.9` / `7.1.0` | No `ViewTransitions` or `ClientRouter` import is used, and no Astro transition directive is present. |
| [GHSA-2pvr-wf23-7pc7](https://github.com/advisories/GHSA-2pvr-wf23-7pc7) | Astro: Host header SSRF in prerendered error page fetch | High | Astro `<6.4.6` / `6.4.6` | Not reachable through this deployment: the primary advisory explicitly lists `@astrojs/cloudflare` as unaffected because it reads error pages through the ASSETS binding. |
| [GHSA-8hv8-536x-4wqp](https://github.com/advisories/GHSA-8hv8-536x-4wqp) | Astro: Reflected XSS via unescaped slot name | High | Astro `<6.3.3` / `6.3.3` | Current named slots are static: the only name is the literal `icon`; the remaining slots are default slots. No attacker-controlled or dynamic Astro slot name is used. |
| [GHSA-88gm-j2wx-58h6](https://github.com/advisories/GHSA-88gm-j2wx-58h6) | Cloudflare has SSRF via redirect following through its image-binding-transform endpoint (incomplete fix for GHSA-qpr4) | Low | `@astrojs/cloudflare <13.1.10` / `13.1.10` | The required remote-image path is not configured or used: there is no `image.domains`, `image.remotePatterns`, `astro:assets`, Astro `<Image>`, or Astro `<Picture>`. This low-severity advisory does not independently increase urgency under the current configuration. |

The image search also found ordinary verification-image storage and admin-route
text. Those are R2-backed verification uploads, not Astro's remote image service,
and are not evidence that the Cloudflare image advisory is reachable. Likewise,
the only source match for `transition:` is a React inline CSS transition in
`BuildingMap.tsx`; it is not an Astro template directive or View Transition API.

These conclusions must be revisited if the project introduces any construct on
which they rely, changes adapters, or exposes a relevant value to attacker
control. Any such change advances the Stage 2 priority and requires security
review before release.

## Stage 2 migration boundary

Stage 2 is a coordinated, separately reviewed major migration with these package
targets:

- `astro` 7.2.9
- `@astrojs/cloudflare` 14.2.5
- `@astrojs/react` 6.0.4
- a current compatible `@cloudflare/workers-types` (5.20260829.1 was current when
  this record was verified)
- `react` and `react-dom` remain at 18.3.1

Astro 7.1.0 is the security floor because it contains the View Transition fix;
7.0.x is not acceptable. The approved Astro 7.2.9 target provides margin above
that floor and matches the Cloudflare adapter's published Astro `^7.2.0` peer
range. Astro 7.2.9 requires Node 22.12.0 or newer.

Implementation must review both official migration guides before changing the
graph:

- [Upgrade to Astro v6 (5→6)](https://docs.astro.build/en/guides/upgrade-to/v6/)
- [Upgrade to Astro v7 (6→7)](https://docs.astro.build/en/guides/upgrade-to/v7/)

After migration 0028, re-audit all of the following against the migrated runtime,
not only against compile-time success:

- Astro `security.checkOrigin`, authenticated and unauthenticated POST routes,
  the `application/json` gap, and SameSite cookie behavior;
- SSR behavior; Cloudflare D1 and R2 bindings; authentication; and image routes;
- `getEnv`, `fireAndForget`, `ctx.waitUntil`, fail-closed rate limiting, and
  destructive-action audit-log writes.

The release gate is `npm run check`, `npm test`, `npm run build`, and the complete
E2E suite, followed by an immutable exact-SHA preview and explicit preview smoke.
After that passes, verify production-only Turnstile and map behavior plus every
user flow affected by the migration. Preview cannot establish the Turnstile or
map results.

Staying on the current Astro major is therefore operational security work: the
examined fixes were not backported to Astro 5. Current source conditions reduce
exposure, but they do not remove the maintenance obligation or replace Stage 2.
