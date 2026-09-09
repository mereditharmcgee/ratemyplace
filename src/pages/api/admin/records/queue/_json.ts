// The JSON plumbing the three queue routes share, kept next to them rather than in
// `src/lib/` because nothing outside this directory uses it.
//
// The leading underscore is load-bearing: Astro excludes `_`-prefixed files under
// `src/pages/` from file-based routing, so this module is an import, not an endpoint.
// (Compare the AGENTS.md warning about `.md` files in `src/pages/`, which ARE routed.)
import type { APIContext } from 'astro';

export function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export type JsonBody =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response };

/**
 * The content-type guard plus the body parse, in the order AGENTS.md requires: the guard
 * MUST come before `request.json()`, which throws a raw SyntaxError on non-JSON input.
 *
 * 415 for the wrong content type matches the rest of the repo (`disputes.ts`,
 * `contact.ts`, `records/corrections.ts`). 400 covers a body that is unparseable, or
 * parses to something that is not an object — `null`, an array, a bare number — because
 * a caller reading fields off it would otherwise throw its way into a generic 500.
 */
export async function readJsonBody(context: APIContext): Promise<JsonBody> {
  const contentType = context.request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return { ok: false, response: json({ error: 'Unsupported Media Type' }, 415) };
  }

  let parsed: unknown;
  try {
    parsed = await context.request.json();
  } catch {
    return { ok: false, response: json({ error: 'Invalid JSON body' }, 400) };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, response: json({ error: 'Invalid JSON body' }, 400) };
  }

  return { ok: true, body: parsed as Record<string, unknown> };
}
