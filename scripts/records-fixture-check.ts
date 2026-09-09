/**
 * Live fixture check for the Boston record adapters (src/lib/records/).
 *
 * This is NOT a test — it is not run by CI and does not use vitest. It hits
 * data.boston.gov for real, so it is slow and depends on the city's data staying put.
 * Run it by hand:
 *   - before the first production pull of a new building/parcel workflow
 *   - whenever Boston changes a schema on one of the eleven sources in jurisdictions.ts
 *     (a renamed/dropped column, a retired CKAN resource id, a reclassified 311 reason)
 *
 * It pulls every Boston source for one fixed fixture — 23-27 Lanark Rd, Brighton,
 * parcel 2102098000 — and checks the results against known-good values recorded
 * September 2026. A failure does not necessarily mean the adapter is broken: the city's
 * data moves (new assessment year, new enforcement case, more 311 volume). Read the
 * printed actual values and decide whether the fixture's expectations are stale or the
 * adapter regressed — do not just bump the expected numbers to make it pass.
 *
 * The checks themselves live in `src/lib/records/fixture.ts`, because the scheduler's
 * daily circuit breaker runs the same ones inside a Worker. This script only prints them.
 *
 * Usage: npm run records:check
 */

import { runLanarkFixture } from '../src/lib/records/fixture';
import type { FetchLike } from '../src/lib/records/types';

const fetchImpl: FetchLike = (input, init) => fetch(input, init);

async function main(): Promise<void> {
  const result = await runLanarkFixture(fetchImpl);

  for (const err of result.sourceErrors) {
    console.log(`${err.label}: FAILED — ${err.message}`);
  }
  for (const c of result.checks) {
    console.log(c.ok ? `PASS ${c.label}` : `FAIL ${c.label} — ${c.detail}`);
  }

  console.log('');
  console.log(result.failures === 0 ? 'ALL PASS' : `${result.failures} failure(s)`);
  process.exit(result.failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Fixture check crashed:', err);
  process.exit(1);
});
