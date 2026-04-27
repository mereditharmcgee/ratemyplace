import type { APIContext } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getEnv } from './runtime';

export function getDB(context: APIContext): D1Database {
  const db = getEnv(context).DB;
  if (!db) {
    throw new Error('D1 Database not found. Make sure you have configured the DB binding.');
  }
  return db as D1Database;
}
