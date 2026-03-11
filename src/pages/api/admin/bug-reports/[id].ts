import type { APIContext } from 'astro';
import { getDB } from '../../../../lib/db';

export async function PATCH(context: APIContext): Promise<Response> {
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!context.locals.user.isAdmin) {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const id = context.params.id;
  if (!id) {
    return new Response(JSON.stringify({ error: 'Bug report ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await context.request.json();
    const { status, admin_notes } = body;

    const validStatuses = ['new', 'in_progress', 'resolved', 'wont_fix'];
    if (status && !validStatuses.includes(status)) {
      return new Response(JSON.stringify({ error: 'Invalid status' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const db = getDB((context.locals as any).runtime);

    const resolvedAt = (status === 'resolved' || status === 'wont_fix') ? 'unixepoch()' : 'NULL';

    await db.prepare(`
      UPDATE bug_reports
      SET status = COALESCE(?, status),
          admin_notes = COALESCE(?, admin_notes),
          resolved_at = CASE WHEN ? IN ('resolved', 'wont_fix') THEN unixepoch() ELSE resolved_at END
      WHERE id = ?
    `).bind(
      status || null,
      admin_notes !== undefined ? admin_notes : null,
      status || '',
      id
    ).run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Failed to update bug report:', error);
    return new Response(JSON.stringify({ error: 'Failed to update bug report' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
