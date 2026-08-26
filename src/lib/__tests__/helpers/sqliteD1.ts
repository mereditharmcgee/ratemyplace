import { createRequire } from 'node:module';

type SqlValue = string | number | bigint | Uint8Array | null;

interface SQLiteStatement {
  get(...values: SqlValue[]): unknown;
  all(...values: SqlValue[]): unknown[];
  run(...values: SqlValue[]): unknown;
}

export interface SQLiteDatabase {
  prepare(sql: string): SQLiteStatement;
  exec(sql: string): void;
  close(): void;
}

interface SQLiteDatabaseConstructor {
  new(filename: string): SQLiteDatabase;
}

let DatabaseSync: SQLiteDatabaseConstructor | null = null;
try {
  const require = createRequire(import.meta.url);
  const sqlite = require('node:sqlite') as { DatabaseSync?: SQLiteDatabaseConstructor };
  DatabaseSync = sqlite.DatabaseSync ?? null;
} catch {
  // node:sqlite is unavailable on older supported Node runtimes; suites skip.
}

export const sqliteAvailable = DatabaseSync !== null;

export function createMemoryDatabase(): SQLiteDatabase {
  if (!DatabaseSync) throw new Error('node:sqlite is unavailable');
  return new DatabaseSync(':memory:');
}

class TestD1Statement {
  private bindings: SqlValue[] = [];

  constructor(
    private readonly database: SQLiteDatabase,
    private readonly sql: string,
  ) {}

  bind(...values: SqlValue[]): this {
    this.bindings = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    const row = this.database.prepare(this.sql).get(...this.bindings);
    return (row as T | undefined) ?? null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    const rows = this.database.prepare(this.sql).all(...this.bindings);
    return { results: rows as T[] };
  }

  async run(): Promise<{ success: boolean }> {
    this.database.prepare(this.sql).run(...this.bindings);
    return { success: true };
  }
}

export class TestD1Database {
  constructor(private readonly database: SQLiteDatabase) {}

  prepare(sql: string): TestD1Statement {
    return new TestD1Statement(this.database, sql);
  }
}
