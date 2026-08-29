# Growth strategy

**Last reviewed:** 2026-08-29
**Numbers:** see [`../METRICS.md`](../METRICS.md), generated from production. Don't quote figures from here.

## The constraint, stated plainly

RateMyPlace works. The instrument is grounded in validated research, the scoring is
published, the site is fast and secure, and moderation and disputes function.

It does not yet have enough reviews to be useful to the person it was built for.

Three numbers say it, all from production:

- **53 approved reviews.**
- **40 of 91 buildings have no review at all.** A prospective tenant searching their
  address most likely finds nothing.
- **2 of 27 landlords clear the three-review threshold.** The landlord portfolio view,
  which is the feature no other site offers, is dark for 25 of them.

That last one matters most. Building reviews are useful individually. Landlord patterns
are the thing that changes decisions, and patterns need volume.

## What this means for prioritization

**Depth beats breadth.** 53 reviews spread across 51 buildings produces almost no
aggregate signal. The same 53 concentrated on 15 buildings owned by 5 landlords would
light up five portfolio pages and demonstrate the product's actual argument.

The implication is uncomfortable but clear: **targeted recruitment beats broad awareness.**
A campaign that brings 200 people to review 200 different buildings leaves the site as
thin as it is now. Recruiting 30 tenants from the same large landlord's buildings produces
the first real portfolio page.

**Working principle:** pick a landlord with many units, recruit across their buildings,
and make that page the demonstration.

## What we know about the audience

Two distinct groups, often confused:

**Reviewers** are current or recent tenants. They have to be motivated by something other
than self-interest, because the review helps the *next* tenant, not them. The motivations
that plausibly work: anger at a specific landlord, solidarity, and being asked directly by
someone they trust. Not: a general appeal to civic good.

**Readers** are prospective tenants, mid-search, usually stressed and time-limited. They
arrive with a specific address. If that address is empty, they leave and don't come back.

These need different approaches, and the reader problem is downstream of the reviewer
problem. **Do not spend effort on reader acquisition until coverage supports it.**

## Channels

See [`CHANNELS.md`](CHANNELS.md) for status and results of each.

The honest state: nothing has been systematically tried. This is the work.

## Open questions

Things that would change the strategy and are not yet answered:

1. **Does the verification step suppress submissions?** 15 of 53 reviews are verified,
   which is a high proportion, but nobody knows how many people started a review and
   abandoned it. There is no funnel instrumentation.
2. **Where do people give up in the form?** It is a five-step, 32-item survey. That is a
   real ask. Unmeasured.
3. **Would a partner organization actually distribute this?** Untested. See
   [`../partners/LANDSCAPE.md`](../partners/LANDSCAPE.md).
4. **Is New Haven a distraction or a second beachhead?** The enrichment adapter supports
   it, and some reviews are there. Splitting a thin dataset across two cities may be
   making both weak.

Question 1 and 2 are answerable with instrumentation and would change what to do.
Currently the project has no analytics at all, deliberately, for privacy reasons. Any
measurement here has to be designed so it does not compromise reviewer anonymity, which is
a genuine constraint and not an excuse.

## What success looks like in three months

Not a review count. A demonstration:

**One landlord portfolio page with enough reviews across enough buildings that the pattern
is visible and undeniable.** That page is the argument for the whole project, and it can
be shown to funders, partners, and press. Nothing else on the site does that job.
