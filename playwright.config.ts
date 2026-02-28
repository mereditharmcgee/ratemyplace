import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8788',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npx wrangler pages dev ./dist --port 8788',
    url: 'http://localhost:8788',
    timeout: 120_000,
    reuseExistingServer: true,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /global\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
      dependencies: ['setup'],
    },
  ],
  outputDir: 'test-results/',
  reporter: [['list']],
});
