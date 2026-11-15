/**
 * WOLS Decryption Module (WOLS v1.3.0 encrypted format)
 *
 * Decrypts `wemush://v1/encrypted/...` URLs, the equivalent
 * {@link EncryptedSpecimen} objects, and field-level {@link EncryptedField}
 * values, using WebCrypto only.
 *
 * Failures never throw; they return `{ success: false, error }` where
 * `error.details.reason` is a stable {@link DecryptionFailureReason}.
 *
 * Legacy payloads (no `kdf`, pre-1.3.0 fixed salt) are rejected unless
 * `allowLegacy: true` is passed.
 *
 * @module crypto/decrypt
 */

import type { WolsEncryptionError } from '../errors.js';
import { parseSpecimen } from '../parser.js';
import type {
  DecryptionFailureReason,
  DecryptionOptions,
  EncryptedField,
  EncryptedSpecimen,
  EncryptionKdf,
  ParseResult,
  Specimen,
} from '../types.js';

import {
  DEFAULT_PBKDF2_ITERATIONS,
  ENCRYPTED_URL_PREFIX,
  IV_LENGTH,
  LEGACY_PBKDF2_SALT,
  MIN_DECODE_ITERATIONS,
  base64UrlDecode,
  decryptionError,
  derivePassphraseKey,
  importAesKey,
  isPassphrase,
  isRawKey,
  resolveRawKey,
} from './shared.js';

type Failure = { success: false; error: WolsEncryptionError };
const fail = (error: WolsEncryptionError): Failure => ({ success: false, error });
const isFailure = (value: unknown): value is Failure =>
  typeof value === 'object' && value !== null && (value as { success?: unknown }).success === false;

/** Normalized parameters for one decryption, independent of input form. */
interface CipherParams {
  /** ID suffix from the URL path or object (`undefined` when not bound to an ID) */
  idSuffix: string | undefined;
  payload: string;
  iv: string;
  /** `undefined` means a legacy (pre-1.3.0) payload */
  kdf: string | undefined;
  salt: string | undefined;
  iterations: string | number | undefined;
}

// =============================================================================
// URL PARSING
// =============================================================================

const SINGLE_VALUED = ['e', 'iv', 'kdf', 'salt', 'i', 'sig'] as const;

/**
 * Parse an encrypted-format URL into an {@link EncryptedSpecimen} without decrypting.
 *
 * Only checks URL structure. Parameter rules (kdf, salt, iterations) are
 * enforced on decryption.
 *
 * @since 1.3.0
 */
export function parseEncryptedUrl(url: string): ParseResult<EncryptedSpecimen> {
  if (typeof url !== 'string' || !url.startsWith(ENCRYPTED_URL_PREFIX)) {
    return fail(decryptionError('invalid-url', `URL must start with '${ENCRYPTED_URL_PREFIX}'`));
  }
  const rest = url.slice(ENCRYPTED_URL_PREFIX.length).split('#')[0] ?? '';
  const q = rest.indexOf('?');
  const rawId = q === -1 ? rest : rest.slice(0, q);
  const query = q === -1 ? '' : rest.slice(q + 1);

  if (rawId.length === 0 || rawId.includes('/')) {
    return fail(
      decryptionError('invalid-url', 'URL path must be a single non-empty specimen ID suffix')
    );
  }
  let suffix: string;
  try {
    suffix = decodeURIComponent(rawId);
  } catch {
    return fail(decryptionError('invalid-url', 'URL path contains an invalid percent-encoding'));
  }
  if (suffix.length === 0) {
    return fail(
      decryptionError('invalid-url', 'URL path must be a single non-empty specimen ID suffix')
    );
  }

  const params = new URLSearchParams(query);
  for (const name of SINGLE_VALUED) {
    if (params.getAll(name).length > 1) {
      return fail(
        decryptionError('invalid-parameter', `Parameter '${name}' appears more than once`)
      );
    }
  }

  const e = params.get('e');
  const iv = params.get('iv');
  if (!e || !iv) {
    return fail(
      decryptionError('missing-parameter', `Encrypted URL requires 'e' and 'iv' parameters`, {
        path: [e ? 'iv' : 'e'],
      })
    );
  }

  const result: EncryptedSpecimen = {
    encrypted: true,
    algorithm: 'AES-256-GCM',
    payload: e,
    iv,
    id: `wemush:${suffix}`,
    url,
  };
  const kdf = params.get('kdf');
  if (kdf !== null) result.kdf = kdf as EncryptionKdf;
  const salt = params.get('salt');
  if (salt !== null) result.salt = salt;
  const i = params.get('i');
  if (i !== null) {
    // Keep non-numeric values visible to the decryptor so it can reject them.
    result.iterations = /^\d+$/.test(i) ? Number(i) : Number.NaN;
  }
  const sig = params.get('sig');
  if (sig !== null) result.signature = sig;
  return { success: true, data: result };
}

function toCipherParams(input: string | EncryptedSpecimen): ParseResult<CipherParams> {
  let enc: EncryptedSpecimen;
  if (typeof input === 'string') {
    const parsed = parseEncryptedUrl(input);
    if (!parsed.success) return parsed;
    enc = parsed.data;
  } else if (typeof input === 'object' && input !== null) {
    enc = input;
  } else {
    return fail(
      decryptionError('invalid-url', 'Expected an encrypted URL or encrypted specimen object')
    );
  }

  if (!enc.payload) {
    return fail(
      decryptionError('missing-parameter', 'Missing encrypted payload', { path: ['payload'] })
    );
  }
  if (!enc.iv) {
    return fail(
      decryptionError('missing-parameter', 'Missing initialization vector (IV)', { path: ['iv'] })
    );
  }

  let idSuffix: string | undefined;
  if (enc.id !== undefined) {
    if (typeof enc.id !== 'string' || !enc.id.startsWith('wemush:') || enc.id.length === 7) {
      return fail(decryptionError('invalid-parameter', `Invalid specimen id '${String(enc.id)}'`));
    }
    idSuffix = enc.id.slice('wemush:'.length);
  }

  return {
    success: true,
    data: {
      idSuffix,
      payload: enc.payload,
      iv: enc.iv,
      kdf: enc.kdf,
      salt: enc.salt,
      iterations: enc.iterations,
    },
  };
}

// =============================================================================
// KEY RESOLUTION
// =============================================================================

function decodeParam(name: string, value: string): Uint8Array<ArrayBuffer> | Failure {
  try {
    return base64UrlDecode(value);
  } catch {
    return fail(decryptionError('invalid-parameter', `Parameter '${name}' is not valid base64url`));
  }
}

function parseIterations(value: string | number | undefined): number | Failure {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n)) {
    return fail(decryptionError('invalid-parameter', `Iteration count must be a decimal integer`));
  }
  if (n < MIN_DECODE_ITERATIONS) {
    return fail(
      decryptionError(
        'insufficient-iterations',
        `PBKDF2 iteration count ${n} is below the minimum of ${MIN_DECODE_ITERATIONS}`
      )
    );
  }
  return n;
}

async function resolveDecryptionKey(
  p: CipherParams,
  options: DecryptionOptions
): Promise<CryptoKey | Failure> {
  const { key } = options;

  // Legacy (pre-1.3.0): no kdf, fixed library salt.
  if (p.kdf === undefined) {
    if (!options.allowLegacy) {
      return fail(
        decryptionError(
          'missing-parameter',
          `Missing 'kdf' parameter. Legacy (pre-1.3.0) payloads need { allowLegacy: true }`,
          { legacy: true }
        )
      );
    }
    if (isPassphrase(key)) {
      const iterations = parseIterations(p.iterations ?? DEFAULT_PBKDF2_ITERATIONS);
      if (typeof iterations !== 'number') return iterations;
      const bytes = await derivePassphraseKey(key, LEGACY_PBKDF2_SALT, iterations);
      return importAesKey(bytes, 'decrypt');
    }
    if (isRawKey(key)) {
      const resolved = await resolveRawKey(key, 'decrypt');
      return typeof resolved === 'string'
        ? fail(decryptionError('invalid-key', resolved))
        : resolved;
    }
    return fail(decryptionError('invalid-key', 'Unsupported key type'));
  }

  if (p.kdf === 'pbkdf2') {
    if (!p.salt || p.iterations === undefined) {
      return fail(
        decryptionError('missing-parameter', `kdf=pbkdf2 requires 'salt' and 'i' parameters`, {
          path: [p.salt ? 'i' : 'salt'],
        })
      );
    }
    const iterations = parseIterations(p.iterations);
    if (typeof iterations !== 'number') return iterations;
    const salt = decodeParam('salt', p.salt);
    if (isFailure(salt)) return salt;
    if (!isPassphrase(key)) {
      return fail(decryptionError('invalid-key', 'kdf=pbkdf2 requires a passphrase string key'));
    }
    const bytes = await derivePassphraseKey(key, salt, iterations);
    return importAesKey(bytes, 'decrypt');
  }

  if (p.kdf === 'raw') {
    if (p.salt !== undefined || p.iterations !== undefined) {
      return fail(
        decryptionError('unexpected-parameter', `'salt' and 'i' must be omitted when kdf=raw`)
      );
    }
    if (!isRawKey(key)) {
      return fail(
        decryptionError('invalid-key', 'kdf=raw requires 32 raw key bytes or an AES-GCM CryptoKey')
      );
    }
    const resolved = await resolveRawKey(key, 'decrypt');
    return typeof resolved === 'string' ? fail(decryptionError('invalid-key', resolved)) : resolved;
  }

  return fail(decryptionError('unsupported-kdf', `Unsupported kdf '${p.kdf}'`));
}

/** Decrypt normalized params to UTF-8 plaintext (no ID check). */
async function openParams(
  p: CipherParams,
  options: DecryptionOptions
): Promise<ParseResult<string>> {
  const cryptoKey = await resolveDecryptionKey(p, options);
  if (isFailure(cryptoKey)) return cryptoKey;

  const ciphertext = decodeParam('e', p.payload);
  if (isFailure(ciphertext)) return ciphertext;
  const iv = decodeParam('iv', p.iv);
  if (isFailure(iv)) return iv;
  if (iv.length !== IV_LENGTH) {
    return fail(
      decryptionError('invalid-parameter', `IV must be ${IV_LENGTH} bytes, got ${iv.length}`)
    );
  }

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext);
  } catch {
    return fail(
      decryptionError(
        'authentication-failed',
        'Decryption failed: wrong key or tampered ciphertext (GCM authentication failed)'
      )
    );
  }

  try {
    return { success: true, data: new TextDecoder('utf-8', { fatal: true }).decode(plaintext) };
  } catch {
    return fail(decryptionError('invalid-plaintext', 'Decrypted payload is not valid UTF-8'));
  }
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Decrypt an encrypted label to its exact plaintext (the embedded JSON-LD string).
 *
 * Enforces every v1.3.0 wire rule, including that the decrypted specimen's
 * `id` equals `wemush:{id}` from the URL path (or the object's `id`).
 *
 * @param input - `wemush://v1/encrypted/...` URL or an {@link EncryptedSpecimen}
 * @param options - `key` (passphrase or raw key) and optional `allowLegacy`
 * @since 1.3.0
 */
export async function decryptPlaintext(
  input: string | EncryptedSpecimen,
  options: DecryptionOptions
): Promise<ParseResult<string>> {
  const params = toCipherParams(input);
  if (!params.success) return params;

  const opened = await openParams(params.data, options);
  if (!opened.success) return opened;

  if (params.data.idSuffix !== undefined) {
    const expectedId = `wemush:${params.data.idSuffix}`;
    let actualId: unknown;
    try {
      actualId = (JSON.parse(opened.data) as { id?: unknown } | null)?.id;
    } catch {
      return fail(decryptionError('invalid-plaintext', 'Decrypted payload is not valid JSON'));
    }
    if (actualId !== expectedId) {
      return fail(
        decryptionError(
          'id-mismatch',
          `Decrypted specimen id '${String(actualId)}' does not match '${expectedId}'`,
          { expectedId, actualId }
        )
      );
    }
  }

  return opened;
}

/**
 * Decrypt an encrypted label and parse it into a validated Specimen.
 *
 * @param input - `wemush://v1/encrypted/...` URL or an {@link EncryptedSpecimen}
 * @param options - `key` (passphrase or raw key) and optional `allowLegacy`
 * @returns ParseResult; on failure `error.details.reason` gives the category
 *
 * @example
 * ```typescript
 * const result = await decryptSpecimen(url, { key: 'correct horse battery staple' });
 * if (result.success) console.log(result.data.species);
 * else console.error(result.error.details?.reason, result.error.message);
 * ```
 *
 * @since 1.3.0 Accepts encrypted URLs, raw key bytes, and `allowLegacy`
 */
export async function decryptSpecimen(
  input: string | EncryptedSpecimen,
  options: DecryptionOptions
): Promise<ParseResult<Specimen>> {
  const plaintext = await decryptPlaintext(input, options);
  if (!plaintext.success) return plaintext;
  return parseSpecimen(plaintext.data);
}

/**
 * Decrypt a single field-level {@link EncryptedField} to its original value.
 *
 * @since 1.3.0
 */
export async function decryptField(
  field: EncryptedField,
  options: DecryptionOptions
): Promise<ParseResult<unknown>> {
  const opened = await openParams(
    {
      idSuffix: undefined,
      payload: field.payload,
      iv: field.iv,
      kdf: field.kdf,
      salt: field.salt,
      iterations: field.iterations,
    },
    options
  );
  if (!opened.success) return opened;
  try {
    return { success: true, data: JSON.parse(opened.data) as unknown };
  } catch {
    return fail(decryptionError('invalid-plaintext', 'Decrypted field is not valid JSON'));
  }
}

/**
 * Decrypt every field-level encrypted value in an object, returning a copy
 * with the original values restored. Fields that are not encrypted are kept.
 *
 * @since 1.3.0
 */
export async function decryptFields<T extends Record<string, unknown>>(
  value: T,
  options: DecryptionOptions
): Promise<ParseResult<Record<string, unknown>>> {
  const result: Record<string, unknown> = { ...value };
  for (const [name, fieldValue] of Object.entries(value)) {
    if (
      typeof fieldValue === 'object' &&
      fieldValue !== null &&
      (fieldValue as { encrypted?: unknown }).encrypted === true
    ) {
      const decrypted = await decryptField(fieldValue as EncryptedField, options);
      if (!decrypted.success) {
        const reason =
          (decrypted.error.details?.['reason'] as DecryptionFailureReason | undefined) ??
          'authentication-failed';
        return fail(
          decryptionError(reason, `Field '${name}': ${decrypted.error.message}`, { path: [name] })
        );
      }
      result[name] = decrypted.data;
    }
  }
  return { success: true, data: result };
}
