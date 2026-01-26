import type { APIContext } from 'astro';
import { getDB } from '../../../../lib/db';
import { getVerificationImage, deleteVerificationImage } from '../../../../lib/storage';

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
    const db = getDB((context.locals as any).runtime);

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
    const bucket = (context.locals as any).runtime?.env?.VERIFICATION_BUCKET;
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

    // Stream the image
    return new Response(r2Object.body, {
      headers: {
        'Content-Type': verification.content_type,
        'Content-Disposition': `inline; filename="${verification.filename}"`,
        'Cache-Control': 'private, max-age=3600'
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

  try {
    const body = await context.request.json();
    const { action, rejection_reason } = body;

    if (!['approve', 'reject'].includes(action)) {
      return new Response(JSON.stringify({ error: 'Invalid action' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const db = getDB((context.locals as any).runtime);

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

    const bucket = (context.locals as any).runtime?.env?.VERIFICATION_BUCKET;
    const now = Math.floor(Date.now() / 1000);

    if (action === 'approve') {
      // Update verification_images
      await db.prepare(`
        UPDATE verification_images
        SET status = 'approved', reviewed_at = ?, reviewed_by = ?
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
        await deleteVerificationImage(bucket, verification.r2_key);
      }

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
        SET status = 'rejected', reviewed_at = ?, reviewed_by = ?, rejection_reason = ?
        WHERE id = ?
      `).bind(now, context.locals.user.id, rejection_reason || null, id).run();

      // Keep the image for 30 days so user can see why it was rejected
      // (Could add cleanup job later)

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
