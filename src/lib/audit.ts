/**
 * Audit logging helper for admin actions
 * Stores immutable audit trail in database
 */

export interface AuditLogEntry {
  adminUserId: string;
  adminIp: string;
  actionType: string;
  entityType: 'review' | 'dispute' | 'landlord' | 'building' | 'user';
  entityId: string;
  oldValue?: Record<string, any>;
  newValue?: Record<string, any>;
  notes?: string;
}

/**
 * Create an audit log entry for an admin action
 * Best-effort: logs error but doesn't throw to avoid breaking admin actions
 */
export async function createAuditLog(
  db: any,
  entry: AuditLogEntry
): Promise<void> {
  try {
    await db.prepare(`
      INSERT INTO audit_logs (
        admin_user_id, admin_ip, action_type, entity_type, entity_id,
        old_value, new_value, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      entry.adminUserId,
      entry.adminIp,
      entry.actionType,
      entry.entityType,
      entry.entityId,
      entry.oldValue ? JSON.stringify(entry.oldValue) : null,
      entry.newValue ? JSON.stringify(entry.newValue) : null,
      entry.notes || null
    ).run();
  } catch (error) {
    // Best-effort logging - don't fail the admin action if audit fails
    console.error('Failed to create audit log:', error);
  }
}
