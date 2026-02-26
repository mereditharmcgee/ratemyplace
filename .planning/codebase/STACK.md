# Technology Stack

**Analysis Date:** 2026-02-26

## Languages

**Primary:**
- TypeScript 5+ - All application code, API endpoints, components
- JavaScript/JSX - React component development via TypeScript

**Secondary:**
- SQL - Database queries via D1/SQLite
- TOML - Wrangler configuration

## Runtime

**Environment:**
- Node.js - Development environment
- Cloudflare Workers - Production runtime (serverless)

**Package Manager:**
- npm - JavaScript package management
- Lockfile: Present (`package-lock.json`)

## Frameworks

**Core:**
- Astro 5.16.11 - Full-stack web framework, SSR with server-side rendering
- React 18.3.1 - UI components and interactive elements
- @astrojs/react 3.6.3 - React integration for Astro

**Authentication:**
- Lucia 3.2.2 - Authentication framework
- @lucia-auth/adapter-sqlite 3.0.2 - SQLite adapter for Lucia

**Styling:**
- Tailwind CSS 4.1.18 - Utility-first CSS framework
- @tailwindcss/vite 4.1.18 - Vite plugin for Tailwind

**Testing:**
- Vitest 4.0.18 - Unit/integration test runner
- @playwright/test 1.58.2 - E2E browser testing
- @testing-library/react 16.3.2 - React component testing utilities
- @testing-library/user-event 14.6.1 - User interaction simulation

**Build/Dev:**
- @astrojs/cloudflare 12.6.12 - Cloudflare adapter for Astro
- tsx 4.21.0 - TypeScript execution for scripts

## Key Dependencies

**Critical:**
- @cloudflare/workers-types 4.20260117.0 - TypeScript types for Cloudflare Workers runtime
- @oslojs/crypto 1.0.1 - Cryptographic utilities (PBKDF2-SHA256, SHA256)
- @oslojs/encoding 1.1.0 - Encoding utilities (base64, hex)

**Infrastructure:**
- happy-dom 20.5.1 - Lightweight DOM implementation for testing

## Configuration

**Environment:**
- Handled via Cloudflare Workers environment bindings (wrangler.jsonc)
- Runtime environment accessed through `context.locals.runtime.env`
- Key variables: `GOOGLE_MAPS_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DB`, `VERIFICATION_BUCKET`

**Build:**
- `astro.config.mjs` - Astro configuration
- `tsconfig.json` - TypeScript compiler options, extends Astro strict config
- `vitest.config.ts` - Unit test configuration with happy-dom environment
- `playwright.config.ts` - E2E test configuration
- `wrangler.jsonc` - Cloudflare deployment configuration

**TypeScript:**
- Strict mode enabled (extends `astro/tsconfigs/strict`)
- JSX: `react-jsx` with `jsxImportSource` set to React
- Path resolution includes `.astro/types.d.ts`

## Platform Requirements

**Development:**
- Node.js (version specified via npm)
- npm package manager
- Cloudflare Wrangler CLI (for local D1/R2 emulation during dev)

**Production:**
- Cloudflare Pages for hosting
- Cloudflare Workers for serverless compute
- Cloudflare D1 for SQLite database
- Cloudflare R2 for object storage

## Runtime Configuration Details

**Cloudflare Bindings (wrangler.jsonc):**
- DB: D1Database (SQLite) - binding name "DB"
- VERIFICATION_BUCKET: R2Bucket - binding name "VERIFICATION_BUCKET"
- Database: "ratemyplace-db" (ID: 7dd2a722-fdd3-4986-b2f7-6d61d069438e)
- R2 Bucket: "ratemyplace-verification"

**Compatibility:**
- Date: 2024-12-01
- Flags: nodejs_compat (Node.js compatibility mode enabled)

---

*Stack analysis: 2026-02-26*
