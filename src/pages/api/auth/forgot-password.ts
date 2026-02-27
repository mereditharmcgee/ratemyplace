import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';
import { createPasswordResetToken } from '../../../lib/tokens';
import { sendPasswordResetEmail } from '../../../lib/email';
import { checkRateLimit, getClientIP } from '../../../lib/rateLimit';
import { logError } from '../../../lib/logger';

interface User {
  id: string;
  email: string;
}

export async function POST(context: APIContext): Promise<Response> {
  const runtime = (context.locals as any).runtime;
  const db = getDB(runtime);

  // Rate limit: 3 password reset requests per hour per IP
  const clientIP = getClientIP(context);
  const rateLimit = await checkRateLimit(db, clientIP, 'password_reset', 3, 3600);

  if (!rateLimit.allowed) {
    const status = rateLimit.error ? 503 : 429;
    const message = rateLimit.error
      ? 'Service temporarily unavailable. Please try again in a few minutes.'
      : 'Too many attempts. Please try again later.';

    if (rateLimit.error) {
      logError('rate_limit_db_failure', {
        endpoint: 'forgot_password',
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
    const formData = await context.request.formData();
    const email = formData.get('email')?.toString().toLowerCase().trim();

    if (!email) {
      return new Response(JSON.stringify({ error: 'Email is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Always respond with success to prevent user enumeration
    const successResponse = new Response(
      JSON.stringify({
        success: true,
        message: 'If an account exists with this email, you will receive a password reset link.'
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );

    // Look up user by email
    const user = await db
      .prepare('SELECT id, email FROM users WHERE email = ?')
      .bind(email)
      .first<User>();

    // If no user found, return success anyway (prevent enumeration)
    if (!user) {
      return successResponse;
    }

    // Create password reset token
    const token = await createPasswordResetToken(db, user.id);

    // Send email
    const siteUrl = runtime.env.SITE_URL || context.url.origin;
    const emailResult = await sendPasswordResetEmail(
      runtime.env.RESEND_API_KEY,
      siteUrl,
      user.email,
      token
    );

    if (!emailResult.success) {
      console.error('Failed to send password reset email:', emailResult.error);
      // Still return success to prevent enumeration
    }

    return successResponse;
  } catch (error) {
    console.error('Forgot password error:', error);
    // Return generic error (don't reveal internal state)
    return new Response(JSON.stringify({ error: 'An error occurred. Please try again.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
