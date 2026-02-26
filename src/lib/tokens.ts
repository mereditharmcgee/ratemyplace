import { generateIdFromEntropySize } from 'lucia';
import type { D1Database } from '@cloudflare/workers-types';

/**
 * Generates a cryptographically secure 64-character alphanumeric token
 * for email verification.
 *
 * Uses Web Crypto API (Cloudflare Workers compatible).
 * Alphabet: A-Z, a-z, 0-9 (62 characters)
 */
export function generateVerificationToken(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const tokenLength = 64;

  // Generate random bytes
  const randomBytes = crypto.getRandomValues(new Uint8Array(tokenLength));

  // Map bytes to alphabet characters
  let token = '';
  for (let i = 0; i < tokenLength; i++) {
    token += alphabet[randomBytes[i] % alphabet.length];
  }

  return token;
}

/**
 * Generates a Unix timestamp 24 hours from now.
 * Used for setting token expiration.
 */
export function generateTokenExpiry(): number {
  return Math.floor(Date.now() / 1000) + (24 * 60 * 60);
}

/**
 * Creates a verification token for a user.
 * Deletes any existing tokens for this user (one active token per user policy).
 *
 * @param db - D1 database instance
 * @param userId - User ID to associate token with
 * @returns The generated token string (to be sent via email)
 */
export async function createVerificationToken(
  db: D1Database,
  userId: string
): Promise<string> {
  try {
    const token = generateVerificationToken();
    const id = generateIdFromEntropySize(10);
    const expiresAt = generateTokenExpiry();

    // Delete any existing tokens for this user (one active token per user)
    await db
      .prepare('DELETE FROM verification_tokens WHERE user_id = ?')
      .bind(userId)
      .run();

    // Insert new token
    await db
      .prepare(
        'INSERT INTO verification_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)'
      )
      .bind(id, userId, token, expiresAt)
      .run();

    return token;
  } catch (error) {
    console.error('Error creating verification token:', error);
    throw new Error('Failed to create verification token');
  }
}

/**
 * Validates a verification token.
 * Checks if token exists and is not expired.
 * Does NOT delete the token (caller should delete after marking email verified).
 *
 * @param db - D1 database instance
 * @param token - Token string to validate
 * @returns Validation result with userId if valid
 */
export async function validateVerificationToken(
  db: D1Database,
  token: string
): Promise<{ valid: boolean; userId?: string; reason?: string }> {
  try {
    const result = await db
      .prepare('SELECT user_id, expires_at FROM verification_tokens WHERE token = ?')
      .bind(token)
      .first<{ user_id: string; expires_at: number }>();

    if (!result) {
      return { valid: false, reason: 'invalid_token' };
    }

    const now = Math.floor(Date.now() / 1000);
    if (result.expires_at < now) {
      return { valid: false, reason: 'expired' };
    }

    return { valid: true, userId: result.user_id };
  } catch (error) {
    console.error('Error validating verification token:', error);
    return { valid: false, reason: 'error' };
  }
}

/**
 * Deletes a verification token from the database.
 * Called after successful email verification.
 *
 * @param db - D1 database instance
 * @param token - Token string to delete
 */
export async function deleteVerificationToken(
  db: D1Database,
  token: string
): Promise<void> {
  try {
    await db
      .prepare('DELETE FROM verification_tokens WHERE token = ?')
      .bind(token)
      .run();
  } catch (error) {
    console.error('Error deleting verification token:', error);
    throw new Error('Failed to delete verification token');
  }
}
