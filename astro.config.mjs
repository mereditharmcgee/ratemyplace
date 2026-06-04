// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';

import tailwindcss from '@tailwindcss/vite';

import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: cloudflare(),

  redirects: {
    '/scoring': '/methodology',
    '/review': '/review/new',
  },

  vite: {
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