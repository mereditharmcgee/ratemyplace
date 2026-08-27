// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';

import tailwindcss from '@tailwindcss/vite';

import react from '@astrojs/react';

const COMMIT_SHA = /^[0-9a-f]{40}$/i;
const releaseCandidate =
  process.env.CF_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA ?? '';
const buildReleaseId = COMMIT_SHA.test(releaseCandidate.trim())
  ? releaseCandidate.trim().toLowerCase()
  : 'unknown';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: cloudflare(),

  redirects: {
    '/scoring': '/methodology',
    '/review': '/review/new',
  },

  vite: {
    define: {
      __RMP_BUILD_RELEASE_ID__: JSON.stringify(buildReleaseId),
    },
    plugins: [tailwindcss()],
    server: {
      watch: {
        // This repo lives in a Google Drive synced folder. Ignore Drive's
        // temp-upload churn so the dev file watcher doesn't reload-loop.
        // Dev-only; no effect on build or runtime.
        ignored: ['**/.tmp.driveupload/**']
      }
    }
  },

  integrations: [react()]
});
