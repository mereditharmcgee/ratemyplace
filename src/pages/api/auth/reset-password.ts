import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';
import { validatePasswordResetToken, deletePasswordResetToken } from '../../../lib/tokens';
import { hashPassword } from '../../../lib/password';

export async function POST(context: APIContext): Promise<Response> {
  const runtime = (context.locals as any).runtime;
  const db = getDB(runtime);

  try {
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

    // Validate token
    const tokenResult = await validatePasswordResetToken(db, token);

    if (!tokenResult.valid) {
      const errorMessage = tokenResult.reason === 'expired'
        ? 'This password reset link has expired. Please request a new one.'
        : 'Invalid password reset link. Please request a new one.';

      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Hash new password
    const passwordHash = await hashPassword(password);

    // Update user's password
    await db
      .prepare('UPDATE users SET hashed_password = ? WHERE id = ?')
      .bind(passwordHash, tokenResult.userId)
      .run();

    // Delete the token (single-use)
    await deletePasswordResetToken(db, token);

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
