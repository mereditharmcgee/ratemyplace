import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';
import { createVerificationToken } from '../../../lib/tokens';
import { sendVerificationEmail } from '../../../lib/email';
import { checkRateLimit, getClientIP } from '../../../lib/rateLimit';

export async function POST(context: APIContext): Promise<Response> {
  const user = (context.locals as any).user;

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

  const runtime = (context.locals as any).runtime;
  const db = getDB(runtime);

  // Rate limit: 3 verification emails per hour per IP
  const clientIP = getClientIP(context);
  const rateLimit = await checkRateLimit(db, clientIP, 'verify_email_resend', 3, 3600);

  if (!rateLimit.allowed) {
    return new Response(JSON.stringify({
      error: `Too many verification emails requested. Please try again in ${Math.ceil(rateLimit.retryAfterSeconds / 60)} minutes.`
    }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': rateLimit.retryAfterSeconds.toString()
      }
    });
  }

  try {
    // Create new token (deletes any existing)
    const token = await createVerificationToken(db, user.id);

    // Send email
    const siteUrl = runtime.env.SITE_URL || context.url.origin;
    const emailResult = await sendVerificationEmail(
      runtime.env.RESEND_API_KEY,
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
