import type { APIContext, APIRoute } from 'astro';
import { getDB } from '../../../lib/db';
import { getEnv } from '../../../lib/runtime';
import { logError } from '../../../lib/logger';
import { buildRateLimitHeaders, checkRateLimit, getClientIP } from '../../../lib/rateLimit';
import { verifyTurnstile } from '../../../lib/turnstile';
import { enqueue } from '../../../lib/records/queue';
import { recordsRequestState } from '../../../lib/records/coverage';
import {
  REQUEST_CAP_WINDOW_SECONDS,
  REQUEST_DAILY_CAP,
  REQUEST_PER_IP,
  REQUEST_WINDOW_SECONDS,
  buttonRequestsSince,
  validateRequestBody,
} from '../../../lib/records/request';

/**
 * POST /api/records/request
 *
 * The reader-facing "Get this building's city records" button. It enqueues one pull for the
 * companion Worker; it never pulls anything itself (AGENTS.md: no fetch from a city API in a
 * request). Unauthenticated JSON POST, so the guard order is the corrections route's:
 * content type -> per-IP rate limit -> body shape -> site-wide daily cap -> Turnstile ->
 * validation -> building -> coverage -> enqueue. Nothing about the presser is stored: the
 * queue row carries the building and the time, and the rate limiter keeps the IP for an hour
 * as it does for every public form.
 */
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

export const POST: APIRoute = async (context: APIContext) => {
  // Content-type guard — MUST come before request.json(), which throws on a non-JSON body.
  const contentType = context.request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return json(415, { error: 'Unsupported Media Type' });
  }

  try {
    const db = getDB(context);
    const clientIP = getClientIP(context);
    const rateLimit = await checkRateLimit(
      db,
      clientIP,
      'records_request',
      REQUEST_PER_IP,
      REQUEST_WINDOW_SECONDS,
    );
    if (!rateLimit.allowed) {
      const status = rateLimit.error ? 503 : 429;
      const message = rateLimit.error
        ? 'Service temporarily unavailable. Please try again in a few minutes.'
        : 'Too many requests. Please try again later.';
      return json(status, { error: message }, buildRateLimitHeaders(rateLimit, REQUEST_PER_IP));
    }
    const limitHeaders = buildRateLimitHeaders(rateLimit, REQUEST_PER_IP);

    const body: unknown = await context.request.json();
    // A JSON body of `null`, an array, or a primitive parses fine but is not a record we can
    // read `buildingId` off — reject it before the property access below.
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return json(400, {
        error: 'Validation failed',
        details: [{ field: 'buildingId', message: 'Building is required.' }],
      });
    }
    const record = body as Record<string, unknown>;

    const now = Math.floor(Date.now() / 1000);
    if ((await buttonRequestsSince(db, now - REQUEST_CAP_WINDOW_SECONDS)) >= REQUEST_DAILY_CAP) {
      return json(
        429,
        { error: "Today's limit for city-records requests has been reached. Please try again tomorrow." },
        limitHeaders,
      );
    }

    const turnstile = await verifyTurnstile(
      typeof record.turnstileToken === 'string' ? record.turnstileToken : '',
      getEnv(context).TURNSTILE_SECRET_KEY,
      clientIP,
    );
    if (!turnstile.success) {
      return json(400, { error: turnstile.error || 'Bot verification failed. Please try again.' });
    }

    const errors = validateRequestBody(record);
    if (errors.length > 0) return json(400, { error: 'Validation failed', details: errors });
    const buildingId = (record.buildingId as string).trim();

    // Unknown building, a city no jurisdiction pulls for, and a building with no parcel id
    // are one answer on purpose: there is nothing to offer and nothing to tell a prober.
    const state = await recordsRequestState(db, buildingId);
    if (state === 'ineligible') return json(404, { error: 'Building not found' });
    if (state === 'pulled') {
      return json(409, { error: 'City records for this building have already been retrieved.' });
    }

    const result = await enqueue(db, { buildingId, reason: 'button', now });
    return json(202, { data: { status: result.status } }, limitHeaders);
  } catch (error) {
    logError('records_request_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return json(500, { error: 'Failed to request records' });
  }
};
