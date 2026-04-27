import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';
import { hashPassword, verifyPassword } from '../../../lib/password';
import { initializeLucia } from '../../../lib/auth';
import { validatePassword } from '../../../lib/userSettings';

export async function PATCH(context: APIContext): Promise<Response> {
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { currentPassword, newPassword } = body;

  if (!newPassword) {
    return new Response(JSON.stringify({ error: 'New password is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Validate new password strength
  const passwordResult = validatePassword(newPassword);
  if (!passwordResult.valid) {
    return new Response(JSON.stringify({ error: passwordResult.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB(context);
    const userId = context.locals.user.id;

    const dbUser = await db.prepare(
      'SELECT hashed_password, google_id FROM users WHERE id = ?'
    )
      .bind(userId)
      .first<{ hashed_password: string | null; google_id: string | null }>();

    if (!dbUser) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const isOAuthOnly = dbUser.google_id !== null && dbUser.hashed_password === null;

    if (isOAuthOnly) {
      // Set password flow for OAuth users — no current password required
      const newHash = await hashPassword(newPassword);
      await db.prepare(
        'UPDATE users SET hashed_password = ?, updated_at = unixepoch() WHERE id = ?'
      )
        .bind(newHash, userId)
        .run();

      return new Response(JSON.stringify({ success: true, message: 'Password set successfully' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (dbUser.hashed_password !== null) {
      // Change password flow — require current password
      if (!currentPassword) {
        return new Response(JSON.stringify({ error: 'Current password is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const isValid = await verifyPassword(currentPassword, dbUser.hashed_password);
      if (!isValid) {
        return new Response(JSON.stringify({ error: 'Current password is incorrect' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const newHash = await hashPassword(newPassword);
      await db.prepare(
        'UPDATE users SET hashed_password = ?, updated_at = unixepoch() WHERE id = ?'
      )
        .bind(newHash, userId)
        .run();

      // Invalidate all sessions so user must sign in with new password
      const lucia = initializeLucia(db as any);
      await lucia.invalidateUserSessions(userId);

      return new Response(
        JSON.stringify({ success: true, message: 'Password changed. Please sign in again.' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Unexpected state: no password and no google_id
    return new Response(JSON.stringify({ error: 'Cannot update password for this account' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('Password update error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
