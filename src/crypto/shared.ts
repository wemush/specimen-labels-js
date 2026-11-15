/**
 * Shared primitives for the WOLS encrypted format (v1.3.0).
 *
 * Uses only WebCrypto (`globalThis.crypto.subtle`), so it runs unchanged in
 * Node.js 18+, browsers, Deno, Bun and workers.
 *
 * `base64UrlEncode`, `base64UrlDecode` and `derivePassphraseKey` are public
 * (re-exported from the package root and `@wemush/wols/crypto`); everything
 * else here is internal to the crypto module.
 *
 * @module crypto/shared
 */

import { WolsDecryptionError, WolsEncryptionError, WolsErrorCode } from '../errors.js';
import type { DecryptionFailureReason, RawEncryptionKey } from '../types.js';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default PBKDF2 iteration count used when generating. */
export const DEFAULT_PBKDF2_ITERATIONS = 100_000;

/** Generators MUST use at least this many PBKDF2 iterations (WOLS v1.3.0). */
export const MIN_GENERATE_ITERATIONS = 100_000;

/** Decoders MUST reject fewer PBKDF2 iterations than this (WOLS v1.3.0). */
export const MIN_DECODE_ITERATIONS = 10_000;

/** Default largest PBKDF2 iteration count accepted from a label when decoding. */
export const DEFAULT_MAX_DECODE_ITERATIONS = 10_000_000;

/** WebCrypto's PBKDF2 `iterations` is an unsigned long; nothing above this is derivable. */
export const MAX_PBKDF2_ITERATIONS = 0xffff_ffff;

/** Per-label PBKDF2 salt length generated (spec minimum: 16 bytes). */
export const SALT_LENGTH = 16;

/** AES-GCM IV length in bytes. */
export const IV_LENGTH = 12;

/** Raw AES-256 key length in bytes. */
export const RAW_KEY_LENGTH = 32;

/** Prefix of every encrypted-format URL. */
export const ENCRYPTED_URL_PREFIX = 'wemush://v1/encrypted/';

/**
 * Library-wide salt used by pre-1.3.0 releases. Only for decoding legacy
 * payloads behind `allowLegacy`; never used when generating.
 */
export const LEGACY_PBKDF2_SALT = new TextEncoder().encode('@wemush/wols/crypto/v1');

// =============================================================================
// ERRORS
// =============================================================================

/**
 * Create a decryption error carrying a stable `details.reason` category.
 */
export function decryptionError(
  reason: DecryptionFailureReason,
  message: string,
  details: Record<string, unknown> = {}
): WolsDecryptionError {
  return new WolsDecryptionError(reason, message, details);
}

/**
 * Whether WebCrypto (`globalThis.crypto.subtle`) is available. It is global in
 * browsers, workers, Deno, Bun and Node.js 19+ (Node 18 needs
 * `--experimental-global-webcrypto`).
 */
export function hasWebCrypto(): boolean {
  const c = (globalThis as { crypto?: { subtle?: unknown; getRandomValues?: unknown } }).crypto;
  return (
    typeof c?.subtle === 'object' && c.subtle !== null && typeof c.getRandomValues === 'function'
  );
}

/** Message used when WebCrypto is missing. */
export const NO_WEBCRYPTO_MESSAGE =
  'WebCrypto (globalThis.crypto.subtle) is not available in this runtime. ' +
  'Use Node.js 20+, a modern browser, Deno or Bun.';

/** Throw a WolsEncryptionError when WebCrypto is missing (encryption paths). */
export function assertWebCrypto(): void {
  if (!hasWebCrypto()) {
    throw new WolsEncryptionError(WolsErrorCode.ENCRYPTION_ERROR, NO_WEBCRYPTO_MESSAGE);
  }
}

// =============================================================================
// BASE64URL
// =============================================================================

/**
 * Encode bytes as base64url (RFC 4648 §5) without padding.
 *
 * @since 1.3.0
 */
export function base64UrlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*={0,2}$/;

/**
 * Decode base64url (RFC 4648 §5). Padded input is accepted.
 *
 * @throws Error if the input is not valid base64url
 * @since 1.3.0
 */
export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  if (!BASE64URL_PATTERN.test(value)) {
    throw new Error('Invalid base64url string');
  }
  const unpadded = value.replace(/=+$/, '');
  if (unpadded.length % 4 === 1) {
    throw new Error('Invalid base64url length');
  }
  const base64 = unpadded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// =============================================================================
// RANDOMNESS
// =============================================================================

/** Cryptographically random bytes from WebCrypto. */
export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

// =============================================================================
// KEYS
// =============================================================================

/** Copy a byte view into a fresh ArrayBuffer-backed Uint8Array (WebCrypto-safe). */
function toOwnedBytes(bytes: Uint8Array | ArrayBuffer): Uint8Array<ArrayBuffer> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const copy = new Uint8Array(view.length);
  copy.set(view);
  return copy;
}

/**
 * Derive a 256-bit key from a passphrase with PBKDF2-HMAC-SHA256.
 *
 * Exposed for debugging and interoperability testing (it reproduces the
 * conformance `derive` vectors). Returns the raw key bytes.
 *
 * @param passphrase - UTF-8 passphrase
 * @param salt - Salt bytes (the label's decoded `salt` parameter)
 * @param iterations - PBKDF2 iteration count (positive integer)
 * @since 1.3.0
 */
export async function derivePassphraseKey(
  passphrase: string,
  salt: Uint8Array | ArrayBuffer,
  iterations: number
): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_PBKDF2_ITERATIONS) {
    throw new Error(
      `PBKDF2 iterations must be an integer from 1 to ${MAX_PBKDF2_ITERATIONS}, got ${iterations}`
    );
  }
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toOwnedBytes(salt), iterations },
    material,
    256
  );
  return new Uint8Array(bits);
}

/** Import 32 raw key bytes as an AES-GCM key. */
export async function importAesKey(
  bytes: Uint8Array | ArrayBuffer,
  usage: 'encrypt' | 'decrypt'
): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', toOwnedBytes(bytes), { name: 'AES-GCM' }, false, [usage]);
}

/**
 * Check whether a value is a WebCrypto CryptoKey without relying on the
 * global `CryptoKey` constructor (absent in some runtimes).
 */
export function isCryptoKey(value: unknown): value is CryptoKey {
  return (
    typeof value === 'object' &&
    value !== null &&
    'algorithm' in value &&
    'usages' in value &&
    'type' in value &&
    !(value instanceof Uint8Array) &&
    !(value instanceof ArrayBuffer)
  );
}

/**
 * Resolve a raw key (bytes or CryptoKey) to an AES-256-GCM CryptoKey.
 * Returns an error message string when the key is unusable.
 */
export async function resolveRawKey(
  key: RawEncryptionKey,
  usage: 'encrypt' | 'decrypt'
): Promise<CryptoKey | string> {
  if (isCryptoKey(key)) {
    const algorithm = key.algorithm as { name?: string; length?: number };
    if (algorithm.name !== 'AES-GCM' || algorithm.length !== 256) {
      return `CryptoKey must be AES-GCM with length 256, got ${algorithm.name ?? 'unknown'}/${algorithm.length ?? '?'}`;
    }
    if (!key.usages.includes(usage)) {
      return `CryptoKey does not allow '${usage}'`;
    }
    return key;
  }
  const length = key instanceof Uint8Array ? key.length : key.byteLength;
  if (length !== RAW_KEY_LENGTH) {
    return `Raw key must be exactly ${RAW_KEY_LENGTH} bytes, got ${length}`;
  }
  return importAesKey(key, usage);
}

/** Whether a key value is a passphrase (selects kdf=pbkdf2). */
export function isPassphrase(key: unknown): key is string {
  return typeof key === 'string';
}

/** Whether a key value is raw key material (selects kdf=raw). */
export function isRawKey(key: unknown): key is RawEncryptionKey {
  return key instanceof Uint8Array || key instanceof ArrayBuffer || isCryptoKey(key);
}
