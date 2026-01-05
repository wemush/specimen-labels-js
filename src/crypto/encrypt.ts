/**
 * WOLS Encryption Module
 *
 * Provides AES-256-GCM encryption for specimens using Web Crypto API.
 * Supports both password-based (PBKDF2) and raw CryptoKey encryption.
 *
 * @module crypto/encrypt
 */

import { serializeSpecimen } from '../specimen.js';
import type { Specimen, EncryptedSpecimen, EncryptionOptions } from '../types.js';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Salt for PBKDF2 key derivation (fixed for deterministic key from same password) */
const PBKDF2_SALT = new TextEncoder().encode('@wemush/wols/crypto/v1');

/** Number of PBKDF2 iterations */
const PBKDF2_ITERATIONS = 100_000;

/** IV length in bytes (96 bits = 12 bytes recommended for GCM) */
const IV_LENGTH = 12;

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Convert ArrayBuffer to base64url string
 */
function toBase64Url(buffer: ArrayBuffer | ArrayBufferLike): string {
  const bytes = new Uint8Array(buffer as ArrayBuffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Derive a CryptoKey from a password using PBKDF2
 */
async function deriveKey(password: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);

  // Import password as key material
  const keyMaterial = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, [
    'deriveKey',
  ]);

  // Derive AES-256-GCM key
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: PBKDF2_SALT,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
}

/**
 * Generate a random initialization vector
 */
function generateIV(): { iv: Uint8Array<ArrayBuffer>; ivBuffer: ArrayBuffer } {
  const buffer = new ArrayBuffer(IV_LENGTH);
  const iv = new Uint8Array(buffer);
  crypto.getRandomValues(iv);
  return { iv, ivBuffer: buffer };
}

// =============================================================================
// ENCRYPTION FUNCTIONS
// =============================================================================

/**
 * Encrypt a specimen using AES-256-GCM
 *
 * @param specimen - The specimen to encrypt
 * @param options - Encryption options (key required)
 * @returns Promise resolving to encrypted specimen wrapper
 *
 * @example
 * ```typescript
 * import { encryptSpecimen } from '@wemush/wols/crypto';
 *
 * const encrypted = await encryptSpecimen(specimen, {
 *   key: 'my-secret-password',
 * });
 * // Returns: { encrypted: true, payload: "...", iv: "...", algorithm: "AES-256-GCM" }
 * ```
 */
export async function encryptSpecimen(
  specimen: Specimen,
  options: EncryptionOptions
): Promise<EncryptedSpecimen> {
  const { key, fields } = options;

  // If partial encryption requested, handle separately
  if (fields !== undefined && fields.length > 0) {
    return encryptPartial(specimen, options);
  }

  // Get or derive the encryption key
  const cryptoKey = typeof key === 'string' ? await deriveKey(key) : key;

  // Serialize the specimen to JSON
  const plaintext = serializeSpecimen(specimen);
  const plaintextBytes = new TextEncoder().encode(plaintext);

  // Generate random IV
  const { iv, ivBuffer } = generateIV();

  // Encrypt
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    plaintextBytes
  );

  // Return encrypted specimen
  return {
    encrypted: true,
    payload: toBase64Url(ciphertext),
    iv: toBase64Url(ivBuffer),
    algorithm: 'AES-256-GCM',
  };
}

/**
 * Encrypt only specific fields of a specimen
 *
 * Returns a specimen-like object with specified fields encrypted.
 */
async function encryptPartial(
  specimen: Specimen,
  options: EncryptionOptions
): Promise<EncryptedSpecimen> {
  const { key, fields = [] } = options;

  // Get or derive the encryption key
  const cryptoKey = typeof key === 'string' ? await deriveKey(key) : key;

  // Clone the specimen
  const result = { ...specimen } as Record<string, unknown>;

  // Encrypt each specified field
  for (const field of fields) {
    const value = result[field];
    if (value !== undefined) {
      const plaintext = JSON.stringify(value);
      const plaintextBytes = new TextEncoder().encode(plaintext);
      const { iv, ivBuffer } = generateIV();

      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        plaintextBytes
      );

      result[field] = {
        encrypted: true,
        payload: toBase64Url(ciphertext),
        iv: toBase64Url(ivBuffer),
        algorithm: 'AES-256-GCM',
      };
    }
  }

  // Cast to EncryptedSpecimen for return type consistency
  // In partial mode, this is actually a hybrid object
  return result as unknown as EncryptedSpecimen;
}

/**
 * Type guard to check if an object is an encrypted specimen
 */
export function isEncrypted(value: unknown): value is EncryptedSpecimen {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value !== 'object') {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return obj['encrypted'] === true;
}
