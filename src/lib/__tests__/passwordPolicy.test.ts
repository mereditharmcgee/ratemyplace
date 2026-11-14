import type { APIContext } from 'astro';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeD1 } from './helpers/fakeD1';

// One password minimum for the sign-up page and API, the reset page and API, and the
// settings page: eight characters. Sign-in keeps a floor of six on purpose, because sign-up
// accepted six until March 2026 and those passwords must still sign in.

vi.mock('../turnstile', () => ({
  verifyTurnstile: vi.fn(async () => ({ success: false, error: 'Bot verification failed. Please try again.' })),
}));

import { verifyTurnstile } from '../turnstile';
import {
  LEGACY_SIGNIN_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SIGNUP_PASSWORD_HINT,
} from '../passwordPolicy';
import { validatePassword } from '../userSettings';
import SignupPage from '../../pages/auth/signup.astro';
import { POST as signupPOST } from '../../pages/api/auth/signup';
import { POST as signinPOST } from '../../pages/api/auth/signin';
import { POST as resetPOST } from '../../pages/api/auth/reset-password';

function context(path: string, fields: Record<string, string>): APIContext {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const url = new URL(`https://ratemyplace.org${path}`);
  const { db } = fakeD1(() => undefined);
  return {
    request: new Request(url, { method: 'POST', body: form, headers: { 'CF-Connecting-IP': '203.0.113.40' } }),
    url,
    params: {},
    cookies: { set: vi.fn() },
    locals: { user: null, runtime: { env: { DB: db, TURNSTILE_SECRET_KEY: 'secret' } } },
  } as unknown as APIContext;
}

beforeEach(() => {
  vi.mocked(verifyTurnstile).mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the password policy', () => {
  it('is eight characters, with a legacy sign-in floor of six', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_MAX_LENGTH).toBe(255);
    expect(LEGACY_SIGNIN_MIN_LENGTH).toBe(6);
    expect(SIGNUP_PASSWORD_HINT).toBe('At least 8 characters');
  });
});

describe('the sign-up page', () => {
  it('asks for eight characters on both inputs and says so once', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(SignupPage, {
      locals: { user: null, session: null } as unknown as App.Locals,
      request: new Request('https://ratemyplace.org/auth/signup'),
    });
    expect(html.match(/minlength="8"/g)).toHaveLength(2);
    expect(html).not.toMatch(/minlength="[0-79]"/);
    expect(html.split(SIGNUP_PASSWORD_HINT)).toHaveLength(2);
    expect(html).not.toContain('At least 6 characters');
  });
});

describe('the sign-up API', () => {
  const fields = (password: string) => ({
    email: 'new@example.com',
    password,
    confirmPassword: password,
    'cf-turnstile-response': 'token',
  });

  it('refuses seven characters before Turnstile', async () => {
    const res = await signupPOST(context('/api/auth/signup', fields('1234567')));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Password must be at least 8 characters' });
    expect(verifyTurnstile).not.toHaveBeenCalled();
  });

  it('lets eight characters through to Turnstile', async () => {
    const res = await signupPOST(context('/api/auth/signup', fields('12345678')));
    expect(verifyTurnstile).toHaveBeenCalledTimes(1);
    expect((await res.json()).error).not.toBe('Password must be at least 8 characters');
  });
});

describe('the sign-in API keeps its legacy floor', () => {
  it('a seven-character password is not refused as invalid; it reaches Turnstile', async () => {
    const res = await signinPOST(
      context('/api/auth/signin', { email: 'old@example.com', password: '1234567', 'cf-turnstile-response': 'token' }),
    );
    expect(verifyTurnstile).toHaveBeenCalledTimes(1);
    expect((await res.json()).error).not.toBe('Invalid password');
  });

  it('five characters is still refused before Turnstile', async () => {
    const res = await signinPOST(
      context('/api/auth/signin', { email: 'old@example.com', password: '12345', 'cf-turnstile-response': 'token' }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid password' });
    expect(verifyTurnstile).not.toHaveBeenCalled();
  });
});

describe('every other password minimum matches', () => {
  it('validatePassword (settings) refuses seven and accepts eight', () => {
    expect(validatePassword('1234567').valid).toBe(false);
    expect(validatePassword('12345678').valid).toBe(true);
  });

  it('the reset API refuses seven', async () => {
    const res = await resetPOST(
      context('/api/auth/reset-password', { token: 't', password: '1234567', confirmPassword: '1234567' }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Password must be at least 8 characters' });
  });

  // The reset page and the settings tab keep their literal minimums; this keeps them equal to
  // the constant.
  it.each([['src/pages/auth/reset-password.astro', 2], ['src/components/profile/SettingsTab.tsx', 1]] as const)(
    '%s uses the same minimum on its password inputs',
    (file, expected) => {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      const found = [...source.matchAll(/minlength="(\d+)"|minLength=\{(\d+)\}/gi)].map((m) => Number(m[1] ?? m[2]));
      expect(found).toHaveLength(expected);
      for (const value of found) expect(value).toBe(PASSWORD_MIN_LENGTH);
    },
  );
});
