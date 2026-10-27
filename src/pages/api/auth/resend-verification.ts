import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';
import { getEnv } from '../../../lib/runtime';
import { createVerificationToken } from '../../../lib/tokens';
import { sendVerificationEmail } from '../../../lib/email';
import { trackSend } from '../../../lib/trackSend';
import { checkRateLimit, getClientIP, buildRateLimitHeaders } from '../../../lib/rateLimit';
import { logError } from '../../../lib/logger';

export async function POST(context: APIContext): Promise<Response> {
  const user = context.locals.user;

  if (!user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Already verified
  if (user.emailVerified) {
    return new Response(JSON.stringify({ error: 'Email already verified' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const db = getDB(context);

  // Rate limit: 3 verification emails per hour per IP
  const clientIP = getClientIP(context);
  const rateLimit = await checkRateLimit(db, clientIP, 'verify_email_resend', 3, 3600);

  if (!rateLimit.allowed) {
    const status = rateLimit.error ? 503 : 429;
    const message = rateLimit.error
      ? 'Service temporarily unavailable. Please try again in a few minutes.'
      : 'Too many attempts. Please try again later.';

    if (rateLimit.error) {
      logError('rate_limit_db_failure', {
        endpoint: 'verify_email_resend',
        ip: clientIP
      });
    }

    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...buildRateLimitHeaders(rateLimit, 3),
      }
    });
  }

  try {
    // Create new token (deletes any existing)
    const token = await createVerificationToken(db, user.id);

    // Phase 18 PERF-01 (companion): the email runs in the background. Always return 200.
    // Failures are logged and recorded on /admin by trackSend; the user can press resend to retry.
    // BEHAVIOR CHANGE: previously returned 500 on email failure; now always returns 200.
    // DB token write already committed above — DB-then-email ordering preserved.
    const siteUrl = getEnv(context).SITE_URL || context.url.origin;
    trackSend(
      context,
      'verification',
      user.email,
      sendVerificationEmail(getEnv(context).RESEND_API_KEY, siteUrl, user.email, token),
    );

    return new Response(JSON.stringify({ success: true, message: 'Verification email sent' }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...buildRateLimitHeaders(rateLimit, 3),
      }
    });
  } catch (error) {
    console.error('Resend verification error:', error);
    return new Response(JSON.stringify({ error: 'An error occurred' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
