// Shelling out to `wrangler d1 execute --json` from a script: one copy of the argument
// quoting, the JSON-payload parse and the `"null"` folding (see `foldNullStrings`), shared by
// `records-seed-boston.ts` and `records-suffix-backfill.ts`. Moved verbatim from the seed
// script, so the comments below still speak of the seed's columns.
import { execFileSync } from 'node:child_process';

/** The D1 database name, local and remote (`database_name` in `wrangler.jsonc`). */
export const D1_DATABASE = 'ratemyplace-db';

/**
 * `execFileSync` with `shell: true` joins argv with single spaces and quotes nothing, on
 * every platform. Windows also cannot spawn `npx.cmd` without a shell (Node refuses to
 * exec a .cmd directly since the 2024 argument-injection fix), so the shell is not
 * optional here and each argument carries its own quotes. No value below contains a
 * double quote; the SQL's single quotes survive `cmd /s /c "..."` unchanged.
 */
export function shellArg(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

/**
 * Wrangler prints its banner and any config warnings before the `--json` payload, and a
 * warning line contains a `[` of its own (`▲ [WARNING] ...`). The payload is the first
 * line that *starts* with `[`.
 */
export function parseWranglerJson<T>(out: string): Array<{ results: T[] }> {
  const start = /^\[/m.exec(out);
  if (!start) throw new Error(`wrangler --json produced no JSON array:\n${out}`);
  return JSON.parse(out.slice(start.index)) as Array<{ results: T[] }>;
}

/**
 * `wrangler d1 execute --json` renders a SQL NULL as the JSON *string* `"null"` (verified
 * against the local D1 on 2026-09-09: `SELECT NULL AS a` comes back as `{"a":"null"}`).
 * Left alone it makes every existing row's empty `parcel_id` read as a real, disagreeing
 * parcel, so `matchExistingBuildings` files a clean match as a conflict and the seed then
 * creates a duplicate row for that parcel. None of the columns this script selects — id,
 * address, slug, parcel_id, latitude, longitude, zip_code — can legitimately hold "null",
 * so the string folds back to null here. A wrangler release that emits real JSON nulls
 * makes this a no-op.
 */
export function foldNullStrings<T>(row: T): T {
  const folded = Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, value === 'null' ? null : value] as const);
  return Object.fromEntries(folded) as T;
}

export function wranglerJson<T>(commandArgs: string[]): T[] {
  const argv = ['wrangler', 'd1', 'execute', D1_DATABASE, '--json', ...commandArgs].map(shellArg);
  const out = execFileSync('npx', argv, { encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  return parseWranglerJson<T>(out)
    .flatMap((r) => r.results)
    .map(foldNullStrings);
}
