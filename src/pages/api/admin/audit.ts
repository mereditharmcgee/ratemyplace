import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';

interface AuditLogRow {
  id: number;
  created_at: number;
  admin_user_id: string;
  admin_ip: string;
  action_type: string;
  entity_type: string;
  entity_id: string;
  old_value: string | null;
  new_value: string | null;
  notes: string | null;
  admin_email?: string;
}

export async function GET(context: APIContext): Promise<Response> {
  // Require authentication
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Require admin
  if (!context.locals.user.isAdmin) {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const url = new URL(context.request.url);
    const actionFilter = url.searchParams.get('action') || 'all';
    const adminFilter = url.searchParams.get('admin') || 'all';
    const startDate = url.searchParams.get('start'); // Unix timestamp
    const endDate = url.searchParams.get('end');     // Unix timestamp
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const limit = 50; // Within 25-50 range per CONTEXT.md
    const offset = (page - 1) * limit;

    const db = getDB((context.locals as any).runtime);

    // Build WHERE clause dynamically
    const conditions: string[] = ['1=1'];
    const params: any[] = [];

    if (actionFilter !== 'all') {
      conditions.push('a.action_type = ?');
      params.push(actionFilter);
    }

    if (adminFilter !== 'all') {
      conditions.push('a.admin_user_id = ?');
      params.push(adminFilter);
    }

    if (startDate) {
      conditions.push('a.created_at >= ?');
      params.push(parseInt(startDate, 10));
    }

    if (endDate) {
      conditions.push('a.created_at <= ?');
      params.push(parseInt(endDate, 10));
    }

    const whereClause = conditions.join(' AND ');

    // Query with admin email join
    const logs = await db.prepare(`
      SELECT
        a.*,
        u.email as admin_email
      FROM audit_logs a
      LEFT JOIN users u ON a.admin_user_id = u.id
      WHERE ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();

    // Get total count for pagination
    const countResult = await db.prepare(`
      SELECT COUNT(*) as count
      FROM audit_logs a
      WHERE ${whereClause}
    `).bind(...params).first<{ count: number }>();

    const total = countResult?.count || 0;

    // Get unique action types for filter dropdown
    const actionTypes = await db.prepare(`
      SELECT DISTINCT action_type FROM audit_logs ORDER BY action_type
    `).all();

    // Get unique admin users for filter dropdown
    const adminUsers = await db.prepare(`
      SELECT DISTINCT a.admin_user_id, u.email
      FROM audit_logs a
      LEFT JOIN users u ON a.admin_user_id = u.id
      ORDER BY u.email
    `).all();

    return new Response(JSON.stringify({
      logs: logs.results || [],
      total,
      page,
      pages: Math.ceil(total / limit),
      filters: {
        actionTypes: (actionTypes.results || []).map((r: any) => r.action_type),
        adminUsers: (adminUsers.results || []).map((r: any) => ({
          id: r.admin_user_id,
          email: r.email
        }))
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch audit logs' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
