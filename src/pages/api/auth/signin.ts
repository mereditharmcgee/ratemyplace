import type { APIContext } from 'astro';
import { initializeLucia } from '../../../lib/auth';
import { getDB } from '../../../lib/db';
import { verifyPassword } from '../../../lib/password';
import { checkRateLimit, getClientIP } from '../../../lib/rateLimit';
import { logError } from '../../../lib/logger';

export async function POST(context: APIContext): Promise<Response> {
  const formData = await context.request.formData();
  const email = formData.get('email');
  const password = formData.get('password');

  if (typeof email !== 'string' || typeof password !== 'string') {
    return new Response(JSON.stringify({ error: 'Invalid input' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (email.length < 3 || email.length > 255 || !email.includes('@')) {
    return new Response(JSON.stringify({ error: 'Invalid email' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (password.length < 6 || password.length > 255) {
    return new Response(JSON.stringify({ error: 'Invalid password' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB((context.locals as any).runtime);

    // Rate limiting: 5 attempts per 15 minutes per IP
    const clientIP = getClientIP(context);
    const rateLimit = await checkRateLimit(db, clientIP, 'signin', 5, 900);

    if (!rateLimit.allowed) {
      const status = rateLimit.error ? 503 : 429;
      const message = rateLimit.error
        ? 'Service temporarily unavailable. Please try again in a few minutes.'
        : 'Too many attempts. Please try again later.';

      if (rateLimit.error) {
        logError('rate_limit_db_failure', {
          endpoint: 'signin',
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

    const result = await db.prepare(
      'SELECT id, hashed_password FROM users WHERE email = ?'
    ).bind(email.toLowerCase()).first<{ id: string; hashed_password: string | null }>();

    if (!result) {
      return new Response(JSON.stringify({ error: 'Invalid email or password' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // OAuth-only users have no password — they must sign in via Google
    if (!result.hashed_password) {
      return new Response(JSON.stringify({ error: 'This account uses Google sign-in. Please sign in with Google.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const validPassword = await verifyPassword(password, result.hashed_password);
    if (!validPassword) {
      return new Response(JSON.stringify({ error: 'Invalid email or password' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const session = await lucia.createSession(result.id, {});
    const sessionCookie = lucia.createSessionCookie(session.id);

    context.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Sign in error:', error);
    return new Response(JSON.stringify({ error: 'An error occurred' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
