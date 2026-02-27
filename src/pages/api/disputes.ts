import type { APIRoute } from 'astro';
import { getDB } from '../../lib/db';
import { extractReviewIdFromUrl } from '../../lib/disputes';
import { sanitizeText } from '../../lib/validation';
import { sendDisputeConfirmationEmail } from '../../lib/email';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
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

    // Get database
    const db = getDB(locals.runtime);

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
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
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
