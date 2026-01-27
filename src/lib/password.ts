import { encodeHexLowerCase, encodeBase64, decodeBase64 } from '@oslojs/encoding';
import { sha256 } from '@oslojs/crypto/sha2';

// PBKDF2-SHA256 parameters
const PBKDF2_ITERATIONS = 100000; // High iteration count for security
const SALT_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits

/**
 * Hash a password using PBKDF2-SHA256 with a random salt.
 * Returns the salt and hash concatenated in format: salt$hash
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const passwordData = encoder.encode(password);

  // Generate a random salt
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));

  // Import password as a key
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    passwordData,
    'PBKDF2',
    false,
    ['deriveBits']
  );

  // Derive key using PBKDF2
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    KEY_LENGTH * 8
  );

  const hashArray = new Uint8Array(derivedBits);

  // Return salt$hash (both base64 encoded)
  return `${encodeBase64(salt)}$${encodeBase64(hashArray)}`;
}

/**
 * Verify a password against a stored hash.
 * The hash should be in format: salt$hash (both base64 encoded)
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  // Handle legacy SHA-256 hashes (hex, 64 chars, no $)
  if (!storedHash.includes('$') && /^[0-9a-f]{64}$/.test(storedHash)) {
    // Legacy verification for migration
    const legacyHash = await legacyHashPassword(password);
    return legacyHash === storedHash;
  }

  const encoder = new TextEncoder();
  const passwordData = encoder.encode(password);

  const [saltBase64, hashBase64] = storedHash.split('$');
  if (!saltBase64 || !hashBase64) {
    return false;
  }

  const salt = decodeBase64(saltBase64);
  const storedHashBytes = decodeBase64(hashBase64);

  // Import password as a key
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    passwordData,
    'PBKDF2',
    false,
    ['deriveBits']
  );

  // Derive key using PBKDF2
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    KEY_LENGTH * 8
  );

  const derivedHash = new Uint8Array(derivedBits);

  // Constant-time comparison
  if (derivedHash.length !== storedHashBytes.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < derivedHash.length; i++) {
    result |= derivedHash[i] ^ storedHashBytes[i];
  }
  return result === 0;
}

/**
 * Legacy SHA-256 hash for backward compatibility during migration.
 * @deprecated Use hashPassword instead
 */
async function legacyHashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = sha256(data);
  return encodeHexLowerCase(hash);
}
