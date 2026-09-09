// CI gate: fail on any critical npm advisory that is not in audit-allowlist.json.
//
// `npm audit --audit-level=critical` has no way to except a single advisory, and a critical
// advisory with no fix short of a major framework upgrade would otherwise block every PR.
// Each allowlist entry names the advisory, says why it does not apply to this deployment,
// and carries an expiry so the exception is revisited, not forgotten.
//
// Usage: node scripts/audit-critical.mjs   (exit 1 on an unlisted critical or an expired entry)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const allowlist = JSON.parse(readFileSync(new URL('../audit-allowlist.json', import.meta.url), 'utf8'));
const today = new Date().toISOString().slice(0, 10);

let report;
try {
  report = JSON.parse(execSync('npm audit --json', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
} catch (err) {
  // npm audit exits non-zero when it finds anything; the JSON is still on stdout.
  if (!err.stdout) throw err;
  report = JSON.parse(err.stdout);
}

const allowed = new Map(allowlist.map((entry) => [entry.id, entry]));
const failures = [];
for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of vuln.via ?? []) {
    if (typeof via !== 'object' || via.severity !== 'critical') continue;
    const id = (via.url ?? '').split('/').pop();
    const entry = allowed.get(id);
    if (!entry) {
      failures.push(`${name}: ${via.title} (${via.url}) is critical and not allowlisted`);
    } else if (entry.expires < today) {
      failures.push(`${name}: allowlist entry ${id} expired on ${entry.expires}; re-assess and extend or fix`);
    } else {
      console.log(`allowlisted ${id} (${name}): ${entry.reason} [until ${entry.expires}]`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('no unlisted critical advisories');
