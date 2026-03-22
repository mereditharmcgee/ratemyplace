import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';
import { validateDisplayName } from '../../../lib/userSettings';

export async function PATCH(context: APIContext): Promise<Response> {
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let body: { displayName?: string; notificationOptIn?: boolean };
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { displayName, notificationOptIn } = body;

  // Validate displayName if provided
  let validatedName: string | null | undefined = undefined;
  if (displayName !== undefined) {
    const nameResult = validateDisplayName(displayName);
    if (!nameResult.valid) {
      return new Response(JSON.stringify({ error: nameResult.error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    validatedName = nameResult.value;
  }

  try {
    const db = getDB((context.locals as any).runtime);
    const userId = context.locals.user.id;

    // Build the update query dynamically based on which fields were provided
    if (validatedName !== undefined && notificationOptIn !== undefined) {
      await db.prepare(
        'UPDATE users SET name = ?, notification_opt_in = ?, updated_at = unixepoch() WHERE id = ?'
      )
        .bind(validatedName, notificationOptIn ? 1 : 0, userId)
        .run();
    } else if (validatedName !== undefined) {
      await db.prepare(
        'UPDATE users SET name = ?, updated_at = unixepoch() WHERE id = ?'
      )
        .bind(validatedName, userId)
        .run();
    } else if (notificationOptIn !== undefined) {
      await db.prepare(
        'UPDATE users SET notification_opt_in = ?, updated_at = unixepoch() WHERE id = ?'
      )
        .bind(notificationOptIn ? 1 : 0, userId)
        .run();
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('Profile update error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
