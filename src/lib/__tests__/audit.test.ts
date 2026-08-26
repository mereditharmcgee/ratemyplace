import { describe, it, expect, vi } from 'vitest';
import { createAuditLog, type AuditLogEntry } from '../audit';

function mockDB(shouldError: boolean = false) {
  const runFn = shouldError
    ? vi.fn().mockRejectedValue(new Error('DB error'))
    : vi.fn().mockResolvedValue({});

  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        run: runFn,
      }),
    }),
    _runFn: runFn,
  };
}

describe('createAuditLog', () => {
  it('inserts audit log entry into database', async () => {
    const db = mockDB();
    const entry: AuditLogEntry = {
      adminUserId: 'admin-123',
      adminIp: '1.2.3.4',
      actionType: 'review_approved',
      entityType: 'review',
      entityId: 'review-456',
      oldValue: { status: 'pending' },
      newValue: { status: 'approved' },
      notes: 'Looks good',
    };

    await createAuditLog(db, entry);

    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO audit_logs'));
  });

  it('handles missing optional fields', async () => {
    const db = mockDB();
    const entry: AuditLogEntry = {
      adminUserId: 'admin-123',
      adminIp: '1.2.3.4',
      actionType: 'review_deleted',
      entityType: 'review',
      entityId: 'review-789',
    };

    await createAuditLog(db, entry);

    expect(db.prepare).toHaveBeenCalled();
  });

  it('does not throw on database error (best-effort)', async () => {
    const db = mockDB(true);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const entry: AuditLogEntry = {
      adminUserId: 'admin-123',
      adminIp: '1.2.3.4',
      actionType: 'review_approved',
      entityType: 'review',
      entityId: 'review-456',
    };

    // Should not throw
    await expect(createAuditLog(db, entry)).resolves.toBeUndefined();

    // Should log the failure structurally, naming the action that was dropped.
    // A CHECK-constraint violation here silently loses an audit row while the
    // admin action still succeeds (that is how admin_granted / verification_*
    // went unlogged between migrations 0014 and 0028), so the log must carry
    // enough to identify the gap without a repro.
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({
      level: 'error',
      event: 'audit_log_write_failed',
      actionType: 'review_approved',
      entityType: 'review',
      entityId: 'review-456',
      error: 'DB error',
    });

    consoleSpy.mockRestore();
  });
});
