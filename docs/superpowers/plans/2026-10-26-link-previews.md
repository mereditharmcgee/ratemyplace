# Item 3: link previews, canonical URLs, distinct titles (`fix/link-previews-seo`)

Base: `main` at `1b8ca2b`. **No migration and no production data change.** Every production step here is a read-only check.

## 0. What I checked (read-only, 2026-10-26)

**The image**
- `GET https://ratemyplace.org/brand/social/og-default.png` returns **404** for a browser and for `facebookexternalhit/1.1`, `Twitterbot/1.0`, `LinkedInBot/1.0` and `Slackbot-LinkExpanding`. All four of those agents get 200 on `/` and on `/brand/logo-lockup.svg`, so no bot protection gets in the way.
- `public/brand/social/` is empty and untracked. `BaseLayout.astro:23` and `:26` point at that missing file with a **relative** URL.

**The homepage head**
- It has no canonical, `og:url`, `og:site_name`, image size, image alt, `twitter:title` or `twitter:description`.
- Its title is `Home | RateMyPlace`.

**Duplicate hosts**
- `https://ratemyplace.org/about/` serves 200, the same as `/about`.
- `https://ratemyplace-64y.pages.dev/` serves 200 with production content. Its `robots.txt` is `Disallow: /` (verified), so compliant crawlers never fetch those pages.
- A canonical there does no harm, but it does not fix the pages.dev duplicate. SAFE-10 (a redirect) is the real fix.
- `www` already 301s to the apex.

**robots and sitemap**
- Production `robots.txt` disallows `/admin /api /auth /profile /review /dispute /email-verified /bug-report`.
- The sitemap writes root as `https://ratemyplace.org/` and every other path with no trailing slash. The canonical follows the same form.

**Fonts**
- BaseLayout loads **Google Fonts** (`BaseLayout.astro:27-29`). brand.md §5 mentions `brand/fonts/`, but that folder does not exist.

**The lockup**
- `brand/logo-lockup.svg` sets the wordmark as `<text font-family="Instrument Serif">`. An SVG loaded as an `<img>` cannot use web fonts, and the production header does show a Times-style fallback. The OG render therefore **inlines** the SVG.
- Its viewBox is `0 0 1920 400`, but the drawing only spans x 75–1485 and y 11–375 (measured with `getBBox()` once the font has loaded). Centring the box pushes the drawing about 40px left, so the render script crops the viewBox to the drawing.
- `brand/logo-lockup.svg` and `public/brand/logo-lockup.svg` are byte-identical today.

**Brand sources**
- I read brand bible v1.0 from the owner's Drive mount: `G:\My Drive\Rate my Place Branding 6.1\RateMyPlace-brand-bible-v1_0.md`. AGENTS.md and `.planning/brand-v1-code-handoff.md` both say the bible outranks brand.md.
- The bible has **no OG layout rules**. It requires:
  - the full lockup on OG images (§5, Logo system)
  - at least 120px of on-screen lockup width
  - clear space of half the mark's height on every side
  - the tagline "Know before you sign." used verbatim
  - the primary message "A public record of rental housing, from the people who know it best."
- The top-left, 48–60px headline and 18px secondary-line rules exist only in brand.md §11.

**Verified reviews**
- 15 of 53 approved reviews have `is_verified = 1` (`SELECT is_verified, COUNT(*) FROM reviews WHERE status='approved' GROUP BY is_verified`). A site-wide image must not say "Verified reviews".

**Titles**
- I exported every building (38,301 rows) and ran `scratchpad/plan-oct26/rev/verify-titles.mts` (its text is in §4) against the **real** `buildingPageMeta`.
  - Today: **292 title groups covering 711 URLs, all seeded.** 177 of those groups span different addresses or ZIPs. Example: `6 Prescott Street, Boston` is both East Boston 02128 and Hyde Park 02136.
- I ran the same script against a scratch copy of the code in §3, Step 4. The result:
  - **120 groups covering 358 URLs.** Every one is the same address and ZIP with a different parcel; for example, `282 Lexington Street` is parcels 0100243000 and 0100244000.
  - 0 titles name a place twice.
  - The longest title with ` | RateMyPlace` is 70 characters; the median is 50.
  - The longest description is 168 characters.
- The neighbourhood guard in Step 4 changes exactly 4 rows compared with the first draft: `1715 Commonwealth Avenue` (`St. Elizabeth's`) and three `Chestnut Hill` rows. All four now get `<address>, Boston`.
- No stored address contains a comma, so the in-address checks are defensive.
- Internal building ids for seeded rows are `seed-<parcel>` (for example `seed-0100205000`).

**Planning history**
- `.planning/milestones/v1.6.0-REQUIREMENTS.md` Phase 29 lists SEO-01 (approved image, 200 in production), SEO-02 (site URL, canonical, absolute OG, `og:url`, site name, full Twitter tags, optional `noindex` in the base layout) and SEO-03 (noindex on auth, profile, admin, search-query variants and other private surfaces). This plan delivers all three.
- SEO-04 shipped in C3.
- SEO-06 (no internal ids or hidden scores in metadata) is respected. Step 8 adds the SSR head assertions for it, but SEO-06 is not ticked, because it also covers the sitemap.
- SEO-05 and SEO-07 are follow-ups.

**Astro 6+ (item 5)**
- The Cloudflare adapter that item 5 moves to defines `locals.runtime` as an object whose `env`, `cf`, `caches` and `ctx` getters **throw** migration errors. I read this in `@astrojs/cloudflare` `dist/utils/cf-helpers.js` `createLocals`, changelog #15075, and the docs section "Removed: `Astro.locals.runtime` API" (`scratchpad/plan-oct26/astro/`).
- So `locals.runtime?.env` would throw on every page after that upgrade. Step 2 handles this.

## 1. Changes from the previous draft

| Critique point | Resolution |
|---|---|
| `maybeEnv` throws under the Astro 6+ adapter | try/catch inside `maybeEnv`, with a throwing-getter test. The item-5 coordination risk now names `maybeEnv`, the BaseLayout head and `Header.astro:7`. The `SITE_URL` fallback stays. |
| "Verified reviews" eyebrow overstates | Eyebrow removed from the image. Decision 1 states the 15/53 fact. |
| Parcel sentence on by default (SEO-06, truncation) | Off by default. It becomes an optional Step 4b with an explicit SEO-06 carve-out. |
| Template not reproducible | The full template and script are below, verbatim. Step 5 says to copy them as written. |
| `bostonPlace` lets junk or out-of-city localities in, and doubles South Boston | The neighbourhood is shown only when `bostonLocalityName` (new, built on the `isBostonLocality` vocabulary) recognises it, and in its display spelling. Any Boston locality already in the address suppresses the suffix. Recounted: the numbers are unchanged and 4 rows differ. |
| Brand bible not checked; legibility argument uneven | I read the bible (see §0). The new draft keeps every element at 32px or larger (≥10.7px in a 400px card). The drawn lockup is 380px, so it stays ≥120px both in a 400px card and in a 200px square thumbnail. |
| pages.dev canonical claim | Corrected in §0. |
| `site` "changes routing" | Corrected in §7. |
| Test type error under `astro check` | The tests cast with `as unknown as App.Locals`. |
| `runtime.ts` docs | `maybeEnv` is documented in the `runtime.ts` section of `src/lib/AGENTS.md`. |
| Template placement and PNG location | The PNG is mirrored at `brand/social/og-default.png` and `public/brand/social/og-default.png` (a test keeps them identical). The wording no longer refers to other templates. |
| Scratch recount script re-implemented the format | `verify-titles.mts` imports the real `buildingPageMeta` by path. Its text is in §4. |
| `og:url` on noindex pages | Omitted, along with the canonical, on noindex pages. |
| Worktree location | `.worktrees/link-previews`, per the repo convention. |
| Homepage title dropped the tagline's period | The default keeps it verbatim. Decision 3 offers the alternative. |
| Social-crawler UAs | Added to the production checks. |
| Missing tests | All six added: page classification, token and query privacy, `bostonPlace` edges, throwing getter, SEO-06 head checks, lockup identity and template slot. |

## 2. Owner decisions before merge (each has a default)

### 1. The image

**Default:** the centred draft at
`C:\Users\mmcge\AppData\Local\Temp\claude\C--Users-mmcge-ratemyplace-boston\e4bed66b-7eb9-44e3-aa17-a1ef131b648b\scratchpad\plan-oct26\rev\og-default-centered-v3.png`

Previews of the same draft at 400px wide, in a 200px centre-square crop and in X's 2:1 crop:
`C:\Users\mmcge\AppData\Local\Temp\claude\C--Users-mmcge-ratemyplace-boston\e4bed66b-7eb9-44e3-aa17-a1ef131b648b\scratchpad\plan-oct26\rev\preview-sizes.png`

**What the image shows:**
- Paper background.
- The full lockup, centred.
- "Know before / you sign." in Instrument Serif at 128px.
- "A public record of rental housing, from the people who know it best." in Inter at 32px, slate-700.

**It meets the bible:**
- full lockup
- 380px drawn width, about 127px in a 400px feed card (minimum 120px)
- clear space of 52px against the required ~49px
- tagline verbatim

**It departs from brand.md §11 on purpose:**
- The lockup is centred, not top-left.
- The headline is 128px, not 48–60px.
- The secondary line is 32px, not 18px.

At feed-card size (one third scale) an 18px line becomes 6px. A top-left lockup is cut off in square thumbnails.

**The earlier draft's eyebrow ("Verified reviews · Evidence-based scoring") is removed.** Only 15 of 53 approved reviews are verified, and a 20px eyebrow shrinks to about 7px in a feed card. If the owner wants an eyebrow back, it must be at least 36px and its copy must be true of every page. "A public record for renters" (brand.md §7.4) would repeat the secondary line.

**Alternative:** a left-aligned layout at
`C:\Users\mmcge\AppData\Local\Temp\claude\C--Users-mmcge-ratemyplace-boston\e4bed66b-7eb9-44e3-aa17-a1ef131b648b\scratchpad\plan-oct26\rev\og-default-left-v3.png`
A square thumbnail cuts its lockup. Choosing it means changing the template and dropping the script's centre-square check, keeping the 15px top and bottom check.

**Or:** the owner supplies a 1200x630 PNG under 300 KB.

**Confirm the bible copy:** the bible copy I read is in `G:\My Drive\Rate my Place Branding 6.1\`. The bible itself says its canonical home is the RateMyPlace Workspace Drive under Brand. The owner should confirm it is current.

### 2. Records-page titles

**Default:**
- `<address>, <neighbourhood>, Boston`.
- East Boston and South Boston give `<address>, East Boston` and `<address>, South Boston`.
- The neighbourhood is named only when it is a real Boston locality. Anything else, such as a blank, `St. Elizabeth's`, `Chestnut Hill` or `Brookline`, gives `<address>, Boston`.
- The description becomes `City of Boston records for <address>, <neighbourhood>: …`.
- The 120 twin-parcel groups (358 URLs) keep identical titles and descriptions.

**Optional, off by default:** add `Assessor parcel <id>.` to the description (Step 4b).
- It brings duplicate descriptions to 0.
- It needs an explicit SEO-06 carve-out, because seeded internal ids are `seed-<parcel>`.
- It starts after character 150, so search snippets usually cut it.

### 3. Homepage title

**Default:** `Know before you sign. | RateMyPlace`. The tagline stays verbatim, as brand.md §2 requires.

**Alternatives:**
- `Know before you sign | RateMyPlace` (period dropped).
- Other copy.
- Keep `Home | RateMyPlace`.

### 4. brand.md edits (the handbook is owner-maintained)

Approval to update §11 (asset rows and OG rules), tick the §12 OG item, and add a §13 v1.5 row. Exact text is in Step 9.

## 3. Setup

- `git fetch origin`
- `git worktree add .worktrees/link-previews -b fix/link-previews-seo origin/main`
- Then `cd .worktrees/link-previews && npm ci`. `.worktrees/` is gitignored and is the repo's convention.
- **Stage explicit paths only.** The main checkout has an untracked, routable `src/pages/api/admin/verification/[id] (1).ts`. A fresh worktree does not contain it, but never run `git add -A` or `git add .` in the main checkout.
- Install Chromium once if it is missing: `npx playwright install chromium`. Playwright 1.58.2 needs chromium-1208, which is installed on this machine.
- Commit once per step below, with tests first in every step. End each commit message with the session's Co-Authored-By line.

## 4. Order of work

### Step 1: head-metadata helpers (`src/lib/seo.ts`, new)

**Write the tests first** in `src/lib/__tests__/seo.test.ts`.

`canonicalPath`:
- `'/'` and `''` give `'/'`.
- `'/about/'` gives `'/about'`, and `'/about'` is unchanged.
- `'//about//'` gives `'/about'`.
- `'/building/6-prescott-street-boston/'` gives `'/building/6-prescott-street-boston'`.
- `'/Building/A%20B'` is unchanged: no lowercasing, no re-encoding.

`siteOriginFrom`:
- `undefined`, `{SITE_URL:''}` and `{SITE_URL:'   '}` give `'https://ratemyplace.org'`.
- `'https://ratemyplace.org/'` gives `'https://ratemyplace.org'`.
- `'ratemyplace.org'` gives `'https://ratemyplace.org'`.
- `'localhost:4321'` gives `'https://localhost:4321'`.
- `'http://localhost:4321'` is kept as is.
- `'https://ratemyplace.org/some/path'` gives `'https://ratemyplace.org'`.
- `'https://'`, `'%%%'` and `'ftp://x.org'` all give the default.

`headMeta({title:'About', description:'d', pathname:'/about/', siteOrigin:'https://ratemyplace.org'})`:
- title is `'About | RateMyPlace'`
- url is `'https://ratemyplace.org/about'`
- robots is `null`
- the image is `{url:'https://ratemyplace.org/brand/social/og-default.png', width:1200, height:630, type:'image/png'}` with a non-empty alt
- The same call with `noindex:true` gives robots `'noindex, follow'`, url `null`, and the same absolute image url.
- `headMeta` with pathname `'/'` gives url `'https://ratemyplace.org/'`.

`isSearchVariant(new URL(...))`:
- `/search` and `/search?` give false.
- `/search?q=lanark`, `/search?q=` and `/search?type=landlords` give true.

**Implement:**

```ts
// Head metadata for every page: title, description, canonical, Open Graph and Twitter tags.
// BaseLayout is the only caller; pure, so it is unit-tested without rendering.
import { siteUrlFrom } from './sitemap';

export const SITE_NAME = 'RateMyPlace';
/** Moved verbatim from BaseLayout's default prop. */
export const DEFAULT_DESCRIPTION = 'Tenant housing reviews - Real experiences from real renters';
export const NOINDEX_ROBOTS = 'noindex, follow';
/**
 * The committed link-preview image, rendered from brand/social/og-default.html by
 * `npm run og:render`. Platforms cache previews by image URL, so a replacement image gets a
 * new filename and this path changes with it.
 */
export const DEFAULT_OG_IMAGE = {
  path: '/brand/social/og-default.png',
  width: 1200,
  height: 630,
  type: 'image/png',
  alt: 'RateMyPlace. Know before you sign. A public record of rental housing, from the people who know it best.',
} as const;

export interface HeadMetaInput { title: string; description: string; pathname: string; siteOrigin: string; noindex?: boolean }
export interface HeadMeta {
  title: string;
  description: string;
  siteName: string;
  /** The canonical link and og:url. Null on noindex pages, so a private URL is never advertised. */
  url: string | null;
  robots: string | null;
  image: { url: string; width: number; height: number; type: string; alt: string };
}

/** The sitemap's form: root is '/', every other path has no trailing slash. Never lowercases or re-encodes. */
export function canonicalPath(pathname: string): string {
  const trimmed = pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  if (trimmed === '') return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** SITE_URL as a bare origin. Never throws: BaseLayout renders every page. */
export function siteOriginFrom(env: { SITE_URL?: string } | undefined): string {
  const fallback = siteUrlFrom(undefined);
  const raw = siteUrlFrom(env).trim();
  try {
    // A scheme is prefixed only when none is present: 'https://' + 'https://x' parses as host 'https'.
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname !== '' ? url.origin : fallback;
  } catch {
    return fallback;
  }
}

export function headMeta(input: HeadMetaInput): HeadMeta {
  const url = input.noindex ? null : `${input.siteOrigin}${canonicalPath(input.pathname)}`;
  return {
    title: `${input.title} | ${SITE_NAME}`,
    description: input.description,
    siteName: SITE_NAME,
    url,
    robots: input.noindex ? NOINDEX_ROBOTS : null,
    image: {
      url: `${input.siteOrigin}${DEFAULT_OG_IMAGE.path}`,
      width: DEFAULT_OG_IMAGE.width,
      height: DEFAULT_OG_IMAGE.height,
      type: DEFAULT_OG_IMAGE.type,
      alt: DEFAULT_OG_IMAGE.alt,
    },
  };
}

/** Any query parameter makes /search a variant: noindexed, and it carries no canonical. */
export function isSearchVariant(url: URL): boolean {
  return [...url.searchParams.keys()].length > 0;
}
```

### Step 2: reading the env without throwing (`src/lib/runtime.ts`)

**Write the tests first** in `src/lib/__tests__/runtime.test.ts` (new `describe('maybeEnv')`). Use no `any`: cast with `as unknown as App.Locals`.

- `maybeEnv({ user: null, session: null, runtime: { env: { SITE_URL: 'x' } } } as unknown as App.Locals)` returns that env object.
- `maybeEnv({ user: null, session: null } as unknown as App.Locals)` returns `undefined`.
- Throwing getter, which is the Astro 6+ adapter's behaviour: `locals = { user: null, session: null, runtime: { get env(): never { throw new Error('Astro.locals.runtime.env has been removed in Astro v6.'); } } }`.
  - `maybeEnv` returns `undefined` and does not throw.
  - With `vi.spyOn(console, 'error')`, two calls log at most one line.

**Implement** below `getEnv`. `logError` is already imported.

```ts
let envUnreadableLogged = false;

/**
 * The runtime env, or undefined when it cannot be read: no runtime at all (the Astro container
 * in unit tests), or the Astro 6+ Cloudflare adapter, whose `locals.runtime.env` is a getter
 * that throws a migration error. Only for render paths that must never throw and have a safe
 * default for every value they read — BaseLayout's head. Anything that needs a binding uses
 * `getEnv`, which throws on purpose.
 */
export function maybeEnv(locals: App.Locals): App.Platform['env'] | undefined {
  try {
    return locals.runtime?.env;
  } catch (err) {
    if (!envUnreadableLogged) {
      envUnreadableLogged = true; // once per isolate: BaseLayout calls this on every page
      logError('maybeEnv: runtime env unreadable', { error: err instanceof Error ? err.message : String(err) });
    }
    return undefined;
  }
}
```

**Why BaseLayout does not use `getEnv`:**
- `getEnv` takes an `APIContext` and throws without a runtime.
- `authPageHeadings.test.ts` and `namedPartySsrVisibility.test.ts` render pages through BaseLayout. The first passes no runtime at all; the second passes a runtime with only `DB`.

**If item 5 (Astro upgrade) merges first:** rebase and implement `maybeEnv` on the same source item 5 gives `getEnv` (for example `cloudflare:workers` `env`). Keep it inside the try/catch, and keep the `siteOriginFrom` fallback, because the vitest container cannot provide `cloudflare:workers` without an alias.

### Step 3: Boston locality display names (`src/lib/locality.ts`)

**Write the tests first** in `src/lib/__tests__/locality.test.ts`, as a new `describe('bostonLocalityName')`. Import `bostonLocalityName` and `isBostonLocality` from `../locality` and `BOSTON_LOCALITY_NAMES` from `../bostonLocalities`.

These give a name:

| Input | Result |
|---|---|
| `'east boston'` | `'East Boston'` |
| `'EAST BOSTON'` | `'East Boston'` |
| `' Hyde Park '` | `'Hyde Park'` |
| `'hyde-park'` | `'Hyde Park'` |
| `'Boston, MA'` | `'Boston'` |

These give `null`:
- `'Brookline'`, `'Newton'`, `'Chestnut Hill'`, `"St. Elizabeth's"`
- `'Aberdeen'` (a sub-area, not a locality name)
- `''`, `null`, `undefined`

Round trip: for every name in `BOSTON_LOCALITY_NAMES`, `bostonLocalityName(name) === name`.

Agreement with the existing predicate: for each of `['Boston','boston, ma','Roxbury','Readville','Brookline','Chestnut Hill','',"St. Elizabeth's",'South End']`, `bostonLocalityName(v) !== null` equals `isBostonLocality(v)`.

**Implement** directly after `isBostonLocality`. Change nothing else in the file.

```ts
// `BOSTON_LOCALITY_NAMES` keyed by `normalize()`, so "east boston" and "EAST BOSTON" both find "East Boston".
const BOSTON_LOCALITY_BY_KEY: ReadonlyMap<string, string> = new Map(
  BOSTON_LOCALITY_NAMES.map((name) => [normalize(name), name])
);

/**
 * The display spelling, from `BOSTON_LOCALITY_NAMES`, of a value `isBostonLocality` accepts
 * ("east boston" -> "East Boston", "Boston, MA" -> "Boston"); null for anything else. Sub-areas
 * ("Aberdeen") are not locality names: pass the value through `displayLocality` first.
 */
export function bostonLocalityName(value: string | null | undefined): string | null {
  if (!value) return null;
  return BOSTON_LOCALITY_BY_KEY.get(normalize(value.replace(/,\s*[A-Za-z]{2}\s*$/, ''))) ?? null;
}
```

### Step 4: distinct records-page titles (`src/lib/buildingMeta.ts`)

**Edit the tests first** in `src/lib/__tests__/recordsBuildingMeta.test.ts`. The fixture `seeded` is unchanged: `23-27 Lanark Road`, Boston, `Aberdeen`, `2102396000`.

Change these existing cases:
- `'describes a seeded page by its city records when no review exists'` now expects:
  - title `'23-27 Lanark Road, Brighton, Boston'`
  - description `'City of Boston records for 23-27 Lanark Road, Brighton: assessment, permits, violations, code enforcement, and 311 requests. No tenant reviews yet.'`
- `'reads the city the way the rest of the records code does'` now expects `'23-27 Lanark Road, Brighton, Boston'` for both `city:'boston'` and `city:'Boston, MA'`.

Keep these unchanged:
- review metadata once a review exists (`'Reviews for 23-27 Lanark Road in Brighton'`)
- no parcel, and New Haven
- `'12 Elm St, Boston'` with `neighborhood:null`

Add these cases. Every input has `city:'Boston'`, and zero approved reviews unless stated.
- The address already carries the city: `{address:'12 Elm St, Boston', neighborhood:'Dorchester', parcel_id:'1'}` gives `'12 Elm St, Boston'`.
- East Boston: `{address:'6 Prescott Street', neighborhood:'East Boston', parcel_id:'0100205000'}` gives `'6 Prescott Street, East Boston'`, and the description starts `'City of Boston records for 6 Prescott Street, East Boston:'`. Add the same check for South Boston.
- The production collision: the East Boston row above and `{address:'6 Prescott Street', neighborhood:'Hyde Park', parcel_id:'1809486000'}` give different titles; the second is `'6 Prescott Street, Hyde Park, Boston'`.
- No neighbourhood: `{address:'14-16 Derne Street', neighborhood:null, parcel_id:'0300001000'}` gives `'14-16 Derne Street, Boston'`, and the description starts `'City of Boston records for 14-16 Derne Street, Boston:'`.
- Street-word neighbourhood: `{address:'1027 Commonwealth Avenue', neighborhood:'Commonwealth'}` gives `'1027 Commonwealth Avenue, Boston'`.
- Junk and out-of-city values:
  - `"St. Elizabeth's"` with `1715 Commonwealth Avenue` gives `'1715 Commonwealth Avenue, Boston'`.
  - `'Chestnut Hill'`, `'Brookline'` and `'Newton'` with `'1 Test Street'` each give `'1 Test Street, Boston'`.
- Lowercase stored value: `neighborhood:'east boston'` gives `'1 Test Street, East Boston'` (display spelling).
- Neighbourhood already in the address:
  - `{address:'12 Elm St, South Boston', neighborhood:'South Boston'}` gives `'12 Elm St, South Boston'`, and the description names it once.
  - `{address:'12 Elm St, Dorchester', neighborhood:'Dorchester'}` gives `'12 Elm St, Dorchester, Boston'`.
- Twin parcels: `282 Lexington Street`, East Boston, parcels `0100243000` and `0100244000` give equal titles and equal descriptions. This is by design, and the test carries a comment saying so.
- Boston appears once: for every name in `BOSTON_LOCALITY_NAMES` used as the neighbourhood of `'1 Test Street'`, the title matches `/\bBoston\b/g` exactly once.

**Implement.** Keep the signature, the exported `BuildingMetaInput`, the eligibility rule and the review-metadata return byte-identical. The caller at `src/pages/building/[slug].astro:196` already passes `neighborhood` and `parcel_id` and does not change.

```ts
import { bostonLocalityName, displayLocality } from './locality';
import { jurisdictionForCity } from './records/jurisdiction';

// (BuildingMetaInput unchanged)

/** A Boston locality the address already names after a comma ("12 Elm St, South Boston"), in display form. */
function localityInAddress(address: string): string | null {
  if (/,\s*boston\b/i.test(address)) return 'Boston'; // the original guard; also catches "…, Boston MA"
  for (const part of address.split(',').slice(1).reverse()) {
    const name = bostonLocalityName(part);
    if (name !== null) return name;
  }
  return null;
}

/**
 * Where in Boston a records page is: `title` for <title>, `line` for the description. The
 * neighbourhood is named only when it is a real Boston locality, in its display spelling, so a
 * junk or out-of-city value ("St. Elizabeth's", "Chestnut Hill") falls back to plain Boston, and
 * Boston is never named twice. Exported for tests.
 */
export function bostonPlace(building: BuildingMetaInput): { title: string; line: string } {
  const named = localityInAddress(building.address);
  if (named !== null) {
    return { title: /\bboston$/i.test(named) ? building.address : `${building.address}, Boston`, line: building.address };
  }
  const name = bostonLocalityName(displayLocality(building));
  if (name === null || name === 'Boston') {
    const plain = `${building.address}, Boston`;
    return { title: plain, line: plain };
  }
  const line = `${building.address}, ${name}`;
  return { title: /\bboston$/i.test(name) ? line : `${line}, Boston`, line }; // East Boston, South Boston
}
```

In `buildingPageMeta`, keep everything up to and including the `if (jurisdiction !== 'boston') return …` block. Replace the suffix lines with:

```ts
  const place = bostonPlace(building);
  return {
    title: place.title,
    description: `City of Boston records for ${place.line}: assessment, permits, violations, code enforcement, and 311 requests. No tenant reviews yet.`,
  };
```

Add one sentence to the JSDoc: before October 2026, 711 seeded URLs shared a title, so the neighbourhood is part of the title, and twin parcels at one address and ZIP (about 120 groups) still share one by design.

### Step 4b (only if decision 2's parcel option is approved)

- Append ` Assessor parcel ${building.parcel_id}.` to the records description. `parcel_id` is non-null on that branch; narrow it into a `const` before the jurisdiction check.
- Change the twin-parcel test to expect different descriptions, each ending `Assessor parcel <its id>.`.
- Add a comment in the test that records the carve-out.
- Add a line under SEO-06 in `.planning/milestones/v1.6.0-REQUIREMENTS.md`: "Carve-out (owner-approved <date>): the City of Boston assessor parcel id in records-page descriptions is public city data, already shown on the page (`FactsStrip.astro:70`), and is not treated as an internal id, although seeded building ids are `seed-<parcel>`."
- Expected recount: 0 duplicate descriptions.

### Step 5: the image (template, script, PNG)

**Write the test first** in `src/lib/__tests__/ogImage.test.ts`. Use `node:fs`, with paths built from `process.cwd()`.

1. `public/brand/social/og-default.png` (`join(process.cwd(), 'public', DEFAULT_OG_IMAGE.path)`) exists. This is the regression test for today's 404.
2. Its first 8 bytes are the PNG signature `89 50 4E 47 0D 0A 1A 0A`, and `readUInt32BE(16)` / `readUInt32BE(20)` equal `DEFAULT_OG_IMAGE.width` / `.height`.
3. `statSync(...).size < 300_000`. WhatsApp drops larger preview images; the draft is 59,193 bytes.
4. `brand/social/og-default.png` is byte-identical to the public copy (the brand-asset mirror, brand.md §11).
5. `brand/social/og-default.html` contains `<!--LOCKUP-->` exactly once (`split('<!--LOCKUP-->').length === 2`).
6. `brand/logo-lockup.svg` is byte-identical to `public/brand/logo-lockup.svg`, so the rendered lockup cannot drift from the one the site serves.

**Add `brand/social/og-default.html`, copied exactly as written.** It is the first template in `brand/social/`, which today holds only `facebook-setup.md`. The file is not served.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<!--
  Source for public/brand/social/og-default.png (1200x630), the default link-preview image.
  Rendered by scripts/og/render-og.mjs (npm run og:render). The committed PNG is the source
  of truth: re-render only on purpose, and get the owner's sign-off on the result.

  Brand: brand.md section 2 (tagline, never reworded), 4 (colour), 5 (type), 6 (full lockup:
  120px minimum width, clear space of half the mark's height), 10 (primary message).

  Layout: the lockup, headline and secondary line all sit inside the centre 630x630 square
  (x 285-915), because some platforms show a square thumbnail, and clear the 15px that X
  trims off the top and bottom for its 2:1 card. The render script fails if they do not.

  The LOCKUP comment in .lockup is replaced at render time with brand/logo-lockup.svg,
  inlined rather than loaded as an img (an SVG image cannot use web fonts, so its wordmark
  falls back to Times). The script then crops the SVG's viewBox to the drawn mark and
  wordmark so the lockup centres optically; the width below is therefore the drawn width.
-->
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=block" rel="stylesheet" />
<style>
  :root {
    --paper: #F6F4EE;      /* Paper, brand.md section 4 */
    --ink: #0F172A;        /* Ink, slate-900 */
    --graphite: #334155;   /* Graphite, slate-700 */
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 1200px; height: 630px; overflow: hidden; }
  body {
    background: var(--paper);
    color: var(--ink);
    font-family: "Inter", ui-sans-serif, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .frame {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center;
    padding: 48px 285px; /* 285px a side leaves the centre 630px square */
  }
  /* 380px drawn width: about 127px in a 400px-wide feed card, above the 120px minimum. */
  .lockup svg { display: block; width: 380px; height: auto; }
  h1 {
    margin-top: 52px; /* clear space: at least half the mark's height (about 98px here) */
    font-family: "Instrument Serif", Georgia, serif;
    font-weight: 400;
    font-size: 128px; line-height: 0.98; letter-spacing: -0.01em;
    white-space: nowrap;
    color: var(--ink);
  }
  .sub {
    margin-top: 28px;
    font-size: 32px; font-weight: 400; line-height: 1.3;
    text-wrap: balance;
    color: var(--graphite);
  }
</style>
</head>
<body>
  <div class="frame">
    <div class="lockup"><!--LOCKUP--></div>
    <h1>Know before<br />you sign.</h1>
    <p class="sub">A public record of rental housing, from the people who know it best.</p>
  </div>
</body>
</html>
```

The template comment must never contain the literal slot token. A `<!--` inside an HTML comment closes it early, and `replace()` would fill the comment instead of the slot. The slot-count test catches this.

**Add `scripts/og/render-og.mjs`, copied exactly as written,** and add `"og:render": "node scripts/og/render-og.mjs"` to `package.json` `scripts`. `.mjs` files are not type-checked; `scripts/audit-critical.mjs` is the precedent.

```js
// Renders brand/social/og-default.html to the 1200x630 link-preview image every page
// advertises (src/lib/seo.ts DEFAULT_OG_IMAGE): public/brand/social/og-default.png, which is
// served, and the identical brand/social/og-default.png, the brand-asset copy (brand.md
// section 11). Run with `npm run og:render`; `npm run og:render -- --out <file>` writes one
// candidate elsewhere for review without touching either committed copy. Needs network
// (Google Fonts) and Playwright's Chromium (`npx playwright install chromium`).
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const W = 1200;
const H = 630;
const MAX_BYTES = 300_000; // WhatsApp drops larger preview images
const SQUARE = { left: (W - H) / 2, right: (W + H) / 2 }; // the centre 630px square
const X_TRIM = 15; // X shows a 2:1 crop: 15px off the top and the bottom
const SLOT = '<!--LOCKUP-->';
// Every face the template sets, with its text, so the right unicode-range subsets are fetched.
const FONTS = [
  ['400 128px "Instrument Serif"', 'Know before you sign. RateMyPlace'],
  ['400 32px "Inter"', 'A public record of rental housing, from the people who know it best.'],
];

const outFlag = process.argv.indexOf('--out');
const outs = outFlag > -1
  ? [resolve(process.argv[outFlag + 1])]
  : [resolve(ROOT, 'public/brand/social/og-default.png'), resolve(ROOT, 'brand/social/og-default.png')];

const template = await readFile(resolve(ROOT, 'brand/social/og-default.html'), 'utf8');
if (template.split(SLOT).length !== 2) throw new Error(`brand/social/og-default.html must contain ${SLOT} exactly once`);
const lockup = await readFile(resolve(ROOT, 'brand/logo-lockup.svg'), 'utf8');
const html = template.replace(SLOT, lockup);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle' });

  // document.fonts.load resolves to the faces it loaded, so an empty list means the face never
  // arrived. Not document.fonts.check(): that is true when no matching face exists at all.
  const missing = await page.evaluate(async (fonts) => {
    const failed = [];
    for (const [spec, text] of fonts) if ((await document.fonts.load(spec, text)).length === 0) failed.push(spec);
    await document.fonts.ready;
    return failed;
  }, FONTS);
  if (missing.length) throw new Error(`Brand font(s) did not load: ${missing.join(', ')}; refusing to write a fallback-font image`);

  // The lockup's viewBox has empty space right of the wordmark, so centring the box would push
  // the drawing left. Crop the viewBox to what is drawn, now that the wordmark's font is in.
  const cropped = await page.evaluate(() => {
    const svg = document.querySelector('.lockup svg');
    if (!(svg instanceof SVGSVGElement)) return false;
    const b = svg.getBBox();
    if (b.width <= 0 || b.height <= 0) return false;
    svg.setAttribute('viewBox', `${b.x} ${b.y} ${b.width} ${b.height}`);
    return true;
  });
  if (!cropped) throw new Error('could not measure the inlined lockup');

  // Hold the layout to the crop-safe zone the template promises. Text is measured by its ink
  // (a Range), not its block box, which spans the whole padded column.
  const boxes = await page.evaluate(() =>
    [
      ['lockup', document.querySelector('.lockup svg')],
      ['headline', document.querySelector('h1')],
      ['secondary', document.querySelector('.sub')],
    ].map(([name, el]) => {
      if (!el) return { name, missing: true };
      let r = el.getBoundingClientRect();
      if (name !== 'lockup') {
        const range = document.createRange();
        range.selectNodeContents(el);
        r = range.getBoundingClientRect();
      }
      return { name, left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
    }),
  );
  for (const b of boxes) {
    if (b.missing) throw new Error(`template has no ${b.name}`);
    if (b.left < SQUARE.left || b.right > SQUARE.right || b.top < X_TRIM || b.bottom > H - X_TRIM) {
      throw new Error(`${b.name} leaves the crop-safe zone: ${JSON.stringify(b)}`);
    }
  }
  const lockupBox = boxes.find((b) => b.name === 'lockup');
  if (lockupBox.width / 3 < 120) throw new Error(`lockup is ${lockupBox.width}px wide; it needs 360px to stay 120px wide in a 400px card`);

  const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: W, height: H } });
  if (png.length > MAX_BYTES) throw new Error(`PNG is ${png.length} bytes; keep it under ${MAX_BYTES}`);
  for (const out of outs) {
    await mkdir(dirname(out), { recursive: true }); // empty directories are not in git
    await writeFile(out, png);
    console.log(`wrote ${out} (${W}x${H}, ${png.length} bytes)`);
  }
  for (const b of boxes) console.log(`  ${b.name}: x ${Math.round(b.left)}-${Math.round(b.right)}, y ${Math.round(b.top)}-${Math.round(b.bottom)}`);
} finally {
  await browser.close();
}
```

**Run `npm run og:render`.** It needs network. On this machine it printed the following, and repeated runs were byte-identical:

```
wrote …public\brand\social\og-default.png (1200x630, 59193 bytes)
wrote …brand\social\og-default.png (1200x630, 59193 bytes)
  lockup: x 410-790, y 59-157
  headline: x 335-865, y 188-480
  secondary: x 343-857, y 489-569
```

All three elements sit inside x 285–915 and y 15–615. The vertical extents measure the font's line box, so the visible glyphs sit inside them.

Commit both PNGs, the template, the script and `package.json`. The committed PNG is the source of truth. A different Chromium or font version can shift pixels slightly, so re-render only on purpose.

**Stop here for the owner to approve `public/brand/social/og-default.png` (decision 1).**

If the owner picks the left layout:
- In `.frame`, set `align-items:flex-start; text-align:left; padding:150px 80px 48px`.
- Use `.lockup { position:absolute; top:56px; left:80px }`.
- Make the `h1` 112px, one line, `margin-top:0`.
- Give `.sub` `max-width:900px`.
- In the script, drop the `SQUARE` check and keep `X_TRIM`.

### Step 6: the BaseLayout head (`src/components/layout/BaseLayout.astro`)

**Write the tests first** in `src/lib/__tests__/baseLayoutHead.test.ts`. Follow `authPageHeadings.test.ts`, with this helper:

```ts
const PROD = { runtime: { env: { SITE_URL: 'https://ratemyplace.org' } } };
async function render(url: string, props: Record<string, unknown> = { title: 'About', description: 'd' }, extra: Record<string, unknown> = PROD) {
  const container = await AstroContainer.create();
  const html = await container.renderToString(BaseLayout, {
    props, slots: { default: '<p>x</p>' }, request: new Request(url), partial: false,
    locals: { user: null, session: null, ...extra } as unknown as App.Locals,
  });
  return new DOMParser().parseFromString(html, 'text/html').head; // happy-dom
}
const content = (head: HTMLHeadElement, key: string) =>
  head.querySelector(`meta[property="${key}"], meta[name="${key}"]`)?.getAttribute('content') ?? null;
```

Cases:

1. **All tags.** Request `https://ratemyplace-64y.pages.dev/about/?utm_source=x`. Assert:
   - exactly one `<title>` and one `meta[name=description]`
   - exactly one `link[rel=canonical]`, with href `https://ratemyplace.org/about`
   - `og:url` is the same
   - `og:site_name` is `RateMyPlace`, and `og:type` is `website`
   - `<title>`, `og:title` and `twitter:title` are all `About | RateMyPlace`
   - `og:description` and `twitter:description` are `d`
   - `og:image` and `twitter:image` are `https://ratemyplace.org/brand/social/og-default.png`
   - `og:image:width` is `1200`, `og:image:height` is `630`, and `og:image:type` is `image/png`
   - `og:image:alt` and `twitter:image:alt` are non-empty
   - `twitter:card` is `summary_large_image`
   - there is no `meta[name=robots]`
2. **Absolute URLs.** Every `og:image`, `og:url`, `twitter:image` and canonical value starts with `https://`. This is the regression test for the relative URL.
3. **Root.** `https://ratemyplace.org/` gives canonical `https://ratemyplace.org/`.
4. **noindex.** With props `{title:'X', noindex:true}`:
   - robots is `noindex, follow`
   - no canonical
   - no `og:url`
   - `og:image` is still absolute
5. **No runtime.** `extra = {}`: the layout renders, and the canonical is `https://ratemyplace.org/about`.
6. **Astro 6+ adapter.** `extra = { runtime: { get env(): never { throw new Error('removed'); } } }`: the layout renders, and the canonical is `https://ratemyplace.org/about`.
7. **Scheme-less SITE_URL.** `extra = { runtime: { env: { SITE_URL: 'ratemyplace.org' } } }` gives canonical `https://ratemyplace.org/about`.
8. **Query strings never reach the head.** Request `https://ratemyplace.org/building/x?submitted=true&reviewId=rev-SECRET-42`:
   - `head.innerHTML` contains neither `rev-SECRET-42` nor `submitted`
   - the canonical is `https://ratemyplace.org/building/x`
9. **Token privacy.** Render the real `src/pages/auth/reset-password.astro` with request `https://ratemyplace.org/auth/reset-password?token=SECRET123` and `locals {user:null, session:null}`. It needs no DB.
   - `SECRET123` appears nowhere in the head
   - robots is `noindex, follow`
   - there is no canonical and no `og:url`

   This case passes only after Step 7 adds `noindex`. Write it now and expect it to fail until then.
10. **Sign-in page.** Render the real `src/pages/auth/signin.astro`: robots is `noindex, follow`. This also waits for Step 7.

**Implement.** The new frontmatter:

```astro
---
import '../../../src/styles/global.css';
import Header from './Header.astro';
import Footer from './Footer.astro';
import { maybeEnv } from '../../lib/runtime';
import { DEFAULT_DESCRIPTION, headMeta, siteOriginFrom } from '../../lib/seo';

interface Props {
  title: string;
  description?: string;
  /** robots noindex, with no canonical and no og:url. Never on a sitemap page (pageIndexing.test.ts). */
  noindex?: boolean;
}

const { title, description = DEFAULT_DESCRIPTION, noindex = false } = Astro.props;
// maybeEnv, not getEnv: this renders every page, including in the unit-test container with no
// runtime and under the Astro 6+ adapter, so it must not throw. siteOriginFrom falls back to
// https://ratemyplace.org.
const meta = headMeta({ title, description, pathname: Astro.url.pathname, siteOrigin: siteOriginFrom(maybeEnv(Astro.locals)), noindex });
---
```

Replace head lines 19–26 and the `<title>` on line 30 with the block below, placed straight after the charset and viewport tags. Keep the three font lines (27–29) exactly as they are, after it.

```astro
<title>{meta.title}</title>
<meta name="description" content={meta.description} />
{meta.robots && <meta name="robots" content={meta.robots} />}
{meta.url && <link rel="canonical" href={meta.url} />}
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<meta property="og:site_name" content={meta.siteName} />
<meta property="og:type" content="website" />
<meta property="og:locale" content="en_US" />
{meta.url && <meta property="og:url" content={meta.url} />}
<meta property="og:title" content={meta.title} />
<meta property="og:description" content={meta.description} />
<meta property="og:image" content={meta.image.url} />
<meta property="og:image:type" content={meta.image.type} />
<meta property="og:image:width" content={String(meta.image.width)} />
<meta property="og:image:height" content={String(meta.image.height)} />
<meta property="og:image:alt" content={meta.image.alt} />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content={meta.title} />
<meta name="twitter:description" content={meta.description} />
<meta name="twitter:image" content={meta.image.url} />
<meta name="twitter:image:alt" content={meta.image.alt} />
```

Astro escapes attribute values, so there is no `set:html`. The search query reaches the title as it does today, and those pages are noindexed.

### Step 7: noindex where it belongs (SEO-03) and the homepage title

**Write the tests first** in `src/lib/__tests__/pageIndexing.test.ts`. It is a source-text test, following `recordsBuildingPageSource.test.ts`.

Walk every `.astro` file under `src/pages` with `readdirSync(join(process.cwd(),'src','pages'), { recursive: true })` (Node 24). Map each file to its route:

```ts
const rel = file.split(sep).join('/').replace(/\.astro$/, '').replace(/(^|\/)index$/, '');
const route = rel === '' ? '/' : `/${rel}`;
```

Read the layout tag with `src.match(/<(BaseLayout|AdminLayout)\b[^>]*>/)`. The `[^>]*` also spans line breaks, as in `dispute.astro`. A tag attribute containing `>` would break the match; none does today, and the test fails loudly if one is added.

1. **Every page is classified exactly once** (`it.each` over the files). Each page must render a `BaseLayout` or `AdminLayout` tag, and must be **exactly one** of:
   - (a) a `STATIC_SITEMAP_PATHS` route
   - (b) one of the indexable dynamic routes `['/building/[slug]', '/landlord/[slug]', '/property-manager/[slug]']`
   - (c) a page whose layout tag is `AdminLayout`, or whose `BaseLayout` tag carries `noindex` (`/\bnoindex\b/`)

   `/search` is exempt from (c). It must instead contain `noindex={isSearchVariant(Astro.url)}` in its tag. Today this gives 9 sitemap pages, 3 dynamic routes and 23 noindex pages (`/404`, 4 auth, bug-report, dispute, email-verified, profile, review/new, review/edit/[id], and 12 admin pages). A new page fails until someone classifies it.
2. **Sitemap paths have pages.** Every `STATIC_SITEMAP_PATHS` entry maps to an existing file (`src/pages/index.astro` for `/`, otherwise `src/pages${path}.astro`).
3. **AdminLayout.** The `<BaseLayout` tag in `src/components/admin/AdminLayout.astro` carries `noindex`.
4. **Homepage title.** `src/pages/index.astro` contains `title="Know before you sign."` (decision 3).

**Implement** by adding the bare `noindex` attribute to the layout tag at these lines:

| File | Line |
|---|---|
| `src/pages/404.astro` | 9 |
| `src/pages/auth/signin.astro` | 10 |
| `src/pages/auth/signup.astro` | 10 |
| `src/pages/auth/forgot-password.astro` | 10 |
| `src/pages/auth/reset-password.astro` | 17 |
| `src/pages/profile.astro` | 51 |
| `src/pages/review/new.astro` | 121 |
| `src/pages/review/edit/[id].astro` | 50 |
| `src/pages/dispute.astro` | 6–9 (multi-line tag) |
| `src/pages/email-verified.astro` | 7 |
| `src/pages/bug-report.astro` | 5 |
| `src/components/admin/AdminLayout.astro` | 38 (covers all 12 admin pages) |

In `src/pages/search.astro`:
- import `isSearchVariant` from `'../lib/seo'` in the frontmatter
- add `noindex={isSearchVariant(Astro.url)}` to the tag at line 178

Plain `/search` stays indexable and in the sitemap. Any `q`, `type` or page parameter is noindexed.

In `src/pages/index.astro:6`, change `title="Home"` to `title="Know before you sign."`, or to the copy chosen in decision 3.

`robots.txt` still blocks most of these paths, so compliant crawlers never see their noindex. It is defence in depth that satisfies SEO-03 and holds if the Disallow list ever changes. Say so in the PR. Do not change `robots.txt`.

### Step 8: SEO-06 head checks (`src/lib/__tests__/namedPartySsrVisibility.test.ts`)

Extend the existing suite, which renders the landlord, property-manager and search pages against the SQLite D1 double. Its `testLocals` has no `SITE_URL`, so the fallback origin applies. Add:

```ts
function headHtml(html: string): string {
  const match = html.match(/<head>([\s\S]*?)<\/head>/);
  if (!match) throw new Error('Rendered page is missing <head>');
  return match[1];
}
```

Then add these tests:

1. **Thin landlord.** `renderDetail(db, LandlordPage, 'landlord', 'thin-data-landlord')`:
   - the head does not contain `4.8` (the hidden two-review aggregate)
   - it contains none of `landlord-thin-1`, `landlord-thin-2`, `landlord-thin-review-1` or `"landlord-thin"` (internal ids)
   - the canonical and `og:url` are `https://ratemyplace.org/landlord/thin-data-landlord`
2. **Thin property manager.** The same checks for `PropertyManagerPage` / `thin-data-manager`, with `4.7` and the `manager-thin…` ids.
3. **Search query.** `renderSearch(db, 'Thin Data')`:
   - the head contains `<meta name="robots" content="noindex, follow">`
   - it has no `rel="canonical"` and no `og:url`
   - it does not contain `4.8`

Do not tick SEO-06, which also covers the sitemap.

### Step 9: docs

**`src/lib/AGENTS.md`**
- In `runtime.ts — the only way to reach the Cloudflare runtime` (line 81), add a paragraph on `maybeEnv(locals)`:
  - it is only for render paths that must never throw and have a default for every value they read (today, BaseLayout's head)
  - it returns undefined with no runtime, and when the Astro 6+ adapter's throwing getter fires; it logs once per isolate
  - everything else keeps using `getEnv`
- In "Search, page metadata, and the sitemap" (line 294), rewrite the `buildingMeta.ts` bullet:
  - the neighbourhood is named only when `bostonLocalityName` recognises it, in display spelling
  - East and South Boston drop the suffix, and Boston is never named twice
  - junk or out-of-city values fall back to `, Boston`
  - twin parcels at one address and ZIP share a title by design
- In the same section, add a `seo.ts` bullet:
  - canonical and `og:url` come from `SITE_URL` through `siteOriginFrom`, which never throws
  - the query string is dropped and the trailing slash stripped, matching the sitemap form
  - noindex pages carry neither tag
  - `isSearchVariant` noindexes `/search` with any parameter
  - `DEFAULT_OG_IMAGE` is guarded by `ogImage.test.ts`
  - page classification is enforced by `pageIndexing.test.ts`
- In the `bostonLocalities.ts` bullet, mention `bostonLocalityName` as a fourth consumer of the vocabulary.

**`AGENTS.md`, Traps:** add one bullet.
- The social image is a committed PNG, mirrored in `public/brand/social/` and `brand/social/`.
- It is rendered from `brand/social/og-default.html` by `npm run og:render`, which needs network and Playwright Chromium.
- Platforms cache previews by image URL, so a replacement uses a new filename and updates `DEFAULT_OG_IMAGE.path`.
- Every new page must be classified in `pageIndexing.test.ts`.
- Until October 2026 the OG tags were relative and pointed at a missing file.

**`docs/superpowers/specs/2026-09-08-boston-coverage-design.md`:** below the "Metadata is narrower than the sketch" blockquote (line 520), add an amendment note for the October 2026 title and description format.

**`brand.md`, gated on decision 4:**
- §11 assets table:
  - Row `brand/social/og-default.png`: status **Final**. Description: "Default link-preview image (1200×630): centred full lockup, tagline, primary message. Rendered from `brand/social/og-default.html` by `npm run og:render`; served copy `public/brand/social/og-default.png`, byte-identical (checked by `ogImage.test.ts`)."
  - Add a row `brand/social/og-default.html` | **Editable** | the template.
  - Row `og-homepage.png`: "Not made: the homepage uses `og-default.png`, which already carries the tagline."
- §11 OG image rules: replace the top-left, 48–60px and 18px bullets with:
  - "Full lockup centred, at least 360px drawn width (120px in a 400px feed card), clear space of half the mark's height."
  - "Instrument Serif headline at 128px."
  - "Inter secondary line at 32px, two lines at most."
  - "Lockup and text inside the centre 630×630 square and at least 15px from the top and bottom."
  - "No eyebrow unless its copy is true of every page and it is at least 36px."
  - Keep the Paper and no-photographs bullets.
- Tick the §12 "OG image" item.
- Add a §13 row: `1.5 | October 2026 | Default OG image shipped; OG rules revised for feed-card legibility and square crops.`

**`.planning/milestones/v1.6.0-REQUIREMENTS.md`:** tick SEO-01, SEO-02 and SEO-03 only after the production checks in §6 pass. Add the SEO-06 carve-out line only if Step 4b ships.

## 5. Local verification

1. In the worktree, run `npm run check && npm test && npm run build`. All three must be clean.
2. `dist/brand/social/og-default.png` exists, and `dist/_routes.json` `exclude` lists `/brand/social/og-default.png`, so the asset is served statically and never reaches the Worker.
3. **Recount titles against production before merge.** Export with this read-only SELECT:

   ```
   npx wrangler d1 execute ratemyplace-db --remote --json --command "SELECT b.slug, b.address, b.city, b.neighborhood, b.zip_code, b.parcel_id, b.source, (SELECT COUNT(*) FROM reviews r WHERE r.building_id = b.id AND r.status = 'approved') AS approved FROM buildings b" > <scratch>/rows.json
   ```

   Save the script below as `<scratch>/verify-titles.mts`, outside the repo. It folds the JSON string `"null"` back to `null` (the migrations/AGENTS.md trap) and imports the real `buildingPageMeta` from the worktree.

   ```ts
   // Usage: npx tsx verify-titles.mts <path to src/lib/buildingMeta.ts> <wrangler --json export>
   import fs from 'node:fs';
   import { pathToFileURL } from 'node:url';
   const [metaPath, rowsPath] = process.argv.slice(2);
   const { buildingPageMeta } = await import(pathToFileURL(metaPath).href);
   const raw = JSON.parse(fs.readFileSync(rowsPath, 'utf8'));
   const rows: Record<string, unknown>[] = Array.isArray(raw) && raw[0]?.results ? raw[0].results : raw;
   for (const r of rows) for (const k of Object.keys(r)) if (r[k] === 'null') r[k] = null;
   const metas = rows.map((r) => ({ r, m: buildingPageMeta(r, Number(r.approved)) as { title: string; description: string } }));
   function collisions(key: 'title' | 'description') {
     const groups = new Map<string, typeof metas>();
     for (const x of metas) groups.set(x.m[key], [...(groups.get(x.m[key]) ?? []), x]);
     const dup = [...groups.values()].filter((g) => g.length > 1);
     return { groups: dup.length, urls: dup.reduce((n, g) => n + g.length, 0),
       differentAddressOrZip: dup.filter((g) => new Set(g.map(({ r }) => `${r.address}|${r.zip_code}`)).size > 1).length };
   }
   // A place named twice puts Boston in two comma segments; a street named Boston does not.
   const bostonSegments = (t: string) => t.split(',').slice(1).filter((s) => /\bboston\b/i.test(s)).length;
   console.log('titles', collisions('title'), 'max length with suffix', Math.max(...metas.map(({ m }) => `${m.title} | RateMyPlace`.length)));
   console.log('descriptions', collisions('description'), 'max length', Math.max(...metas.map(({ m }) => m.description.length)));
   console.log('place named twice', metas.filter(({ m }) => bostonSegments(m.title) > 1).length);
   ```

   Run `npx tsx <scratch>/verify-titles.mts src/lib/buildingMeta.ts <scratch>/rows.json` from the worktree.
   - Expected on main: titles `{groups:292, urls:711, differentAddressOrZip:177}`.
   - Expected after this branch: titles `{groups:≈120, urls:≈358, differentAddressOrZip:0}`, max length 70; descriptions the same counts (or 0 groups with Step 4b), max length 168; `place named twice 0`.
   - Small drift is fine as the city-wide fill adds rows. **`differentAddressOrZip` must be 0.**
4. Run `/qa`. Pay particular attention to building pages: seeded with no review, reviewed (`/building/27-lanark-road-boston`), New Haven, and an unknown slug that rewrites to the 404.

## 6. Preview and production checks

**Preview deploy**
- Preview cannot run Turnstile (its sitekey is not allowlisted for `pages.dev`) or the map (no Maps key), per AGENTS.md. This change touches neither, but QA on preview cannot cover them either.
- Run `curl -s https://<preview>.ratemyplace-64y.pages.dev/about | grep -o '<link rel="canonical"[^>]*>'`. Expect `https://ratemyplace.org/about`: preview has no `SITE_URL` and falls back to production.
- Fetch `/brand/social/og-default.png` on the preview host itself: expect 200 `image/png`.
- Preview's `og:image` points at the production host, so it 404s there until the production deploy. This is expected.

**Production, after merge and auto-deploy** (Git Bash)

1. `curl -sI https://ratemyplace.org/brand/social/og-default.png` returns 200, `content-type: image/png`, and a content-length under 300000.
2. Check the dimensions:

   ```
   curl -s https://ratemyplace.org/brand/social/og-default.png -o og.png && node -e "const b=require('fs').readFileSync('og.png');console.log(b.readUInt32BE(16),b.readUInt32BE(20))"
   ```

   Expect `1200 630`.
3. Social crawlers. Expect 200 for every pair:

   ```
   for ua in 'facebookexternalhit/1.1' 'Twitterbot/1.0' 'LinkedInBot/1.0' 'Slackbot-LinkExpanding 1.0'; do echo "$ua $(curl -s -o /dev/null -w '%{http_code}' -A "$ua" https://ratemyplace.org/) $(curl -s -o /dev/null -w '%{http_code} %{content_type}' -A "$ua" https://ratemyplace.org/brand/social/og-default.png)"; done
   ```

4. For each URL below, run `curl -s URL | grep -oE '<title>[^<]*|<link rel="canonical"[^>]*>|<meta (name|property)="(robots|og:url|og:image|og:site_name|twitter:card)"[^>]*>'`.

   | URL | Expected |
   |---|---|
   | `/` | title `Know before you sign. \| RateMyPlace`; canonical and `og:url` `https://ratemyplace.org/`; absolute `og:image`; `twitter:card` `summary_large_image` |
   | `/about/` | canonical `https://ratemyplace.org/about` |
   | `/search` | canonical; no robots |
   | `/search?q=lanark` | robots `noindex, follow`; no canonical; no `og:url` |
   | `/auth/signin` | noindex; no canonical |
   | `/no-such-page` | status 404, with noindex |
   | `/building/6-prescott-street-boston` | `6 Prescott Street, East Boston \| RateMyPlace` |
   | `/building/6-prescott-street-boston-2` | `6 Prescott Street, Hyde Park, Boston \| RateMyPlace` |
   | `/building/14-16-derne-street-boston` | `14-16 Derne Street, Boston \| RateMyPlace` |
   | `/building/850-dorchester-avenue-boston` | `850 Dorchester Avenue, Dorchester, Boston \| RateMyPlace` |
   | `/building/1715-commonwealth-avenue-boston` | `1715 Commonwealth Avenue, Boston \| RateMyPlace` |
   | `/building/27-lanark-road-boston` | **unchanged**: `27 Lanark Road \| RateMyPlace` |
   | `/building/282-lexington-street-boston` and `-2` | the same title, by design |

5. `curl -s https://ratemyplace-64y.pages.dev/about | grep canonical` gives `https://ratemyplace.org/about`. This is informational only: that host serves `Disallow: /`, so SAFE-10 is still the real fix.
6. `curl -s https://ratemyplace.org/sitemaps/static.xml` and `/robots.txt` are unchanged.
7. Public validators that need no login: `https://www.opengraph.xyz/url/https%3A%2F%2Fratemyplace.org%2F` and `https://metatags.io/?url=https://ratemyplace.org`. Also paste the link into Slack or iMessage.
8. Owner, logged in:
   - In the Facebook Sharing Debugger, run "Scrape Again" on `https://ratemyplace.org/`.
   - Use the LinkedIn Post Inspector on the same URL.
   - Both flush cached previews that have no image.
   - In Search Console, run URL Inspection and "Test live URL" on a seeded building page to confirm the user-declared canonical.
9. Tick SEO-01, SEO-02 and SEO-03 (Step 9).

## 7. What not to change

- `src/pages/robots.txt.ts`, `src/lib/sitemap.ts` and `STATIC_SITEMAP_PATHS`.
- `buildings.updated_at`, or any DB row. A title change is not a content change for sitemap `lastmod`.
- Slugs. Never regenerate them.
- The review-metadata branch of `buildingPageMeta`, and the jurisdiction, parcel and zero-review eligibility rule.
- Existing functions in `locality.ts`, and `bostonLocalities.ts`. Only `bostonLocalityName` is added.
- Do not noindex building, landlord or property-manager pages, or any sitemap page.
- Do not add `trailingSlash` to `astro.config.mjs`; it changes routing and redirects. Do not add `site` either: it does not change routing, but it is build-time, whereas the canonical comes from `SITE_URL` at request time so preview and production share one build.
- BaseLayout's font loading lines.
- `brand/*.svg` and `public/brand/*.svg`. The lockup is cropped only in the render page's DOM.
- Scoring, privacy fuzzing, records, and search SQL.
- `robots.txt` content.
- Do not reintroduce `(locals as any).runtime`, and add no new `any`.
- Do not use `getEnv` in BaseLayout.

## 8. Follow-ups (out of scope)

- **Header wordmark.** `Header.astro` loads `logo-lockup.svg` as an `<img>`, so "RateMyPlace" renders in Times. It also does not crop the viewBox. Inline the SVG, or outline the text.
- SEO-05: JSON-LD.
- SEO-07: smoke probes for the image, canonical and noindex in `src/lib/smoke.ts`.
- SEO-06: sitemap-side assertions.
- SAFE-10: redirect the production `pages.dev` host.
- Junk neighbourhood values on user rows, for example add `St. Elizabeth's` → Brighton to `BOSTON_SUB_AREAS`.
- The review-metadata description still prints raw `displayLocality`.
- Descriptions for `/search` and the auth pages.
- An index policy for landlord pages with no approved reviews.
- brand.md §11 lists IG templates and PNGs that are not in the repo.
