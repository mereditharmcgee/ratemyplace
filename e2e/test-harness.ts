import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(E2E_DIR, '..');
const WRANGLER_ENTRY = path.join(PROJECT_ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const WRANGLER_CONFIG = path.join(PROJECT_ROOT, 'wrangler.jsonc');
const WRANGLER_PERSISTENCE = path.join(PROJECT_ROOT, '.wrangler', 'state');

const TURNSTILE_SCRIPT = /^https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js(?:\?.*)?$/;
export const TURNSTILE_TEST_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const LOCAL_E2E_ORIGIN = 'http://localhost:8788';

export interface LocalE2EEnvironment {
  BASE_URL?: string;
  D1_REMOTE?: string;
  SEED_REVIEWS_ONLY?: string;
}

export function resolveLocalE2EBaseURL(configuredBaseURL = process.env.BASE_URL): string {
  const candidate = configuredBaseURL ?? LOCAL_E2E_ORIGIN;
  let parsed: URL;

  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(
      `[E2E safety] Invalid local E2E target. BASE_URL must be ${LOCAL_E2E_ORIGIN}.`
    );
  }

  const isOriginOnly =
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.pathname === '/' &&
    parsed.search === '' &&
    parsed.hash === '';

  if (parsed.origin !== LOCAL_E2E_ORIGIN || !isOriginOnly) {
    throw new Error(
      `[E2E safety] Refusing non-local E2E target ${parsed.origin}. BASE_URL must be ${LOCAL_E2E_ORIGIN}.`
    );
  }

  return LOCAL_E2E_ORIGIN;
}

export function validateLocalE2EEnvironment(
  environment: LocalE2EEnvironment = process.env
): string {
  const baseURL = resolveLocalE2EBaseURL(environment.BASE_URL);
  const unsafeFlags = ['D1_REMOTE', 'SEED_REVIEWS_ONLY'] as const;

  for (const flag of unsafeFlags) {
    if (environment[flag] !== undefined) {
      throw new Error(
        `[E2E safety] Refusing to run with ${flag} set. Unset it before running local E2E tests.`
      );
    }
  }

  return baseURL;
}

// Cloudflare documents this token for automated tests. The matching public
// always-pass secret is bound only to the local Wrangler process in
// playwright.config.ts; production keeps its real widget and fail-closed path.
const TURNSTILE_STUB = `
(() => {
  const token = '${TURNSTILE_TEST_TOKEN}';

  const addToken = (container) => {
    if (!container || container.querySelector('input[name="cf-turnstile-response"]')) return;
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'cf-turnstile-response';
    input.value = token;
    container.appendChild(input);
  };

  const mountImplicitWidgets = () => {
    document.querySelectorAll('.cf-turnstile').forEach(addToken);
  };

  let widgetSequence = 0;
  window.turnstile = {
    render(container, options = {}) {
      const element = typeof container === 'string'
        ? document.querySelector(container)
        : container;
      addToken(element);
      queueMicrotask(() => options.callback?.(token));
      widgetSequence += 1;
      return 'e2e-turnstile-' + widgetSequence;
    },
    reset() {},
    remove() {},
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountImplicitWidgets, { once: true });
  } else {
    mountImplicitWidgets();
  }
})();
`;

export async function installTurnstileStub(page: Page): Promise<void> {
  await page.route(TURNSTILE_SCRIPT, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: TURNSTILE_STUB,
    });
  });
}

export function executeLocalD1(sql: string): string {
  const isolatedCwd = mkdtempSync(path.join(tmpdir(), 'ratemyplace-e2e-wrangler-'));

  try {
    return execFileSync(
      process.execPath,
      [
        WRANGLER_ENTRY,
        'd1',
        'execute',
        'ratemyplace-db',
        '--local',
        '--config',
        WRANGLER_CONFIG,
        '--persist-to',
        WRANGLER_PERSISTENCE,
        '--command',
        sql,
        '--json',
      ],
      {
        cwd: isolatedCwd,
        timeout: 30_000,
        encoding: 'utf8',
      }
    );
  } finally {
    rmSync(isolatedCwd, { recursive: true, force: true });
  }
}

function quoteShellArgument(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

export function buildLocalPagesCommand(): string {
  return [
    quoteShellArgument(process.execPath),
    quoteShellArgument(WRANGLER_ENTRY),
    'pages',
    'dev',
    quoteShellArgument(path.join(PROJECT_ROOT, 'dist')),
    '--port',
    '8788',
    '--persist-to',
    quoteShellArgument(WRANGLER_PERSISTENCE),
    '--binding=TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA',
  ].join(' ');
}
