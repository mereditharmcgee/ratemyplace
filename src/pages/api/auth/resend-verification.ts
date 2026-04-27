import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';
import { getEnv } from '../../../lib/runtime';
import { createVerificationToken } from '../../../lib/tokens';
import { sendVerificationEmail } from '../../../lib/email';
import { checkRateLimit, getClientIP } from '../../../lib/rateLimit';
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
        'Retry-After': String(rateLimit.retryAfterSeconds)
      }
    });
  }

  try {
    // Create new token (deletes any existing)
    const token = await createVerificationToken(db, user.id);

    // Send email
    const siteUrl = getEnv(context).SITE_URL || context.url.origin;
    const emailResult = await sendVerificationEmail(
      getEnv(context).RESEND_API_KEY,
      siteUrl,
      user.email,
      token
    );

    if (!emailResult.success) {
      return new Response(JSON.stringify({ error: 'Failed to send verification email' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ success: true, message: 'Verification email sent' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Resend verification error:', error);
    return new Response(JSON.stringify({ error: 'An error occurred' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
