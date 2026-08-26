# `src/components/` — Components

33 React islands + 13 Astro components. Components render; they do not hold business
logic. Scoring, validation, formatting, and data access all live in `src/lib/`.

---

## Astro or React?

**Astro (`.astro`)** — default. Layouts, data display, anything server-rendered.
No client JS ships unless you ask for it.

**React (`.tsx`)** — interactive islands only: forms, the map, dynamic admin tables.

```astro
<ReviewForm client:load buildingId={building.id} />
```

Use `client:load`. If you find yourself reaching for a React component to display static
data, use Astro instead.

## Directory layout

| Directory | Contents |
|-----------|----------|
| `layout/` | `BaseLayout.astro`, `Header`, `Footer` |
| `reviews/` | `ReviewForm`, `ReviewEditForm`, `ReviewCard`, `form-steps/` |
| `admin/` | 9 tables and queues + `AdminLayout.astro` |
| `profile/` | Tenant dashboard, settings, notifications, verification |
| `search/`, `ratings/`, `ui/`, `contact/`, `disputes/` | As named |

The multi-step review form is split across `reviews/form-steps/` — address, unit details,
ratings, additional, confirm, plus `StepIndicator` and `RatingItem`. Add new form fields
to the appropriate step, not to the parent.

## Brand tokens

The brand system is real and implemented. Tokens live in
[`src/styles/global.css`](../styles/global.css) — use them rather than raw values.

```css
--color-paper: #F6F4EE;      /* page surface — replaces bg-slate-50 */
--color-warm-lamp: #F5E6A8;  /* logo lit window ONLY, never elsewhere */
--font-sans: "Inter", ...;
--font-display: "Instrument Serif", Georgia, serif;
--radius-card: 0.375rem;     /* 6px */
--radius-input: 0.25rem;     /* 4px */
--radius-pill: 9999px;
```

### Component fingerprint

These deliberate deviations from Tailwind defaults are what keep the site from reading as
generated. Full rationale in [`brand.md`](../../brand.md) §7.

- **Cards use a 1px hairline border at rest, not a shadow.** Shadow is a hover state.
  ```html
  <div class="bg-white p-6 rounded-[6px] border border-slate-200 hover:shadow-sm transition-shadow">
  ```
  Exception: floating UI (dropdowns, tooltips, modals) keeps its shadow — it needs to
  communicate elevation.
- **Card radius is 6px, not Tailwind's 8px `rounded-lg`.** Inputs and buttons are 4px.
  Pills and badges stay `rounded-full`.
- **Instrument Serif is display-only** — homepage hero H1, methodology section openers,
  large numeric stats, pull quotes. Everything else is Inter. Do not retype body copy.
- **Warm Lamp `#F5E6A8` appears only in the logo's lit window.** Never in buttons, links,
  text, charts, or hover states.

Brand primary is `teal-700` `#0F766E` for civic weight; `teal-600` is demoted to
surface/graphic-fill.

## Score colors

Never hardcode a score band color. Import from `src/lib/scoring-colors.ts`:

```typescript
import { getScoreColor, getScoreTextColor, getScoreBgTint } from '../../lib/scoring-colors';
```

Four bands — Good 4.0–5.0, Mixed 3.0–3.9, Concerning 2.0–2.9, Poor 1.0–1.9. Any new
surface that displays a score uses these helpers. `text-teal-600` is not a score color.

## Privacy in display components

Public-facing components must never render exact tenancy dates or submission timestamps.
Route through `formatRecency` and the season/year formatters in `src/lib/privacy.ts`.
This is a tenant-safety control, not a formatting preference.

## Escaping

Anything user-supplied that reaches the DOM must be escaped or set via `textContent`.
A stored XSS through the map InfoWindow was a real finding — it was building HTML from a
review field. User-supplied URLs rendered as links must pass `isSafeHttpUrl` first.

## Known debt

Three components exceed 700 lines and mix form logic, state, API calls, and display:

- `reviews/ReviewEditForm.tsx` (918)
- `admin/BuildingsTable.tsx` (873)
- `admin/ReviewsTable.tsx` (754)

If you are working substantially inside one of these, splitting it is welcome — extract
steps or cells into separate files and move state into custom hooks. Don't grow them further.

## Testing

Component tests use Vitest + Testing Library with `happy-dom`. Prefer extracting logic
into `src/lib/` where it can be unit-tested directly over testing it through the component.
