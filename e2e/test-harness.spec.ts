import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as testHarness from './test-harness';

type BaseURLResolver = (configuredBaseURL?: string) => string;
type E2EEnvironment = Record<string, string | undefined>;
type EnvironmentValidator = (environment?: E2EEnvironment) => string;

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { scripts?: Record<string, string> };
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const childEnvironmentKeys = [
  'APPDATA',
  'COMSPEC',
  'HOME',
  'LOCALAPPDATA',
  'PATH',
  'Path',
  'PATHEXT',
  'SYSTEMROOT',
  'SystemRoot',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USERPROFILE',
] as const;

function buildPreflightEnvironment(
  unsafeFlag: 'D1_REMOTE' | 'SEED_REVIEWS_ONLY'
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    BASE_URL: 'http://localhost:8788',
    [unsafeFlag]: '1',
  };

  for (const key of childEnvironmentKeys) {
    if (process.env[key] !== undefined) {
      environment[key] = process.env[key];
    }
  }

  return environment;
}

function getNpmInvocation(): { executable: string; arguments: string[] } {
  if (process.platform !== 'win32') {
    return { executable: 'npm', arguments: ['run', 'e2e:preflight'] };
  }

  const npmCliPath = process.env.npm_execpath;
  if (!npmCliPath) {
    throw new Error('npm_execpath is required to run the package preflight contract on Windows.');
  }

  return {
    executable: process.execPath,
    arguments: [npmCliPath, 'run', 'e2e:preflight'],
  };
}

function getBaseURLResolver(): BaseURLResolver {
  const resolver = Reflect.get(testHarness, 'resolveLocalE2EBaseURL');
  expect(typeof resolver).toBe('function');
  return resolver as BaseURLResolver;
}

function getEnvironmentValidator(): EnvironmentValidator {
  const validator = Reflect.get(testHarness, 'validateLocalE2EEnvironment');
  expect(typeof validator).toBe('function');
  return validator as EnvironmentValidator;
}

test.describe('local E2E target guard', () => {
  test('defaults to and normalizes the approved local origin', () => {
    const resolveLocalE2EBaseURL = getBaseURLResolver();

    expect(resolveLocalE2EBaseURL()).toBe('http://localhost:8788');
    expect(resolveLocalE2EBaseURL('http://localhost:8788/')).toBe('http://localhost:8788');
  });

  test('rejects any target other than the exact local HTTP origin', () => {
    const resolveLocalE2EBaseURL = getBaseURLResolver();
    const rejectedTargets = [
      'https://ratemyplace.org',
      'https://localhost:8788',
      'http://127.0.0.1:8788',
      'http://localhost:8789',
      'http://localhost:8788/admin',
      'http://localhost:8788?unsafe=true',
      'not-a-url',
    ];

    for (const target of rejectedTargets) {
      expect(() => resolveLocalE2EBaseURL(target)).toThrow(/local E2E target/i);
    }
  });

  test('runs the safety preflight before any database setup', () => {
    expect(packageJson.scripts?.e2e).toMatch(
      /^npm run e2e:preflight && npm run db:setup &&/
    );
    expect(packageJson.scripts?.['e2e:headed']).toMatch(
      /^npm run e2e:preflight && npm run db:setup &&/
    );
  });

  test('rejects inherited flags that can target or bypass local database seeding', () => {
    const validateLocalE2EEnvironment = getEnvironmentValidator();

    expect(() => validateLocalE2EEnvironment({ D1_REMOTE: '1' })).toThrow(/D1_REMOTE/);
    expect(() =>
      validateLocalE2EEnvironment({ SEED_REVIEWS_ONLY: '1' })
    ).toThrow(/SEED_REVIEWS_ONLY/);
  });

  test('package preflight entrypoint rejects unsafe database seed flags', () => {
    const npmInvocation = getNpmInvocation();

    for (const unsafeFlag of ['D1_REMOTE', 'SEED_REVIEWS_ONLY'] as const) {
      const result = spawnSync(npmInvocation.executable, npmInvocation.arguments, {
        cwd: projectRoot,
        env: buildPreflightEnvironment(unsafeFlag),
        encoding: 'utf8',
        shell: false,
      });
      const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(output).toContain('[E2E safety]');
      expect(output).toContain(unsafeFlag);
    }
  });
});
