import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';
import { uploadVerificationImage } from '../../../lib/storage';
import { generateIdFromEntropySize } from 'lucia';

export async function POST(context: APIContext): Promise<Response> {
  // Require authentication
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const formData = await context.request.formData();
    const reviewId = formData.get('review_id') as string;
    const file = formData.get('file') as File;

    if (!reviewId) {
      return new Response(JSON.stringify({ error: 'Review ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!file || !(file instanceof File)) {
      return new Response(JSON.stringify({ error: 'File is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const db = getDB((context.locals as any).runtime);

    // Verify user owns this review
    const review = await db.prepare('SELECT user_id, is_verified FROM reviews WHERE id = ?')
      .bind(reviewId)
      .first<{ user_id: string; is_verified: number }>();

    if (!review) {
      return new Response(JSON.stringify({ error: 'Review not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (review.user_id !== context.locals.user.id) {
      return new Response(JSON.stringify({ error: 'Not authorized to verify this review' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (review.is_verified === 1) {
      return new Response(JSON.stringify({ error: 'Review is already verified' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check if there's already a pending verification
    const existingVerification = await db.prepare(`
      SELECT id FROM verification_images
      WHERE review_id = ? AND status = 'pending'
    `).bind(reviewId).first();

    if (existingVerification) {
      return new Response(JSON.stringify({
        error: 'A verification request is already pending for this review'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get R2 bucket
    const bucket = (context.locals as any).runtime?.env?.VERIFICATION_BUCKET;
    if (!bucket) {
      console.error('VERIFICATION_BUCKET not configured');
      return new Response(JSON.stringify({ error: 'Storage not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Upload to R2
    const uploadResult = await uploadVerificationImage(
      bucket,
      context.locals.user.id,
      reviewId,
      file
    );

    if (!uploadResult.success) {
      return new Response(JSON.stringify({ error: uploadResult.error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Create database record
    const verificationId = generateIdFromEntropySize(10);
    await db.prepare(`
      INSERT INTO verification_images (
        id, review_id, user_id, r2_key, filename, content_type, size_bytes
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      verificationId,
      reviewId,
      context.locals.user.id,
      uploadResult.key,
      uploadResult.filename,
      uploadResult.contentType,
      uploadResult.sizeBytes
    ).run();

    return new Response(JSON.stringify({
      success: true,
      message: 'Verification submitted. An admin will review your document shortly.',
      verificationId
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Verification upload error:', error);
    return new Response(JSON.stringify({ error: 'Failed to upload verification' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
