import type { APIContext, APIRoute } from 'astro';
import { getDB } from '../../../lib/db';
import { getEnv, fireAndForget } from '../../../lib/runtime';
import { sendDisputeResolutionEmail } from '../../../lib/email';
import { createAuditLog } from '../../../lib/audit';
import { getClientIP } from '../../../lib/rateLimit';
import { createNotification } from '../../../lib/notifications';

/**
 * PATCH /api/disputes/:id
 * Resolve a dispute (admin only)
 */
export const PATCH: APIRoute = async (context: APIContext) => {
  const { params, request } = context;
  try {
    const disputeId = params.id;

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

    // Parse request body
    const body = await request.json();
    const { resolutionOutcome, resolutionNotes } = body;

    // Validate outcome
    const validOutcomes = ['uphold', 'dismiss', 'partially_valid'];
    if (!resolutionOutcome || !validOutcomes.includes(resolutionOutcome)) {
      return new Response(
        JSON.stringify({ error: 'Invalid resolution outcome. Must be: uphold, dismiss, or partially_valid' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate notes (required)
    if (!resolutionNotes || typeof resolutionNotes !== 'string' || resolutionNotes.trim() === '') {
      return new Response(
        JSON.stringify({ error: 'Resolution notes are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get database
    const db = getDB(context);

    // Get dispute details for email and audit log
    const dispute = await db
      .prepare('SELECT landlord_email, landlord_name, status, resolution_outcome FROM disputes WHERE id = ?')
      .bind(disputeId)
      .first();

    if (!dispute) {
      return new Response(
        JSON.stringify({ error: 'Dispute not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Prevent re-resolving an already-resolved dispute
    if (dispute.status === 'resolved') {
      return new Response(
        JSON.stringify({ error: 'Dispute has already been resolved' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Capture current state for audit log
    const oldStatus = dispute.status || 'unknown';
    const oldOutcome = dispute.resolution_outcome || null;

    // Update dispute
    await db
      .prepare(`
        UPDATE disputes
        SET status = 'resolved',
            resolution_outcome = ?,
            resolution_notes = ?,
            resolved_at = unixepoch(),
            resolved_by = ?,
            updated_at = unixepoch()
        WHERE id = ?
      `)
      .bind(resolutionOutcome, resolutionNotes, user.id, disputeId)
      .run();

    // Audit log the resolution
    // Map outcome to action type for clearer filtering
    const actionType = resolutionOutcome === 'uphold' ? 'dispute_upheld'
      : resolutionOutcome === 'dismiss' ? 'dispute_dismissed'
      : resolutionOutcome === 'partially_valid' ? 'dispute_partially_valid'
      : 'dispute_resolved';

    await createAuditLog(db, {
      adminUserId: user.id,
      adminIp: getClientIP({ request }),
      actionType,
      entityType: 'dispute',
      entityId: disputeId as string,
      oldValue: { status: oldStatus, outcome: oldOutcome },
      newValue: { status: 'resolved', outcome: resolutionOutcome },
      notes: resolutionNotes
    });

    // Notify review author that their dispute was resolved
    const reviewInfo = await db.prepare(
      'SELECT d.review_id, r.user_id, b.address FROM disputes d JOIN reviews r ON d.review_id = r.id JOIN buildings b ON r.building_id = b.id WHERE d.id = ?'
    ).bind(disputeId).first<{ review_id: string; user_id: string; address: string }>();

    if (reviewInfo) {
      await createNotification(db, {
        userId: reviewInfo.user_id,
        eventType: 'dispute_resolved',
        reviewId: reviewInfo.review_id,
        buildingAddress: reviewInfo.address,
      });
    }

    // Send resolution email to landlord regardless of outcome — silence on
    // dismissed or partially-upheld disputes used to read as the system being
    // unresponsive (audit CG1).
    //
    // fireAndForget so the admin's PATCH returns immediately instead of
    // blocking on Resend's response time. Errors are logged structurally
    // inside the helper.
    if (resolutionOutcome === 'uphold' || resolutionOutcome === 'dismiss' || resolutionOutcome === 'partially_valid') {
      const apiKey = getEnv(context).RESEND_API_KEY;
      if (apiKey) {
        fireAndForget(
          context,
          sendDisputeResolutionEmail(
            apiKey,
            dispute.landlord_email as string,
            dispute.landlord_name as string,
            resolutionOutcome,
            resolutionNotes
          )
        );
      } else {
        console.warn('RESEND_API_KEY not configured - skipping dispute resolution email');
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error resolving dispute:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to resolve dispute' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
