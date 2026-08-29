import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowPath = (...parts: string[]) => resolve(process.cwd(), '.github', 'workflows', ...parts);
const readWorkflow = (name: string) => readFileSync(workflowPath(name), 'utf8').replace(/\r\n/g, '\n');
const readRepositoryFile = (...parts: string[]) => readFileSync(resolve(process.cwd(), ...parts), 'utf8')
  .replace(/\r\n/g, '\n');

const stripYamlComment = (line: string) => {
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (quote === '"' && character === '\\') {
      index++;
      continue;
    }
    if (quote === "'" && character === "'" && line[index + 1] === "'") {
      index++;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? undefined : quote ?? character;
      continue;
    }
    if (character === '#' && quote === undefined) return line.slice(0, index);
  }

  return line;
};

const yamlScalar = (value: string) => {
  const normalized = stripYamlComment(value).trim();
  const quote = normalized[0];
  return (quote === '"' || quote === "'") && normalized.at(-1) === quote
    ? normalized.slice(1, -1)
    : normalized;
};

interface YamlMapping {
  indent: number;
  key: string;
  value: string;
}

const parseYamlMapping = (line: string): YamlMapping | undefined => {
  const activeLine = stripYamlComment(line).replace(/\s+$/, '');
  if (!activeLine.trim()) return undefined;

  const indent = activeLine.match(/^ */)?.[0].length ?? 0;
  const mapping = activeLine.slice(indent).match(/^(?:"([^"]+)"|'([^']+)'|([^:#][^:]*?))\s*:\s*(.*)$/);
  if (!mapping) return undefined;

  return {
    indent,
    key: (mapping[1] ?? mapping[2] ?? mapping[3]).trim(),
    value: mapping[4],
  };
};

const getActiveYamlLines = (lines: string[]) => {
  const activeLines: string[] = [];
  let blockScalarIndent: number | undefined;

  for (const line of lines) {
    const withoutComment = stripYamlComment(line).replace(/\s+$/, '');
    const indent = withoutComment.match(/^ */)?.[0].length ?? 0;

    if (blockScalarIndent !== undefined) {
      if (!withoutComment.trim() || indent > blockScalarIndent) continue;
      blockScalarIndent = undefined;
    }
    if (!withoutComment.trim()) continue;

    activeLines.push(withoutComment);
    const mapping = parseYamlMapping(withoutComment);
    if (mapping && /^(?:\||>)[+-]?$/.test(mapping.value.trim())) {
      blockScalarIndent = mapping.indent;
    }
  }

  return activeLines;
};

const getYamlBlock = (lines: string[], key: string, indent: number) => {
  const activeLines = getActiveYamlLines(lines);
  const start = activeLines.findIndex((line) => {
    const mapping = parseYamlMapping(line);
    return mapping?.indent === indent && mapping.key === key && mapping.value === '';
  });
  expect(start).toBeGreaterThanOrEqual(0);

  const block: string[] = [];
  for (let index = start + 1; index < activeLines.length; index++) {
    const line = activeLines[index];
    const lineIndent = line.match(/^ */)?.[0].length ?? 0;
    if (lineIndent <= indent) break;
    block.push(line);
  }
  return block;
};

const getYamlScalar = (lines: string[], key: string, indent: number) => {
  const mapping = getActiveYamlLines(lines)
    .map(parseYamlMapping)
    .find((candidate) => candidate?.indent === indent && candidate.key === key);
  return mapping === undefined ? undefined : yamlScalar(mapping.value);
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

const getWorkflowRunCommands = (workflow: string, jobName: string) => {
  const lines = getWorkflowJob(workflow, jobName).split('\n');
  const commands: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const mapping = parseYamlMapping(lines[index]);
    if (mapping?.indent !== 8 || mapping.key !== 'run') continue;

    const value = yamlScalar(mapping.value);
    if (!/^(?:\||>)[+-]?$/.test(value)) {
      commands.push(value);
      continue;
    }

    for (let child = index + 1; child < lines.length; child++) {
      const line = lines[child];
      const indent = line.match(/^ */)?.[0].length ?? 0;
      if (line.trim() && indent <= mapping.indent) break;
      const command = line.trim();
      if (command && !command.startsWith('#')) commands.push(command);
    }
  }

  return commands;
};

const assertCiAuditGate = (ci: string) => {
  const auditCommand = 'npm audit --audit-level=critical';
  const runCommands = getWorkflowRunCommands(ci, 'quality');
  expect(runCommands.filter((command) => command.includes(auditCommand))).toEqual([auditCommand]);

  const commandPositions = [
    'npm ci',
    auditCommand,
    'npm run check',
    'npm test',
    'npm run build',
  ].map((command) => runCommands.indexOf(command));
  expect(commandPositions.every((position) => position >= 0)).toBe(true);
  expect(commandPositions).toEqual([...commandPositions].sort((a, b) => a - b));
};

const assertDependabotPolicy = (dependabot: string) => {
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
  const pullRequestLimit = getYamlScalar(npmEntry, 'open-pull-requests-limit', 4);
  if (pullRequestLimit !== undefined) {
    const numericLimit = Number(pullRequestLimit);
    expect(Number.isFinite(numericLimit)).toBe(true);
    expect(numericLimit).toBeGreaterThan(0);
  }

  const groups = getDependabotGroups(npmEntry);
  const versionGroup = groups.find((group) => group.appliesTo === 'version-updates');
  const securityGroup = groups.find((group) => group.appliesTo === 'security-updates');
  expect(versionGroup?.patterns).toContain('*');
  expect(securityGroup?.patterns).toContain('*');
  expect(versionGroup?.name).not.toBe(securityGroup?.name);

  const activeMappings = getActiveYamlLines(lines)
    .map(parseYamlMapping)
    .filter((mapping): mapping is YamlMapping => mapping !== undefined);
  const forbiddenKeys = new Set(['registries', 'secret', 'secrets', 'automerge', 'auto-merge', 'auto_merge']);
  expect(activeMappings.some((mapping) => forbiddenKeys.has(mapping.key.toLowerCase()))).toBe(false);
  expect(activeMappings.some((mapping) => /\bsecrets?\s*\./i.test(yamlScalar(mapping.value)))).toBe(false);
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

    assertCiAuditGate(ci);
  });

  it('keeps npm version and security updates separately grouped without elevated authority', () => {
    assertDependabotPolicy(readRepositoryFile('.github', 'dependabot.yml'));
  });

  it.each(['00', '0x0', '+0', '0.0'])(
    'rejects open-pull-requests-limit numeric zero form %s',
    (zero) => {
      const dangerousDependabot = readRepositoryFile('.github', 'dependabot.yml').replace(
        '    directory: /\n',
        `    directory: /\n    open-pull-requests-limit: ${zero}\n`,
      );

      expect(() => assertDependabotPolicy(dangerousDependabot)).toThrow();
    },
  );

  it('rejects a quoted active registries key', () => {
    const dangerousDependabot = readRepositoryFile('.github', 'dependabot.yml').replace(
      '    directory: /\n',
      '    directory: /\n    "registries":\n      - private\n',
    );

    expect(() => assertDependabotPolicy(dangerousDependabot)).toThrow();
  });

  it('allows harmless YAML comments mentioning secrets or auto-merge', () => {
    const harmlessDependabot = [
      '# secrets: are not configured here',
      '# auto-merge remains disabled',
      readRepositoryFile('.github', 'dependabot.yml'),
    ].join('\n');

    expect(() => assertDependabotPolicy(harmlessDependabot)).not.toThrow();
  });

  it('rejects audit text left only in a YAML comment', () => {
    const ciWithoutAudit = readWorkflow('ci.yml').replace(
      '      - name: Audit critical vulnerabilities\n        run: npm audit --audit-level=critical\n',
      '      # run: npm audit --audit-level=critical\n',
    );

    expect(() => assertCiAuditGate(ciWithoutAudit)).toThrow();
  });

  it('rejects audit text left only in a non-executable block scalar', () => {
    const ciWithoutAudit = readWorkflow('ci.yml').replace(
      '      - name: Audit critical vulnerabilities\n        run: npm audit --audit-level=critical\n',
      [
        '      - name: Preserve audit command as data',
        '        env:',
        '          NOTE: |',
        '            run: npm audit --audit-level=critical',
        '        run: echo "$NOTE"',
        '',
      ].join('\n'),
    );

    expect(() => assertCiAuditGate(ciWithoutAudit)).toThrow();
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
