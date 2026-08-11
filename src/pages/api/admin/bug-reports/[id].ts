import type { APIContext } from 'astro';
import { getDB } from '../../../../lib/db';
import { createAuditLog } from '../../../../lib/audit';
import { getClientIP } from '../../../../lib/rateLimit';

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

    const db = getDB(context);

    // Existence check — without it, a PATCH to a nonexistent id updates 0 rows but
    // returns success, and the client optimistically shows a change that never
    // persisted.
    const existing = await db.prepare('SELECT id FROM bug_reports WHERE id = ?').bind(id).first();
    if (!existing) {
      return new Response(JSON.stringify({ error: 'Bug report not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

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

    await createAuditLog(db, {
      adminUserId: context.locals.user.id,
      adminIp: getClientIP(context),
      actionType: 'bug_report_updated',
      entityType: 'bug_report',
      entityId: id,
      newValue: { status: status || undefined },
    });

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
