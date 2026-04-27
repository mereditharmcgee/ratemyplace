import type { APIContext } from 'astro';
import { initializeLucia } from '../../../lib/auth';
import { getDB } from '../../../lib/db';
import { getEnv } from '../../../lib/runtime';
import { hashPassword } from '../../../lib/password';
import { generateIdFromEntropySize } from 'lucia';
import { checkRateLimit, getClientIP } from '../../../lib/rateLimit';
import { createVerificationToken } from '../../../lib/tokens';
import { sendVerificationEmail } from '../../../lib/email';
import { logError } from '../../../lib/logger';
import { verifyTurnstile } from '../../../lib/turnstile';

export async function POST(context: APIContext): Promise<Response> {
  const formData = await context.request.formData();
  const email = formData.get('email');
  const password = formData.get('password');
  const confirmPassword = formData.get('confirmPassword');

  if (typeof email !== 'string' || typeof password !== 'string') {
    return new Response(JSON.stringify({ error: 'Invalid input' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (email.length < 3 || email.length > 255 || !email.includes('@')) {
    return new Response(JSON.stringify({ error: 'Invalid email address' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (password.length < 8 || password.length > 255) {
    return new Response(JSON.stringify({ error: 'Password must be at least 8 characters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (password !== confirmPassword) {
    return new Response(JSON.stringify({ error: 'Passwords do not match' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Verify Turnstile token
  const turnstileToken = formData.get('cf-turnstile-response') as string;
  const turnstileResult = await verifyTurnstile(
    turnstileToken,
    getEnv(context).TURNSTILE_SECRET_KEY,
    getClientIP(context)
  );
  if (!turnstileResult.success) {
    return new Response(JSON.stringify({ error: turnstileResult.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB(context);

    // Rate limiting: 3 accounts per hour per IP
    const clientIP = getClientIP(context);
    const rateLimit = await checkRateLimit(db, clientIP, 'signup', 3, 3600);

    if (!rateLimit.allowed) {
      const status = rateLimit.error ? 503 : 429;
      const message = rateLimit.error
        ? 'Service temporarily unavailable. Please try again in a few minutes.'
        : 'Too many attempts. Please try again later.';

      if (rateLimit.error) {
        logError('rate_limit_db_failure', {
          endpoint: 'signup',
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

    const lucia = initializeLucia(db);

    // Check if user already exists
    const existingUser = await db.prepare(
      'SELECT id FROM users WHERE email = ?'
    ).bind(email.toLowerCase()).first();

    if (existingUser) {
      return new Response(JSON.stringify({ error: 'Email already registered' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const userId = generateIdFromEntropySize(10);
    const hashedPassword = await hashPassword(password);

    await db.prepare(
      'INSERT INTO users (id, email, hashed_password) VALUES (?, ?, ?)'
    ).bind(userId, email.toLowerCase(), hashedPassword).run();

    // Create verification token and send email
    try {
      const token = await createVerificationToken(db, userId);
      const siteUrl = getEnv(context).SITE_URL || context.url.origin;
      const emailResult = await sendVerificationEmail(
        getEnv(context).RESEND_API_KEY,
        siteUrl,
        email.toLowerCase(),
        token
      );

      if (!emailResult.success) {
        // Log but don't fail signup - user can request new email later
        console.error('Verification email failed:', emailResult.error);
      }
    } catch (emailError) {
      // Log but don't fail signup
      console.error('Verification email error:', emailError);
    }

    const session = await lucia.createSession(userId, {});
    const sessionCookie = lucia.createSessionCookie(session.id);

    context.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Sign up error:', error);
    return new Response(JSON.stringify({ error: 'An error occurred' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
