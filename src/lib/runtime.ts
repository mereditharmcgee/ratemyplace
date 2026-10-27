import type { APIContext } from 'astro';
import { sha256 } from '@oslojs/crypto/sha2';
import { encodeHexLowerCase } from '@oslojs/encoding';
import { logError } from './logger';

export function getEnv(context: APIContext): App.Platform['env'] {
  const runtime = context.locals.runtime;
  if (!runtime) {
    throw new Error('Cloudflare runtime unavailable — are you running in Wrangler?');
  }
  return runtime.env;
}

let envUnreadableLogged = false;

/**
 * The runtime env, or undefined when it cannot be read: no runtime at all (the Astro container
 * in unit tests), or the Astro 6+ Cloudflare adapter, whose `locals.runtime.env` is a getter
 * that throws a migration error. Only for render paths that must never throw and have a safe
 * default for every value they read — BaseLayout's head, and the auth pages' review note, which
 * drops the building address when there is no DB. Anything else that needs a binding uses
 * `getEnv`, which throws on purpose.
 */
export function maybeEnv(locals: App.Locals): App.Platform['env'] | undefined {
  try {
    return locals.runtime?.env;
  } catch (err) {
    if (!envUnreadableLogged) {
      envUnreadableLogged = true; // once per isolate: BaseLayout calls this on every page
      logError('maybeEnv: runtime env unreadable', { error: err instanceof Error ? err.message : String(err) });
    }
    return undefined;
  }
}

/**
 * Hash a recipient email for privacy-preserving log correlation.
 *
 * Uses @oslojs/crypto sha256 (synchronous, pure JS, already in tree from password.ts).
 * Returns the first 8 lowercase hex characters — enough to correlate "same address
 * failing repeatedly" without exposing the address itself in logs.
 *
 * Lowercases the email first so case variations don't fragment the correlation key.
 */
export function recipientHash(email: string): string {
  const bytes = sha256(new TextEncoder().encode(email.toLowerCase()));
  return encodeHexLowerCase(bytes).slice(0, 8);
}

/**
 * Fire-and-forget a promise without blocking the response.
 *
 * - In production / Wrangler dev: registers the promise with `ctx.waitUntil` so the
 *   Worker isolate stays alive until the promise resolves, even after the response
 *   has been sent to the client.
 * - In Vitest unit tests (or any environment where `context.locals.runtime` is
 *   undefined): falls back to `void wrapped`, which schedules the promise on the
 *   microtask queue without awaiting. The promise still runs; the caller does not
 *   block. This preserves dev/test parity — emails still send in tests, just
 *   asynchronously.
 *
 * The internal `.catch(logError)` is non-optional. An unhandled rejection inside
 * `waitUntil` crashes the Cloudflare Worker isolate in production. Always swallow
 * here, log structurally for observability.
 *
 * Returns `void` — callers cannot accidentally `await` it (which would defeat the
 * purpose). TypeScript will error on `await fireAndForget(...)`.
 */
export function fireAndForget(context: APIContext, promise: Promise<unknown>): void {
  const ctx = context.locals.runtime?.ctx;
  const wrapped = promise.catch((err: unknown) => {
    const isError = err instanceof Error;
    logError('fireAndForget failed', {
      route: context.url.pathname,
      error: isError ? err.message : String(err),
      stack: isError ? err.stack : undefined,
    });
  });
  if (ctx?.waitUntil) {
    ctx.waitUntil(wrapped);
  } else {
    // No ctx (rare in dev, common in unit tests): schedule the promise without
    // awaiting. Deliberately NOT `await wrapped` — that would re-block the
    // response in tests and dev, defeating the perf goal and creating a
    // misleading test environment.
    void wrapped;
  }
}
