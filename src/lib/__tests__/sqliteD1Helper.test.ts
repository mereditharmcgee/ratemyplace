import { afterEach, describe, it, expect } from 'vitest';
import { createMemoryDatabase, sqliteAvailable, TestD1Database, type SQLiteDatabase } from './helpers/sqliteD1';

const suite = sqliteAvailable ? describe : describe.skip;

suite('TestD1Database.batch', () => {
  let raw: SQLiteDatabase;
  let db: TestD1Database;

  const setup = () => {
    raw = createMemoryDatabase();
    db = new TestD1Database(raw);
    db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
  };

  afterEach(() => {
    raw.close();
  });

  it('commits every statement on success', async () => {
    setup();
    await db.batch([
      db.prepare('INSERT INTO t (id) VALUES (?)').bind('a'),
      db.prepare('INSERT INTO t (id) VALUES (?)').bind('b'),
    ]);
    // A second batch can only BEGIN if the first one really committed.
    await db.batch([db.prepare('INSERT INTO t (id) VALUES (?)').bind('c')]);
    const count = await db.prepare('SELECT COUNT(*) AS n FROM t').first<{ n: number }>();
    expect(count?.n).toBe(3);
  });

  it('rolls back every statement when one fails', async () => {
    setup();
    await db.batch([db.prepare('INSERT INTO t (id) VALUES (?)').bind('a')]);
    await expect(
      db.batch([
        db.prepare('INSERT INTO t (id) VALUES (?)').bind('b'),
        db.prepare('INSERT INTO t (id) VALUES (?)').bind('a'), // duplicate PK
      ]),
    ).rejects.toThrow(/UNIQUE constraint failed/);
    const count = await db.prepare('SELECT COUNT(*) AS n FROM t').first<{ n: number }>();
    expect(count?.n).toBe(1);
    // The failed batch must have released the transaction.
    await db.batch([db.prepare('INSERT INTO t (id) VALUES (?)').bind('c')]);
  });
});
