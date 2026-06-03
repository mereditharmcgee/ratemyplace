# RateMyPlace Brand Handbook

> **Status:** v1.4 · Living document
> **Repo path:** `/brand.md`
> **Scope:** Codify the existing visual system with a small number of deliberate upgrades that shift the site from "AI-default" to "made by someone with a point of view." This is not a redesign. Every rule below is implementable against the current Astro + Tailwind 4 codebase without structural change.
>
> **Relationship to the brand bible (v1.0):** The brand bible is the canonical brand document, the source of truth for foundation, voice, visual identity, and platform application. This handbook is its code-level companion: the Tailwind tokens, component classes, and migration steps that turn the identity into shipped pages. Where the two disagree, the bible wins. The canonical primary message is **"A public record of rental housing, from the people who know it best."** The shorter tenant-facing variant **"A public record for renters"** is retired as a primary line and remains only as a mid-sentence descriptor when the full message doesn't fit.

---

## 1. What we are

RateMyPlace is **a public record of rental housing, from the people who know it best.** We help tenants make informed decisions about where they live by publishing honest, verified reviews weighted by the health and safety factors that actually affect their lives.

We are not Yelp for apartments. We are closer to **a public health department with a comment section.** (That line is now in the bible's positioning section too.)

Our moat is our methodology. Our job, visually, is to make people trust it on first impression.

---

## 2. Voice

### The voice principles

1. **First-person plural, tenant-side.** "We believe every renter deserves access to honest information." Not "we empower renters", we don't empower anyone, we publish the record.
2. **Short, declarative, unornamented.** "Renters can't afford to be picky. They can't get honest answers. And they have nowhere to check." Every clause a hammer.
3. **Specific over sweeping.** "15 maintenance requests" not "lots of maintenance requests." "Fall 2023" not "a while back." Numbers and names build trust; vagueness erodes it.
4. **Public-health cadence, not marketing cadence.** We cite sources in full (Joint Center for Housing Studies, Harvard; University of Kansas Housing Survey). We don't say "studies show."
5. **Direct about harm.** When a review describes mold, we call it mold. We don't soften, we don't editorialize.
6. **No startup vocabulary.** Never: platform, solution, empower, democratize, disrupt, seamless, reimagined, one-stop. Allowed: tool, record, review, report, verify, document.

### The tagline

> **Know before you sign.**

It works on every surface: homepage hero, IG bio, OG image, business card. Do not rewrite, shorten, or extend it. Pair it with the product name only when both fit comfortably; otherwise use one or the other.

### Example do / don't

| Don't | Do |
|---|---|
| "A platform empowering renters with transparency." | "A public record for renters." |
| "Reviews are moderated to ensure quality." | "Reviews are checked for guideline compliance before publishing." |
| "Share your rental journey!" | "Write a review. The next tenant will read it." |
| "Our AI-powered scoring system" | "Our scoring is weighted by peer-reviewed research." |

---

## 3. Values

Three, in priority order:

1. **Tenant-side by default.** When a design decision could favor the reviewer or the reviewed, we favor the reviewer, except where fairness (verification, dispute, retaliation) requires otherwise.
2. **Privacy as identity.** Season dates not exact dates, no unit numbers displayed, no PII on reviews. Make the privacy design visible, not buried. The season chip is a brand element.
3. **Evidence, not vibes.** Every score weight traces to a citation. Every stat we publish is sourced inline. If we can't source it, we don't say it.

---

## 4. Color

The current Tailwind palette is correct. The fix is not new colors, it is **one warmer surface color** that replaces `bg-slate-50` everywhere, and a documented small-text map that survives the warmer background.

### The single deliberate tweak

| Name | Old | New | Where |
|---|---|---|---|
| **Paper** | `bg-slate-50` `#F8FAFC` | **`#F6F4EE`** | Default page sections that currently use `bg-slate-50`. Any "why trust us" card background. The 404 page. |

That's it. Slate-50 is the single most common AI-generated background color on the internet. Moving one value 4% warmer on the hue wheel is enough to read "this was chosen" without changing the product's identity. Keep white (`#FFFFFF`) as the card surface color inside Paper sections so cards still lift.

### The full palette, named

Names are for discussion and commit messages. Hex values are canonical.

| Role | Name | Hex | Tailwind |
|---|---|---|---|
| Brand primary | **Signal Teal** | `#0F766E` | `teal-700` |
| Brand primary (deep, hover / civic weight) | **Signal Teal (deep)** | `#115E59` | `teal-800` |
| Brand primary (surface / graphic fill only) | **Signal Teal (surface)** | `#0D9488` | `teal-600` |
| Ink (headlines, body) | **Ink** | `#0F172A` | `slate-900` |
| Ink (secondary) | **Graphite** | `#334155` | `slate-700` |
| Ink (tertiary / meta) | **Slate** | `#475569` | `slate-600` |
| Muted text | **Mist** | `#64748B` | `slate-500` |
| Page surface | **Paper** | `#F6F4EE` | *custom, see §4.1* |
| Card surface | **White** | `#FFFFFF` | `white` |
| Hairline rule | **Rule** | `#E2E8F0` | `slate-200` |
| Logo mark (lit window only) | **Warm Lamp** | `#F5E6A8` | *custom, icon-only, never elsewhere* |
| Good / verified | **Signal Green** | `#047857` | `emerald-700` |
| Good / fills | **Signal Green (surface)** | `#059669` | `emerald-600` |
| Mixed / stars | **Signal Amber** | `#F59E0B` | `amber-500` |
| Mixed text (required) | **Signal Amber (ink)** | `#A16207` | `amber-700` |
| Concerning / error | **Signal Red** | `#B91C1C` | `red-700` |

### Warm Lamp is a restricted color

Warm Lamp (`#F5E6A8`) appears **exclusively in the lit window of the logo mark** and nowhere else. Not in buttons, not in links, not in text, not in data visualizations, not as a hover state. It is a brand signature reserved for the mark. This discipline keeps the lit window specific and meaningful every time it appears. If you're reaching for Warm Lamp on any surface other than the logo, stop.

### 4.1 Paper in code

Add to `tailwind.config` theme extend, or as a CSS variable in `src/styles/global.css`:

```css
/* src/styles/global.css */
@import "tailwindcss";

@theme {
  --color-paper: #F6F4EE;
}
```

Then replace every occurrence of `bg-slate-50` with `bg-paper` in `src/pages/*.astro` and `src/components/**/*.{astro,tsx}`. That is the entire color migration.

### 4.2 Contrast rules (WCAG AA)

All text colors are verified against Paper `#F6F4EE`. Do not deviate.

| Use | Hex / Tailwind | Ratio on Paper | Notes |
|---|---|---|---|
| Body / headlines | `slate-900` | 16.2 : 1 | Default |
| Secondary text | `slate-700` | 9.4 : 1 | Lede copy, card subheads |
| Tertiary / meta | `slate-600` | 6.9 : 1 | Timestamps, breadcrumbs |
| Muted text | `slate-500` | 4.3 : 1 | **Large text only (≥18px)** |
| Link | `teal-700` | 5.0 : 1 | **Body-size links use teal-700, not teal-600** |
| Button surface | `teal-700` bg, white text | 5.5 : 1 | **Primary buttons are teal-700, not teal-600** |
| Good score text | `emerald-700` | 5.0 : 1 | Small text |
| Good score fill (pill, bar, icon) | `emerald-600` | n/a | Used with white text or as graphic fill only |
| Mixed score text | `amber-700` | 4.5 : 1 | Small text |
| Star icon | `amber-500` | n/a | Icon-as-data; contrast doesn't apply the same way |
| Concerning / error text | `red-700` | 5.9 : 1 | |

**Migration rules for Claude Code:**
- Find `bg-teal-600` used on a button → change to `bg-teal-700 hover:bg-teal-800`
- Find `text-teal-600` on body-size text → change to `text-teal-700`
- Find `text-amber-500` / `text-amber-600` on body text → change to `text-amber-700`
- Find `text-emerald-600` on body text → change to `text-emerald-700`
- Find `text-red-600` on body text → change to `text-red-700`
- Leave star icons, progress bar fills, and large display text using the 500/600 variants where they are, they are graphics, not prose.

### 4.3 Score color function (canonical)

Replace the stub in `CLAUDE.md`:

```ts
// src/lib/scoring-colors.ts
export function getScoreColor(score: number): { bg: string; text: string; label: string } {
  if (score >= 4)   return { bg: 'bg-emerald-600', text: 'text-white',      label: 'Good' };
  if (score >= 3)   return { bg: 'bg-amber-500',   text: 'text-white',      label: 'Mixed' };
  if (score >= 2)   return { bg: 'bg-amber-700',   text: 'text-white',      label: 'Concerning' };
  return              { bg: 'bg-red-700',     text: 'text-white',      label: 'Poor' };
}

export function getScoreTextColor(score: number): string {
  if (score >= 4) return 'text-emerald-700';
  if (score >= 3) return 'text-amber-700';
  return 'text-red-700';
}
```

---

## 5. Typography

### The one intentional pairing

> **Instrument Serif** (display only) + **Inter** (everything else)

**Keep Inter** for body, nav, buttons, forms, labels, data, tables, all 95% of the site. It's what's there, it works, it's accessible, and replacing it site-wide is expensive change for no clear gain.

**Introduce Instrument Serif** for display only: the H1 on the homepage hero, the methodology page's section openers, the large numeric stats ("37%"), and pull quotes in reviews. Nowhere else.

### Why Instrument Serif

1. **It's not overused.** Fraunces, Playfair, PT Serif, Source Serif are all in every design system. Instrument Serif is rarer and has a recognizable personality.
2. **It has warmth without being precious.** A slight calligraphic pull in the italic, a confident Roman upright. It reads "an editor picked this" not "a template used this."
3. **It's free on Google Fonts and loads in a single weight** (400 regular + 400 italic). One additional font file, not a site-wide retype.
4. **It holds up at display sizes.** Designed to be set large, 36px minimum, 48–96px sings.
5. **The italic is the move.** Use Instrument Serif italic sparingly on a single word or phrase for emphasis inside a sans headline, that single flourish becomes a brand fingerprint.

### Type scale

All sizes are Inter unless marked. Line-height in parentheses.

| Use | Size | Weight | Font | Tracking |
|---|---|---|---|---|
| Hero H1 | 56–72px (1.05) | 400 | **Instrument Serif** | -0.01em |
| Page H1 | 36–44px (1.1) | 700 | Inter | -0.015em |
| Section H2 | 24–28px (1.2) | 700 | Inter | -0.01em |
| Card title H3 | 18px (1.3) | 600 | Inter | 0 |
| Body | 16px (1.55) | 400 | Inter | 0 |
| Body (lede) | 18–20px (1.5) | 400 | Inter | 0 |
| Meta / caption | 13px (1.5) | 500 | Inter | 0.01em |
| **Eyebrow** | 12px (1) | 600 | Inter | **0.12em UPPERCASE** |
| Display number ("37%") | 48–72px (1) | 400 | **Instrument Serif** | -0.02em |
| Button | 14–15px | 600 | Inter | 0 |

### Loading

Instrument Serif is available two ways:

1. **Self-hosted (preferred, offline-safe):** the TTF files live in `brand/fonts/`. Inter is provided as a variable font (`Inter-VariableFont.ttf` + `Inter-Italic-VariableFont.ttf`, both `wght 100–900`), and Instrument Serif ships as regular + italic. Declare via `@font-face` and they'll load from the project.
2. **Google Fonts (fallback):** the `<link>` below keeps working if self-hosting isn't wired up for a given surface.

Add to `BaseLayout.astro` `<head>`:

```html
<style>
  @font-face{font-family:"Inter";src:url("/fonts/Inter-VariableFont.ttf") format("truetype-variations");font-weight:100 900;font-style:normal;font-display:swap;}
  @font-face{font-family:"Inter";src:url("/fonts/Inter-Italic-VariableFont.ttf") format("truetype-variations");font-weight:100 900;font-style:italic;font-display:swap;}
  @font-face{font-family:"Instrument Serif";src:url("/fonts/InstrumentSerif-Regular.ttf") format("truetype");font-weight:400;font-style:normal;font-display:swap;}
  @font-face{font-family:"Instrument Serif";src:url("/fonts/InstrumentSerif-Italic.ttf") format("truetype");font-weight:400;font-style:italic;font-display:swap;}
</style>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
```

Add to `tailwind.config` / `@theme`:

```css
@theme {
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-display: "Instrument Serif", Georgia, serif;
}
```

Then `font-display` is the opt-in class for display type. Default stays Inter.

### Rules

- **Instrument Serif is earned, not defaulted.** If you're reaching for it on a form label, you're wrong.
- The homepage H1 becomes `<h1 class="font-display text-6xl">Know before you sign.</h1>`, one line, one typeface, done.
- Large stat numerals in display serif are a brand signature. Any page that publishes numbers (methodology, about, building score summary) should use them.
- Italic word inside a sans headline: allowed once per page, zero times on app surfaces. Marketing pages only.

---

## 6. Logo usage

The mark is a hand-drawn vector silhouette of an urban apartment building: three floors, nine windows in a three-column grid, a flush-right door with a two-step stoop, and a small cornice overhang at the top. The center window of the middle floor is rendered in Warm Lamp (`#F5E6A8`) to signal **someone lives here.** This detail is the brand signature.

### The narrative

The building is the city. The lit window is the tenant. The mark is about the specific person who's home right now, writing a review. Every design decision in the mark supports this, the flush-right door that reads as a walk-up entrance, the double-hung windows that read as real apartments, the single warm window at dead center that reads as one specific life.

### Variants

| Variant | When | File |
|---|---|---|
| **Full lockup** (mark + "RateMyPlace" wordmark in Instrument Serif) | Site nav, OG images, press kit, formal deliverables, light surfaces | `brand/logo-lockup.svg` |
| **Reverse lockup** (silhouette mark + wordmark in white) | Dark surfaces: dark OG images, dark headers, dark email | `brand/logo-lockup-reverse.svg` |
| **Reverse lockup, teal** (full-color building + white wordmark) | Dark surfaces where a colored building reads better than a silhouette | `brand/logo-lockup-reverse-teal.svg` |
| **Mark only** | Favicon, IG PFP, app icon contexts, anywhere ≤ 40px | `brand/logo-mark.svg` |
| **Utility lockup** (mark + "RateMyPlace" wordmark in Inter Bold) | Email signatures, small-format contexts where the serif feels too editorial | `brand/logo-lockup-utility.svg` |
| **Ink only** (single color) | Print, fax, one-color email signatures | `brand/logo-mark-ink.svg` |
| **Reverse mark** (silhouette with the lit window) | Dark backgrounds; the footer uses it | `brand/logo-mark-reverse.svg` |

### Committed colors

- Building: **Signal Teal** `#0F766E`
- Windows and door frame: **Paper** `#F6F4EE`
- Lit window (center of middle floor): **Warm Lamp** `#F5E6A8`

Three colors, no more. The amber lit window always appears as amber; it is never recolored to match the background. The building is always teal; it is never outlined, gradient-filled, or shadowed.

### Minimum sizes

| Context | Min size |
|---|---|
| Mark alone | 24px digital / 18px print (below 24px, lit window detail softens but silhouette still reads to 16px for favicons) |
| Full lockup | 120px wide digital / 1 inch print |

### Clear space

Around the full lockup: **half the mark's height** on all sides. Around the mark alone: **a quarter of its height** on all sides. No other element (text, rule, illustration) inside that zone.

### Don'ts

- **Never change the Warm Lamp color** on the lit window. It is always `#F5E6A8`.
- **Never move the lit window** from the center of the middle floor. Its position is the signature.
- **Never remove the lit window.** A building without the lit window is not the RateMyPlace mark.
- **Never recolor the building** to a teal lighter or brighter than `#0F766E`.
- **Never outline the mark**, add a drop shadow, or apply a gradient to any part.
- **Never stretch or skew.**
- **Never add filters**, textures, weathering, or distressed effects.
- **Never place on busy photography or patterned backgrounds** where the windows lose legibility. If the mark needs to sit on a dark surface, use the reverse variant (paper building silhouette with the amber lit window preserved), which now ships as `brand/logo-mark-reverse.svg` for the mark and `brand/logo-lockup-reverse.svg` for the lockup.

### Refinement schedule

The mark's geometry is considered final through end of year 2026. A polish pass is scheduled for H2 2026 once the platform has more surface area to evaluate against (the three treatments, ink-only, reverse, and full-color, may receive subtle proportion adjustments; the silhouette, color system, and lit-window signature will not change).

---

## 7. Component fingerprint

These are the small deliberate deviations from Tailwind defaults that make the site read as "made" instead of "generated." Every rule is one change, easy to apply globally.

### 7.1 Radius

> **Default card radius is `6px`, not `8px`.**

Tailwind's `rounded-lg` (8px) is the single most common AI-default. Moving to `6px` is small enough that nothing looks weird, distinct enough that side-by-side it reads as chosen.

Implementation:

```css
@theme {
  --radius-card: 0.375rem;   /* 6px */
  --radius-input: 0.25rem;   /* 4px */
  --radius-pill: 9999px;
}
```

| Element | Old | New |
|---|---|---|
| Cards, panels, alerts | `rounded-lg` (8px) | `rounded-[6px]` or `rounded-card` |
| Buttons, inputs, selects | `rounded-lg` | `rounded-[4px]` or `rounded-input` |
| Pills, badges, star chips | `rounded-full` | unchanged |
| Score stamp (square wrapper) | `rounded-md` | `rounded-[2px]` |

### 7.2 Borders vs shadows

> **Cards use a 1px hairline border by default. Shadow is a hover state, not a rest state.**

This is the single biggest feel-shift. AI-default cards float with `shadow-sm` and no border. That's the tell. Real editorial and civic sites almost always use borders.

Implementation rule, replace this pattern:

```html
<!-- before -->
<div class="bg-white p-6 rounded-lg shadow-sm">…</div>
```

with:

```html
<!-- after -->
<div class="bg-white p-6 rounded-[6px] border border-slate-200 hover:shadow-sm transition-shadow">…</div>
```

Exception: floating UI (dropdowns, tooltips, modals) keeps shadow because it needs to communicate elevation above the page. Everything else is borders.

### 7.3 Buttons

> **Primary button is `bg-teal-700`, weight `600`, radius `4px`, no uppercase.**

```html
<!-- primary -->
<button class="bg-teal-700 hover:bg-teal-800 text-white font-semibold rounded-[4px] px-5 py-2.5 transition-colors">
  Write a review
</button>

<!-- secondary -->
<button class="bg-white hover:bg-paper text-slate-900 border border-slate-300 font-semibold rounded-[4px] px-5 py-2.5 transition-colors">
  Learn more
</button>

<!-- ghost -->
<button class="text-teal-700 hover:text-teal-800 font-semibold hover:underline transition-colors">
  Read methodology →
</button>
```

Button copy is always sentence case, never Title Case, never UPPERCASE. "Write a review" not "Write A Review" not "WRITE A REVIEW."

### 7.4 Eyebrow (the signature section marker)

> **Every major marketing section opens with an uppercase tracked eyebrow above the heading.**

This already exists in the deck ("NEW HAVEN, CONNECTICUT · 2023–2025"). Codify it on the site.

```html
<p class="text-xs font-semibold uppercase tracking-[0.12em] text-teal-700 mb-3">
  A public record for renters
</p>
<h2 class="text-2xl font-bold text-slate-900">How it works</h2>
```

Use on: homepage sections, about page section heads, methodology page, building page score summary ("AGGREGATE SCORE · 21 REVIEWS"), OG images.

Don't use on: app surfaces (the review form, admin pages, the tenant dashboard). Marketing and editorial only.

### 7.5 Spacing rhythm

> **Marketing sections use 80px vertical padding (`py-20`), not 64px (`py-16`). App surfaces use 48px (`py-12`).**

The current site uses `py-16` everywhere. Pushing marketing to `py-20` gives it more breathing room and makes the app surfaces feel denser-by-contrast, which is correct, an app should feel efficient, a pitch page should feel considered.

### 7.6 Stat treatment

Any published number ≥36px is set in Instrument Serif, followed by a small all-caps mono-style citation in `slate-600` (slate-500 fails WCAG AA at this size).

```html
<div class="border-l-2 border-slate-900 pl-5">
  <p class="font-display text-6xl leading-none tracking-tight text-slate-900">37%</p>
  <p class="mt-2 text-sm text-slate-700 max-w-[26ch]">of renters sign a lease without seeing the apartment in person.</p>
  <p class="mt-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-600">Apartments.com, 2024</p>
</div>
```

The left hairline rule replaces the Tailwind-default rounded card for stats. Apply on the about page, methodology, homepage "why trust us," and any future marketing surface.

### 7.7 Season chip (brand element)

The privacy design is an identity element, not something hidden in the footer. The season chip is small, bordered, mono-tracked, and shows up on every review card.

```html
<span class="inline-block border border-slate-900 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-900 rounded-[2px]">
  Fall 2023 · Summer 2024
</span>
```

Use wherever a move-in/move-out date is displayed.

---

## 8. Imagery & illustration

### Principles

1. **We do not use stock photography of smiling people in apartments.** Ever. That's the single fastest way to look like every other rental site.
2. **We prefer typography and data over imagery on marketing surfaces.** Stats, quotes, and lists do more work than photos.
3. **When we use photographs, they are of buildings, not people.** Neutral, documentary, flat light. Think Zillow listing photo or a city assessor's database, not a real-estate brochure.
4. **No illustrations of houses, keys, or hands holding keys.** No abstract geometric "concept" art. The mark is the only illustration we have.
5. **Icons are line icons at 1.5–2px stroke width, never filled.** Match the spirit of the logo mark. Use Heroicons or Lucide outline variants; do not invent new icons.
6. **Data visualizations are the exception.** Score bars, maps, histograms, these are welcome and should be rendered with the documented palette.

### When you need a visual and don't have a photo

- Set a large stat in Instrument Serif.
- Pull quote from a review, set in italic serif, attributed as "Verified tenant · Fall 2023."
- A map of Boston with building markers.
- A hairline-rule structural diagram (like the scoring-methodology page).

None of these require a designer or a stock site.

### Review screenshots / case study imagery

When we publish a review or case study on social, we use a typographic treatment of the review text itself (see §10 IG post template), never a photograph of the building.

---

## 9. Motion

Small rules, codified once.

- **Default transition: 150ms ease-out.** `transition-colors`, `transition-shadow`, `transition-opacity`. Never `transition-all` (it animates layout, breaks on reflow).
- **No entrance animations on page load.** No fade-ins on scroll, no staggered reveals. A civic document loads. It does not perform.
- **Hover only on devices that support hover.** Wrap any non-essential hover reveal in `@media (hover: hover)`.
- **The one allowed flourish:** the score number on a review card counts up on first scroll-into-view, once. 400ms, ease-out. Skip if `prefers-reduced-motion: reduce`.

---

## 10. Social & Instagram

### Accounts

- **Instagram:** `@ratemyplace` (or the available handle, document actual on file)
- **Bluesky / X / Threads:** same handle across all
- **Bio (canonical copy):**

  > Know before you sign.
  > A public record for renters.
  > Verified reviews · Evidence-based scoring
  > ratemyplace.org

### Profile picture

Mark on ink `#0F172A` background. Use `brand/social/ig-pfp.png`, 1080×1080 with the mark centered at ~60% of the frame. See §11 for generated asset.

### Post template (1080×1350)

Single codified treatment. Works for three post types:

1. **Stat post**, large Instrument Serif numeral + one-sentence context + source citation + logo.
2. **Review pullquote post**, italic serif quote + attribution ("Verified tenant · Fall 2023") + logo.
3. **Educational post**, uppercase eyebrow + sans headline + 2–3 bullet facts + logo.

All share: Paper background, slate-900 ink, one accent (teal-700), hairline rule above logo, eyebrow-style "ratemyplace.org" at bottom. See `brand/social/ig-post-template.html` for the editable source.

### Story / highlight cover (1080×1920)

Single-mark icon on Paper with one-word label in Inter 800 tracked wide. Used for highlight categories: **Methodology · Reviews · Disputes · Press · Updates**.

### Do / don't

- **Do** post a single verified review each week with the reviewer's consent, using the pullquote template.
- **Do** post a new stat each month tied to a public housing report.
- **Don't** post memes, reaction images, or "types of landlords" listicles. We are not that kind of account.
- **Don't** use emojis in captions. One allowed exception: a 🏠 as the final character in bio/pinned content if visual balance requires.
- **Don't** use Instagram filters or color grading on any photos we publish.

---

## 11. Assets

These files exist in the repo under `brand/` and are the canonical source for every surface. Do not regenerate without updating this section.

| File | Status | Use |
|---|---|---|
| `brand/logo-mark.svg` | **Final** | Primary logo mark. Three-color urban apartment building with amber lit window. Source of truth. |
| `brand/favicon.svg` | **Final** (copy of `logo-mark.svg`) | Site favicon (16px safe). |
| `brand/logo-mark-ink.svg` | **Final** | Monochrome mark in Ink `#0F172A` for print, fax, and single-color email signatures. Window cutouts inherit surface color (transparent). No amber lit window. |
| `brand/logo-mark-reverse.svg` | **Final** | Paper `#F6F4EE` building silhouette with transparent window cutouts and preserved Warm Lamp `#F5E6A8` lit window. For dark surfaces. The brand's strongest dark-mode moment. |
| `brand/logo-lockup.svg` | **Final** | Editorial lockup (mark + "RateMyPlace" in Instrument Serif Regular). For OG images, press kit, marketing-page nav. |
| `brand/logo-lockup-utility.svg` | **Final** | Utility lockup (mark + "RateMyPlace" in Inter Bold). For email signatures, footers, and small-format contexts. |
| `brand/logo-lockup-reverse.svg` | **Final** | Reverse lockup (silhouette mark + "RateMyPlace" wordmark in white). Primary dark-surface lockup; matches the reverse mark. For dark OG images, dark headers, dark email. |
| `brand/logo-lockup-reverse-teal.svg` | **Final** | Reverse lockup with full-color teal building and white wordmark. Alternate for dark surfaces where a colored building reads better than the silhouette; its teal building intentionally differs from the reverse mark. |
| `brand/social/ig-pfp.png` | Regenerate with final mark | Instagram profile picture (1080×1080). Recommended: reverse mark on Signal Teal background, the amber lit window pops most against teal. |
| `brand/social/ig-highlight.png` | Regenerate with final mark | Instagram highlight cover (1080×1920). |
| `brand/social/ig-post-template.html` | Editable | Post template, three variants (stat, quote, educational). Logo slot now uses final mark. |
| `brand/social/ig-story-template.html` | Editable | Story / highlight cover template. |
| `brand/social/og-default.png` | Regenerate with final mark | Default OG image (1200×630) with editorial lockup top-left. |
| `brand/social/og-homepage.png` | Regenerate with final mark | Homepage OG image with tagline. |

### OG image rules

- Dimensions 1200×630 (the standard).
- Paper background by default.
- Full lockup top-left.
- Large Instrument Serif headline (48–60px).
- One-line Inter secondary text at 18px.
- No photographs. No gradients beyond the mark's own.

---

## 12. Implementation checklist for Claude Code

When applying this handbook to the existing codebase, execute in this order. Each step is isolable and reviewable as its own PR.

- [ ] **Fonts**. Add Inter + Instrument Serif `<link>` to `BaseLayout.astro`. Add `--font-sans` and `--font-display` to `@theme` in `src/styles/global.css`.
- [ ] **Paper color**. Add `--color-paper: #F6F4EE` to `@theme`. Find-and-replace `bg-slate-50` → `bg-paper` across `src/pages/**` and `src/components/**`.
- [ ] **Contrast migration**. Apply the small-text rules in §4.2: `text-teal-600` → `text-teal-700` on body text; `text-amber-500/600` → `text-amber-700` on body text; `text-emerald-600` → `text-emerald-700` on body text; `text-red-600` → `text-red-700`.
- [ ] **Buttons**. Replace primary button color `bg-teal-600` → `bg-teal-700 hover:bg-teal-800`. Ensure `font-semibold` and `rounded-[4px]`.
- [ ] **Card radius + borders**. Global replace `rounded-lg shadow-sm` (on non-floating surfaces) → `rounded-[6px] border border-slate-200 hover:shadow-sm transition-shadow`.
- [ ] **Hero H1**. On `src/pages/index.astro`, change the H1 to `<h1 class="font-display text-5xl sm:text-6xl md:text-7xl font-normal tracking-tight leading-[1.05]">Know before you sign.</h1>`. Remove the `font-bold`.
- [ ] **Eyebrows**. Add eyebrow `<p>` above each major marketing section H2. Copy already written in §7.4.
- [ ] **Score color function**. Create `src/lib/scoring-colors.ts` per §4.3. Refactor `ReviewCard.astro` and any inline color logic to import from it.
- [ ] **Season chip**. Extract into `src/components/ui/SeasonChip.astro`, apply on all review surfaces.
- [ ] **Spacing**. Change `py-16` → `py-20` on marketing sections (homepage, about, methodology). Leave app surfaces at `py-12`.
- [ ] **Logo**. Replace `public/favicon.svg` with `brand/logo-mark.svg` (the final three-color mark). Ensure `--color-warm-lamp: #F5E6A8` is added to `@theme` for any inline SVG needs. Mark-only and lockup variants go in `brand/` per the asset table in §11.
- [ ] **OG image**. Replace existing OG image with `brand/social/og-default.png`. Ensure `BaseLayout.astro` references it with correct `og:image` tag.

Estimated effort: one focused day of work by one engineer, or one Claude Code session.

---

## 13. Revisions

| Version | Date | Change |
|---|---|---|
| 1.0 | April 2026 | Initial handbook. Codifies existing teal + slate palette, introduces Paper `#F6F4EE`, documents Inter + Instrument Serif pairing, locks contrast rules, specifies component fingerprint deviations from Tailwind defaults. |
| 1.1 | April 19, 2026 | **Logo section overridden**, mark is in active redesign, see `icon-design-brief.md`; placeholder usage documented. **Primary message reconciled** to the canonical bible line, "A public record of rental housing, from the people who know it best." **Teal depth committed to teal-700** as brand primary for civic weight; teal-600 demoted to surface/graphic-fill role. **"Public health department with a comment section"** flagged for addition to the bible's positioning section. IG PFP and highlight cover flagged as placeholders pending new mark. |
| 1.2 | April 20, 2026 | **Logo finalized.** Mark is now a hand-drawn vector urban apartment building with three floors, nine-window grid, flush-right door with two-step stoop, and amber lit window at dead center of the middle floor. Section 6 rewritten with full usage spec (variants, committed colors, minimum sizes, clear space, don'ts). **Warm Lamp `#F5E6A8` added to palette** as an icon-only restricted color. Assets table (§11) updated: `logo-mark.svg` is final; ink-only, reverse, and lockup variants scheduled for Claude Design polish pass. Placeholder asset flags removed. |
| 1.3 | April 26, 2026 | **Logo asset set complete.** Claude Design polish pass delivered four final SVG variants: `logo-mark-ink.svg` (monochrome, transparent window cutouts), `logo-mark-reverse.svg` (paper silhouette on dark, amber lit window preserved), `logo-lockup.svg` (editorial, Instrument Serif), and `logo-lockup-utility.svg` (Inter Bold). All four marked Final in §11. Ready for site migration. |
| 1.4 | June 2026 | **Synced to brand bible v1.0.** Added two reverse lockups, `logo-lockup-reverse.svg` (silhouette mark plus white wordmark) and `logo-lockup-reverse-teal.svg` (full-color teal building plus white wordmark), to the variants table in §6 and the assets registry in §11. Fixed the §7.6 stat citation from `slate-500` to `slate-600` so it clears WCAG AA at 11px. Updated §1 to name the brand bible v1.0 as the canonical brand document, with this handbook as its code-level companion. Refreshed the stale reverse-variant note in §6. Removed em dashes throughout for voice consistency with the bible. |

---

*Maintained by the brand owner. Challenge before extending.*
