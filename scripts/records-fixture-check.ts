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
 * It pulls every Boston source for the records fixture, one fixed building (`RECORDS_FIXTURE`:
 * 2262-2266 Dorchester Ave, a Boston Housing Authority building), and checks the results
 * against the known-good values recorded there in November 2026. A failure does not
 * necessarily mean the adapter is broken: the city's data moves (new assessment year, new
 * enforcement case, more 311 volume). Read the printed actual values and decide whether the
 * fixture's expectations are stale or the adapter regressed. Do not just bump the expected
 * numbers to make it pass.
 *
 * The checks themselves live in `src/lib/records/fixture.ts`, because the scheduler's
 * daily circuit breaker runs the same ones inside a Worker. This script only prints them.
 *
 * Usage: npm run records:check
 */

import { runRecordsFixture } from '../src/lib/records/fixture';
import type { FetchLike } from '../src/lib/records/types';

const fetchImpl: FetchLike = (input, init) => fetch(input, init);

async function main(): Promise<void> {
  const result = await runRecordsFixture(fetchImpl);

  console.log(`Resolved parcelId=${result.parcelId} condominium=${result.condominium}`);
  console.log('');

  // Row counts before the checks: a check that failed because its source came back empty
  // reads very differently from one that failed on a changed value, and only these lines
  // tell them apart.
  for (const [label, rows] of Object.entries(result.rowsBySource)) {
    console.log(`${label}: ${rows} rows`);
  }
  for (const err of result.sourceErrors) {
    console.log(`${err.label}: FAILED — ${err.message}`);
  }
  console.log('');

  // A passing line prints only its note, never its whole detail: the note is what the 311 empty-file
  // probe excused (a lowered floor, a skipped file), and the other details can carry values a
  // passing morning has no reason to print, such as the RentSmart check's city-wide sample parcel.
  for (const c of result.checks) {
    if (!c.ok) console.log(`FAIL ${c.label} — ${c.detail}`);
    else console.log(c.note ? `PASS ${c.label} (${c.note})` : `PASS ${c.label}`);
  }

  // Report-only: a notice never changes the exit code, as it never pauses the fill.
  if (result.notices.length > 0) {
    console.log('');
    for (const n of result.notices) console.log(`NOTE ${n.label} — ${n.detail}`);
  }

  console.log('');
  console.log(
    result.failures === 0
      ? 'ALL PASS'
      : `${result.failures} failure(s): ${result.checksFailed} check(s) failed, ${result.sourceErrors.length} source(s) threw`,
  );
  process.exit(result.failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Fixture check crashed:', err);
  process.exit(1);
});
