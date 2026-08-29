# Messages

**Last reviewed:** 2026-08-29

Approved language. Voice rules come from `brand.md` §2; this is where they get applied to
specific recurring situations.

**Voice rules that apply to everything below:**

- **No em dashes.** `brand.md` v1.4 removed them for consistency with the brand bible.
  Use commas, colons, or a full stop.
- Plain, direct, civic. Specific over clever. Active voice.
- Write from the tenant's side of the screen.
- No urgency, no marketing register, nothing that sounds like a startup pitch.
- Credibility comes from restraint and from showing the work.

## The canonical line

> **A public record of rental housing, from the people who know it best.**

This is the primary message, from the brand bible. Do not paraphrase it into something
punchier. The shorter variant "a public record for renters" is retired as a primary line
and survives only as a mid-sentence descriptor.

## Positioning, when someone asks what it is

> We are not Yelp for apartments. We are closer to a public health department with a
> comment section.

Useful because it does two jobs at once: it sets the frame and it heads off the comparison
everyone reaches for first.

## The ask, to a prospective reviewer

Lead with the next tenant, not with civic good. A review does not help the person writing
it, and pretending otherwise is transparent.

> Your review will not help you. You already know what living there was like. It will help
> the person standing in that apartment next year deciding whether to sign.

Follow with the honest cost: it is a 32-item survey and takes real time. Do not soften
that. People who are told it is quick and find it is not will abandon it, and abandoned
reviews are worse than declined ones.

## On anonymity, which is the first question every time

> Reviews are anonymous. We collect exact dates so the data is useful, and we never display
> them: the site shows a season and a year, or a range like "1 to 3 years ago." Your name
> is never shown. Reviews are moderated before publication, and landlords can dispute a
> review through a formal process, but a review is never removed because a landlord
> disagrees with it.

Every clause here is true and checkable. Do not add reassurance beyond it.

**Do not say "we don't store IP addresses."** It is not accurate. Reviewer IPs are never
stored, but IPs are persisted for rate limiting and in admin audit logs. If pressed, say
exactly that.

## On methodology, when credibility is the question

> The survey is adapted from three validated public health instruments rather than
> invented: the Observational Housing Quality Scale, the Physical Housing Quality Scale,
> and the WHO LARES study. Every item, every weight, and every citation is published at
> ratemyplace.org/methodology, including worked examples on real reviews. You can check
> our work.

The methodology page is the strongest asset the project has. Point at it early and often.

## On the health weighting, carefully

Health and safety items carry more weight: pests and mold at 1.5x, structural and climate
at 1.3x, plumbing and building security at 1.2x.

**Do not overstate the effect.** On real data the weighting shifts scores by less than 0.1
in practice. If asked directly:

> The weighting reflects which conditions the research says matter most for health. On our
> current dataset it moves scores only slightly. We publish the formula and the worked
> examples so anyone can see exactly how much it does.

Overselling this is the precise failure the project's own ethics forbid.

## On the size of the dataset

Do not hide it and do not apologize for it.

> The site is early. It holds [N approved reviews — see ../METRICS.md] across Boston and
> New Haven, and most landlords do not yet have enough reviews to show a portfolio score.
> We withhold a landlord's score below three reviews rather than publish a number based on
> one person's experience.

The withholding rule is a strength worth stating. It says the project would rather show
nothing than something unfair, which is the opposite of what people expect from a review
site.

**Never hard-code the count.** Run `npx tsx scripts/ops-metrics.ts` and fill it at use time.

## Things not to say

| Don't | Because |
|---|---|
| "We don't store IP addresses" | Not accurate. See above. |
| "Verified reviews" as a headline claim | Only some are. Unverified reviews are simply unbadged, never labeled unverified. |
| Anything implying we solve affordability | Explicitly out of scope, and claiming it undermines everything else. |
| "Rate My Professor for landlords" | Invites the consumer-review frame the project is built against. |
| Any number not freshly generated | See METRICS.md. |
