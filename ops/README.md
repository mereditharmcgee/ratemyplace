# ops/ — the non-code work

Everything RateMyPlace needs that isn't source code: getting reviews, funding the work,
building relationships, and saying what the project is.

`.planning/` tracks engineering milestones. This tracks everything else.

## Why this exists

The site is technically healthy and methodologically sound. It is thin on evidence:
**53 approved reviews**, and only 2 of 27 landlords clear the three-review threshold
required to show a score. No code change fixes that. This directory is where that work
lives.

## What's here

| Path | Holds | Refresh |
|---|---|---|
| [`METRICS.md`](METRICS.md) | The real numbers, straight from production | **Generated** — never edit by hand |
| [`growth/`](growth/STRATEGY.md) | Getting reviews. The priority. | When something is tried or learned |
| [`funding/`](funding/PIPELINE.md) | Opportunities, deadlines, reusable narrative | When a deadline moves or a piece of prose proves itself |
| [`partners/`](partners/LANDSCAPE.md) | Organizations and the landscape | When the map changes |
| [`content/`](content/MESSAGES.md) | Approved language and talking points | When a message is tested |
| `private/` | Named individuals, private conversations, funder feedback | **Gitignored. Never tracked.** |

## The privacy rule

**Named individuals and private conversations go in `private/`, which is gitignored.**

This is not bureaucratic. RateMyPlace's first non-negotiable is that people who talk to it
should not face retaliation, and that extends past reviewers to the tenant organizers,
legal aid staff, and city contacts who help. A public list of who spoke to you and what
they said is exactly the artifact this project exists to argue against.

Tracked files may name **organizations**. They may not name **individuals**, quote private
conversations, or record what someone said off the record.

## Keeping it current

Every file carries a `Last reviewed:` date. That is a claim, and it can be wrong.

Two rules, both learned the hard way in this repo — `VERSION.md` sat frozen at
v1.1.0-alpha for seven months, and `MASTER.md` described fraud controls that were never
built:

1. **Numbers are generated, never typed.** Anything countable comes from
   `npx tsx scripts/ops-metrics.ts`. If you find yourself typing a figure into a document,
   it will be wrong within a month.
2. **When a document and reality disagree, reality wins** — and the document gets fixed in
   the same sitting, not added to a list.

Agents maintaining these files: read [`AGENTS.md`](AGENTS.md) in this directory first.

## Refreshing the numbers

```bash
npx tsx scripts/ops-metrics.ts
```

Read-only against production. Run it before quoting any figure in an application, a pitch,
or a post.
