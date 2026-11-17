/**
 * Audit logging helper for admin actions
 * Stores immutable audit trail in database
 */

import { logError } from './logger';

export interface AuditLogEntry {
  adminUserId: string;
  adminIp: string;
  actionType: string;
  entityType: 'review' | 'dispute' | 'landlord' | 'building' | 'user' | 'manager' | 'verification' | 'bug_report';
  entityId: string;
  oldValue?: Record<string, any>;
  newValue?: Record<string, any>;
  notes?: string;
}

/**
 * Write an audit log entry and report whether it landed. Never throws: a failure is logged
 * as `audit_log_write_failed` and comes back as false.
 *
 * Use this directly only where the action must not happen without its entry: an admin
 * opening a proof-of-address document fails closed on false. Everything else calls
 * createAuditLog, which ignores the result.
 */
export async function tryCreateAuditLog(
  db: any,
  entry: AuditLogEntry
): Promise<boolean> {
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
    return true;
  } catch (error) {
    // Log structurally, not via console.error. A CHECK-constraint violation here
    // (action_type or entity_type not in the allowed list) is indistinguishable
    // from a transient DB error at the call site, and silently drops the audit
    // row while the admin action still succeeds. That is exactly how
    // admin_granted / admin_revoked / verification_* / manager_* went unlogged
    // between migration 0014 and 0028. Include the action and entity so the gap
    // is greppable in Cloudflare logs the next time it happens.
    logError('audit_log_write_failed', {
      actionType: entry.actionType,
      entityType: entry.entityType,
      entityId: entry.entityId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Create an audit log entry for an admin action
 * Best-effort: logs error but doesn't throw to avoid breaking admin actions
 */
export async function createAuditLog(
  db: any,
  entry: AuditLogEntry
): Promise<void> {
  // Best-effort logging - don't fail the admin action if audit fails.
  await tryCreateAuditLog(db, entry);
}
