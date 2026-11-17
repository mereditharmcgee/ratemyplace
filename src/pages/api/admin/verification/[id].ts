import type { APIContext } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDB } from '../../../../lib/db';
import { getEnv } from '../../../../lib/runtime';
import { getVerificationImage, deleteVerificationImage } from '../../../../lib/storage';
import { createAuditLog } from '../../../../lib/audit';
import { getClientIP } from '../../../../lib/rateLimit';
import { logError } from '../../../../lib/logger';
import { createNotification, wantsReviewStatusEmail } from '../../../../lib/notifications';
import { sendVerificationRejectedEmail } from '../../../../lib/email';
import { trackSend } from '../../../../lib/trackSend';

const ENDPOINT = '/api/admin/verification/[id]';

/**
 * Tell the review's author how the decision went: an in-app notice either way, and on a
 * rejection an email with the reason, unless they turned off "Email me when my review status
 * changes". Runs after the decision is written and never throws: a notice that cannot be
 * written (for example before migration 0037 widens the event CHECK) is logged, and the
 * decision still stands.
 */
async function notifyAuthor(
  context: APIContext,
  db: D1Database,
  verificationId: string,
  reviewId: string,
  decision: 'approve' | 'reject',
  reason: string | null,
): Promise<void> {
  try {
    const author = await db.prepare(
      'SELECT r.user_id, b.address, u.email, u.notification_opt_in FROM reviews r JOIN buildings b ON r.building_id = b.id JOIN users u ON r.user_id = u.id WHERE r.id = ?'
    ).bind(reviewId).first<{ user_id: string; address: string; email: string; notification_opt_in: number | null }>();
    if (!author) return;

    await createNotification(db, {
      userId: author.user_id,
      eventType: decision === 'approve' ? 'verification_approved' : 'verification_rejected',
      reviewId,
      buildingAddress: author.address,
    });

    if (decision === 'reject' && wantsReviewStatusEmail(author.notification_opt_in)) {
      const env = getEnv(context);
      const siteUrl = env.SITE_URL || 'https://ratemyplace.org';
      // In the background, so the admin's decision returns at once; a failed or unconfigured
      // send is recorded on /admin.
      trackSend(
        context,
        'verification_rejected',
        author.email,
        sendVerificationRejectedEmail(env.RESEND_API_KEY, siteUrl, author.email, author.address, reason)
      );
    }
  } catch (err) {
    logError('verification_outcome_notice_failed', {
      endpoint: ENDPOINT,
      verificationId,
      decision,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// GET - Stream the verification image
export async function GET(context: APIContext): Promise<Response> {
  const { id } = context.params;

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

  try {
    const db = getDB(context);

    // Get verification record
    const verification = await db.prepare(`
      SELECT r2_key, content_type, filename FROM verification_images WHERE id = ?
    `).bind(id).first<{ r2_key: string; content_type: string; filename: string }>();

    if (!verification) {
      return new Response(JSON.stringify({ error: 'Verification not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get R2 bucket
    const bucket = getEnv(context).VERIFICATION_BUCKET;
    if (!bucket) {
      return new Response(JSON.stringify({ error: 'Storage not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get image from R2
    const r2Object = await getVerificationImage(bucket, verification.r2_key);
    if (!r2Object) {
      return new Response(JSON.stringify({ error: 'Image not found in storage' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Sanitize the user-supplied filename before echoing it into the header —
    // strip quotes, path separators, and control chars that could break the
    // Content-Disposition parameter. Fall back to a generic name.
    const safeFilename = (verification.filename || 'verification')
      .replace(/[^\w.\- ]/g, '_')
      .slice(0, 100) || 'verification';

    // Stream the image. r2Object.body is a workers-types ReadableStream, which
    // the DOM Response BodyInit type doesn't recognize; cast. Type-only.
    // no-store: a proof-of-address document must not sit in the admin's browser
    // cache after the decision deletes it from R2.
    return new Response(r2Object.body as unknown as ReadableStream, {
      headers: {
        'Content-Type': verification.content_type,
        'Content-Disposition': `inline; filename="${safeFilename}"`,
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    console.error('Error fetching verification image:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch image' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// POST - Approve or reject verification
export async function POST(context: APIContext): Promise<Response> {
  const { id } = context.params;

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

  if (!id) {
    return new Response(JSON.stringify({ error: 'Verification ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await context.request.json();
    const { action, rejection_reason } = body;
    // The reason reaches the author now (profile and email), so only a non-blank string counts.
    const reason = typeof rejection_reason === 'string' && rejection_reason.trim()
      ? rejection_reason.trim()
      : null;

    if (!['approve', 'reject'].includes(action)) {
      return new Response(JSON.stringify({ error: 'Invalid action' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const db = getDB(context);

    // Get verification record
    const verification = await db.prepare(`
      SELECT id, review_id, r2_key, status FROM verification_images WHERE id = ?
    `).bind(id).first<{ id: string; review_id: string; r2_key: string; status: string }>();

    if (!verification) {
      return new Response(JSON.stringify({ error: 'Verification not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (verification.status !== 'pending') {
      return new Response(JSON.stringify({ error: 'Verification already processed' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const bucket = getEnv(context).VERIFICATION_BUCKET;
    const now = Math.floor(Date.now() / 1000);

    // Both decisions blank the filename: it is the tenant's own and often names their
    // address or unit, and nothing needs it once the document is decided. The column is
    // NOT NULL, so blank is ''.
    if (action === 'approve') {
      // Update verification_images
      await db.prepare(`
        UPDATE verification_images
        SET status = 'approved', reviewed_at = ?, reviewed_by = ?, filename = ''
        WHERE id = ?
      `).bind(now, context.locals.user.id, id).run();

      // Update review to verified
      await db.prepare(`
        UPDATE reviews
        SET is_verified = 1, verified_at = ?, verified_by = ?
        WHERE id = ?
      `).bind(now, context.locals.user.id, verification.review_id).run();

      // Delete image from R2 (no longer needed after approval)
      if (bucket) {
        const deleted = await deleteVerificationImage(bucket, verification.r2_key);
        if (!deleted) {
          logError('verification_document_delete_failed', {
            endpoint: ENDPOINT,
            verificationId: id,
            decision: 'approve',
          });
        }
      }

      // Audit log — approval flips the review's is_verified trust signal AND
      // irreversibly deletes the evidence, so record who did it.
      await createAuditLog(db, {
        adminUserId: context.locals.user.id,
        adminIp: getClientIP(context),
        actionType: 'verification_approved',
        entityType: 'verification',
        entityId: id,
        newValue: { review_id: verification.review_id, is_verified: 1 },
      });

      await notifyAuthor(context, db, id, verification.review_id, 'approve', null);

      return new Response(JSON.stringify({
        success: true,
        message: 'Verification approved'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      // Reject
      await db.prepare(`
        UPDATE verification_images
        SET status = 'rejected', reviewed_at = ?, reviewed_by = ?, rejection_reason = ?, filename = ''
        WHERE id = ?
      `).bind(now, context.locals.user.id, reason, id).run();

      // Delete image from R2 immediately after the decision. Verification
      // documents are temporary evidence and are never retained after review,
      // regardless of whether the submission is approved or rejected.
      if (bucket) {
        const deleted = await deleteVerificationImage(bucket, verification.r2_key);
        if (!deleted) {
          logError('verification_document_delete_failed', {
            endpoint: ENDPOINT,
            verificationId: id,
            decision: 'reject',
          });
        }
      }

      await createAuditLog(db, {
        adminUserId: context.locals.user.id,
        adminIp: getClientIP(context),
        actionType: 'verification_rejected',
        entityType: 'verification',
        entityId: id,
        newValue: { review_id: verification.review_id },
        notes: reason ?? undefined,
      });

      await notifyAuthor(context, db, id, verification.review_id, 'reject', reason);

      return new Response(JSON.stringify({
        success: true,
        message: 'Verification rejected'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    console.error('Error processing verification:', error);
    return new Response(JSON.stringify({ error: 'Failed to process verification' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
