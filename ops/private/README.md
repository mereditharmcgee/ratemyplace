# ops/private/ — not tracked

Everything in this directory is gitignored except this README.

## What belongs here

- Names, roles, and contact details of people at partner organizations
- Notes from conversations, calls, and meetings
- Anything said off the record, or said in confidence
- Funder feedback, especially on declined applications
- Anything identifying an individual reviewer

## What does not

Strategy, organization-level landscape, reusable narrative, approved messaging, and
metrics all live in the tracked files one level up. Keeping them tracked is what lets
agents read them and what makes them survive a laptop failure.

## Why this split exists

RateMyPlace's first non-negotiable is that people who engage with it should not face
retaliation. That was written about reviewers, but it covers the tenant organizers, legal
aid staff, and city contacts who help the project too. A committed file listing who spoke
to you and what they said is precisely the kind of artifact this project exists to argue
against, and on a public repository it would be permanent and searchable.

The gitignore rule is a backstop. The actual rule is the one in
[`../AGENTS.md`](../AGENTS.md): **never write a named individual into a tracked file.**

## If the repository becomes private

This directory stays gitignored anyway. Repository visibility can change, GitHub accounts
get compromised, and a repository can be shared with a collaborator in a hurry. A file
that was never committed cannot leak in any of those cases.

## Backups

Because nothing here is in git, nothing here is backed up by git. If this material matters,
keep it somewhere that syncs. The repository already lives in a Google Drive folder, which
covers it, but that is worth knowing rather than assuming.
