# Growth channels

**Last reviewed:** 2026-08-29

One row per channel. Status is a claim about reality, not a plan.

**Status values:** `untried` · `testing` · `working` · `failed` · `parked`

Record failures with as much care as successes. A channel that didn't work saves the next
attempt, and it is the entry nobody writes down.

Never name individuals here. Organizations only. Contacts and conversations go in
`ops/private/`.

## Channels

| Channel | Status | Last touched | What happened |
|---|---|---|---|
| Tenant unions / organizing groups | `untried` | — | Highest-potential: reaches people already angry at a landlord, already organized, already trusting the messenger. Depends on a partner willing to distribute. |
| Legal aid / housing clinics | `untried` | — | Reaches tenants at the moment of a dispute. Ethically delicate: people in active legal trouble should not be recruited carelessly. |
| Graduate and professional student housing groups | `untried` | — | High turnover, concentrated in large buildings, comfortable with surveys, motivated by the next cohort. Good depth-per-effort fit. |
| Neighborhood associations / online neighborhood groups | `untried` | — | Broad reach, low depth. Risks the breadth trap described in STRATEGY.md. |
| Instagram / organic social | `testing` | 2026-05-31 | The "we show our work" methodology angle exists and the worked-example section shipped to `/methodology` to support it. No measured recruitment result. |
| Press / local housing journalism | `untried` | — | Better suited to a moment (a finding, a portfolio page, a report) than to a cold pitch. Hold until there is something to show. |
| Direct outreach to tenants of one target landlord | `untried` | — | The depth play from STRATEGY.md. Most likely to produce the demonstration page. Also the most labor-intensive and the most sensitive. |
| Reddit and local forums | `untried` | — | Where people already complain about landlords. Community rules on self-promotion are the obstacle; participating honestly rather than posting a link is the approach. |

## Notes on the two most promising

**Tenant unions** are the best fit on paper: the audience is pre-qualified, the messenger
is trusted, and the project's ethics align with theirs. The risk is that a union sees a
review site as competing with organizing rather than supporting it. The pitch has to lead
with what the data does for *them*, which is documenting a landlord's pattern across a
portfolio in a form they can use.

**Direct outreach around one landlord** is the only channel that reliably produces depth.
It is also the one that most requires care: contacting tenants of a specific landlord, by
building, is exactly the pattern that looks like harassment if done badly, and it puts
those tenants at retaliation risk if the outreach is traceable. Any version of this needs
a partner organization fronting it, not the project cold-contacting residents.

## Instrumentation gap

No channel above can currently be measured. The site has no analytics, deliberately, for
privacy reasons. There is no way to know whether a visitor came from Instagram, started a
review, and abandoned it at step three.

This is a real strategic blind spot, and it is not resolved by adding analytics carelessly.
Any measurement must not compromise reviewer anonymity. Aggregate, non-identifying funnel
counts are likely compatible with the privacy commitments; per-user tracking is not.

**Open decision:** whether to add privacy-preserving funnel instrumentation. See
STRATEGY.md open questions 1 and 2.
