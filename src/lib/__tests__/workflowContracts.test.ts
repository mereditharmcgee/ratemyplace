import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowPath = (...parts: string[]) => resolve(process.cwd(), '.github', 'workflows', ...parts);
const readWorkflow = (name: string) => readFileSync(workflowPath(name), 'utf8');

interface PermissionsDeclaration {
  indent: number;
  line: number;
  value: string;
}

const findPermissionsDeclarations = (lines: string[]): PermissionsDeclaration[] => lines.flatMap((line, index) => {
  const match = line.match(/^([ \t]*)(?:"permissions"|'permissions'|permissions)[ \t]*:(.*)$/);
  if (!match) return [];

  return [{ indent: match[1].length, line: index, value: match[2].trim() }];
});

const assertReadOnlyPermissionsBlock = (workflow: string) => {
  const lines = workflow.split(/\r?\n/);
  const declarations = findPermissionsDeclarations(lines);

  expect(declarations).toHaveLength(1);
  const [topLevel] = declarations;
  expect(topLevel.indent).toBe(0);

  if (topLevel.value) {
    expect(topLevel.value).toMatch(/^\{[ \t]*contents[ \t]*:[ \t]*read[ \t]*\}[ \t]*(?:#.*)?$/);
    return;
  }

  const blockEntries: string[] = [];
  for (let index = topLevel.line + 1; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^[ \t]+/.test(line)) break;
    blockEntries.push(line);
  }

  expect(blockEntries).toHaveLength(1);
  expect(blockEntries[0]).toMatch(/^[ \t]+contents[ \t]*:[ \t]*read[ \t]*(?:#.*)?$/);
};

const assertLeastPrivilege = (workflow: string) => {
  assertReadOnlyPermissionsBlock(workflow);
  expect(workflow).not.toMatch(/\bwrangler\b/i);
  expect(workflow).not.toMatch(/\b(?:d1|r2)\b/i);
  expect(workflow).not.toMatch(/(?:CLOUDFLARE|CF)_[A-Z_]*TOKEN/i);
  expect(workflow).not.toMatch(/secrets\./i);
  expect(workflow).not.toMatch(/pull_request_target/i);
  expect(workflow).not.toMatch(/permissions:\s*write-all/i);
  expect(workflow).not.toMatch(/continue-on-error:\s*true/i);
};

describe('release workflow contracts', () => {
  it('runs the least-privilege CI quality gate for pull requests and main pushes', () => {
    const ci = readWorkflow('ci.yml');

    expect(ci).toMatch(/^name: CI$/m);
    expect(ci).toMatch(/^\s{2}pull_request:\s*$/m);
    expect(ci).toMatch(/^\s{2}push:\n\s{4}branches: \[main\]$/m);
    assertLeastPrivilege(ci);
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
    assertLeastPrivilege(smoke);
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
      assertLeastPrivilege(readWorkflow(name));
    }
  });

  it('rejects every job-level permissions declaration and write capability', () => {
    const ci = readWorkflow('ci.yml');

    for (const permission of ['contents: write', 'id-token: write']) {
      const dangerousWorkflow = ci.replace(
        '  quality:\n',
        `  quality:\n    permissions:\n      ${permission}\n`,
      );

      expect(dangerousWorkflow).not.toBe(ci);
      expect(() => assertLeastPrivilege(dangerousWorkflow)).toThrow();
    }
  });

  it('rejects an unquoted spaced inline job permissions key', () => {
    const dangerousWorkflow = readWorkflow('ci.yml').replace(
      '  quality:\n',
      '  quality:\n    permissions : { contents: write }\n',
    );

    expect(() => assertLeastPrivilege(dangerousWorkflow)).toThrow();
  });

  it('rejects a double-quoted inline job permissions key', () => {
    const dangerousWorkflow = readWorkflow('ci.yml').replace(
      '  quality:\n',
      '  quality:\n    "permissions": { contents: write }\n',
    );

    expect(() => assertLeastPrivilege(dangerousWorkflow)).toThrow();
  });

  it('rejects a single-quoted block job permissions key', () => {
    const dangerousWorkflow = readWorkflow('ci.yml').replace(
      '  quality:\n',
      "  quality:\n    'permissions':\n      contents: read\n",
    );

    expect(() => assertLeastPrivilege(dangerousWorkflow)).toThrow();
  });

  it('rejects an extra top-level write capability', () => {
    const dangerousWorkflow = readWorkflow('ci.yml').replace(
      '  contents: read',
      '  contents: read\n  id-token: write',
    );

    expect(() => assertLeastPrivilege(dangerousWorkflow)).toThrow();
  });

  it('allows harmless write-like shell text inside a run block', () => {
    const harmlessWorkflow = readWorkflow('ci.yml').replace(
      'run: npm ci',
      'run: |\n          echo contents: write',
    );

    expect(() => assertLeastPrivilege(harmlessWorkflow)).not.toThrow();
  });
});
