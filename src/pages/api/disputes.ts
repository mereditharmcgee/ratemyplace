import type { APIRoute } from 'astro';
import { getDB } from '../../lib/db';
import { extractReviewIdFromUrl } from '../../lib/disputes';
import { sanitizeText } from '../../lib/validation';
import { sendDisputeConfirmationEmail } from '../../lib/email';
import { checkRateLimit, getClientIP } from '../../lib/rateLimit';

export const POST: APIRoute = async ({ request, locals: rawLocals }) => {
  const locals = rawLocals as any;
  try {
    const db = getDB(locals.runtime);

    // Rate limiting: 3 dispute submissions per hour per IP
    const clientIP = getClientIP({ request });
    const rateLimit = await checkRateLimit(db, clientIP, 'dispute', 3, 3600);

    if (!rateLimit.allowed) {
      const status = rateLimit.error ? 503 : 429;
      const message = rateLimit.error
        ? 'Service temporarily unavailable. Please try again in a few minutes.'
        : 'Too many dispute submissions. Please try again later.';

      return new Response(
        JSON.stringify({ error: message }),
        { status, headers: { 'Content-Type': 'application/json', 'Retry-After': String(rateLimit.retryAfterSeconds) } }
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
    } = body;

    // Validate required fields
    if (!reviewUrl || !landlordName || !landlordEmail || !landlordPhone || !disputeReasons) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!Array.isArray(disputeReasons) || disputeReasons.length === 0) {
      return new Response(
        JSON.stringify({ error: 'At least one dispute reason is required' }),
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
      .prepare('SELECT id, building_id FROM reviews WHERE id = ?')
      .bind(reviewId)
      .first();

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
      .first();

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

    // Send confirmation email (best-effort)
    const resendApiKey = locals.runtime?.env?.RESEND_API_KEY;
    if (resendApiKey) {
      try {
        await sendDisputeConfirmationEmail(
          resendApiKey,
          siteUrl,
          landlordEmail,
          {
            landlordName,
            buildingAddress,
            disputeReasons,
            disputeExplanation,
          }
        );
      } catch (emailError) {
        console.error('Failed to send confirmation email:', emailError);
        // Continue - don't fail the request if email fails
      }
    } else {
      console.warn('RESEND_API_KEY not configured - skipping confirmation email');
    }

    // Return success
    return new Response(
      JSON.stringify({ success: true, disputeId }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
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
export const GET: APIRoute = async ({ locals: rawLocals }) => {
  const locals = rawLocals as any;
  try {
    // Check authentication
    const user = locals.user;
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
    const db = getDB(locals.runtime);

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
