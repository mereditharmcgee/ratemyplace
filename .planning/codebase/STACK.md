# Technology Stack

**Analysis Date:** 2026-05-02

## Languages

**Primary:**
- **TypeScript** 5.9.3 - Entire application codebase with strict mode enabled (`tsconfig.json` extends `astro/tsconfigs/strict`)
- **HTML/CSS** - Astro SSR markup, Tailwind CSS for styling

**Secondary:**
- **SQL** - SQLite migrations and database queries via Cloudflare D1
- **JavaScript** - React components and client-side interactions

## Runtime

**Environment:**
- **Node.js** - Version not pinned in repo (no `.nvmrc` or `engines` field in `package.json`)
- **Cloudflare Workers** - Primary deployment target via Astro adapter

**Package Manager:**
- **npm** - Version not specified
- **Lockfile:** `package-lock.json` - Present and committed

## Frameworks

**Core:**
- **Astro** 5.16.11 - SSR web framework with Cloudflare adapter (`@astrojs/cloudflare` 12.6.12)
- **React** 18.3.1 - Client-side interactive islands via `@astrojs/react` 3.6.3

**Styling:**
- **Tailwind CSS** 4.1.18 - Utility-first CSS framework
- **@tailwindcss/vite** 4.1.18 - Vite integration for Tailwind

**Testing:**
- **Vitest** 4.0.18 - Unit test runner with happy-dom environment
- **@playwright/test** 1.58.2 - E2E testing framework
- **@testing-library/react** 16.3.2 - React component testing utilities

**Build/Dev:**
- **@astrojs/check** 0.9.6 - TypeScript validation for Astro
- **tsx** 4.21.0 - TypeScript execution for scripts

## Key Dependencies

**Critical:**
- **lucia** 3.2.2 - Authentication framework for session/user management
- **@lucia-auth/adapter-sqlite** 3.0.2 - SQLite adapter for Lucia auth with D1
- **resend** 6.9.2 - Email delivery service SDK
- **docx** 9.6.1 - Word document generation library (for dispute/export functionality)

**Cryptography & Encoding:**
- **@oslojs/crypto** 1.0.1 - Cryptographic utilities (SHA256 hashing)
- **@oslojs/encoding** 1.1.0 - Encoding/decoding utilities

**Infrastructure:**
- **@cloudflare/workers-types** 4.20260117.0 - Type definitions for Cloudflare Workers, D1, R2, Turnstile

**React Integration:**
- **@types/react** 18.3.0 - Type definitions for React
- **@types/react-dom** 18.3.0 - Type definitions for React DOM
- **react-dom** 18.3.1 - React rendering library

**Testing:**
- **happy-dom** 20.5.1 - Lightweight DOM implementation for unit tests
- **@testing-library/user-event** 14.6.1 - User interaction simulation for tests

## Configuration

**Build Configuration:**
- `astro.config.mjs` - Astro configuration with Cloudflare Pages deployment, Tailwind integration, React islands
- `tsconfig.json` - TypeScript strict mode with JSX React configuration
- `vitest.config.ts` - Unit test configuration (happy-dom environment, test file patterns)
- `playwright.config.ts` - E2E test configuration
- `wrangler.jsonc` - Cloudflare Workers/Pages configuration with D1 and R2 bindings

**Environment:**
Environment variables accessed via `(context.locals as any).runtime.env`:
- `DB` - Cloudflare D1 SQLite database binding
- `VERIFICATION_BUCKET` - Cloudflare R2 bucket for file storage
- `GOOGLE_CLIENT_ID` - OAuth provider credential
- `GOOGLE_CLIENT_SECRET` - OAuth provider credential
- `GOOGLE_MAPS_API_KEY` - Maps/Places API key
- `GOOGLE_PLACES_API_KEY` - Places API key (New API version preferred)
- `RESEND_API_KEY` - Email service API key
- `TURNSTILE_SECRET_KEY` - Cloudflare Turnstile CAPTCHA verification key
- `SITE_URL` - Base URL for email links (e.g., `https://ratemyplace.org`)

## Platform Requirements

**Development:**
- Wrangler CLI for local Cloudflare Workers development
- Node.js with npm
- TypeScript compiler via tsx or ts-node for script execution

**Production:**
- **Cloudflare Pages** - Primary host (pages.dev domain with custom domain routing)
- **Cloudflare D1** - SQLite database (FY2026 version, ratemyplace-db instance)
- **Cloudflare R2** - Object storage for verification documents and exports
- **Cloudflare Email Routing** - Catch-all email forwarding for @ratemyplace.org addresses

---

*Stack analysis: 2026-05-02*
