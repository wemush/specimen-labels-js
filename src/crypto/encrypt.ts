/**
 * WOLS Encryption Module (WOLS v1.3.0 encrypted format)
 *
 * AES-256-GCM via WebCrypto, so it runs in Node.js 20+, browsers, Deno and Bun.
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
  FieldEncryptedSpecimen,
  FieldEncryptedSpecimenOf,
  FieldEncryptionOptions,
  Specimen,
} from '../types.js';
import { withStringGeneration } from '../utils/generation.js';
import { isKnownSpecimenField } from '../validator.js';

import {
  DEFAULT_PBKDF2_ITERATIONS,
  ENCRYPTED_URL_PREFIX,
  GCM_TAG_LENGTH,
  IV_LENGTH,
  LEGACY_PBKDF2_SALT,
  IDENTIFYING_FIELDS,
  MAX_ITERATIONS,
  fieldAad,
  MIN_GENERATE_ITERATIONS,
  SALT_LENGTH,
  assertWebCrypto,
  base64UrlDecode,
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

/** Generators MUST use 100,000 to 10,000,000 iterations (WOLS 1.3.0). */
function checkGenerateIterations(iterations: unknown): number {
  if (
    typeof iterations !== 'number' ||
    !Number.isInteger(iterations) ||
    iterations < MIN_GENERATE_ITERATIONS ||
    iterations > MAX_ITERATIONS
  ) {
    return encryptionError(
      `PBKDF2 iterations must be an integer from ${MIN_GENERATE_ITERATIONS} to ` +
        `${MAX_ITERATIONS}, got ${String(iterations)}`
    );
  }
  return iterations;
}

/** Decode canonical, unpadded base64url, or throw an encryption error naming the parameter. */
function canonicalBytes(name: string, value: unknown): Uint8Array {
  let bytes: Uint8Array | undefined;
  if (typeof value === 'string' && !value.includes('=')) {
    try {
      bytes = base64UrlDecode(value);
    } catch {
      bytes = undefined;
    }
  }
  // Re-encoding catches non-canonical spellings (non-zero trailing bits) that
  // decode to the same bytes as a different string.
  if (bytes === undefined || base64UrlEncode(bytes) !== value) {
    return encryptionError(`${name} must be canonical base64url without padding`);
  }
  return bytes;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** Identifying fields (WOLS 1.3.0) stay in cleartext so labels remain routable. */
const STRUCTURAL_FIELDS = new Set(IDENTIFYING_FIELDS);

/**
 * Turn the caller's key into an AES key plus the parameters to record.
 * A passphrase gets a fresh random salt for every call (one call = one label).
 */
async function resolveEncryptionKey(options: EncryptionOptions): Promise<ResolvedKey> {
  const { key } = options;

  if (isPassphrase(key)) {
    const iterations = checkGenerateIterations(options.iterations ?? DEFAULT_PBKDF2_ITERATIONS);
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

/**
 * AES-256-GCM encrypt UTF-8 text with a fresh IV. The tag is appended by
 * WebCrypto. `aad` is used for field-level values only; whole labels have none.
 */
async function seal(
  cryptoKey: CryptoKey,
  text: string,
  aad?: Uint8Array<ArrayBuffer>
): Promise<{ payload: string; iv: string }> {
  const iv = randomBytes(IV_LENGTH);
  const params: AesGcmParams =
    aad === undefined ? { name: 'AES-GCM', iv } : { name: 'AES-GCM', iv, additionalData: aad };
  const ciphertext = await crypto.subtle.encrypt(params, cryptoKey, new TextEncoder().encode(text));
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
 * Enforces the generator rules, so a hand-built object cannot produce a
 * non-conformant label:
 * - `payload` and `iv` are canonical unpadded base64url, the IV is 12 bytes,
 *   and the payload is at least the 16-byte GCM tag
 * - `kdf` is present: `pbkdf2` needs 100,000 to 2^32-1 iterations and a salt
 *   of at least 16 bytes that is not the legacy library salt (compared as
 *   bytes); `raw` must not carry `salt` or `iterations`
 *
 * Labels with more than 10,000,000 iterations are valid but exceed the
 * decoders' default `maxIterations`, so readers must raise it.
 *
 * @throws WolsEncryptionError when the object would produce a non-conformant
 *   label (including legacy payloads, which are never generated)
 * @since 1.3.0
 */
export function toEncryptedUrl(encrypted: EncryptedSpecimen): string {
  const suffix = idSuffix(encrypted.id);
  if (encrypted.kdf !== 'pbkdf2' && encrypted.kdf !== 'raw') {
    encryptionError(
      'Encrypted URLs require kdf=pbkdf2 or kdf=raw; legacy payloads are not generated'
    );
  }
  if (canonicalBytes('payload', encrypted.payload).length < GCM_TAG_LENGTH) {
    encryptionError(`payload must include the ${GCM_TAG_LENGTH}-byte GCM tag`);
  }
  if (canonicalBytes('iv', encrypted.iv).length !== IV_LENGTH) {
    encryptionError(`iv must be ${IV_LENGTH} bytes`);
  }
  const params = [`e=${encrypted.payload}`, `iv=${encrypted.iv}`, `kdf=${encrypted.kdf}`];
  if (encrypted.kdf === 'pbkdf2') {
    const { salt } = encrypted;
    if (!salt || encrypted.iterations === undefined) {
      encryptionError('kdf=pbkdf2 requires salt and iterations');
    }
    const iterations = checkGenerateIterations(encrypted.iterations);
    const saltBytes = canonicalBytes('salt', salt);
    if (saltBytes.length < SALT_LENGTH) {
      encryptionError(`salt must be at least ${SALT_LENGTH} bytes, got ${saltBytes.length}`);
    }
    if (bytesEqual(saltBytes, LEGACY_PBKDF2_SALT)) {
      encryptionError('The fixed pre-1.3.0 library salt must not be used to generate labels');
    }
    params.push(`salt=${salt}`, `i=${iterations}`);
  } else if (encrypted.salt !== undefined || encrypted.iterations !== undefined) {
    encryptionError('kdf=raw labels must not carry salt or iterations');
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
 * Encrypt a whole specimen with AES-256-GCM (WOLS v1.3.0 encrypted format).
 *
 * The specimen's embedded JSON-LD serialization is encrypted and the result
 * carries `url`, the `wemush://v1/encrypted/...` string to encode in a QR code.
 * For field-level encryption use {@link encryptFields}.
 *
 * @param specimen - The specimen to encrypt
 * @param options - `key` (passphrase or raw key) and optional `iterations`
 * @throws WolsEncryptionError for an unusable key, too few iterations, an id
 *   without a suffix, or a runtime without WebCrypto
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
 * @since 1.3.0 Per-label random salt, `kdf`, `id` and `url`; raw key bytes accepted.
 *   The `fields` option is deprecated in favor of `encryptFields()`.
 */
export async function encryptSpecimen(
  specimen: Specimen,
  options: EncryptionOptions & { fields: readonly string[] }
): Promise<FieldEncryptedSpecimen>;
export async function encryptSpecimen(
  specimen: Specimen,
  options: EncryptionOptions
): Promise<EncryptedSpecimen>;
export async function encryptSpecimen(
  specimen: Specimen,
  options: EncryptionOptions
): Promise<EncryptedSpecimen | FieldEncryptedSpecimen> {
  assertWebCrypto();
  const { fields } = options;
  if (fields !== undefined && fields.length > 0) {
    // Deprecated 1.2.x path: same behavior as encryptFields(). A call that
    // passes `fields` literally is typed FieldEncryptedSpecimen by the first
    // overload; options typed as plain EncryptionOptions keep the 1.2.x
    // signature for source compatibility, which is why the option is deprecated.
    const fieldOptions: FieldEncryptionOptions = {
      key: options.key,
      fields: fields as readonly (keyof Specimen)[],
    };
    if (options.iterations !== undefined) fieldOptions.iterations = options.iterations;
    return encryptFields(specimen, fieldOptions);
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
 * Field-level encryption (WOLS v1.3.0): replace the value of each named field
 * with an {@link EncryptedField} and leave the rest of the specimen in cleartext.
 *
 * One key (and, for passphrases, one random salt) per call; a fresh IV per field.
 * Each value is bound to its label and field with AES-GCM additional data:
 * the UTF-8 of `"{id}\n{field}"` (WOLS 1.3.0). A value moved to another field
 * or copied into another label fails authentication. Restore with `decryptFields()`.
 *
 * The identifying fields (`@context`, `@type`, `id`, `version`, `type`,
 * `species`) can't be encrypted.
 *
 * @param specimen - The specimen to partially encrypt
 * @param options - `key`, `fields` (each must be present on the specimen), optional `iterations`
 * @throws WolsEncryptionError when `fields` is empty, names a field the specimen
 *   does not have, or names a field twice; or for an unusable key
 *
 * @example
 * ```typescript
 * const partial = await encryptFields(specimen, { key: passphrase, fields: ['strain'] });
 * partial.species;  // still cleartext
 * partial.strain;   // { encrypted: true, algorithm: 'AES-256-GCM', payload, iv, kdf: 'pbkdf2', salt, iterations }
 * ```
 *
 * @since 1.3.0
 */
export async function encryptFields<K extends keyof Specimen>(
  specimen: Specimen,
  options: FieldEncryptionOptions<K>
): Promise<FieldEncryptedSpecimenOf<K>> {
  assertWebCrypto();
  const { fields } = options;
  if (!Array.isArray(fields) || fields.length === 0) {
    encryptionError('encryptFields requires a non-empty fields array');
  }
  // The AAD binds every value to the label's full id, so the id must be usable.
  idSuffix(specimen.id);
  const seen = new Set<string>();
  for (const field of fields) {
    if (typeof field === 'string' && STRUCTURAL_FIELDS.has(field)) {
      encryptionError(
        `Cannot encrypt field '${field}': it identifies the label and must stay in cleartext`
      );
    }
    if (field === 'unknownMembers') {
      encryptionError(
        "Cannot encrypt 'unknownMembers': it is library state, not a label field. " +
          'Kept unknown members are written in cleartext.'
      );
    }
    if (typeof field !== 'string' || !Object.hasOwn(specimen, field)) {
      encryptionError(
        `Cannot encrypt field '${String(field)}': the specimen has no such field. ` +
          'Refusing to leave it unprotected.'
      );
    }
    if ((specimen as unknown as Record<string, unknown>)[field] === undefined) {
      encryptionError(`Cannot encrypt field '${field}': its value is undefined`);
    }
    if (seen.has(field)) {
      encryptionError(`Field '${field}' is listed more than once`);
    }
    seen.add(field);
  }

  const keyOptions: EncryptionOptions = { key: options.key };
  if (options.iterations !== undefined) keyOptions.iterations = options.iterations;
  const resolved = await resolveEncryptionKey(keyOptions);
  // Kept unknown members go back on the wire at the top level (WOLS 1.5 draft),
  // never as an `unknownMembers` object, and never over a known field.
  const { unknownMembers, ...known } = specimen;
  const result = { ...known } as Record<string, unknown>;
  if (unknownMembers !== undefined) {
    for (const [key, value] of Object.entries(unknownMembers)) {
      if (!isKnownSpecimenField(key) && value !== undefined) result[key] = value;
    }
  }
  // strain.generation is always written as a string (WOLS 1.4.0).
  if (result['strain'] !== undefined) result['strain'] = withStringGeneration(result['strain']);

  for (const field of fields) {
    // Fresh IV per field; AAD = "{id}\n{field}" (WOLS 1.3.0).
    const sealed = await seal(
      resolved.cryptoKey,
      JSON.stringify(result[field]),
      fieldAad(specimen.id, field)
    );
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

  return result as FieldEncryptedSpecimenOf<K>;
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

function hasCipherShape(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)['encrypted'] === true &&
    typeof (value as Record<string, unknown>)['payload'] === 'string' &&
    typeof (value as Record<string, unknown>)['iv'] === 'string'
  );
}

/**
 * Whether a value is a field-level {@link EncryptedField}: an encrypted value
 * with a `kdf` and no specimen `id` or `url`.
 *
 * The 1.3.0 shapes are told apart structurally: whole-label objects produced
 * by `encryptSpecimen` and `parseEncryptedUrl` always carry `id`, and field
 * values never do. Legacy (pre-1.3.0) values have no `kdf` and are reported
 * as {@link isEncryptedSpecimen}, whether they were whole labels or fields.
 * `decryptFields` handles legacy field values regardless (with `allowLegacy`).
 *
 * @since 1.3.0
 */
export function isEncryptedField(value: unknown): value is EncryptedField {
  return (
    hasCipherShape(value) &&
    (value['kdf'] === 'pbkdf2' || value['kdf'] === 'raw') &&
    value['id'] === undefined &&
    value['url'] === undefined
  );
}

/**
 * Whether a value is a whole-label {@link EncryptedSpecimen} (v1.3.0 or legacy).
 *
 * @since 1.3.0
 */
export function isEncryptedSpecimen(value: unknown): value is EncryptedSpecimen {
  return hasCipherShape(value) && !isEncryptedField(value);
}

/**
 * Whether a value carries the `encrypted: true` marker: either a whole-label
 * {@link EncryptedSpecimen} or a field-level {@link EncryptedField}. Use
 * {@link isEncryptedSpecimen} or {@link isEncryptedField} to tell them apart.
 *
 * @since 1.3.0 Narrows to `EncryptedSpecimen | EncryptedField`
 */
export function isEncrypted(value: unknown): value is EncryptedSpecimen | EncryptedField {
  if (value === null || value === undefined || typeof value !== 'object') {
    return false;
  }
  return (value as Record<string, unknown>)['encrypted'] === true;
}
