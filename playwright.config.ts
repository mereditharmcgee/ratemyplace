import { defineConfig } from '@playwright/test';
import { buildLocalPagesCommand, resolveLocalE2EBaseURL } from './e2e/test-harness';

const baseURL = resolveLocalE2EBaseURL();

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 0,
  workers: 1,
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  webServer: {
    command: buildLocalPagesCommand(),
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: false,
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
