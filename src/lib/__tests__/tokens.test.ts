import { describe, it, expect } from 'vitest';
import { generateVerificationToken, generateTokenExpiry } from '../tokens';

describe('Token Generation', () => {
  describe('generateVerificationToken', () => {
    it('should generate a 64-character alphanumeric string', () => {
      const token = generateVerificationToken();
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[A-Za-z0-9]+$/);
    });

    it('should only contain alphanumeric characters (A-Z, a-z, 0-9)', () => {
      const token = generateVerificationToken();
      const validChars = /^[A-Za-z0-9]+$/;
      expect(validChars.test(token)).toBe(true);
    });

    it('should generate unique tokens', () => {
      const tokens = new Set<string>();
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        tokens.add(generateVerificationToken());
      }

      // All 100 tokens should be unique
      expect(tokens.size).toBe(iterations);
    });

    it('should be URL-safe (no special characters)', () => {
      const token = generateVerificationToken();
      // Should not contain URL-unsafe characters like +, /, =
      expect(token).not.toMatch(/[+/=]/);
    });
  });

  describe('generateTokenExpiry', () => {
    it('should return a Unix timestamp approximately 24 hours in the future', () => {
      const now = Math.floor(Date.now() / 1000);
      const expiry = generateTokenExpiry();
      const expectedExpiry = now + (24 * 60 * 60);

      // Allow 1 second tolerance for test execution time
      expect(expiry).toBeGreaterThanOrEqual(expectedExpiry - 1);
      expect(expiry).toBeLessThanOrEqual(expectedExpiry + 1);
    });

    it('should return a number', () => {
      const expiry = generateTokenExpiry();
      expect(typeof expiry).toBe('number');
    });

    it('should return an integer (no decimals)', () => {
      const expiry = generateTokenExpiry();
      expect(Number.isInteger(expiry)).toBe(true);
    });

    it('should be greater than current timestamp', () => {
      const now = Math.floor(Date.now() / 1000);
      const expiry = generateTokenExpiry();
      expect(expiry).toBeGreaterThan(now);
    });
  });
});
