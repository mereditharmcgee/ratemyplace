import type { APIContext } from 'astro';
import { getDB } from '../../../../lib/db';
import { getEnv, fireAndForget } from '../../../../lib/runtime';
import { createAuditLog } from '../../../../lib/audit';
import { getClientIP } from '../../../../lib/rateLimit';
import { createNotification } from '../../../../lib/notifications';
import { sendReviewRejectedEmail } from '../../../../lib/email';
import { logError } from '../../../../lib/logger';
import { errorMessage } from '../../../../lib/records/errors';
import { recordsRequestState } from '../../../../lib/records/coverage';
import { enqueue } from '../../../../lib/records/queue';

export async function PATCH(context: APIContext): Promise<Response> {
  // Require authentication
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Require admin
  if (!context.locals.user.isAdmin) {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const reviewId = context.params.id;
  if (!reviewId) {
    return new Response(JSON.stringify({ error: 'Review ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await context.request.json();
    const { status, moderation_notes } = body;

    const validStatuses = ['pending', 'approved', 'rejected', 'flagged'];
    if (status && !validStatuses.includes(status)) {
      return new Response(JSON.stringify({ error: 'Invalid status value' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const db = getDB(context);

    // Check if review exists and get current status (for audit log). `building_id` comes
    // along for the records enqueue at the bottom of the approval branch.
    const review = await db
      .prepare('SELECT id, status, building_id FROM reviews WHERE id = ?')
      .bind(reviewId)
      .first<{ id: string; status: string; building_id: string }>();
    if (!review) {
      return new Response(JSON.stringify({ error: 'Review not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const oldStatus = review.status || 'unknown';

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];

    if (status) {
      updates.push('status = ?');
      values.push(status);
    }

    if (moderation_notes !== undefined) {
      updates.push('moderation_notes = ?');
      values.push(moderation_notes);
    }

    updates.push('updated_at = unixepoch()');
    values.push(reviewId);

    await db.prepare(`
      UPDATE reviews
      SET ${updates.join(', ')}
      WHERE id = ?
    `).bind(...values).run();

    // Audit log the status change
    if (status) {
      await createAuditLog(db, {
        adminUserId: context.locals.user.id,
        adminIp: getClientIP(context),
        actionType: `review_${status}`,  // review_approved, review_rejected, etc.
        entityType: 'review',
        entityId: reviewId,
        oldValue: { status: oldStatus },
        newValue: { status },
        notes: moderation_notes || undefined
      });

      // Notify the review author when their review is approved or rejected.
      // Approved: in-app notification only (low urgency, they'll see it next visit).
      // Rejected: in-app notification + email — a tenant who put real time into
      // a review and gets it rejected may not log back in to find out, so the
      // email is the load-bearing channel for telling them what happened and
      // pointing them at edit-and-resubmit (audit CG2).
      if (status === 'approved' || status === 'rejected') {
        const reviewWithBuilding = await db.prepare(
          'SELECT r.user_id, b.address, u.email FROM reviews r JOIN buildings b ON r.building_id = b.id JOIN users u ON r.user_id = u.id WHERE r.id = ?'
        ).bind(reviewId).first<{ user_id: string; address: string; email: string }>();

        if (reviewWithBuilding) {
          await createNotification(db, {
            userId: reviewWithBuilding.user_id,
            eventType: status === 'approved' ? 'review_approved' : 'review_rejected',
            reviewId,
            buildingAddress: reviewWithBuilding.address,
          });

          if (status === 'rejected') {
            const env = getEnv(context);
            const apiKey = env.RESEND_API_KEY;
            const siteUrl = env.SITE_URL || 'https://ratemyplace.org';
            if (apiKey) {
              // fireAndForget so the moderator's PATCH returns immediately
              // instead of blocking on Resend's response time. Errors are
              // logged structurally inside the helper.
              fireAndForget(
                context,
                sendReviewRejectedEmail(
                  apiKey,
                  siteUrl,
                  reviewWithBuilding.email,
                  reviewWithBuilding.address,
                  moderation_notes ?? null
                )
              );
            } else {
              console.warn('RESEND_API_KEY not configured - skipping review rejected email');
            }
          }
        }
      }

      // An approval is the third "someone cares about this building" signal, alongside the
      // reader-facing button and a save: the review goes live next to four "Not retrieved
      // yet" rows unless the Worker is asked for the deeper records now, and `planRefresh`
      // will not ask — it only re-pulls buildings that already have a deeper pull, so a
      // seeded building approved before the city-wide pass reaches it waits weeks. Enqueue
      // once, and only when the building is eligible, has no deeper records yet, and nobody
      // (button, follower, or the city-wide pass) has asked already. A pending fill row is
      // deliberately not promoted, for the same reason as `save.ts`: this path carries no
      // Turnstile and no daily cap, so promotion would be an uncapped route to priority 0.
      // `follower` is reused rather than a new reason — a new one needs a migration for
      // `records_queue`'s CHECK constraint, and the priority is the same. Isolated so a
      // queue hiccup cannot turn a completed approval into a 500.
      if (status === 'approved') {
        try {
          if ((await recordsRequestState(db, review.building_id)) === 'never_pulled') {
            await enqueue(db, {
              buildingId: review.building_id,
              reason: 'follower',
              now: Math.floor(Date.now() / 1000),
            });
          }
        } catch (err) {
          logError('records_review_approval_enqueue_failed', {
            buildingId: review.building_id,
            reviewId,
            error: errorMessage(err),
          });
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error updating review:', error);
    return new Response(JSON.stringify({ error: 'Failed to update review' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function GET(context: APIContext): Promise<Response> {
  // Require authentication
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Require admin
  if (!context.locals.user.isAdmin) {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const reviewId = context.params.id;
  if (!reviewId) {
    return new Response(JSON.stringify({ error: 'Review ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB(context);

    const review = await db.prepare(`
      SELECT
        r.*,
        u.email as user_email,
        b.address as building_address,
        b.city as building_city,
        b.neighborhood as building_neighborhood
      FROM reviews r
      JOIN users u ON r.user_id = u.id
      JOIN buildings b ON r.building_id = b.id
      WHERE r.id = ?
    `).bind(reviewId).first();

    if (!review) {
      return new Response(JSON.stringify({ error: 'Review not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ review }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching review:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch review' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function DELETE(context: APIContext): Promise<Response> {
  // Require authentication
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Require admin
  if (!context.locals.user.isAdmin) {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const reviewId = context.params.id;
  if (!reviewId) {
    return new Response(JSON.stringify({ error: 'Review ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB(context);

    // Check if review exists and capture data for audit log
    const review = await db.prepare(
      'SELECT id, status, user_id, building_id, review_title, overall_score FROM reviews WHERE id = ?'
    ).bind(reviewId).first<{ id: string; status: string; user_id: string; building_id: string; review_title: string | null; overall_score: number | null }>();
    if (!review) {
      return new Response(JSON.stringify({ error: 'Review not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Audit log the deletion with forensic data
    await createAuditLog(db, {
      adminUserId: context.locals.user.id,
      adminIp: getClientIP(context),
      actionType: 'review_deleted',
      entityType: 'review',
      entityId: reviewId,
      oldValue: { status: review.status, userId: review.user_id, buildingId: review.building_id, title: review.review_title, score: review.overall_score },
      newValue: { deleted: true }
    });

    // Delete the review (cascades to verification_images, review_votes)
    await db.prepare('DELETE FROM reviews WHERE id = ?').bind(reviewId).run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error deleting review:', error);
    return new Response(JSON.stringify({ error: 'Failed to delete review' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
