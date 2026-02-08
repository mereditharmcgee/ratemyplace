import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../password';

// ═══════════════════════════════════════════════════
// hashPassword
// ═══════════════════════════════════════════════════

describe('hashPassword', () => {
  it('returns a string in salt$hash format', async () => {
    const hash = await hashPassword('testpassword');
    expect(hash).toContain('$');
    const parts = hash.split('$');
    expect(parts).toHaveLength(2);
    expect(parts[0].length).toBeGreaterThan(0);
    expect(parts[1].length).toBeGreaterThan(0);
  });

  it('generates different hashes for the same password (random salt)', async () => {
    const hash1 = await hashPassword('testpassword');
    const hash2 = await hashPassword('testpassword');
    expect(hash1).not.toBe(hash2);
  });

  it('generates non-empty output', async () => {
    const hash = await hashPassword('a');
    expect(hash.length).toBeGreaterThan(10);
  });
});

// ═══════════════════════════════════════════════════
// verifyPassword
// ═══════════════════════════════════════════════════

describe('verifyPassword', () => {
  it('returns true for correct password', async () => {
    const hash = await hashPassword('mypassword123');
    const result = await verifyPassword('mypassword123', hash);
    expect(result).toBe(true);
  });

  it('returns false for wrong password', async () => {
    const hash = await hashPassword('mypassword123');
    const result = await verifyPassword('wrongpassword', hash);
    expect(result).toBe(false);
  });

  it('returns false for malformed hash (no $ separator)', async () => {
    const result = await verifyPassword('test', 'nothinghere');
    expect(result).toBe(false);
  });

  it('handles empty password', async () => {
    const hash = await hashPassword('');
    const result = await verifyPassword('', hash);
    expect(result).toBe(true);
  });

  it('handles long passwords', async () => {
    const longPass = 'a'.repeat(1000);
    const hash = await hashPassword(longPass);
    const result = await verifyPassword(longPass, hash);
    expect(result).toBe(true);
  });

  it('handles special characters in password', async () => {
    const specialPass = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`"\'\\';
    const hash = await hashPassword(specialPass);
    const result = await verifyPassword(specialPass, hash);
    expect(result).toBe(true);
  });
});
