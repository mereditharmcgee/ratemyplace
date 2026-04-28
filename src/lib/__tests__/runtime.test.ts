import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireAndForget, recipientHash } from '../runtime';
import type { APIContext } from 'astro';

// Helper to build a minimal APIContext-shaped object for tests.
// runtime is undefined by default (matches Vitest reality — adapter is bypassed).
function makeContext(overrides: Partial<{ runtime: any; pathname: string }> = {}): APIContext {
  return {
    locals: { runtime: overrides.runtime } as any,
    url: new URL(`https://test.local${overrides.pathname ?? '/api/test'}`),
  } as unknown as APIContext;
}

describe('fireAndForget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns void (not a Promise) regardless of branch taken', () => {
    const ctx = makeContext();
    const result = fireAndForget(ctx, Promise.resolve('ok'));
    expect(result).toBeUndefined();
  });

  it('registers the wrapped promise with ctx.waitUntil when runtime.ctx is available', async () => {
    const waitUntilSpy = vi.fn();
    const ctx = makeContext({ runtime: { ctx: { waitUntil: waitUntilSpy } } });
    const promise = Promise.resolve('ok');

    fireAndForget(ctx, promise);

    expect(waitUntilSpy).toHaveBeenCalledTimes(1);
    // Argument is the wrapped (.catch'd) promise — not strictly the original.
    // Assert it's a Promise that resolves without throwing.
    const arg = waitUntilSpy.mock.calls[0][0];
    expect(arg).toBeInstanceOf(Promise);
    await expect(arg).resolves.not.toThrow();
  });

  it('falls back to void-scheduling (no throw) when context.locals.runtime is undefined', async () => {
    const ctx = makeContext({ runtime: undefined });
    let resolved = false;
    const promise = Promise.resolve().then(() => { resolved = true; });

    expect(() => fireAndForget(ctx, promise)).not.toThrow();

    // Drain the microtask queue so the void-scheduled promise can resolve.
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  it('falls back to void-scheduling when runtime.ctx is undefined (partial runtime object)', () => {
    const ctx = makeContext({ runtime: { env: {} } }); // runtime exists, ctx missing
    expect(() => fireAndForget(ctx, Promise.resolve())).not.toThrow();
  });

  it('logs via console.error when the wrapped promise rejects (waitUntil branch)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const captured: Promise<unknown>[] = [];
    const waitUntil = (p: Promise<unknown>) => { captured.push(p); };
    const ctx = makeContext({ runtime: { ctx: { waitUntil } }, pathname: '/api/auth/signup' });

    fireAndForget(ctx, Promise.reject(new Error('Resend boom')));

    // Drain so the wrapped .catch can run.
    await Promise.allSettled(captured);

    expect(consoleSpy).toHaveBeenCalled();
    const firstCallArg = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(firstCallArg);
    expect(parsed.event).toBe('fireAndForget failed');
    expect(parsed.route).toBe('/api/auth/signup');
    expect(parsed.error).toContain('Resend boom');
    consoleSpy.mockRestore();
  });

  it('logs via console.error when the wrapped promise rejects (void-fallback branch)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = makeContext({ runtime: undefined, pathname: '/api/contact' });

    fireAndForget(ctx, Promise.reject(new Error('void branch boom')));

    // Drain microtasks.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleSpy).toHaveBeenCalled();
    const parsed = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(parsed.event).toBe('fireAndForget failed');
    expect(parsed.route).toBe('/api/contact');
    consoleSpy.mockRestore();
  });
});

describe('recipientHash', () => {
  it('returns an 8-character lowercase hex string', () => {
    const hash = recipientHash('user@example.com');
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic — same input produces same output', () => {
    expect(recipientHash('user@example.com')).toBe(recipientHash('user@example.com'));
  });

  it('is case-insensitive on the email input (lowercases before hashing)', () => {
    expect(recipientHash('User@Example.COM')).toBe(recipientHash('user@example.com'));
  });

  it('produces different output for different emails', () => {
    expect(recipientHash('a@example.com')).not.toBe(recipientHash('b@example.com'));
  });

  it('returns synchronously (not a Promise)', () => {
    const result = recipientHash('user@example.com');
    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof result).toBe('string');
  });
});
