import type { APIRoute } from 'astro';
import { getDB } from '../../../lib/db';
import { sendDisputeUpheldEmail } from '../../../lib/email';
import { createAuditLog } from '../../../lib/audit';
import { getClientIP } from '../../../lib/rateLimit';

/**
 * PATCH /api/disputes/:id
 * Resolve a dispute (admin only)
 */
export const PATCH: APIRoute = async ({ params, request, locals }) => {
  try {
    const disputeId = params.id;

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
    const db = getDB(locals.runtime);

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

    // If outcome is 'uphold', send notification email to landlord
    if (resolutionOutcome === 'uphold') {
      const apiKey = locals.runtime?.env?.RESEND_API_KEY;
      if (apiKey) {
        try {
          await sendDisputeUpheldEmail(
            apiKey,
            dispute.landlord_email as string,
            dispute.landlord_name as string,
            resolutionNotes
          );
        } catch (emailError) {
          console.error('Failed to send upheld notification email:', emailError);
          // Don't fail the request if email fails
        }
      } else {
        console.warn('RESEND_API_KEY not configured - skipping upheld notification email');
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
