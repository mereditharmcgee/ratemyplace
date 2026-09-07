import { describe, it, expect } from 'vitest';
import { createMemoryDatabase, sqliteAvailable, TestD1Database } from './helpers/sqliteD1';

const suite = sqliteAvailable ? describe : describe.skip;

suite('TestD1Database.batch', () => {
  it('runs statements in one transaction and rolls back on failure', async () => {
    const raw = createMemoryDatabase();
    const db = new TestD1Database(raw);
    db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');

    await db.batch([db.prepare('INSERT INTO t (id) VALUES (?)').bind('a')]);
    const first = await db.prepare('SELECT COUNT(*) AS n FROM t').first<{ n: number }>();
    expect(first?.n).toBe(1);

    await expect(
      db.batch([
        db.prepare('INSERT INTO t (id) VALUES (?)').bind('b'),
        db.prepare('INSERT INTO t (id) VALUES (?)').bind('a'), // duplicate PK
      ]),
    ).rejects.toThrow();
    const after = await db.prepare('SELECT COUNT(*) AS n FROM t').first<{ n: number }>();
    expect(after?.n).toBe(1);
  });
});
