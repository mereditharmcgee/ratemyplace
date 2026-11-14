import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMemoryDatabase, TestD1Database } from './sqliteD1';

// The one every-migration test schema: every file in migrations/, applied in order, so a
// route test runs against the schema production has. Add helpers here rather than a second
// builder.

const MIGRATIONS = join(process.cwd(), 'migrations');

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS).filter((file) => file.endsWith('.sql')).sort();
}

export function schemaDb(options: { through?: string } = {}): TestD1Database {
  const db = new TestD1Database(createMemoryDatabase());
  for (const file of migrationFiles()) {
    if (options.through && file > options.through) break;
    db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
  return db;
}

/** The migration before `file` in sorted order. Throws if `file` is absent or the first. */
export function previousMigration(file: string): string {
  const files = migrationFiles();
  const index = files.indexOf(file);
  if (index === -1) throw new Error(`No migration named ${file}`);
  if (index === 0) throw new Error(`${file} is the first migration`);
  return files[index - 1];
}
