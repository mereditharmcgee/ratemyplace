/**
 * Regenerates ops/METRICS.md from the production database.
 *
 * Why this exists: every stale doc in this repo went stale because a human had to
 * remember to update a number. These numbers update themselves.
 *
 * Usage:
 *   npx tsx scripts/ops-metrics.ts            # writes ops/METRICS.md
 *   npx tsx scripts/ops-metrics.ts --dry-run  # prints, writes nothing
 *
 * Requires CLOUDFLARE_API_TOKEN in the environment (see AGENTS.md traps).
 * Read-only: every query is a SELECT. It never writes to the database.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'ops/METRICS.md');
const DB = 'ratemyplace-db';

/** The review threshold below which a named party's aggregate score is withheld. */
const NAMED_PARTY_MIN_REVIEWS = 3;

// Invoke wrangler's JS entry point with the current node binary rather than the
// `npx` / `wrangler.cmd` shims. Node 24 refuses to spawn .cmd files without
// shell:true, and shell:true would force SQL through shell quoting. This path
// avoids both problems and behaves the same on Windows, macOS, and Linux.
const WRANGLER = resolve(ROOT, 'node_modules/wrangler/bin/wrangler.js');

function query<T = Record<string, unknown>>(sql: string): T[] {
  const raw = execFileSync(
    process.execPath,
    [WRANGLER, 'd1', 'execute', DB, '--remote', '--json', '--command', sql],
    { encoding: 'utf8', cwd: ROOT, maxBuffer: 32 * 1024 * 1024 },
  );
  // wrangler prefixes human-readable banner lines before the JSON payload.
  const start = raw.indexOf('[');
  if (start === -1) throw new Error(`No JSON in wrangler output:\n${raw.slice(0, 500)}`);
  const parsed = JSON.parse(raw.slice(start));
  return parsed[0]?.results ?? [];
}

function num(rows: Record<string, unknown>[], key: string): number {
  return Number(rows[0]?.[key] ?? 0);
}

const counts = query(`SELECT
  (SELECT COUNT(*) FROM reviews WHERE status='approved') AS reviews_approved,
  (SELECT COUNT(*) FROM reviews WHERE status='pending')  AS reviews_pending,
  (SELECT COUNT(*) FROM buildings)                        AS buildings,
  (SELECT COUNT(*) FROM landlords)                        AS landlords,
  (SELECT COUNT(*) FROM property_managers)                AS managers,
  (SELECT COUNT(*) FROM reviews WHERE is_verified=1)      AS reviews_verified,
  (SELECT COUNT(*) FROM disputes)                         AS disputes`);

// Landlord coverage: how many clear the named-party display threshold.
const landlordDist = query<{ n_reviews: number; n_landlords: number }>(`
  SELECT n_reviews, COUNT(*) AS n_landlords FROM (
    SELECT b.landlord_id, COUNT(r.id) AS n_reviews
    FROM reviews r JOIN buildings b ON b.id = r.building_id
    WHERE r.status='approved' AND b.landlord_id IS NOT NULL
    GROUP BY b.landlord_id
  ) GROUP BY n_reviews ORDER BY n_reviews`);

// Buildings carrying at least one approved review — the coverage that makes search useful.
const covered = query(`
  SELECT COUNT(DISTINCT building_id) AS n FROM reviews WHERE status='approved'`);

const withScore = landlordDist
  .filter((r) => r.n_reviews >= NAMED_PARTY_MIN_REVIEWS)
  .reduce((s, r) => s + Number(r.n_landlords), 0);
const belowScore = landlordDist
  .filter((r) => r.n_reviews < NAMED_PARTY_MIN_REVIEWS)
  .reduce((s, r) => s + Number(r.n_landlords), 0);

const reviewsApproved = num(counts, 'reviews_approved');
const buildings = num(counts, 'buildings');
const buildingsCovered = num(covered, 'n');

const today = new Date().toISOString().slice(0, 10);

const distRows = landlordDist
  .map((r) => {
    const flag = r.n_reviews >= NAMED_PARTY_MIN_REVIEWS ? 'shown' : 'withheld';
    return `| ${r.n_reviews} | ${r.n_landlords} | ${flag} |`;
  })
  .join('\n');

const md = `# Metrics

**Generated ${today} from the production database.** Do not edit by hand — run:

\`\`\`bash
npx tsx scripts/ops-metrics.ts
\`\`\`

Read-only. Every query is a SELECT.

## The number that matters

**${reviewsApproved} approved reviews.**

Everything else in [growth/](growth/STRATEGY.md) exists to move this. The site is
methodologically sound and technically healthy; it is thin on evidence.

## Coverage

| Measure | Count |
|---|---|
| Approved reviews | ${reviewsApproved} |
| Pending review queue | ${num(counts, 'reviews_pending')} |
| Verified reviews (proof of address) | ${num(counts, 'reviews_verified')} |
| Buildings in database | ${buildings} |
| Buildings with at least one review | ${buildingsCovered} |
| Buildings with no review yet | ${buildings - buildingsCovered} |
| Landlords | ${num(counts, 'landlords')} |
| Property managers | ${num(counts, 'managers')} |
| Disputes filed | ${num(counts, 'disputes')} |

${buildingsCovered} of ${buildings} buildings carry a review. A search that returns an
empty building is a visitor who leaves.

## Landlord score coverage

A landlord aggregate is withheld below ${NAMED_PARTY_MIN_REVIEWS} approved reviews, so a
named party is never scored on thin evidence.

| Approved reviews | Landlords | Score |
|---|---|---|
${distRows}

**${withScore} landlord${withScore === 1 ? '' : 's'} currently show a score. ${belowScore} are withheld.**

This is the clearest statement of the constraint. The threshold is a deliberate fairness
choice, not a bug — but it means landlord pages only become useful with volume.

---

*Regenerated by \`scripts/ops-metrics.ts\`. If this file's date is old, the numbers are
old — rerun it before quoting any figure in a grant application, a pitch, or a post.*
`;

if (process.argv.includes('--dry-run')) {
  console.log(md);
} else {
  writeFileSync(OUT, md, 'utf8');
  console.log(`Wrote ${OUT}`);
  console.log(`${reviewsApproved} approved reviews | ${withScore} landlords scored, ${belowScore} withheld`);
}
