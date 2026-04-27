import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';
import { verifyPassword } from '../../../lib/password';
import { validateEmail } from '../../../lib/userSettings';

export async function PATCH(context: APIContext): Promise<Response> {
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let body: { currentPassword?: string; newEmail?: string };
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { currentPassword, newEmail } = body;

  if (!newEmail) {
    return new Response(JSON.stringify({ error: 'New email is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Validate email format
  const emailResult = validateEmail(newEmail);
  if (!emailResult.valid) {
    return new Response(JSON.stringify({ error: emailResult.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  const normalizedEmail = emailResult.value!;

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

    // Block Google OAuth users from changing email
    if (dbUser.google_id !== null) {
      return new Response(
        JSON.stringify({ error: 'Email changes are managed through your Google account.' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Unexpected state: no hashed password and no google_id
    if (dbUser.hashed_password === null) {
      return new Response(JSON.stringify({ error: 'Cannot update email for this account' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Require current password for email changes
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

    // Check email uniqueness
    const existing = await db.prepare(
      'SELECT id FROM users WHERE email = ? AND id != ?'
    )
      .bind(normalizedEmail, userId)
      .first<{ id: string }>();

    if (existing) {
      return new Response(JSON.stringify({ error: 'This email is already in use' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Update email and reset verification status
    await db.prepare(
      'UPDATE users SET email = ?, email_verified = 0, updated_at = unixepoch() WHERE id = ?'
    )
      .bind(normalizedEmail, userId)
      .run();

    return new Response(
      JSON.stringify({ success: true, message: 'Email updated. Please verify your new email address.' }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (err) {
    console.error('Email update error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
