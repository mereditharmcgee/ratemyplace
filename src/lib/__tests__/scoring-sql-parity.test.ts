/**
 * Executable SQL⇄JS parity test.
 *
 * Proves the emitted `recencyWeightedOverallSql` fragment computes the SAME
 * recency-weighted aggregate as the JS `calculateAggregatedScores`, by running
 * the SQL against a real SQLite engine (Node's built-in `node:sqlite`) and
 * comparing to the JS result over the identical fixture.
 *
 * `node:sqlite` is a built-in in Node >= 22 (stable in v24). It is loaded
 * synchronously below; if it is unavailable (older Node, or a runtime that does
 * not expose it without `--experimental-sqlite`), the whole suite is SKIPPED via
 * `describe.skip` rather than failing the `npm test` run. The warning printed at
 * load time explains why.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { recencyWeightedOverallSql } from '../scoring-sql';
import { calculateAggregatedScores } from '../scoring';

// --- Synchronous availability probe (decides describe vs describe.skip) ---
let DatabaseSync: any;
let sqliteAvailable = false;
try {
  const require = createRequire(import.meta.url);
  ({ DatabaseSync } = require('node:sqlite'));
  const probe = new DatabaseSync(':memory:');
  probe.exec('CREATE TABLE _probe (x)');
  probe.close();
  sqliteAvailable = true;
} catch (err) {
  sqliteAvailable = false;
  // eslint-disable-next-line no-console
  console.warn(
    '[scoring-sql-parity] node:sqlite unavailable — parity suite SKIPPED. ' +
      'Requires Node >= 22 with node:sqlite (may need the --experimental-sqlite flag). ' +
      `Reason: ${(err as Error)?.message}`
  );
}

const CURRENT_YEAR = 2026;

type FixtureRow = {
  id: string;
  building_id: string;
  status: string;
  overall_score: number | null;
  move_out_year_new: string | null; // TEXT: a 4-digit year, 'current', or null
  created_at: number; // unix epoch seconds
};

/** July 1 of `year`, UTC, in unix seconds — mid-year to avoid boundary flakiness. */
function midYearUnix(year: number): number {
  return Math.floor(Date.UTC(year, 6, 1) / 1000);
}

const suite = sqliteAvailable ? describe : describe.skip;

suite('recencyWeightedOverallSql ⇄ calculateAggregatedScores parity (real SQLite)', () => {
  function makeDb(rows: FixtureRow[]) {
    const db = new DatabaseSync(':memory:');
    db.exec(
      'CREATE TABLE reviews (id TEXT, building_id TEXT, status TEXT, overall_score REAL, move_out_year_new TEXT, created_at INTEGER)'
    );
    const stmt = db.prepare(
      'INSERT INTO reviews (id, building_id, status, overall_score, move_out_year_new, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const r of rows) {
      stmt.run(r.id, r.building_id, r.status, r.overall_score, r.move_out_year_new, r.created_at);
    }
    return db;
  }

  /** Run the emitted SQL fragment for one building and return the scalar (number | null). */
  function sqlAvg(db: any, buildingId: string): number | null {
    const sql = `SELECT ${recencyWeightedOverallSql('r', CURRENT_YEAR)} as avg
      FROM reviews r
      WHERE r.building_id = ? AND r.status = 'approved'`;
    const row = db.prepare(sql).get(buildingId) as { avg: number | null } | undefined;
    return row?.avg ?? null;
  }

  /** JS side over the same approved rows for one building. */
  function jsAvg(rows: FixtureRow[], buildingId: string): number | null {
    const approved = rows.filter((r) => r.building_id === buildingId && r.status === 'approved');
    return calculateAggregatedScores(approved, CURRENT_YEAR).avgOverall;
  }

  it('mixed recent + aged reviews, with a NULL-overall row excluded (ages 0,3,4,5)', () => {
    // Ages exercised against CURRENT_YEAR=2026 via explicit move_out_year_new
    // (a 4-digit TEXT year wins over created_at):
    //   '2026' -> age 0 -> weight 1.00
    //   '2023' -> age 3 -> weight 0.95
    //   '2022' -> age 4 -> weight 0.90
    //   '2021' -> age 5 -> weight 0.85
    const rows: FixtureRow[] = [
      { id: 'r1', building_id: 'b1', status: 'approved', overall_score: 4.0, move_out_year_new: '2026', created_at: midYearUnix(2026) },
      { id: 'r2', building_id: 'b1', status: 'approved', overall_score: 3.0, move_out_year_new: '2023', created_at: midYearUnix(2023) },
      { id: 'r3', building_id: 'b1', status: 'approved', overall_score: 5.0, move_out_year_new: '2022', created_at: midYearUnix(2022) },
      { id: 'r4', building_id: 'b1', status: 'approved', overall_score: 2.0, move_out_year_new: '2021', created_at: midYearUnix(2021) },
      // NULL overall_score — MUST be excluded from both SQL and JS aggregates.
      { id: 'r5', building_id: 'b1', status: 'approved', overall_score: null, move_out_year_new: '2026', created_at: midYearUnix(2026) },
    ];
    const db = makeDb(rows);
    try {
      // Hand-computed expected (NULL row excluded):
      //   num = 4.0*1.00 + 3.0*0.95 + 5.0*0.90 + 2.0*0.85 = 13.05
      //   den = 1.00 + 0.95 + 0.90 + 0.85               = 3.70
      //   13.05 / 3.70 = 3.5270... -> round(1) = 3.5
      const expected = 3.5;
      const sql = sqlAvg(db, 'b1');
      const js = jsAvg(rows, 'b1');

      expect(js).toBe(expected); // proves NULL-overall exclusion (hand value)
      expect(sql).toBe(expected);
      expect(sql).toBe(js); // the parity assertion
    } finally {
      db.close();
    }
  });

  it("created_at-fallback year ('current' / NULL move_out_year_new) stays in parity", () => {
    // A non-4-digit move_out_year_new ('current') or NULL -> recency basis is the
    // UTC year of created_at in BOTH paths (SQL strftime vs JS getReviewYear).
    // Mid-year timestamps avoid edges.
    const rows: FixtureRow[] = [
      { id: 'c1', building_id: 'b4', status: 'approved', overall_score: 2.0, move_out_year_new: 'current', created_at: midYearUnix(2021) }, // age 5 -> 0.85
      { id: 'c2', building_id: 'b4', status: 'approved', overall_score: 4.0, move_out_year_new: null, created_at: midYearUnix(2026) }, // age 0 -> 1.00
    ];
    const db = makeDb(rows);
    try {
      // num = 2.0*0.85 + 4.0*1.00 = 5.7 ; den = 1.85 ; 5.7/1.85 = 3.081... -> 3.1
      const sql = sqlAvg(db, 'b4');
      const js = jsAvg(rows, 'b4');
      expect(js).toBe(3.1);
      expect(sql).toBe(js);
    } finally {
      db.close();
    }
  });

  it('all-NULL overall_score -> both return NULL', () => {
    const rows: FixtureRow[] = [
      { id: 'n1', building_id: 'b2', status: 'approved', overall_score: null, move_out_year_new: '2026', created_at: midYearUnix(2026) },
      { id: 'n2', building_id: 'b2', status: 'approved', overall_score: null, move_out_year_new: '2022', created_at: midYearUnix(2022) },
    ];
    const db = makeDb(rows);
    try {
      expect(sqlAvg(db, 'b2')).toBeNull();
      expect(jsAvg(rows, 'b2')).toBeNull();
    } finally {
      db.close();
    }
  });

  it('no matching rows -> both return NULL', () => {
    const rows: FixtureRow[] = [
      // A row for a DIFFERENT building, so b3 has zero approved rows.
      { id: 'x1', building_id: 'other', status: 'approved', overall_score: 4.0, move_out_year_new: '2026', created_at: midYearUnix(2026) },
    ];
    const db = makeDb(rows);
    try {
      expect(sqlAvg(db, 'b3')).toBeNull();
      expect(jsAvg(rows, 'b3')).toBeNull();
    } finally {
      db.close();
    }
  });
});
