# Technology Stack

**Analysis Date:** 2026-04-26

## Languages

**Primary:**
- TypeScript 5.9.3 - All source code, strict mode enabled via `astro/tsconfigs/strict`

**Secondary:**
- JavaScript - Configuration files (`astro.config.mjs`, `wrangler.jsonc`)
- SQL - Database migrations and queries

## Runtime

**Environment:**
- Node.js (implied by SSR and build scripts)
- Cloudflare Workers (server runtime via `@astrojs/cloudflare` adapter)

**Package Manager:**
- npm (detected via `package-lock.json`)
- Lockfile: Present

## Frameworks

**Core:**
- Astro 5.16.11 - SSR framework with server-side rendering enabled (`output: 'server'`)
- React 18.3.1 - Client-side interactive components (islands architecture)
- Lucia v3.2.2 - Authentication with SQLite D1 adapter

**Styling:**
- Tailwind CSS 4.1.18 - Utility-first CSS
- @tailwindcss/vite 4.1.18 - Vite plugin for Tailwind

**Testing:**
- Vitest 4.0.18 - Unit and component testing (`vitest.config.ts`)
- Happy DOM 20.5.1 - DOM environment for tests
- @playwright/test 1.58.2 - E2E testing
- @testing-library/react 16.3.2 - React component testing utilities

**Build/Dev:**
- Vite (via Astro)
- @astrojs/react 3.6.3 - React integration for Astro
- @astrojs/cloudflare 12.6.12 - Cloudflare Pages adapter

## Key Dependencies

**Critical:**
- lucia 3.2.2 - Session management and authentication
- @lucia-auth/adapter-sqlite 3.0.2 - D1 database adapter for Lucia
- resend 6.9.2 - Email service for transactional emails (verification, password reset, notifications)
- @oslojs/crypto 1.0.1 - Cryptographic utilities for token generation
- @oslojs/encoding 1.1.0 - Encoding utilities
- docx 9.6.1 - Document generation for reports/exports

**Infrastructure:**
- @cloudflare/workers-types 4.20260117.0 - TypeScript types for Cloudflare Workers
- tsx 4.21.0 - TypeScript execution for scripts

## Configuration

**Environment:**
- `GOOGLE_CLIENT_ID` - OAuth provider ID
- `GOOGLE_CLIENT_SECRET` - OAuth provider secret
- `GOOGLE_MAPS_API_KEY` - Google Maps API key for map display
- `GOOGLE_PLACES_API_KEY` - Google Places API key for address autocomplete
- `RESEND_API_KEY` - Email service API key
- `SITE_URL` - Canonical site URL (fallback to `context.url.origin`)
- `TURNSTILE_SECRET_KEY` - Cloudflare Turnstile bot verification secret

**Build:**
- `astro.config.mjs` - Astro configuration with Cloudflare adapter and Tailwind plugin
- `tsconfig.json` - TypeScript strict mode configuration
- `wrangler.jsonc` - Cloudflare Workers configuration with D1 and R2 bindings
- `vitest.config.ts` - Test runner configuration with Happy DOM environment

**Runtime Files:**
- `src/env.d.ts` - Environment type definitions for Astro locals, Cloudflare runtime bindings

## Platform Requirements

**Development:**
- Node.js (version not specified, infer from package ecosystem)
- npm for dependency management
- Wrangler CLI (for local D1/R2 development)

**Production:**
- Cloudflare Pages (server runtime)
- Cloudflare Workers (server functions)
- Cloudflare D1 (SQLite database)
- Cloudflare R2 (file storage for verification images)
- Cloudflare Email Routing (email forwarding for @ratemyplace.org domain)

---

*Stack analysis: 2026-04-26*
