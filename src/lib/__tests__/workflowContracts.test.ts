import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowPath = (...parts: string[]) => resolve(process.cwd(), '.github', 'workflows', ...parts);
const readWorkflow = (name: string) => readFileSync(workflowPath(name), 'utf8').replace(/\r\n/g, '\n');
const readRepositoryFile = (...parts: string[]) => readFileSync(resolve(process.cwd(), ...parts), 'utf8')
  .replace(/\r\n/g, '\n');

const yamlScalar = (value: string) => {
  const normalized = value.replace(/\s+#.*$/, '').trim();
  const quote = normalized[0];
  return (quote === '"' || quote === "'") && normalized.at(-1) === quote
    ? normalized.slice(1, -1)
    : normalized;
};

const getYamlBlock = (lines: string[], key: string, indent: number) => {
  const header = `${' '.repeat(indent)}${key}:`;
  const start = lines.findIndex((line) => line.replace(/\s+$/, '') === header);
  expect(start).toBeGreaterThanOrEqual(0);

  const block: string[] = [];
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const lineIndent = line.match(/^ */)?.[0].length ?? 0;
    if (lineIndent <= indent) break;
    block.push(line);
  }
  return block;
};

const getYamlScalar = (lines: string[], key: string, indent: number) => {
  const prefix = `${' '.repeat(indent)}${key}:`;
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  return line === undefined ? undefined : yamlScalar(line.slice(prefix.length));
};

interface DependabotGroup {
  name: string;
  appliesTo?: string;
  patterns: string[];
}

const getDependabotGroups = (entry: string[]) => {
  const groupsBlock = getYamlBlock(entry, 'groups', 4);
  const groups: DependabotGroup[] = [];

  for (let index = 0; index < groupsBlock.length; index++) {
    const match = groupsBlock[index].match(/^ {6}([^\s:#][^:#]*):\s*(?:#.*)?$/);
    if (!match) continue;

    const groupLines: string[] = [];
    for (let child = index + 1; child < groupsBlock.length; child++) {
      const line = groupsBlock[child];
      const indent = line.match(/^ */)?.[0].length ?? 0;
      if (indent <= 6) break;
      groupLines.push(line);
    }

    const patternsBlock = getYamlBlock(groupLines, 'patterns', 8);
    groups.push({
      name: yamlScalar(match[1]),
      appliesTo: getYamlScalar(groupLines, 'applies-to', 8),
      patterns: patternsBlock
        .map((line) => line.match(/^ {10}-\s+(.+)$/)?.[1])
        .filter((value): value is string => value !== undefined)
        .map(yamlScalar),
    });
  }

  return groups;
};

const getWorkflowJob = (workflow: string, name: string) => {
  const jobsStart = workflow.indexOf('jobs:\n');
  const start = workflow.indexOf(`  ${name}:\n`, jobsStart);
  expect(start).toBeGreaterThanOrEqual(0);

  const afterJob = workflow.slice(start + `  ${name}:\n`.length);
  const nextJob = afterJob.search(/^  [A-Za-z0-9_-]+:\s*$/m);
  return nextJob === -1 ? afterJob : afterJob.slice(0, nextJob);
};

interface PermissionsDeclaration {
  indent: number;
  line: number;
  value: string;
}

const findPermissionsDeclarations = (lines: string[]): PermissionsDeclaration[] => {
  const declarations: PermissionsDeclaration[] = [];
  let blockScalarIndent: number | undefined;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const indent = line.match(/^[ \t]*/)?.[0].length ?? 0;
    const trimmed = line.trim();

    if (blockScalarIndent !== undefined) {
      if (!trimmed || trimmed.startsWith('#') || indent > blockScalarIndent) continue;
      blockScalarIndent = undefined;
    }

    const blockScalar = line.match(/^[ \t]*[^#:\n][^:\n]*:[ \t]*(?:\||>)[+-]?[ \t]*(?:#.*)?$/);
    if (blockScalar) {
      blockScalarIndent = indent;
      continue;
    }

    const match = line.match(/^([ \t]*)(?:"permissions"|'permissions'|permissions)[ \t]*:(.*)$/);
    if (match) {
      declarations.push({ indent: match[1].length, line: index, value: match[2].trim() });
    }
  }

  return declarations;
};

const assertReadOnlyPermissionsBlock = (workflow: string, allowedReadPermissions: string[] = ['contents']) => {
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

  expect(blockEntries).toHaveLength(allowedReadPermissions.length);
  expect(blockEntries).toEqual(expect.arrayContaining(
    allowedReadPermissions.map((permission) => expect.stringMatching(
      new RegExp(`^[ \\t]+${permission}[ \\t]*:[ \\t]*read[ \\t]*(?:#.*)?$`),
    )),
  ));
};

const assertLeastPrivilege = (workflow: string, allowedReadPermissions?: string[]) => {
  assertReadOnlyPermissionsBlock(workflow, allowedReadPermissions);
  expect(workflow).not.toMatch(/\bwrangler\b/i);
  expect(workflow).not.toMatch(/\b(?:d1|r2)\b/i);
  expect(workflow).not.toMatch(/(?:CLOUDFLARE|CF)_[A-Z_]*(?:TOKEN|KEY)\b/i);
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

    const auditCommand = 'npm audit --audit-level=critical';
    expect(ci.split(auditCommand)).toHaveLength(2);
    expect(ci.match(/^\s*run: npm audit --audit-level=critical\s*$/gm) ?? []).toHaveLength(1);

    const commandPositions = [
      'npm ci',
      auditCommand,
      'npm run check',
      'npm test',
      'npm run build',
    ]
      .map((command) => ci.indexOf(command));
    expect(commandPositions.every((position) => position >= 0)).toBe(true);
    expect(commandPositions).toEqual([...commandPositions].sort((a, b) => a - b));
  });

  it('keeps npm version and security updates separately grouped without elevated authority', () => {
    const dependabot = readRepositoryFile('.github', 'dependabot.yml');
    const lines = dependabot.split('\n');

    expect(getYamlScalar(lines, 'version', 0)).toBe('2');

    const updates = getYamlBlock(lines, 'updates', 0);
    const entries: string[][] = [];
    for (let index = 0; index < updates.length; index++) {
      if (!/^ {2}-\s+/.test(updates[index])) continue;
      const entry = [updates[index].replace(/^ {2}-\s+/, '    ')];
      for (let child = index + 1; child < updates.length; child++) {
        if (/^ {2}-\s+/.test(updates[child])) break;
        entry.push(updates[child]);
      }
      entries.push(entry);
    }

    const npmEntries = entries.filter((entry) => getYamlScalar(entry, 'package-ecosystem', 4) === 'npm');
    expect(npmEntries).toHaveLength(1);
    const [npmEntry] = npmEntries;
    expect(getYamlScalar(npmEntry, 'directory', 4)).toBe('/');
    expect(getYamlScalar(getYamlBlock(npmEntry, 'schedule', 4), 'interval', 6)).toBe('monthly');
    expect(getYamlScalar(npmEntry, 'open-pull-requests-limit', 4)).not.toBe('0');

    const groups = getDependabotGroups(npmEntry);
    const versionGroup = groups.find((group) => group.appliesTo === 'version-updates');
    const securityGroup = groups.find((group) => group.appliesTo === 'security-updates');
    expect(versionGroup?.patterns).toContain('*');
    expect(securityGroup?.patterns).toContain('*');
    expect(versionGroup?.name).not.toBe(securityGroup?.name);

    expect(dependabot).not.toMatch(/^\s*registries\s*:/m);
    expect(dependabot).not.toMatch(/\bsecrets?\s*[.:]/i);
    expect(dependabot).not.toMatch(/\bauto(?:-|_)?merge\b/i);
  });

  it('keeps every qualifying main completion visible while only successful releases smoke', () => {
    const workflow = readWorkflow('post-deploy-smoke.yml');
    const beforeJobs = workflow.slice(0, workflow.indexOf('jobs:\n'));
    const sentinel = getWorkflowJob(workflow, 'sentinel');
    const smoke = getWorkflowJob(workflow, 'smoke');

    expect(workflow).toMatch(/^name: Post-deploy smoke$/m);
    expect(workflow).toMatch(/^  workflow_run:\n    workflows: \[CI\]\n    types: \[completed\]$/m);
    assertLeastPrivilege(workflow, ['contents', 'checks']);
    expect(beforeJobs).not.toMatch(/^concurrency:/m);

    expect(sentinel).toMatch(/github\.event\.workflow_run\.event == 'push'/);
    expect(sentinel).toMatch(/github\.event\.workflow_run\.head_branch == 'main'/);
    expect(sentinel).toMatch(/github\.event\.workflow_run\.head_repository\.full_name == github\.repository/);
    expect(sentinel).not.toMatch(/concurrency:/);
    expect(sentinel).toMatch(/if: github\.event\.workflow_run\.conclusion != 'success'\n        run: \|\n[\s\S]*?exit 1/);
    expect(sentinel).toMatch(/if: github\.event\.workflow_run\.conclusion == 'success'\n        run: echo/);
    expect(sentinel).not.toMatch(/actions\/checkout|run: npm ci|npm run smoke/);

    expect(smoke).toMatch(/^    needs: sentinel$/m);
    expect(smoke).toMatch(/needs\.sentinel\.result == 'success'/);
    expect(smoke).toMatch(/github\.event\.workflow_run\.conclusion == 'success'/);
    expect(smoke).toMatch(/^    concurrency:\n      group: production-smoke\n      cancel-in-progress: true$/m);
    expect(workflow.match(/group: production-smoke/g)).toHaveLength(1);

    const checkout = smoke.indexOf('uses: actions/checkout@v6');
    const smokeCommand = smoke.indexOf('npm run smoke --');
    expect(checkout).toBeGreaterThanOrEqual(0);
    expect(smokeCommand).toBeGreaterThan(checkout);
    expect(smoke).toMatch(/ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
    expect(smoke).toMatch(/uses: actions\/checkout@v6\n        with:\n          ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}\n          persist-credentials: false/);
    expect(smoke).toMatch(/uses: actions\/setup-node@v7\n        with:\n          node-version-file: \.node-version\n          cache: npm/);
    expect(smoke.indexOf('run: npm ci')).toBeGreaterThan(checkout);
    expect(smoke.indexOf('run: npm ci')).toBeLessThan(smokeCommand);
    expect(smoke).toMatch(/GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
    expect(smoke).toMatch(/scripts\/pages-deployment-url\.ts/);
    expect(smoke).toMatch(/--repository \"\$\{\{ github\.repository \}\}\"/);
    expect(smoke).toMatch(/--sha \"\$\{\{ github\.event\.workflow_run\.head_sha \}\}\"/);
    expect(smoke).toMatch(/--wait-ms 600000/);
    expect(smoke).toMatch(/--environment preview/);
    expect(smoke).toMatch(/--base-url "\$deployment_origin"/);
    expect(smoke).not.toMatch(/--base-url https:\/\/ratemyplace\.org/);
    expect(smoke).toMatch(/--expected-release \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
    expect(smoke).toMatch(/--wait-for-release-ms 600000/);
  });

  it('keeps Cloudflare deployment and privileged operations out of repository workflows', () => {
    for (const name of ['ci.yml', 'post-deploy-smoke.yml']) {
      assertLeastPrivilege(readWorkflow(name), name === 'post-deploy-smoke.yml' ? ['contents', 'checks'] : undefined);
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

  it('rejects a Cloudflare API key credential', () => {
    const dangerousWorkflow = readWorkflow('ci.yml').replace(
      '  quality:\n',
      '  quality:\n    env:\n      CLOUDFLARE_API_KEY: unsafe\n',
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

  it('allows an unquoted permissions-looking line inside a literal run block', () => {
    const harmlessWorkflow = readWorkflow('ci.yml').replace(
      'run: npm ci',
      'run: |\n          permissions: { contents: write }\n          # script comment\n          echo done',
    );

    expect(() => assertLeastPrivilege(harmlessWorkflow)).not.toThrow();
  });

  it('allows a quoted permissions-looking line inside a folded run block', () => {
    const harmlessWorkflow = readWorkflow('ci.yml').replace(
      'run: npm ci',
      'run: >-\n          "permissions" : { contents: write }\n\n          echo done',
    );

    expect(() => assertLeastPrivilege(harmlessWorkflow)).not.toThrow();
  });

  it('resumes scanning and rejects a real job permission after a run block', () => {
    const dangerousWorkflow = readWorkflow('ci.yml').replace(
      'run: npm ci',
      'run: |\n          permissions: { contents: write }\n          echo done\n    permissions: { contents: write }',
    );

    expect(() => assertLeastPrivilege(dangerousWorkflow)).toThrow();
  });
});
