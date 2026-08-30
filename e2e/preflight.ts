import { validateLocalE2EEnvironment } from './test-harness';

const baseURL = validateLocalE2EEnvironment();

console.log(`[E2E safety] Local preflight passed for ${baseURL}.`);
