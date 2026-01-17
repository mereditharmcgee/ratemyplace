import type { D1Database } from '@cloudflare/workers-types';

export function getDB(runtime: any): D1Database {
  const db = runtime?.env?.DB;
  if (!db) {
    throw new Error('D1 Database not found. Make sure you have configured the DB binding.');
  }
  return db as D1Database;
}
