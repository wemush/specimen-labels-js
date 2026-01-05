/**
 * WOLS Decryption Module
 *
 * Provides AES-256-GCM decryption for encrypted specimens using Web Crypto API.
 * Supports both password-based (PBKDF2) and raw CryptoKey decryption.
 *
 * @module crypto/decrypt
 */

import { WolsEncryptionError, WolsErrorCode } from '../errors.js';
import { parseSpecimen } from '../parser.js';
import type { Specimen, EncryptedSpecimen, DecryptionOptions, ParseResult } from '../types.js';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Salt for PBKDF2 key derivation (must match encrypt.ts) */
const PBKDF2_SALT = new TextEncoder().encode('@wemush/wols/crypto/v1');

/** Number of PBKDF2 iterations (must match encrypt.ts) */
const PBKDF2_ITERATIONS = 100_000;

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Convert base64url string to ArrayBuffer
 */
function fromBase64Url(base64url: string): ArrayBuffer {
  // Convert base64url to base64
  const base64 = base64url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(base64url.length + ((4 - (base64url.length % 4)) % 4), '=');

  // Decode base64 to binary string
  const binaryString = atob(base64);

  // Convert to ArrayBuffer
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return bytes.buffer;
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
    ['decrypt']
  );
}

// =============================================================================
// DECRYPTION FUNCTIONS
// =============================================================================

/**
 * Decrypt an encrypted specimen using AES-256-GCM
 *
 * @param encrypted - The encrypted specimen wrapper
 * @param options - Decryption options (key required)
 * @returns Promise resolving to ParseResult with decrypted specimen or error
 *
 * @example
 * ```typescript
 * import { decryptSpecimen } from '@wemush/wols/crypto';
 *
 * const result = await decryptSpecimen(encrypted, {
 *   key: 'my-secret-password',
 * });
 *
 * if (result.success) {
 *   console.log(result.data);
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
export async function decryptSpecimen(
  encrypted: EncryptedSpecimen,
  options: DecryptionOptions
): Promise<ParseResult<Specimen>> {
  const { key } = options;

  // Validate encrypted specimen structure
  if (!encrypted.payload) {
    return {
      success: false,
      error: new WolsEncryptionError(WolsErrorCode.DECRYPTION_ERROR, 'Missing encrypted payload', {
        path: ['payload'],
      }),
    };
  }

  if (!encrypted.iv) {
    return {
      success: false,
      error: new WolsEncryptionError(
        WolsErrorCode.DECRYPTION_ERROR,
        'Missing initialization vector (IV)',
        { path: ['iv'] }
      ),
    };
  }

  try {
    // Get or derive the decryption key
    const cryptoKey = typeof key === 'string' ? await deriveKey(key) : key;

    // Decode payload and IV from base64url
    const ciphertext = fromBase64Url(encrypted.payload);
    const ivBuffer = fromBase64Url(encrypted.iv);
    const iv = new Uint8Array(ivBuffer);

    // Decrypt
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext);

    // Decode plaintext to string
    const json = new TextDecoder().decode(plaintext);

    // Parse the decrypted JSON back into a specimen
    return parseSpecimen(json);
  } catch (error) {
    // Handle decryption errors (wrong key, tampered data, etc.)
    const errorMessage = error instanceof Error ? error.message : 'Unknown decryption error';

    return {
      success: false,
      error: new WolsEncryptionError(
        WolsErrorCode.DECRYPTION_ERROR,
        `Decryption failed: ${errorMessage}`
      ),
    };
  }
}
