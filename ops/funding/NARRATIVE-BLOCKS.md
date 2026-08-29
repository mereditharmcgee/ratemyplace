# Narrative blocks

**Last reviewed:** 2026-08-29

Reusable prose for grant applications, fellowship materials, and partner pitches. Written
once, checked against reality, reused rather than rewritten under deadline.

**Rules for this file:**

- Every factual claim must be checkable against `MASTER.md`'s **Built today** section or
  [`../METRICS.md`](../METRICS.md).
- **Never hard-code a number here.** Write `[N approved reviews — see METRICS.md]` and fill
  it at use time from a fresh generator run. Numbers in reusable prose are how a stale
  figure ends up in a submitted application.
- No em dashes (`brand.md` v1.4 voice rule).

---

## The problem (short, ~60 words)

Housing is a social determinant of health. Leaks, pests, poor ventilation, and inadequate
heat drive asthma, cardiovascular disease, injury, and psychological distress, and they
fall hardest on low-income renters and communities of color. Yet rental markets run on
lopsided information: landlords pull credit reports and tenant blacklists, while tenants
get a walkthrough and a signature line.

## The problem (long, ~130 words)

Housing conditions are a documented driver of health outcomes. Substandard conditions are
associated with respiratory disease, cardiovascular problems, injury, and psychological
distress, and the burden is patterned along race, income, and immigration status.

The information asymmetry in rental markets compounds this. A landlord evaluating a tenant
can access credit history, eviction records, and commercial screening reports. A tenant
evaluating a landlord has a walkthrough, a listing, and whatever they can learn from
strangers. Problem landlords can therefore operate across a portfolio without their
pattern becoming visible to the people most affected by it.

Existing review sites treat housing as a consumer product and ask whether an apartment was
liked. That question does not surface the conditions that make people sick.

## What RateMyPlace is (~70 words)

RateMyPlace is a public record of rental housing, built from tenant reviews and structured
around validated public health instruments. Renters rate their unit, their building, and
their landlord across 27 scored items adapted from the Observational Housing Quality Scale,
the Physical Housing Quality Scale, and the WHO LARES study. Reviews are anonymous,
moderated, and disputable. Scores are published separately by domain, with the full
methodology public.

## Theory of change (~50 words)

If tenants can access structured, comparable information about units, buildings, and
landlords, then they can make more informed housing decisions, which reduces exposure to
substandard housing, leading to better health outcomes and greater landlord
accountability. Aggregated across a portfolio, the same data supports tenant organizing
and policy advocacy.

## What distinguishes it (~90 words)

Three things.

The instrument is adapted from validated public health research rather than invented, so
each item maps to a documented health pathway. The methodology is published in full,
including every item, every weight, and every citation, so the scoring can be criticized
rather than merely trusted. And scores aggregate to the landlord and property manager, not
just the address, which is what makes a pattern of neglect visible across a portfolio.

The design treats tenant anonymity as a safety requirement rather than a preference,
because retaliation is the risk that keeps people quiet.

## Current state, told honestly (~80 words)

The platform is live at ratemyplace.org and technically mature: server-rendered, deployed
on Cloudflare, with automated tests, moderation tooling, an audit trail, and a formal
landlord dispute process.

It is early on evidence. It currently holds [N approved reviews — see METRICS.md] across
Boston and New Haven, and only [N — see METRICS.md] landlords have enough reviews to clear
the three-review threshold required before a portfolio score is displayed. Building the
review base is the present work, and it is a distribution problem rather than a technical
one.

## On limitations (~60 words)

RateMyPlace cannot address housing affordability, supply, or discrimination, and does not
claim to. It depends on tenants choosing to contribute, which introduces selection effects
that a small dataset cannot correct for. The health-based weighting shifts scores only
slightly in practice. These limits are documented publicly rather than managed around,
because a tool that overstates itself cannot be trusted with this subject.

## Who built it (~40 words)

RateMyPlace is built and maintained by a single person with a public health background,
working on it independently. That constrains pace and reach, and it is a reason support
would change what the project can do rather than merely how fast it moves.

---

## Using these

Assemble, then edit for the specific funder. Do not submit assembled blocks unedited: they
are consistent by design, which reads as boilerplate when four of them run consecutively.

Before submitting anything containing a figure, run:

```bash
npx tsx scripts/ops-metrics.ts
```

and fill every `[N — see METRICS.md]` placeholder from the fresh output.
