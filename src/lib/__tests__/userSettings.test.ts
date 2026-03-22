import { describe, it, expect } from 'vitest';
import {
  validateDisplayName,
  validatePassword,
  validateEmail,
} from '../userSettings';

describe('validateDisplayName', () => {
  it('trims whitespace from display name', () => {
    const result = validateDisplayName('  Alice  ');
    expect(result.valid).toBe(true);
    expect(result.value).toBe('Alice');
  });

  it('converts an empty string to null', () => {
    const result = validateDisplayName('');
    expect(result.valid).toBe(true);
    expect(result.value).toBe(null);
  });

  it('converts a whitespace-only string to null', () => {
    const result = validateDisplayName('   ');
    expect(result.valid).toBe(true);
    expect(result.value).toBe(null);
  });

  it('rejects a display name longer than 50 characters', () => {
    const longName = 'a'.repeat(51);
    const result = validateDisplayName(longName);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('accepts a display name of exactly 50 characters', () => {
    const name = 'a'.repeat(50);
    const result = validateDisplayName(name);
    expect(result.valid).toBe(true);
    expect(result.value).toBe(name);
  });
});

describe('validatePassword', () => {
  it('rejects passwords shorter than 8 characters', () => {
    const result = validatePassword('abc123');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('accepts passwords of exactly 8 characters', () => {
    const result = validatePassword('abcd1234');
    expect(result.valid).toBe(true);
  });

  it('accepts passwords longer than 8 characters', () => {
    const result = validatePassword('a_very_long_secure_password!');
    expect(result.valid).toBe(true);
  });

  it('rejects an empty password', () => {
    const result = validatePassword('');
    expect(result.valid).toBe(false);
  });
});

describe('validateEmail', () => {
  it('accepts a valid email address', () => {
    const result = validateEmail('user@example.com');
    expect(result.valid).toBe(true);
    expect(result.value).toBe('user@example.com');
  });

  it('trims whitespace from email', () => {
    const result = validateEmail('  user@example.com  ');
    expect(result.valid).toBe(true);
    expect(result.value).toBe('user@example.com');
  });

  it('lowercases the email', () => {
    const result = validateEmail('User@Example.COM');
    expect(result.valid).toBe(true);
    expect(result.value).toBe('user@example.com');
  });

  it('rejects an email missing the @ symbol', () => {
    const result = validateEmail('notanemail');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects an email missing a domain', () => {
    const result = validateEmail('user@');
    expect(result.valid).toBe(false);
  });

  it('rejects an empty string', () => {
    const result = validateEmail('');
    expect(result.valid).toBe(false);
  });
});
