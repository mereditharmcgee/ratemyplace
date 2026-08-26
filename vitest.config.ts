/// <reference types="vitest/config" />

import { getViteConfig } from 'astro/config';
import react from '@astrojs/react';

export default getViteConfig(
  {
    test: {
      environment: 'happy-dom',
      include: ['src/**/*.test.{ts,tsx}'],
      exclude: ['node_modules', 'dist'],
    },
  },
  {
    configFile: false,
    integrations: [react()],
  },
);
