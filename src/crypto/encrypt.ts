/**
 * WOLS Encryption Module (WOLS v1.3.0 encrypted format)
 *
 * AES-256-GCM via WebCrypto, so it runs in Node.js 18+ and browsers.
 *
 * ## Wire format
 *
 * ```
 * wemush://v1/encrypted/{id}?e={ciphertext}&iv={iv}&kdf={pbkdf2|raw}[&salt={salt}&i={iterations}]
 * ```
 *
 * - `e`: ciphertext with the 16-byte GCM tag appended
 * - `iv`: fresh random 12-byte IV per encryption
 * - All binary values are base64url without padding
 *
 * ## Keys
 *
 * | `key` value | `kdf` | Notes |
 * |-------------|-------|-------|
 * | `string` passphrase | `pbkdf2` | PBKDF2-HMAC-SHA256, fresh random 16-byte salt per label, ≥100,000 iterations |
 * | 32-byte `Uint8Array` / `ArrayBuffer` | `raw` | Key shared out of band |
 * | AES-GCM 256 `CryptoKey` | `raw` | Key shared out of band |
 *
 * Pre-1.3.0 releases derived passphrase keys with a fixed library-wide salt.
 * That scheme is never generated any more; see `allowLegacy` on decryption.
 *
 * @module crypto/encrypt
 */

import { WolsEncryptionError, WolsErrorCode } from '../errors.js';
import { serializeSpecimen } from '../specimen.js';
import type {
  EncryptedField,
  EncryptedSpecimen,
  EncryptionKdf,
  EncryptionOptions,
  Specimen,
} from '../types.js';

import {
  DEFAULT_PBKDF2_ITERATIONS,
  ENCRYPTED_URL_PREFIX,
  IV_LENGTH,
  MIN_GENERATE_ITERATIONS,
  SALT_LENGTH,
  base64UrlEncode,
  derivePassphraseKey,
  importAesKey,
  isPassphrase,
  isRawKey,
  randomBytes,
  resolveRawKey,
} from './shared.js';

// =============================================================================
// KEY RESOLUTION
// =============================================================================

interface ResolvedKey {
  cryptoKey: CryptoKey;
  kdf: EncryptionKdf;
  salt?: string;
  iterations?: number;
}

function encryptionError(message: string, code = WolsErrorCode.ENCRYPTION_ERROR): never {
  throw new WolsEncryptionError(code, message);
}

/**
 * Turn the caller's key into an AES key plus the parameters to record.
 * A passphrase gets a fresh random salt for every call (one call = one label).
 */
async function resolveEncryptionKey(options: EncryptionOptions): Promise<ResolvedKey> {
  const { key } = options;

  if (isPassphrase(key)) {
    const iterations = options.iterations ?? DEFAULT_PBKDF2_ITERATIONS;
    if (!Number.isInteger(iterations) || iterations < MIN_GENERATE_ITERATIONS) {
      encryptionError(
        `PBKDF2 iterations must be an integer of at least ${MIN_GENERATE_ITERATIONS}, got ${iterations}`
      );
    }
    const salt = randomBytes(SALT_LENGTH);
    const keyBytes = await derivePassphraseKey(key, salt, iterations);
    return {
      cryptoKey: await importAesKey(keyBytes, 'encrypt'),
      kdf: 'pbkdf2',
      salt: base64UrlEncode(salt),
      iterations,
    };
  }

  if (isRawKey(key)) {
    const resolved = await resolveRawKey(key, 'encrypt');
    if (typeof resolved === 'string') {
      encryptionError(resolved, WolsErrorCode.INVALID_KEY);
    }
    return { cryptoKey: resolved, kdf: 'raw' };
  }

  return encryptionError(
    'key must be a passphrase string, 32 raw key bytes, or an AES-GCM CryptoKey',
    WolsErrorCode.INVALID_KEY
  );
}

/** AES-256-GCM encrypt UTF-8 text with a fresh IV. Tag is appended by WebCrypto. */
async function seal(cryptoKey: CryptoKey, text: string): Promise<{ payload: string; iv: string }> {
  const iv = randomBytes(IV_LENGTH);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    new TextEncoder().encode(text)
  );
  return { payload: base64UrlEncode(ciphertext), iv: base64UrlEncode(iv) };
}

/** Split `wemush:{suffix}` into its suffix, enforcing a non-empty suffix. */
function idSuffix(id: unknown): string {
  if (typeof id !== 'string' || !id.startsWith('wemush:') || id.length === 'wemush:'.length) {
    encryptionError(
      `Specimen id must be 'wemush:' followed by a non-empty suffix, got '${String(id)}'`
    );
  }
  return id.slice('wemush:'.length);
}

// =============================================================================
// URL SERIALIZATION
// =============================================================================

/**
 * Build the encrypted-format URL for an encrypted specimen.
 *
 * @throws WolsEncryptionError if the object lacks `id` or `kdf` (legacy payloads
 *   cannot be expressed as v1.3.0 URLs and are never generated)
 * @since 1.3.0
 */
export function toEncryptedUrl(encrypted: EncryptedSpecimen): string {
  const suffix = idSuffix(encrypted.id);
  if (encrypted.kdf !== 'pbkdf2' && encrypted.kdf !== 'raw') {
    encryptionError(
      'Encrypted URLs require kdf=pbkdf2 or kdf=raw; legacy payloads are not generated'
    );
  }
  const params = [`e=${encrypted.payload}`, `iv=${encrypted.iv}`, `kdf=${encrypted.kdf}`];
  if (encrypted.kdf === 'pbkdf2') {
    if (!encrypted.salt || encrypted.iterations === undefined) {
      encryptionError('kdf=pbkdf2 requires salt and iterations');
    }
    params.push(`salt=${encrypted.salt}`, `i=${encrypted.iterations}`);
  }
  if (encrypted.signature !== undefined) {
    params.push(`sig=${encodeURIComponent(encrypted.signature)}`);
  }
  return `${ENCRYPTED_URL_PREFIX}${encodeURIComponent(suffix)}?${params.join('&')}`;
}

// =============================================================================
// ENCRYPTION
// =============================================================================

/**
 * Encrypt a specimen with AES-256-GCM (WOLS v1.3.0 encrypted format).
 *
 * Without `fields`, the whole specimen (its embedded JSON-LD serialization)
 * is encrypted and the result carries `url`, the `wemush://v1/encrypted/...`
 * string to encode in a QR code.
 *
 * With `fields`, each named field's value is replaced in place with an
 * {@link EncryptedField} and the rest of the specimen stays in cleartext.
 *
 * @param specimen - The specimen to encrypt
 * @param options - `key` (passphrase or raw key), optional `fields` and `iterations`
 *
 * @example
 * ```typescript
 * // Passphrase: kdf=pbkdf2 with a random per-label salt
 * const enc = await encryptSpecimen(specimen, { key: 'correct horse battery staple' });
 * enc.url; // 'wemush://v1/encrypted/clx1a2b3c4?e=...&iv=...&kdf=pbkdf2&salt=...&i=100000'
 *
 * // Raw 32-byte key: kdf=raw
 * const raw = await encryptSpecimen(specimen, { key: crypto.getRandomValues(new Uint8Array(32)) });
 * ```
 *
 * @since 1.3.0 Per-label random salt, `kdf`, `id` and `url`; raw key bytes accepted
 */
export async function encryptSpecimen(
  specimen: Specimen,
  options: EncryptionOptions
): Promise<EncryptedSpecimen> {
  if (options.fields !== undefined && options.fields.length > 0) {
    return encryptPartial(specimen, options);
  }

  const id = specimen.id;
  idSuffix(id);
  const resolved = await resolveEncryptionKey(options);
  const sealed = await seal(resolved.cryptoKey, serializeSpecimen(specimen));

  const result: EncryptedSpecimen = {
    encrypted: true,
    algorithm: 'AES-256-GCM',
    payload: sealed.payload,
    iv: sealed.iv,
    kdf: resolved.kdf,
    id,
  };
  if (resolved.salt !== undefined) result.salt = resolved.salt;
  if (resolved.iterations !== undefined) result.iterations = resolved.iterations;
  result.url = toEncryptedUrl(result);
  return result;
}

/**
 * Field-level encryption: replace each named field with an EncryptedField.
 * One key (and, for passphrases, one salt) per call; a fresh IV per field.
 */
async function encryptPartial(
  specimen: Specimen,
  options: EncryptionOptions
): Promise<EncryptedSpecimen> {
  const resolved = await resolveEncryptionKey(options);
  const result = { ...specimen } as Record<string, unknown>;

  for (const field of options.fields ?? []) {
    const value = result[field];
    if (value === undefined) continue;

    const sealed = await seal(resolved.cryptoKey, JSON.stringify(value));
    const encryptedField: EncryptedField = {
      encrypted: true,
      algorithm: 'AES-256-GCM',
      payload: sealed.payload,
      iv: sealed.iv,
      kdf: resolved.kdf,
    };
    if (resolved.salt !== undefined) encryptedField.salt = resolved.salt;
    if (resolved.iterations !== undefined) encryptedField.iterations = resolved.iterations;
    result[field] = encryptedField;
  }

  // In field-level mode the result is the specimen with some values replaced.
  return result as unknown as EncryptedSpecimen;
}

/**
 * Type guard to check if an object is an encrypted specimen or encrypted field
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
