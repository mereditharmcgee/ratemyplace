import type { APIContext } from 'astro';
import { getDB } from '../../../../lib/db';
import { createAuditLog } from '../../../../lib/audit';
import { getClientIP } from '../../../../lib/rateLimit';

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

    const db = getDB((context.locals as any).runtime);

    // Check if review exists and get current status (for audit log)
    const review = await db.prepare('SELECT id, status FROM reviews WHERE id = ?').bind(reviewId).first();
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
    const db = getDB((context.locals as any).runtime);

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
    const db = getDB((context.locals as any).runtime);

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
