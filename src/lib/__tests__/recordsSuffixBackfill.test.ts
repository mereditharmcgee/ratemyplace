import { describe, expect, it } from 'vitest';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding, insertPull, pendingReasons } from './helpers/recordsDb';
import { formatSeedAddress } from '../records/seed/format';
import {
  MAX_STATEMENTS_PER_FILE,
  backfillFiles,
  planSuffixBackfill,
  refreshCancelStatements,
  refreshIds,
  refreshStatements,
  rekeyRollbackStatements,
  rekeyStatements,
  respellRollbackStatements,
  respellStatements,
  respelledSeedAddress,
  writeBackfillRun,
  type BackfillFileOptions,
  type KeyedBuildingRow,
  type RunDirFs,
  type SuffixBackfillPlan,
} from '../records/seed/suffixBackfill';

const suite = sqliteAvailable ? describe : describe.skip;

function row(overrides: Partial<KeyedBuildingRow> & Pick<KeyedBuildingRow, 'id' | 'address' | 'street_key'>): KeyedBuildingRow {
  return { source: 'seed', st_num_lo: 1, st_num_hi: 1, updated_at: 1, ...overrides };
}

const OPTIONS: BackfillFileOptions = { pulledSince: 1_793_000_000, generatedAt: 1_793_067_655, target: '--remote', dir: '.cache/suffix-backfill/remote-1793067655', database: 'ratemyplace-db' };

describe('respelledSeedAddress', () => {
  it('spells the last word out the way formatSeedAddress now does', () => {
    expect(respelledSeedAddress('120 Grampian Wy')).toBe('120 Grampian Way');
    expect(respelledSeedAddress('9-11 Appian Wy')).toBe('9-11 Appian Way');
    expect(respelledSeedAddress('12 American Legion Hw')).toBe('12 American Legion Highway');
    expect(respelledSeedAddress('16 Cedar Lane Wy')).toBe('16 Cedar Lane Way');
    expect(respelledSeedAddress('566 W Roxbury Pw')).toBe('566 W Roxbury Parkway');
    expect(respelledSeedAddress('10-12 Conry Cr')).toBe('10-12 Conry Crescent');
  });

  it('keeps a lettered number and a parenthesized tail', () => {
    expect(respelledSeedAddress('120A Grampian Wy')).toBe('120A Grampian Way');
    expect(respelledSeedAddress('5 Grampian Wy (Rear)')).toBe('5 Grampian Way (Rear)');
  });

  it('leaves an address already in its longest spelling, or with no suffix, alone', () => {
    expect(respelledSeedAddress('23-27 Lanark Road')).toBeNull();
    expect(respelledSeedAddress('29 Neponset Field Lane')).toBeNull();
    expect(respelledSeedAddress('10 W Broadway')).toBeNull();
    expect(respelledSeedAddress('12 Lanark Road (Rear)')).toBeNull();
    expect(respelledSeedAddress('5 Park Street')).toBeNull();
    expect(respelledSeedAddress('5 Wy')).toBeNull();
  });

  it.each([
    ['9 Grampian Wy', '9', null, 'GRAMPIAN WY'],
    ['9 Cummins Hw', '9', null, 'CUMMINS HW'],
    ['3 Mamelon Ci', '3', null, 'MAMELON CI'],
    ['50 Neponset Valley Pw', '50', null, 'NEPONSET VALLEY PW'],
    ['11 Radford La', '11', null, 'RADFORD LA'],
    ['2 Holden Ro', '2', null, 'HOLDEN RO'],
    ['11 Board Al', '11', null, 'BOARD AL'],
    ['10-12 Conry Cr', '10', '12', 'CONRY CR'],
  ])('respells %s exactly as a fresh seed would format it', (stored, lo, hi, stName) => {
    expect(respelledSeedAddress(stored)).toBe(formatSeedAddress(lo, hi, stName));
  });
});

describe('planSuffixBackfill', () => {
  const grampian = row({ id: 'seed-g', address: '120 Grampian Wy', street_key: 'GRAMPIAN WY', st_num_lo: 120, st_num_hi: 120 });
  const neponset = row({ id: 'seed-n', address: '29 Neponset Field Lane', street_key: 'NEPONSET FIELD LN', st_num_lo: 29, st_num_hi: 29 });
  const lanark = row({ id: 'seed-l', address: '23-27 Lanark Road', street_key: 'LANARK RD', st_num_lo: 23, st_num_hi: 27 });
  const userWy = row({ id: 'u-wy', source: 'user', address: '9 Appian Wy', street_key: 'APPIAN WY', st_num_lo: 9, st_num_hi: 9 });
  const userWay = row({ id: 'u-way', source: 'user', address: '9 Appian Way', street_key: 'APPIAN WAY', st_num_lo: 9, st_num_hi: 9 });

  it('respells a seeded Wy row without re-keying it, and re-keys the stored LN key without respelling it', () => {
    const plan = planSuffixBackfill([grampian, neponset, lanark]);
    expect(plan.respells).toEqual([{ id: 'seed-g', source: 'seed', from: '120 Grampian Wy', to: '120 Grampian Way' }]);
    expect(plan.rekeys).toEqual([{ id: 'seed-n', source: 'seed', from: 'NEPONSET FIELD LN', to: 'NEPONSET FIELD LA' }]);
    expect(plan.refused).toEqual([]);
  });

  it('never respells a user row, but re-keys one keyed under the old table', () => {
    const plan = planSuffixBackfill([userWy, userWay]);
    expect(plan.respells).toEqual([]);
    expect(plan.rekeys).toEqual([{ id: 'u-way', source: 'user', from: 'APPIAN WAY', to: 'APPIAN WY' }]);
  });

  it('refuses a lone directional base, a respell that changes the key or range, and a degenerate re-key', () => {
    const plan = planSuffixBackfill([
      row({ id: 'seed-dir', address: '7 N Wy', street_key: 'N WY', st_num_lo: 7, st_num_hi: 7 }),
      row({ id: 'seed-rear', address: '5 Grampian Wy (Rear)', street_key: 'GRAMPIAN WY (REAR)', st_num_lo: 5, st_num_hi: 5 }),
      row({ id: 'seed-range', address: '9-11 Appian Wy', street_key: 'APPIAN WY', st_num_lo: 9, st_num_hi: 13 }),
      row({ id: 'seed-bare', address: '5 Wy', street_key: 'WY', st_num_lo: 5, st_num_hi: 5 }),
    ]);
    expect(plan.refused).toEqual([
      { id: 'seed-dir', address: '7 N Wy', reason: 'lone_directional_base' },
      { id: 'seed-rear', address: '5 Grampian Wy (Rear)', reason: 'respell_changes_key' },
      { id: 'seed-range', address: '9-11 Appian Wy', reason: 'respell_changes_key' },
      { id: 'seed-bare', address: '5 Wy', reason: 'rekey_degenerate' },
    ]);
    expect(plan.respells).toEqual([]);
    expect(plan.rekeys).toEqual([]);
    expect(rekeyStatements(plan).join('\n')).not.toContain('NULL');
  });

  it('snapshots exactly the rows it touches or refuses', () => {
    const bare = row({ id: 'seed-bare', address: '5 Wy', street_key: 'WY', st_num_lo: 5, st_num_hi: 5 });
    const plan = planSuffixBackfill([grampian, neponset, lanark, userWy, userWay, bare]);
    expect(plan.before.map((r) => r.id)).toEqual(['seed-g', 'seed-n', 'u-way', 'seed-bare']);
    expect(plan.before[0]).toEqual(grampian);
  });

  it('refreshes seeded ids only, from both lists, deduped and sorted', () => {
    const both = row({ id: 'seed-b', address: '1 Greenough Ln', street_key: 'GREENOUGH LN', st_num_lo: 1, st_num_hi: 1 });
    const plan = planSuffixBackfill([grampian, neponset, userWay, both]);
    expect(plan.respells.map((c) => c.id)).toEqual(['seed-g', 'seed-b']);
    expect(plan.rekeys.map((c) => c.id)).toEqual(['seed-n', 'u-way', 'seed-b']);
    expect(refreshIds(plan)).toEqual(['seed-b', 'seed-g', 'seed-n']);
  });
});

describe('suffix backfill statements', () => {
  const plan: SuffixBackfillPlan = {
    respells: [{ id: 'seed-g', source: 'seed', from: '120 Grampian Wy', to: '120 Grampian Way' }],
    rekeys: [{ id: 'seed-n', source: 'seed', from: 'NEPONSET FIELD LN', to: 'NEPONSET FIELD LA' }],
    refused: [],
    before: [],
  };

  it('spells each statement out exactly, guarded by the old value', () => {
    expect(rekeyStatements(plan)).toEqual([
      "UPDATE buildings SET street_key = 'NEPONSET FIELD LA' WHERE id = 'seed-n' AND street_key = 'NEPONSET FIELD LN';",
    ]);
    expect(respellStatements(plan)).toEqual([
      "UPDATE buildings SET address = '120 Grampian Way', updated_at = unixepoch() WHERE id = 'seed-g' AND source = 'seed' AND address = '120 Grampian Wy';",
    ]);
    expect(refreshStatements(plan, 1000)).toEqual([
      "INSERT OR IGNORE INTO records_queue (building_id, reason, priority, requested_at) SELECT 'seed-g', 'refresh', 1, unixepoch() WHERE EXISTS (SELECT 1 FROM buildings WHERE id = 'seed-g') AND NOT EXISTS (SELECT 1 FROM record_pulls WHERE building_id = 'seed-g' AND retrieved_at >= 1000);",
      "INSERT OR IGNORE INTO records_queue (building_id, reason, priority, requested_at) SELECT 'seed-n', 'refresh', 1, unixepoch() WHERE EXISTS (SELECT 1 FROM buildings WHERE id = 'seed-n') AND NOT EXISTS (SELECT 1 FROM record_pulls WHERE building_id = 'seed-n' AND retrieved_at >= 1000);",
    ]);
    expect(refreshCancelStatements(plan, 1000)[0]).toBe(
      "UPDATE records_queue SET done_at = unixepoch() WHERE building_id = 'seed-g' AND reason = 'refresh' AND done_at IS NULL AND requested_at >= 1000;",
    );
  });

  it('makes each rollback the exact inverse', () => {
    expect(rekeyRollbackStatements(plan)).toEqual([
      "UPDATE buildings SET street_key = 'NEPONSET FIELD LN' WHERE id = 'seed-n' AND street_key = 'NEPONSET FIELD LA';",
    ]);
    expect(respellRollbackStatements(plan)).toEqual([
      "UPDATE buildings SET address = '120 Grampian Wy', updated_at = unixepoch() WHERE id = 'seed-g' AND source = 'seed' AND address = '120 Grampian Way';",
    ]);
  });

  it('quotes an apostrophe through lit()', () => {
    const obrien = planSuffixBackfill([row({ id: 'seed-ob', address: "5 O'Brien Wy", street_key: "O'BRIEN WY", st_num_lo: 5, st_num_hi: 5 })]);
    expect(respellStatements(obrien)[0]).toContain("SET address = '5 O''Brien Way'");
    expect(respellStatements(obrien)[0]).toContain("AND address = '5 O''Brien Wy'");
  });

  it('refuses a refresh cutoff that is not a whole number of seconds', () => {
    expect(() => refreshStatements(plan, Number.NaN)).toThrow();
    expect(() => refreshStatements(plan, 1.5)).toThrow();
  });
});

describe('backfillFiles and writeBackfillRun', () => {
  const twoRespellsOneRekey = planSuffixBackfill([
    row({ id: 'seed-g', address: '120 Grampian Wy', street_key: 'GRAMPIAN WY', st_num_lo: 120, st_num_hi: 120 }),
    row({ id: 'seed-h', address: '9 Cummins Hw', street_key: 'CUMMINS HW', st_num_lo: 9, st_num_hi: 9 }),
    row({ id: 'seed-n', address: '29 Neponset Field Lane', street_key: 'NEPONSET FIELD LN', st_num_lo: 29, st_num_hi: 29 }),
  ]);

  interface FakeFs extends RunDirFs {
    writes: Array<{ path: string; data: string; flag: string }>;
    mkdirs: Array<{ path: string; options: { recursive: true } }>;
  }

  function fakeFs(exists = false): FakeFs {
    const writes: FakeFs['writes'] = [];
    const mkdirs: FakeFs['mkdirs'] = [];
    return {
      writes,
      mkdirs,
      existsSync: () => exists,
      mkdirSync: (path: string, options: { recursive: true }) => {
        mkdirs.push({ path, options });
      },
      writeFileSync: (path: string, data: string, options: { flag: 'wx' }) => {
        writes.push({ path, data, flag: options.flag });
      },
    };
  }

  it('writes the re-key, respell and refresh files apart, plus a snapshot and a summary', () => {
    const files = backfillFiles(twoRespellsOneRekey, OPTIONS);
    expect([...files.keys()].sort()).toEqual([
      'before.json', 'refresh-cancel.sql', 'refresh.sql', 'rekey-rollback.sql', 'rekey.sql', 'respell-rollback.sql', 'respell.sql', 'summary.txt',
    ]);
    expect(files.get('rekey.sql')).toBe(`${rekeyStatements(twoRespellsOneRekey).join('\n')}\n`);
    expect(files.get('respell.sql')!.trim().split('\n')).toHaveLength(2);
    expect(files.get('refresh.sql')!.trim().split('\n')).toHaveLength(3);
    for (const [name, content] of files) {
      if (name.endsWith('.sql')) expect(content).not.toMatch(/^--/m);
    }
    expect(JSON.parse(files.get('before.json')!)).toEqual(twoRespellsOneRekey.before);
    const summary = files.get('summary.txt')!;
    expect(summary).toContain('--remote');
    expect(summary).toContain('1793067655');
    expect(summary).toContain('1793000000');
    expect(summary).toContain('Highway 1');
    expect(summary).toContain('Way 1');
    expect(summary).toContain('seed-n: NEPONSET FIELD LN -> NEPONSET FIELD LA');
    expect(summary).toContain('npx wrangler d1 execute ratemyplace-db --remote --file .cache/suffix-backfill/remote-1793067655/rekey.sql');
    expect(summary).toContain('npx wrangler d1 execute ratemyplace-db --remote --file .cache/suffix-backfill/remote-1793067655/respell.sql');
    expect(summary).toContain('npx wrangler d1 execute ratemyplace-db --remote --file .cache/suffix-backfill/remote-1793067655/refresh.sql');
  });

  it('writes no refresh files without a cutoff, and says why', () => {
    const files = backfillFiles(twoRespellsOneRekey, { ...OPTIONS, pulledSince: null });
    expect(files.has('refresh.sql')).toBe(false);
    expect(files.has('refresh-cancel.sql')).toBe(false);
    expect(files.get('summary.txt')).toContain('refresh.sql not written: pass --pulled-since <T_live>');
  });

  it('writes no respell files for a re-key-only plan', () => {
    const rekeyOnly = planSuffixBackfill([row({ id: 'seed-n', address: '29 Neponset Field Lane', street_key: 'NEPONSET FIELD LN', st_num_lo: 29, st_num_hi: 29 })]);
    const files = backfillFiles(rekeyOnly, OPTIONS);
    expect(files.has('respell.sql')).toBe(false);
    expect(files.has('respell-rollback.sql')).toBe(false);
    expect(files.has('rekey.sql')).toBe(true);
  });

  it('writes nothing at all for a plan with no changes', () => {
    const none = planSuffixBackfill([row({ id: 'seed-l', address: '23-27 Lanark Road', street_key: 'LANARK RD', st_num_lo: 23, st_num_hi: 27 })]);
    const files = backfillFiles(none, OPTIONS);
    expect(files.size).toBe(0);
    const fs = fakeFs();
    expect(writeBackfillRun('.cache/suffix-backfill/x', files, fs)).toBe(false);
    expect(fs.mkdirs).toEqual([]);
    expect(fs.writes).toEqual([]);
  });

  it('throws rather than write a file past the per-file statement ceiling', () => {
    const big: SuffixBackfillPlan = {
      respells: Array.from({ length: MAX_STATEMENTS_PER_FILE + 1 }, (_, i) => ({ id: `seed-${i}`, source: 'seed' as const, from: `${i} Grampian Wy`, to: `${i} Grampian Way` })),
      rekeys: [],
      refused: [],
      before: [],
    };
    expect(() => backfillFiles(big, { ...OPTIONS, pulledSince: null })).toThrow(/999/);
  });

  it('refuses to overwrite an existing run directory and writes nothing', () => {
    const fs = fakeFs(true);
    expect(() => writeBackfillRun('.cache/suffix-backfill/x', backfillFiles(twoRespellsOneRekey, OPTIONS), fs)).toThrow(/refusing to overwrite/);
    expect(fs.mkdirs).toEqual([]);
    expect(fs.writes).toEqual([]);
  });

  it('creates the directory and writes every file exclusively', () => {
    const fs = fakeFs();
    const files = backfillFiles(twoRespellsOneRekey, OPTIONS);
    expect(writeBackfillRun('.cache/suffix-backfill/x', files, fs)).toBe(true);
    expect(fs.mkdirs).toEqual([{ path: '.cache/suffix-backfill/x', options: { recursive: true } }]);
    expect(fs.writes.map((w) => w.path).sort()).toEqual([...files.keys()].map((name) => `.cache/suffix-backfill/x/${name}`).sort());
    expect(fs.writes.every((w) => w.flag === 'wx')).toBe(true);
  });
});

/** Applies a generated file the way `wrangler d1 execute --file` would, one statement per line. */
async function apply(db: TestD1Database, content: string | undefined): Promise<number> {
  if (content === undefined) throw new Error('file was not generated');
  let changes = 0;
  for (const statement of content.split('\n').filter((line) => line.trim() !== '')) {
    changes += (await db.prepare(statement).run()).meta.changes;
  }
  return changes;
}

async function buildingRow(db: TestD1Database, id: string) {
  return db.prepare('SELECT address, slug, street_key, updated_at FROM buildings WHERE id = ?').bind(id).first<{ address: string; slug: string; street_key: string; updated_at: number }>();
}

suite('suffix backfill files applied to the records schema', () => {
  it('re-keys, respells, queues refreshes once, cancels, and rolls back', async () => {
    const db = createRecordsTestDb();
    const seed = (id: string, address: string, streetKey: string, lo: number, hi: number) =>
      insertBuilding(db, { id, address, slug: `${id}-slug`, source: 'seed', street_key: streetKey, st_num_lo: lo, st_num_hi: hi });
    await seed('seed-g', '120 Grampian Wy', 'GRAMPIAN WY', 120, 120);
    await seed('seed-n', '29 Neponset Field Lane', 'NEPONSET FIELD LN', 29, 29);
    await seed('seed-a', '9-11 Appian Wy', 'APPIAN WY', 9, 11);
    await seed('seed-p', '72-74 Grampian Wy', 'GRAMPIAN WY', 72, 74);
    await seed('seed-o', '3 Mamelon Ci', 'MAMELON CI', 3, 3);
    await insertBuilding(db, { id: 'u1', address: '9 Appian Way', slug: 'u1-slug', source: 'user', street_key: 'APPIAN WAY', st_num_lo: 9, st_num_hi: 9 });
    await db.prepare('UPDATE buildings SET updated_at = 1').run();
    await db.prepare("INSERT INTO records_queue (building_id, reason, priority, requested_at) VALUES ('seed-a', 'fill', 2, 1)").run();
    await insertPull(db, 'seed-p', 'pilot');
    await insertPull(db, 'seed-o', 'old');
    await db.prepare("UPDATE record_pulls SET retrieved_at = 500 WHERE building_id = 'seed-o'").run();

    const { results } = await db
      .prepare('SELECT id, address, source, street_key, st_num_lo, st_num_hi, updated_at FROM buildings WHERE street_key IS NOT NULL ORDER BY id')
      .all<KeyedBuildingRow>();
    const plan = planSuffixBackfill(results);
    const files = backfillFiles(plan, { ...OPTIONS, pulledSince: 1000 });

    // Re-key: the stale LN seed and the user row keyed under the old table; no date moves.
    expect(await apply(db, files.get('rekey.sql'))).toBe(2);
    expect(await buildingRow(db, 'seed-n')).toMatchObject({ street_key: 'NEPONSET FIELD LA', updated_at: 1 });
    expect(await buildingRow(db, 'u1')).toMatchObject({ street_key: 'APPIAN WY', updated_at: 1 });

    // Respell: four seeds, content changed so updated_at moves; slugs and the user row stay.
    expect(await apply(db, files.get('respell.sql'))).toBe(4);
    for (const [id, address] of [['seed-g', '120 Grampian Way'], ['seed-a', '9-11 Appian Way'], ['seed-p', '72-74 Grampian Way'], ['seed-o', '3 Mamelon Circle']]) {
      const after = await buildingRow(db, id);
      expect(after?.address).toBe(address);
      expect(after?.slug).toBe(`${id}-slug`);
      expect(after!.updated_at).toBeGreaterThan(1);
    }
    expect(await buildingRow(db, 'u1')).toMatchObject({ address: '9 Appian Way', slug: 'u1-slug' });

    // Re-applying either file changes nothing.
    expect((await apply(db, files.get('rekey.sql'))) + (await apply(db, files.get('respell.sql')))).toBe(0);

    // Refresh: skip a pending fill row, a building pulled since the cutoff, and the user row.
    await apply(db, files.get('refresh.sql'));
    expect(await pendingReasons(db, 'seed-g')).toEqual(['refresh']);
    expect(await pendingReasons(db, 'seed-n')).toEqual(['refresh']);
    expect(await pendingReasons(db, 'seed-o')).toEqual(['refresh']);
    expect(await pendingReasons(db, 'seed-a')).toEqual(['fill']);
    expect(await pendingReasons(db, 'seed-p')).toEqual([]);
    expect(await pendingReasons(db, 'u1')).toEqual([]);

    // The batch drains: every refresh row done, every building pulled. A second apply is a no-op.
    await db.prepare("UPDATE records_queue SET done_at = unixepoch() WHERE reason = 'refresh'").run();
    for (const id of ['seed-g', 'seed-n', 'seed-o']) await insertPull(db, id, 'refresh');
    const queued = async () => (await db.prepare('SELECT COUNT(*) AS n FROM records_queue').first<{ n: number }>())!.n;
    const beforeReapply = await queued();
    expect(await apply(db, files.get('refresh.sql'))).toBe(0);
    expect(await queued()).toBe(beforeReapply);

    // Cancel closes a pending refresh row.
    await db.prepare("INSERT INTO records_queue (building_id, reason, priority, requested_at) VALUES ('seed-g', 'refresh', 1, unixepoch())").run();
    await apply(db, files.get('refresh-cancel.sql'));
    expect(await pendingReasons(db, 'seed-g')).toEqual([]);

    // Roll back respell first, then the re-key: every address and key is as it started.
    await apply(db, files.get('respell-rollback.sql'));
    await apply(db, files.get('rekey-rollback.sql'));
    for (const original of results) {
      expect(await buildingRow(db, original.id)).toMatchObject({ address: original.address, street_key: original.street_key });
    }
  });
});
