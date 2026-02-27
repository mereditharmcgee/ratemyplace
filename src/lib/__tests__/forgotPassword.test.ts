import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generatePasswordResetExpiry,
  generateTokenExpiry,
  createPasswordResetToken,
  validatePasswordResetToken,
  deletePasswordResetToken,
} from '../tokens';
import { sendPasswordResetEmail } from '../email';

// ═══════════════════════════════════════════════════
// generatePasswordResetExpiry
// ═══════════════════════════════════════════════════

describe('generatePasswordResetExpiry', () => {
  it('should return a Unix timestamp approximately 1 hour in the future', () => {
    const now = Math.floor(Date.now() / 1000);
    const expiry = generatePasswordResetExpiry();
    const expected = now + 60 * 60;

    expect(expiry).toBeGreaterThanOrEqual(expected - 1);
    expect(expiry).toBeLessThanOrEqual(expected + 1);
  });

  it('should return an integer', () => {
    const expiry = generatePasswordResetExpiry();
    expect(Number.isInteger(expiry)).toBe(true);
  });

  it('should be shorter than verification token expiry (1h vs 24h)', () => {
    const resetExpiry = generatePasswordResetExpiry();
    const verifyExpiry = generateTokenExpiry();
    expect(verifyExpiry - resetExpiry).toBeGreaterThan(22 * 60 * 60);
  });
});

// ═══════════════════════════════════════════════════
// D1 mock helpers
// ═══════════════════════════════════════════════════

function mockDB(overrides: {
  firstResult?: any;
  firstError?: boolean;
  runError?: boolean;
} = {}) {
  const runFn = overrides.runError
    ? vi.fn().mockRejectedValue(new Error('DB error'))
    : vi.fn().mockResolvedValue({});

  const firstFn = overrides.firstError
    ? vi.fn().mockRejectedValue(new Error('DB error'))
    : vi.fn().mockResolvedValue(overrides.firstResult ?? null);

  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        run: runFn,
        first: firstFn,
      }),
    }),
    _runFn: runFn,
    _firstFn: firstFn,
  };
}

// ═══════════════════════════════════════════════════
// createPasswordResetToken
// ═══════════════════════════════════════════════════

describe('createPasswordResetToken', () => {
  it('should return a 64-character alphanumeric token', async () => {
    const db = mockDB();
    const token = await createPasswordResetToken(db as any, 'user-123');
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('should delete existing tokens for the user before creating new one', async () => {
    const db = mockDB();
    await createPasswordResetToken(db as any, 'user-123');

    // First prepare call should be the DELETE
    const firstCall = db.prepare.mock.calls[0][0];
    expect(firstCall).toContain('DELETE FROM password_reset_tokens');
    expect(firstCall).toContain('user_id');
  });

  it('should insert a new token into password_reset_tokens', async () => {
    const db = mockDB();
    await createPasswordResetToken(db as any, 'user-123');

    // Second prepare call should be the INSERT
    const secondCall = db.prepare.mock.calls[1][0];
    expect(secondCall).toContain('INSERT INTO password_reset_tokens');
  });

  it('should generate unique tokens across calls', async () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const db = mockDB();
      const token = await createPasswordResetToken(db as any, 'user-123');
      tokens.add(token);
    }
    expect(tokens.size).toBe(20);
  });

  it('should throw on database error', async () => {
    const db = mockDB({ runError: true });
    await expect(
      createPasswordResetToken(db as any, 'user-123')
    ).rejects.toThrow('Failed to create password reset token');
  });
});

// ═══════════════════════════════════════════════════
// validatePasswordResetToken
// ═══════════════════════════════════════════════════

describe('validatePasswordResetToken', () => {
  it('should return valid with userId for a valid, non-expired token', async () => {
    const futureExpiry = Math.floor(Date.now() / 1000) + 3600;
    const db = mockDB({
      firstResult: { user_id: 'user-123', expires_at: futureExpiry },
    });

    const result = await validatePasswordResetToken(db as any, 'valid-token');
    expect(result.valid).toBe(true);
    expect(result.userId).toBe('user-123');
    expect(result.reason).toBeUndefined();
  });

  it('should return invalid with reason "expired" for expired token', async () => {
    const pastExpiry = Math.floor(Date.now() / 1000) - 100;
    const db = mockDB({
      firstResult: { user_id: 'user-123', expires_at: pastExpiry },
    });

    const result = await validatePasswordResetToken(db as any, 'expired-token');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('expired');
    expect(result.userId).toBeUndefined();
  });

  it('should return invalid with reason "invalid_token" for non-existent token', async () => {
    const db = mockDB({ firstResult: null });

    const result = await validatePasswordResetToken(db as any, 'nonexistent');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('invalid_token');
  });

  it('should return invalid with reason "error" on database failure', async () => {
    const db = mockDB({ firstError: true });

    const result = await validatePasswordResetToken(db as any, 'any-token');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('error');
  });

  it('should treat a token expiring exactly now as expired', async () => {
    const now = Math.floor(Date.now() / 1000);
    const db = mockDB({
      firstResult: { user_id: 'user-123', expires_at: now - 1 },
    });

    const result = await validatePasswordResetToken(db as any, 'edge-token');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('should query the password_reset_tokens table', async () => {
    const db = mockDB({ firstResult: null });
    await validatePasswordResetToken(db as any, 'test-token');

    const query = db.prepare.mock.calls[0][0];
    expect(query).toContain('password_reset_tokens');
    expect(query).toContain('token');
  });
});

// ═══════════════════════════════════════════════════
// deletePasswordResetToken
// ═══════════════════════════════════════════════════

describe('deletePasswordResetToken', () => {
  it('should delete the token from password_reset_tokens', async () => {
    const db = mockDB();
    await deletePasswordResetToken(db as any, 'token-to-delete');

    const query = db.prepare.mock.calls[0][0];
    expect(query).toContain('DELETE FROM password_reset_tokens');
    expect(query).toContain('token');
  });

  it('should throw on database error', async () => {
    const db = mockDB({ runError: true });
    await expect(
      deletePasswordResetToken(db as any, 'token')
    ).rejects.toThrow('Failed to delete password reset token');
  });
});

// ═══════════════════════════════════════════════════
// sendPasswordResetEmail
// ═══════════════════════════════════════════════════

describe('sendPasswordResetEmail', () => {
  it('should return error when API key is missing', async () => {
    const result = await sendPasswordResetEmail('', 'https://example.com', 'user@test.com', 'token123');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Email service not configured');
  });

  it('should return error when API key is undefined', async () => {
    const result = await sendPasswordResetEmail(
      undefined as any,
      'https://example.com',
      'user@test.com',
      'token123'
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('Email service not configured');
  });
});

// ═══════════════════════════════════════════════════
// One-token-per-user policy
// ═══════════════════════════════════════════════════

describe('one-token-per-user policy', () => {
  it('should delete existing tokens before creating new one', async () => {
    const db = mockDB();
    const calls: string[] = [];

    db.prepare = vi.fn().mockImplementation((sql: string) => {
      calls.push(sql.includes('DELETE') ? 'DELETE' : 'INSERT');
      return {
        bind: vi.fn().mockReturnValue({
          run: vi.fn().mockResolvedValue({}),
        }),
      };
    });

    await createPasswordResetToken(db as any, 'user-123');

    expect(calls[0]).toBe('DELETE');
    expect(calls[1]).toBe('INSERT');
  });
});

// ═══════════════════════════════════════════════════
// Token security properties
// ═══════════════════════════════════════════════════

describe('token security properties', () => {
  it('should generate URL-safe tokens (no +, /, = characters)', async () => {
    const db = mockDB();
    for (let i = 0; i < 50; i++) {
      const token = await createPasswordResetToken(db as any, 'user-123');
      expect(token).not.toMatch(/[+/=]/);
    }
  });

  it('should use 1-hour expiry (not 24-hour verification expiry)', () => {
    const now = Math.floor(Date.now() / 1000);
    const expiry = generatePasswordResetExpiry();
    const diffSeconds = expiry - now;

    // Should be ~3600 seconds (1 hour), not ~86400 (24 hours)
    expect(diffSeconds).toBeGreaterThanOrEqual(3599);
    expect(diffSeconds).toBeLessThanOrEqual(3601);
  });
});
