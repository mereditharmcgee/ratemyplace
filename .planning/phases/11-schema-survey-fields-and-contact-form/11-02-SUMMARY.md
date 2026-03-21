---
phase: 11-schema-survey-fields-and-contact-form
plan: "02"
subsystem: contact-form
tags: [contact, email, turnstile, rate-limiting, admin, d1, resend]
dependency_graph:
  requires: []
  provides: [contact-form, contact-messages-table, admin-contact-tab]
  affects: [src/lib/email.ts, src/components/admin/AdminLayout.astro]
tech_stack:
  added: []
  patterns: [SSR-direct-D1-query, React-island-with-Turnstile, best-effort-email]
key_files:
  created:
    - migrations/0019_reserved.sql
    - migrations/0020_contact_messages.sql
    - migrations/0021_reserved.sql
    - migrations/0022_reserved.sql
    - src/pages/api/contact.ts
    - src/components/contact/ContactForm.tsx
    - src/pages/admin/contact.astro
    - src/pages/api/admin/contact-messages.ts
  modified:
    - src/lib/email.ts
    - src/pages/contact.astro
    - src/components/admin/AdminLayout.astro
decisions:
  - "SSR direct D1 query in admin/contact.astro frontmatter (no React component) — simpler, avoids extra client JS for read-only table"
  - "Migration 0019 added as reserved placeholder since it was missing in sequence between 0018 and 0023"
  - "sendContactConfirmationEmail and sendContactNotificationEmail are best-effort — email failures do not fail the API response"
metrics:
  duration_seconds: 187
  completed_date: "2026-03-21"
  tasks_completed: 2
  tasks_total: 2
  files_created: 8
  files_modified: 3
---

# Phase 11 Plan 02: Contact Form and Admin Messages Summary

**One-liner:** Contact form with Turnstile spam protection, 3/hour rate limiting, D1 storage, Resend confirmation emails, and SSR admin messages table.

## What Was Built

A complete contact form system replacing the static mailto link page:

- `/contact` — React island form with name, email, category dropdown, message textarea, Turnstile widget, inline validation, loading/success/error states
- `/api/contact` POST — Turnstile verification, rate limit (3/hour/IP), input validation, D1 insert, best-effort confirmation + admin notification emails via Resend
- `contact_messages` D1 table — id, name, email, category, status, created_at, resolved_at, admin_notes with two indexes
- `/admin/contact` — SSR Astro page with direct D1 query, sortable table showing date/name/email/category/message preview/status with colored category and status badges
- `/api/admin/contact-messages` GET — admin-only JSON endpoint for the messages table
- `AdminLayout.astro` — Contact nav item (mail icon) added after Bug Reports; union type extended with 'contact'
- `src/lib/email.ts` — Two new functions: `sendContactConfirmationEmail` and `sendContactNotificationEmail` following existing Resend patterns

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing] Migration 0019 placeholder added**
- **Found during:** Task 1 setup
- **Issue:** Sequence gap existed between migration 0018 and 0023 — 0019 was unaccounted for
- **Fix:** Created 0019_reserved.sql as a SELECT 1 placeholder to maintain sequential numbering
- **Files modified:** migrations/0019_reserved.sql

## Self-Check: PASSED

All 8 created files confirmed on disk. Both task commits (1e90542, 65efd03) confirmed in git log. 189 tests passing.
