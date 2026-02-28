/**
 * Database Migration Script for RateMyPlace Boston
 *
 * Applies all pending migrations to the local D1 database
 * using the official wrangler migration system.
 *
 * Run: npm run db:migrate:local
 */

import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { join } from 'path';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

console.log(`\n  ${BOLD}Migrate local database${RESET}\n`);

// Step 1: Count migrations
let migrationCount = 0;
try {
  const migrationsDir = join(process.cwd(), 'migrations');
  const files = readdirSync(migrationsDir);
  const sqlFiles = files.filter((f) => f.endsWith('.sql'));
  migrationCount = sqlFiles.length;
  console.log(`  Counting migrations... ${migrationCount} migration files found`);
} catch (err) {
  const error = err as NodeJS.ErrnoException;
  console.error(`  ${RED}✗ Failed to read migrations directory: ${error.message}${RESET}`);
  process.exit(1);
}

// Step 2: Apply migrations
console.log(`  Applying migrations...\n`);
try {
  execSync('npx wrangler d1 migrations apply ratemyplace-db --local', {
    stdio: 'inherit',
  });
} catch (err) {
  const error = err as NodeJS.ErrnoException & { stderr?: Buffer };
  console.error(`\n  ${RED}✗ Migration failed${RESET}`);
  if (error.message) {
    console.error(`  Error: ${error.message}`);
  }
  if (error.stderr) {
    console.error(`  Stderr: ${error.stderr.toString()}`);
  }
  process.exit(1);
}

console.log(`\n  ${GREEN}✓ Migrations applied successfully${RESET}\n`);
