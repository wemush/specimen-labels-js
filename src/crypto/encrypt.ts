/**
 * WOLS Encryption Module
 *
 * Provides AES-256-GCM encryption for specimens using Web Crypto API.
 * Supports both password-based (PBKDF2) and raw CryptoKey encryption.
 *
 * ## Security Model
 *
 * This module implements a **deterministic key derivation** model optimized for:
 * - Cross-environment compatibility (browser + Node.js)
 * - Offline decryption (no external key storage needed)
 * - Self-describing payloads (iterations stored in output)
 *
 * ### Password vs CryptoKey
 *
 * | Input Type | Use Case | Security Level |
 * |------------|----------|----------------|
 * | `string` (password) | Simple sharing, QR codes | Good (depends on password strength) |
 * | `CryptoKey` | Server-side, key management systems | Best (full control over key material) |
 *
 * ### Security Considerations
 *
 * 1. **Fixed Salt**: The PBKDF2 salt is fixed per crypto version. This is intentional
 *    for deterministic cross-environment key derivation. Password strength is critical.
 *
 * 2. **Iteration Count**: Default 100,000 iterations. Can be increased via `iterations`
 *    option for higher security (at cost of performance).
 *
 * 3. **Random IV**: Each encryption uses a cryptographically random 96-bit IV,
 *    ensuring identical plaintexts produce different ciphertexts.
 *
 * 4. **Authenticated Encryption**: AES-256-GCM provides both confidentiality and
 *    integrity - tampered ciphertext will fail decryption.
 *
 * ## Future Specification Updates (v1.2.1+)
 *
 * TODO(wols-spec): The following enhancements should be documented in the upstream
 * WOLS specification (wemush/open-standard/SPECIFICATION.md) in a future release:
 *
 * 1. **EncryptedSpecimen schema**: Define the `cryptoVersion` and `iterations` fields
 *    in the encrypted payload format section.
 *
 * 2. **Configurable iterations**: Document the `iterations` option in EncryptionOptions
 *    with recommended ranges (100k-600k) and minimum floor (10k).
 *
 * 3. **Self-describing payloads**: Explain that v1.2.0+ payloads include derivation
 *    parameters for forward-compatible decryption.
 *
 * 4. **Security guidance**: Add a security considerations section covering:
 *    - Fixed salt tradeoffs (determinism vs uniqueness)
 *    - Password strength requirements
 *    - When to use CryptoKey vs password
 *    - Optional random salt for high-security scenarios (future v2)
 *
 * @module crypto/encrypt
 */

import { serializeSpecimen } from '../specimen.js';
import type { Specimen, EncryptedSpecimen, EncryptionOptions } from '../types.js';

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Salt for PBKDF2 key derivation.
 *
 * DESIGN DECISION: This salt is intentionally fixed (not random) for deterministic
 * key derivation. This allows:
 *
 * 1. **Cross-environment compatibility**: Same password produces same key in
 *    browser (Web Crypto API) and server (Node.js crypto), enabling encrypted
 *    specimens to be decrypted in either environment.
 *
 * 2. **Offline decryption**: No need to store/transmit the salt alongside the
 *    encrypted payload - the salt is known from the library version.
 *
 * 3. **Version-aware migration**: The salt includes a version identifier
 *    (@wemush/wols/crypto/v1) allowing future versions to use different salts
 *    while maintaining backward compatibility for decryption.
 *
 * SECURITY NOTE: The fixed salt means password security depends entirely on
 * password strength. Users should use strong, unique passwords. For maximum
 * security, use a CryptoKey directly instead of a password string.
 *
 * @internal
 */
const PBKDF2_SALT = new TextEncoder().encode('@wemush/wols/crypto/v1');

/** Default number of PBKDF2 iterations */
const DEFAULT_PBKDF2_ITERATIONS = 100_000;

/** Minimum allowed PBKDF2 iterations (security floor) */
const MIN_PBKDF2_ITERATIONS = 10_000;

/** Current crypto schema version */
const CRYPTO_VERSION = 'v1' as const;

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
 * Validate and normalize iteration count
 * @throws Error if iterations below minimum
 */
function validateIterations(iterations: number | undefined): number {
  const count = iterations ?? DEFAULT_PBKDF2_ITERATIONS;
  if (count < MIN_PBKDF2_ITERATIONS) {
    throw new Error(
      `PBKDF2 iterations must be at least ${MIN_PBKDF2_ITERATIONS}, got ${count}`
    );
  }
  return count;
}

/**
 * Derive a CryptoKey from a password using PBKDF2
 */
async function deriveKey(password: string, iterations: number): Promise<CryptoKey> {
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
      iterations,
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
 * // Basic encryption with default iterations (100k)
 * const encrypted = await encryptSpecimen(specimen, {
 *   key: 'my-secret-password',
 * });
 *
 * // Higher security with custom iterations
 * const secureEncrypted = await encryptSpecimen(specimen, {
 *   key: 'my-secret-password',
 *   iterations: 300_000,
 * });
 * // Returns: { encrypted: true, payload: "...", iv: "...", algorithm: "AES-256-GCM", cryptoVersion: "v1", iterations: 300000 }
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

  // Validate and get iteration count
  const iterations = validateIterations(options.iterations);

  // Get or derive the encryption key
  // When key is a CryptoKey, iterations is still recorded for documentation
  // but not used (key is already derived)
  const cryptoKey = typeof key === 'string' ? await deriveKey(key, iterations) : key;

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

  // Return encrypted specimen with version and iterations for self-describing decryption
  return {
    encrypted: true,
    payload: toBase64Url(ciphertext),
    iv: toBase64Url(ivBuffer),
    algorithm: 'AES-256-GCM',
    cryptoVersion: CRYPTO_VERSION,
    iterations,
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

  // Validate and get iteration count
  const iterations = validateIterations(options.iterations);

  // Get or derive the encryption key
  const cryptoKey = typeof key === 'string' ? await deriveKey(key, iterations) : key;

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
        cryptoVersion: CRYPTO_VERSION,
        iterations,
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
