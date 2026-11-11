import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// Every build is noindex unless DASHBOARD_INDEXABLE=1 is set, which only the go-live deploy does.
const robots = process.env.DASHBOARD_INDEXABLE === '1' ? '' : '<meta name="robots" content="noindex, nofollow" />';

export default defineConfig({
  plugins: [
    preact(),
    { name: 'robots-meta', transformIndexHtml: (html) => html.replace('<!--ROBOTS_META-->', robots) },
  ],
  build: { target: 'es2020', sourcemap: false },
  test: { include: ['src/**/*.test.ts'] },
});
