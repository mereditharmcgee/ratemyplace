# Handoff to Claude Code: bring the site in line with brand v1.0

*Written June 2026, after the brand bible hit v1.0 and `/brand.md` was synced to v1.4. Recommended home in the repo: `.planning/brand-v1-code-handoff.md`. Delete it once the work lands.*

## What this is

The brand identity is finished and locked. The bible is at v1.0 and the repo's `/brand.md` (now v1.4) is its code-level companion. Most of the visual system already ships. This is the short list of code changes left to close the gap, grounded in an actual audit of `src/`, not a wishlist. Implement the spec, don't redesign it.

If the bible and `/brand.md` ever disagree, the bible wins. If a rule here disagrees with what you find in the code and the code is clearly right, say so before changing it.

## Canonical sources, in order

1. `/brand.md` (v1.4) in this repo. The implementation spec: tokens, class patterns, component rules. The sections that matter here are §4 (color and the §4.2 contrast table), §6 (logo), and §7 (component fingerprint).
2. The brand bible v1.0 (`RateMyPlace-brand-bible-v1_0.md`, canonical copy in the RateMyPlace Drive under Brand). Read Section 5 (Visual identity), especially the accessibility floor, and Section 6 (Platform application).
3. `src/lib/scoring-colors.ts` is the single source of truth for score colors. Never hardcode a score color anywhere else.

## Ground rules

These come from the repo `CLAUDE.md` and are not optional.

- One task per commit, each independently reviewable. Use the commit prefixes already in use: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`.
- Never add AI co-authorship trailers. No `Co-Authored-By: Claude`, no `Generated with Claude Code`. The GitHub history is part of Meredith's professional footprint.
- No em dashes in any user-facing UI text, page title, or generated output.
- Run `npm test` after any change that touches scoring or shared components. Run `/qa` (the checklist in `CLAUDE.md`) before a deploy, with extra attention to contrast and to data showing consistently across every view.
- Parameterized queries, auth checks, and the rest of the security checklist still apply to any endpoint you touch.

## The work

Do these in order. Task 1 unblocks the radius work in Task 4. Everything else is independent.

### 1. Add the missing theme tokens
**File:** `src/styles/global.css`. Right now `@theme` only defines `--color-paper`, `--font-sans`, and `--font-display`. Add the four that the spec assumes but the code never declared:

```css
@theme {
  /* existing tokens stay */
  --color-warm-lamp: #F5E6A8;   /* logo lit window ONLY, never elsewhere */
  --radius-card: 0.375rem;      /* 6px */
  --radius-input: 0.25rem;      /* 4px */
  --radius-pill: 9999px;
}
```

Nothing should change visually from this commit alone. It just makes the tokens available. Ref: `/brand.md` §7.1, bible Section 5 (Color, Layout and spacing).
**Done when:** the tokens resolve and the build is green.

### 2. Fix the header wordmark legibility
**File:** `src/components/layout/Header.astro`. The full lockup (`brand/logo-lockup.svg`) currently renders too small to read in the header. This is the one known live bug. Give the lockup enough height that the wordmark is actually legible (the spec wants the full lockup at least 120px wide). Check the mobile breakpoint too: if the lockup gets cramped on a narrow screen, switch to the square mark (`brand/logo-mark.svg`) below that breakpoint, per the bible's mobile section. The logo must still link to home.
**Done when:** the wordmark is readable on desktop, tablet, and mobile, and the link still works. Ref: bible Section 5 (Logo system) and Section 6 (mobile), `/brand.md` §6 (minimum sizes).

### 3. Stat citation contrast fix (AA)
Grep `text-slate-500`. There is exactly one occurrence, the small uppercase source line in the stat treatment (the block with `border-l-2 border-slate-900`). Change it to `text-slate-600`. Slate-500 is about 4.3:1 on Paper, under the 4.5:1 floor for small text; slate-600 is about 6.9:1. This is the only place Mist (slate-500) appears, so nothing else needs touching.
**Done when:** the citation passes AA on Paper. Ref: bible accessibility floor, `/brand.md` §4.2 and §7.6.

### 4. Finish the card radius and borders-over-shadows migration
This one is partly done. About 44 files already use `rounded-[6px]`, but roughly 27 still use `rounded-lg`, and about 25 use `shadow-sm`. Bring the stragglers in line:

- Cards, panels, and alerts on `rounded-lg` move to `rounded-[6px]` (or `rounded-card` now that the token exists).
- A resting card should carry a 1px border, not a shadow. The pattern is `bg-white border border-slate-200 rounded-[6px] hover:shadow-sm transition-shadow`. Shadow is a hover state, not a rest state.
- Leave floating UI alone. Dropdowns, tooltips, and modals keep their shadow because they need to read as elevated.

Work component by component so each diff is easy to review. Ref: `/brand.md` §7.1 and §7.2.
**Done when:** no `rounded-lg` remains on cards, resting cards are bordered, and only floating UI uses a resting shadow.

### 5. Audit teal-600 on buttons and body text
Five files use `bg-teal-600`. Confirm each is a graphic fill or surface (fine) and not a primary button. Any primary button on teal-600 becomes `bg-teal-700 hover:bg-teal-800`, `font-semibold`, `rounded-[4px]`. Same idea for body-size text: `text-teal-600` on prose becomes `text-teal-700` for contrast. Leave star icons, progress-bar fills, and large display numerals on their 500 and 600 variants; those are graphics, not prose.
**Done when:** buttons and body-size links clear AA, and graphic fills are untouched. Ref: `/brand.md` §4.2 and §7.3.

### 6. Confirm the rest actually shipped (verify, mostly no change)
A quick pass to make sure the spec matches reality, since the audit suggests most of it is already done:

- Spacing: `py-16` is already gone. Confirm marketing sections sit at `py-20` and app surfaces at `py-12`.
- Eyebrows: already live on the homepage. Confirm they stay off app surfaces (review form, dashboard, admin).
- Season chip: `src/components/ui/SeasonChip.astro` exists. Confirm it is used on every review surface.
- Color independence: confirm every score shows its word and number, never color alone.

Note anything that is off rather than silently fixing scope creep. Ref: `/brand.md` §7, bible Section 5 (Accessibility floor).

## Out of scope

- Do not change scoring weights or the band values in `scoring-colors.ts`.
- Do not build a dark mode. The palette is light-surface by design; that would be a v1.1 decision, not a gap.
- Do not recolor the score system to the transparency parabola's coral and teal. That logic stays conceptual, on the about and methodology pages only.
- Do not use Warm Lamp anywhere but the logo's lit window.
- Do not redesign. If something tempts you to improve the visual system, that is a conversation with Meredith, not a commit.

## Suggested commit sequence

1. `feat: add warm-lamp and radius tokens to theme`
2. `fix: make header wordmark legible, swap to mark on mobile`
3. `fix: bump stat citation to slate-600 for AA`
4. `refactor: finish card radius and border-over-shadow migration`
5. `fix: move teal-600 buttons and body links to teal-700`
6. `chore: verify spacing, eyebrows, season chip, score labeling against brand v1.0`
