---
phase: quick
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - src/pages/test.astro (deleted)
  - public/_headers
  - README.md
autonomous: true
requirements: [LAUNCH-01, LAUNCH-02, LAUNCH-03]

must_haves:
  truths:
    - "No test page accessible in production"
    - "Security headers applied to all routes"
    - "README describes actual project, not Astro boilerplate"
  artifacts:
    - path: "public/_headers"
      provides: "Security headers for Cloudflare Pages"
      contains: "X-Content-Type-Options"
    - path: "README.md"
      provides: "Project documentation"
      min_lines: 30
  key_links:
    - from: "public/_headers"
      to: "Cloudflare Pages"
      via: "automatic header injection"
      pattern: "X-Frame-Options"
---

<objective>
Remove test page, add security headers, and update README with actual project information.

Purpose: Address launch blockers before production deployment.
Output: Clean production-ready codebase with proper security headers and documentation.
</objective>

<execution_context>
@C:/Users/mmcge/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/mmcge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/HANDOFF.md
@.planning/PROJECT.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Remove test page and add security headers</name>
  <files>src/pages/test.astro (delete), public/_headers</files>
  <action>
1. Delete the test page:
   - Remove src/pages/test.astro entirely

2. Create public/_headers with Cloudflare Pages security headers:
```
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  X-XSS-Protection: 1; mode=block
  Referrer-Policy: strict-origin-when-cross-origin
```

The _headers file is automatically read by Cloudflare Pages during deployment.
  </action>
  <verify>
    - test.astro no longer exists: `ls src/pages/test.astro` returns error
    - _headers file exists with correct content: `cat public/_headers`
  </verify>
  <done>Test page removed, security headers file created with all four headers</done>
</task>

<task type="auto">
  <name>Task 2: Update README with project information</name>
  <files>README.md</files>
  <action>
Replace the Astro boilerplate README with actual project documentation:

# RateMyPlace Boston

A public health-focused tenant housing review platform for Boston renters.

## About

Tenants rate their apartment unit, building, and landlord using a 27-item structured survey grounded in validated housing quality research (OHQS, PHQS, WHO LARES). The platform addresses information asymmetry in rental markets by giving tenants a way to research landlords before signing a lease.

## Features

- 27-item evidence-based housing quality survey
- Weighted scoring with health/safety priority factors
- Building and landlord profile pages with aggregate scores
- Privacy-preserving score aggregation
- Email-verified anonymous reviews
- Landlord dispute submission system
- Admin moderation dashboard

## Tech Stack

- **Framework**: Astro 5
- **Hosting**: Cloudflare Pages
- **Database**: Cloudflare D1 (SQLite)
- **Auth**: Lucia + Google OAuth
- **Email**: Resend
- **Styling**: Tailwind CSS 4

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

## Links

- **Production**: https://ratemyplace.boston
- **Methodology**: /methodology (citations and scoring approach)

## License

All rights reserved.
  </action>
  <verify>
    - README.md contains "RateMyPlace Boston" header
    - No "Astro Starter Kit" text remains
    - Includes Features, Tech Stack, and Development sections
  </verify>
  <done>README updated with actual project information, no boilerplate remaining</done>
</task>

<task type="auto">
  <name>Task 3: Commit and push changes</name>
  <files>N/A</files>
  <action>
Stage all changes and commit with descriptive message, then push to main:

```bash
git add -A
git commit -m "chore: remove test page, add security headers, update README"
git push origin main
```

This triggers auto-deploy to Cloudflare Pages.
  </action>
  <verify>
    - `git status` shows clean working directory
    - `git log -1 --oneline` shows the new commit
    - Push completed without errors
  </verify>
  <done>Changes committed and pushed to main, auto-deploy triggered</done>
</task>

</tasks>

<verification>
After all tasks complete:
1. Test page route no longer accessible (will 404 after deploy)
2. Security headers visible in browser dev tools (after deploy)
3. README displays correctly on GitHub repo page
</verification>

<success_criteria>
- src/pages/test.astro deleted
- public/_headers exists with 4 security headers
- README.md contains actual project documentation
- All changes committed and pushed to main
</success_criteria>

<output>
After completion, create `.planning/quick/1-remove-test-page-add-security-headers-up/1-SUMMARY.md`
</output>
