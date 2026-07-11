import type { APIContext, APIRoute } from 'astro';
import { getDB } from '../../lib/db';
import { getEnv, fireAndForget } from '../../lib/runtime';
import { extractReviewIdFromUrl } from '../../lib/disputes';
import { sanitizeText, validateDisputeForm } from '../../lib/validation';
import { sendDisputeConfirmationEmail } from '../../lib/email';
import { checkRateLimit, getClientIP, buildRateLimitHeaders } from '../../lib/rateLimit';
import { createNotification } from '../../lib/notifications';
import { verifyTurnstile } from '../../lib/turnstile';

export const POST: APIRoute = async (context: APIContext) => {
  // Content-type guard — MUST come before request.json() (which throws SyntaxError on non-JSON)
  const contentType = context.request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return new Response(JSON.stringify({ error: 'Unsupported Media Type' }), {
      status: 415,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { request } = context;
  try {
    const db = getDB(context);

    // Rate limiting: 3 dispute submissions per hour per IP
    const clientIP = getClientIP(context);
    const rateLimit = await checkRateLimit(db, clientIP, 'dispute', 3, 3600);

    if (!rateLimit.allowed) {
      const status = rateLimit.error ? 503 : 429;
      const message = rateLimit.error
        ? 'Service temporarily unavailable. Please try again in a few minutes.'
        : 'Too many dispute submissions. Please try again later.';

      return new Response(
        JSON.stringify({ error: message }),
        { status, headers: { 'Content-Type': 'application/json', ...buildRateLimitHeaders(rateLimit, 3) } }
      );
    }

    const body = await request.json();
    const {
      reviewUrl,
      landlordName,
      landlordEmail,
      landlordPhone,
      disputeReasons,
      disputeExplanation,
      turnstileToken,
    } = body;

    // Turnstile bot verification — this endpoint is unauthenticated, accepts JSON
    // (so Astro checkOrigin does not cover it), and sends email to an attacker-
    // supplied address, so Turnstile is the primary anti-bot control.
    const turnstileResult = await verifyTurnstile(
      turnstileToken,
      getEnv(context).TURNSTILE_SECRET_KEY,
      clientIP
    );
    if (!turnstileResult.success) {
      return new Response(
        JSON.stringify({ error: turnstileResult.error || 'Bot verification failed. Please try again.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // VAL-01: validate landlord fields and explanation length
    const errors = validateDisputeForm(body);
    if (errors.length > 0) {
      return new Response(
        JSON.stringify({ error: 'Validation failed', details: errors }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // reviewUrl is NOT in validateDisputeForm — it's a business-logic field validated below
    if (!reviewUrl || typeof reviewUrl !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Validation failed', details: [{ field: 'reviewUrl', message: 'Review URL is required.' }] }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // disputeReasons stays as inline business-logic check (it's an array, not a form field value)
    if (!Array.isArray(disputeReasons) || disputeReasons.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Validation failed', details: [{ field: 'disputeReasons', message: 'At least one dispute reason is required.' }] }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Extract and validate review URL
    const siteUrl = new URL(request.url).origin;
    const reviewId = extractReviewIdFromUrl(reviewUrl, siteUrl);

    if (!reviewId) {
      return new Response(
        JSON.stringify({ error: 'Invalid review URL. Please paste the full URL from your browser.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify review exists and get building info
    const review = await db
      .prepare('SELECT id, building_id, user_id FROM reviews WHERE id = ?')
      .bind(reviewId)
      .first<{ id: string; building_id: string; user_id: string }>();

    if (!review) {
      return new Response(
        JSON.stringify({ error: 'Review not found. Please check the URL and try again.' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get building address for confirmation email
    const building = await db
      .prepare('SELECT address FROM buildings WHERE id = ?')
      .bind(review.building_id)
      .first<{ address: string }>();

    const buildingAddress = building?.address || 'Unknown address';

    // Generate dispute ID
    const disputeId = crypto.randomUUID();

    // Insert dispute record
    try {
      await db
        .prepare(`
          INSERT INTO disputes (
            id,
            review_id,
            landlord_name,
            landlord_email,
            landlord_phone,
            dispute_reasons,
            dispute_explanation,
            status,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', unixepoch(), unixepoch())
        `)
        .bind(
          disputeId,
          reviewId,
          sanitizeText(landlordName),
          landlordEmail.toLowerCase().trim(),
          sanitizeText(landlordPhone),
          JSON.stringify(disputeReasons),
          disputeExplanation ? sanitizeText(disputeExplanation) : null
        )
        .run();
    } catch (dbError: any) {
      // Check for UNIQUE constraint violation (duplicate dispute)
      if (dbError.message?.includes('UNIQUE constraint failed')) {
        return new Response(
          JSON.stringify({ error: 'A dispute already exists for this review.' }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw dbError;
    }

    // Notify the review author that their review has been disputed (best-effort)
    if (review?.user_id) {
      await createNotification(db, {
        userId: review.user_id,
        eventType: 'review_disputed',
        reviewId,
        buildingAddress,
      });
    }

    // Send confirmation email — Phase 18 PERF-04: fire-and-forgot.
    // DB dispute INSERT already committed above — DB-then-email ordering preserved.
    const resendApiKey = getEnv(context).RESEND_API_KEY;
    if (resendApiKey) {
      fireAndForget(
        context,
        sendDisputeConfirmationEmail(resendApiKey, siteUrl, landlordEmail, {
          landlordName,
          buildingAddress,
          disputeReasons,
          disputeExplanation,
        }),
      );
    } else {
      console.warn('RESEND_API_KEY not configured - skipping confirmation email');
    }

    // Return success
    return new Response(
      JSON.stringify({ success: true, disputeId }),
      { status: 201, headers: { 'Content-Type': 'application/json', ...buildRateLimitHeaders(rateLimit, 3) } }
    );
  } catch (error) {
    console.error('Dispute submission error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to submit dispute' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * GET /api/disputes
 * Get all disputes with joined review and building data (admin only)
 */
export const GET: APIRoute = async (context: APIContext) => {
  try {
    // Check authentication
    const user = context.locals.user;
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check admin permission
    if (!user.isAdmin) {
      return new Response(
        JSON.stringify({ error: 'Admin access required' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get database
    const db = getDB(context);

    // Query disputes with joined review and building data
    const disputes = await db
      .prepare(`
        SELECT
          d.*,
          b.address as building_address,
          r.review_text,
          r.review_title,
          r.overall_score as review_overall_score
        FROM disputes d
        JOIN reviews r ON d.review_id = r.id
        JOIN buildings b ON r.building_id = b.id
        ORDER BY d.created_at ASC
      `)
      .all();

    return new Response(
      JSON.stringify({ disputes: disputes.results || [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error fetching disputes:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch disputes' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
