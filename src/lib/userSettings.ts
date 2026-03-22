/**
 * Shared validation helpers for user settings API endpoints.
 * Pure functions — no side effects — so they can be unit tested directly.
 */

export interface ValidationResult<T = string | null> {
  valid: boolean;
  value?: T;
  error?: string;
}

/**
 * Validate and normalize a display name.
 * - Trims whitespace
 * - Empty / whitespace-only string becomes null (clears the name)
 * - Maximum 50 characters (after trim)
 */
export function validateDisplayName(raw: string): ValidationResult<string | null> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { valid: true, value: null };
  }
  if (trimmed.length > 50) {
    return { valid: false, error: 'Display name must be 50 characters or fewer' };
  }
  return { valid: true, value: trimmed };
}

/**
 * Validate a password.
 * - Minimum 8 characters
 */
export function validatePassword(password: string): ValidationResult<string> {
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters' };
  }
  return { valid: true, value: password };
}

/**
 * Validate and normalize an email address.
 * - Trims whitespace
 * - Converts to lowercase
 * - Checks format with RFC-lite regex
 */
export function validateEmail(raw: string): ValidationResult<string> {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Email is required' };
  }
  // Simple but effective email format check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    return { valid: false, error: 'Please enter a valid email address' };
  }
  return { valid: true, value: trimmed };
}
