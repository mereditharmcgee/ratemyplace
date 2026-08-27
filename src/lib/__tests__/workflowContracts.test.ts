import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowPath = (...parts: string[]) => resolve(process.cwd(), '.github', 'workflows', ...parts);
const readWorkflow = (name: string) => readFileSync(workflowPath(name), 'utf8');

describe('release workflow contracts', () => {
  it('runs the least-privilege CI quality gate for pull requests and main pushes', () => {
    const ci = readWorkflow('ci.yml');

    expect(ci).toMatch(/^name: CI$/m);
    expect(ci).toMatch(/^\s{2}pull_request:\s*$/m);
    expect(ci).toMatch(/^\s{2}push:\n\s{4}branches: \[main\]$/m);
    expect(ci).toMatch(/^permissions:\n  contents: read$/m);
    expect([...ci.matchAll(/^permissions:/gm)]).toHaveLength(1);
    expect(ci).toMatch(/^concurrency:\n  group: ci-\$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n  cancel-in-progress: true$/m);
    expect(ci).toMatch(/^  quality:\n    name: quality\n    runs-on: ubuntu-latest\n    timeout-minutes: 20\n    env:\n      ASTRO_TELEMETRY_DISABLED: "1"$/m);
    expect(ci).toMatch(/uses: actions\/checkout@v6\n        with:\n          persist-credentials: false/);
    expect(ci).toMatch(/uses: actions\/setup-node@v7\n        with:\n          node-version-file: \.node-version\n          cache: npm/);

    const commandPositions = ['npm ci', 'npm run check', 'npm test', 'npm run build']
      .map((command) => ci.indexOf(command));
    expect(commandPositions.every((position) => position >= 0)).toBe(true);
    expect(commandPositions).toEqual([...commandPositions].sort((a, b) => a - b));
  });

  it('fails visibly for unsuccessful internal main CI and smokes the exact deployed commit', () => {
    const smoke = readWorkflow('post-deploy-smoke.yml');

    expect(smoke).toMatch(/^name: Post-deploy smoke$/m);
    expect(smoke).toMatch(/^  workflow_run:\n    workflows: \[CI\]\n    types: \[completed\]$/m);
    expect(smoke).toMatch(/^permissions:\n  contents: read$/m);
    expect([...smoke.matchAll(/^permissions:/gm)]).toHaveLength(1);
    expect(smoke).toMatch(/^concurrency:\n  group: production-smoke\n  cancel-in-progress: true$/m);
    expect(smoke).toMatch(/github\.event\.workflow_run\.event == 'push'/);
    expect(smoke).toMatch(/github\.event\.workflow_run\.head_branch == 'main'/);
    expect(smoke).toMatch(/github\.event\.workflow_run\.head_repository\.full_name == github\.repository/);
    const jobGuard = smoke.match(/name: production sentinel and smoke\n    if: >-\n([\s\S]*?)\n    runs-on:/)?.[1];
    expect(jobGuard).toBeDefined();
    expect(jobGuard).not.toContain('conclusion');
    expect(smoke).toMatch(/if: github\.event\.workflow_run\.conclusion != 'success'/);
    expect(smoke).toMatch(/if: github\.event\.workflow_run\.conclusion != 'success'\n        run: \|\n[\s\S]*?exit 1/);

    const sentinel = smoke.indexOf("github.event.workflow_run.conclusion != 'success'");
    const checkout = smoke.indexOf('uses: actions/checkout@v6');
    const smokeCommand = smoke.indexOf('npm run smoke --');
    expect(sentinel).toBeGreaterThanOrEqual(0);
    expect(checkout).toBeGreaterThan(sentinel);
    expect(smokeCommand).toBeGreaterThan(checkout);
    expect(smoke).toMatch(/ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
    expect(smoke).toMatch(/uses: actions\/checkout@v6\n        with:\n          ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}\n          persist-credentials: false/);
    expect(smoke).toMatch(/uses: actions\/setup-node@v7\n        with:\n          node-version-file: \.node-version\n          cache: npm/);
    expect(smoke.indexOf('run: npm ci')).toBeGreaterThan(checkout);
    expect(smoke.indexOf('run: npm ci')).toBeLessThan(smokeCommand);
    expect(smoke).toMatch(/--base-url https:\/\/ratemyplace\.org/);
    expect(smoke).toMatch(/--expected-release \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
    expect(smoke).toMatch(/--wait-for-release-ms 600000/);
  });

  it('keeps Cloudflare deployment and privileged operations out of repository workflows', () => {
    for (const name of ['ci.yml', 'post-deploy-smoke.yml']) {
      const workflow = readWorkflow(name);

      expect(workflow).not.toMatch(/\bwrangler\b/i);
      expect(workflow).not.toMatch(/\b(?:d1|r2)\b/i);
      expect(workflow).not.toMatch(/(?:CLOUDFLARE|CF)_[A-Z_]*TOKEN/i);
      expect(workflow).not.toMatch(/secrets\./i);
      expect(workflow).not.toMatch(/pull_request_target/i);
      expect(workflow).not.toMatch(/permissions:\s*write-all/i);
      expect(workflow).not.toMatch(/continue-on-error:\s*true/i);
    }
  });
});
