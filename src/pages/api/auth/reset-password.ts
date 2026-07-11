import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';
import { hashPassword } from '../../../lib/password';
import { initializeLucia } from '../../../lib/auth';
import { checkRateLimit, getClientIP, buildRateLimitHeaders } from '../../../lib/rateLimit';

export async function POST(context: APIContext): Promise<Response> {
  const db = getDB(context);

  try {
    // Rate limit: 5 reset attempts per hour per IP (defense-in-depth on top of
    // the high-entropy single-use token).
    const rateLimit = await checkRateLimit(db, getClientIP(context), 'reset-password', 5, 3600);
    if (!rateLimit.allowed) {
      const status = rateLimit.error ? 503 : 429;
      const message = rateLimit.error
        ? 'Service temporarily unavailable. Please try again in a few minutes.'
        : 'Too many attempts. Please try again later.';
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json', ...buildRateLimitHeaders(rateLimit, 5) }
      });
    }

    const formData = await context.request.formData();
    const token = formData.get('token')?.toString();
    const password = formData.get('password')?.toString();
    const confirmPassword = formData.get('confirmPassword')?.toString();

    // Validate input
    if (!token) {
      return new Response(JSON.stringify({ error: 'Invalid reset link' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!password || password.length < 8) {
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

    // Look up the token to get user_id
    const now = Math.floor(Date.now() / 1000);
    const tokenRecord = await db
      .prepare('SELECT user_id, expires_at FROM password_reset_tokens WHERE token = ?')
      .bind(token)
      .first<{ user_id: string; expires_at: number }>();

    if (!tokenRecord) {
      return new Response(JSON.stringify({ error: 'Invalid password reset link. Please request a new one.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (tokenRecord.expires_at < now) {
      return new Response(JSON.stringify({ error: 'This password reset link has expired. Please request a new one.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Atomically consume the token — prevents race condition where token is used twice
    const deleteResult = await db
      .prepare('DELETE FROM password_reset_tokens WHERE token = ? AND expires_at > ?')
      .bind(token, now)
      .run();

    if (!deleteResult.meta.changes || deleteResult.meta.changes === 0) {
      // Token was already consumed by a concurrent request
      return new Response(JSON.stringify({ error: 'This reset link has already been used. Please request a new one.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Hash new password
    const passwordHash = await hashPassword(password);

    // Update user's password
    await db
      .prepare('UPDATE users SET hashed_password = ? WHERE id = ?')
      .bind(passwordHash, tokenRecord.user_id)
      .run();

    // Invalidate all existing sessions for this user
    const lucia = initializeLucia(db);
    await lucia.invalidateUserSessions(tokenRecord.user_id);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Password reset successfully. You can now sign in with your new password.'
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Reset password error:', error);
    return new Response(JSON.stringify({ error: 'An error occurred. Please try again.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
