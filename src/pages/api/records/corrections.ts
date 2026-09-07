import type { APIContext, APIRoute } from 'astro';
import { getDB } from '../../../lib/db';
import { getEnv } from '../../../lib/runtime';
import { checkRateLimit, getClientIP, buildRateLimitHeaders } from '../../../lib/rateLimit';
import { verifyTurnstile } from '../../../lib/turnstile';
import { sanitizeMultilineText } from '../../../lib/validation';
import { logError } from '../../../lib/logger';
import {
  validateCorrectionBody,
  toStoredKind,
  CLAIM_MIN,
  type CorrectionKind,
} from '../../../lib/records/corrections';

/**
 * POST /api/records/corrections
 *
 * Public, unauthenticated "report a record error" submission. Unlike disputes,
 * nothing about the filer is stored except an optional contact email — no IP,
 * no name. Follows the disputes.ts guard order exactly (content-type guard →
 * rate limit → request.json() → Turnstile → validation → logic) because this
 * is an unauthenticated JSON POST and Astro's checkOrigin does not cover
 * application/json bodies.
 *
 * Reports are only accepted for buildings that have a records panel — a building
 * with no `record_pulls` row 404s like an unknown one.
 */
export const POST: APIRoute = async (context: APIContext) => {
  // Content-type guard — MUST come before request.json() (which throws SyntaxError on non-JSON)
  const contentType = context.request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return new Response(JSON.stringify({ error: 'Unsupported Media Type' }), {
      status: 415,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { request } = context;
  try {
    const db = getDB(context);

    // Rate limiting: 3 correction reports per hour per IP
    const clientIP = getClientIP(context);
    const rateLimit = await checkRateLimit(db, clientIP, 'record_correction', 3, 3600);

    if (!rateLimit.allowed) {
      const status = rateLimit.error ? 503 : 429;
      const message = rateLimit.error
        ? 'Service temporarily unavailable. Please try again in a few minutes.'
        : 'Too many reports. Please try again later.';

      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json', ...buildRateLimitHeaders(rateLimit, 3) },
      });
    }

    const body = await request.json();

    // A JSON body of `null`, an array, or a primitive parses fine but isn't a
    // record we can validate field-by-field — reject it before it reaches
    // property access below (e.g. `body.turnstileToken` on `null` would throw
    // and fall through to the generic 500 handler instead of a clean 400).
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return new Response(
        JSON.stringify({
          error: 'Validation failed',
          details: [{ field: 'buildingId', message: 'Building is required.' }],
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Turnstile bot verification — this endpoint is unauthenticated and accepts
    // JSON (so Astro checkOrigin does not cover it).
    const turnstileResult = await verifyTurnstile(
      typeof body.turnstileToken === 'string' ? body.turnstileToken : '',
      getEnv(context).TURNSTILE_SECRET_KEY,
      clientIP
    );
    if (!turnstileResult.success) {
      return new Response(
        JSON.stringify({ error: turnstileResult.error || 'Bot verification failed. Please try again.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const errors = validateCorrectionBody(body);
    if (errors.length > 0) {
      return new Response(JSON.stringify({ error: 'Validation failed', details: errors }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { buildingId, recordKind, claim, contactEmail } = body as {
      buildingId: string;
      recordKind: CorrectionKind;
      claim: string;
      contactEmail?: string;
    };

    // Sanitize before the length check: markup-only input like
    // '<b></b><i></i><em></em>' passes validateCorrectionBody's raw-string
    // length check (it's >= CLAIM_MIN characters) but sanitizes down to an
    // empty claim. Re-validate the cleaned text so that can't be stored.
    // Only the minimum is re-checked: sanitizing strips markup, it never adds
    // characters, so a claim already under CLAIM_MAX can't cross it here.
    const cleanedClaim = sanitizeMultilineText(claim);
    if (cleanedClaim.length < CLAIM_MIN) {
      return new Response(
        JSON.stringify({
          error: 'Validation failed',
          details: [{ field: 'claim', message: `Tell us what is wrong in at least ${CLAIM_MIN} characters.` }],
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const building = await db.prepare('SELECT id FROM buildings WHERE id = ?').bind(buildingId).first();
    if (!building) {
      return new Response(JSON.stringify({ error: 'Building not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // A building with no `record_pulls` row renders no records panel, and the form lives
    // inside that panel — so there is no record on the page to report and no legitimate
    // way to reach this endpoint for it. Same 404 as an unknown building: the queue is for
    // corrections to records we actually publish, and this keeps it from being a general
    // write channel keyed on any building id.
    const pulled = await db
      .prepare('SELECT 1 AS present FROM record_pulls WHERE building_id = ? LIMIT 1')
      .bind(buildingId)
      .first();
    if (!pulled) {
      return new Response(JSON.stringify({ error: 'Building not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const id = crypto.randomUUID();
    const normalizedContactEmail =
      typeof contactEmail === 'string' && contactEmail.trim() ? contactEmail.trim().toLowerCase() : null;

    await db
      .prepare(
        'INSERT INTO record_corrections (id, building_id, record_kind, claim, contact_email) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(id, buildingId, toStoredKind(recordKind), cleanedClaim, normalizedContactEmail)
      .run();

    return new Response(JSON.stringify({ data: { id } }), {
      status: 201,
      headers: { 'Content-Type': 'application/json', ...buildRateLimitHeaders(rateLimit, 3) },
    });
  } catch (error) {
    logError('record_correction_submit_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response(JSON.stringify({ error: 'Failed to submit report' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
