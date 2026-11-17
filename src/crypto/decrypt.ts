/**
 * WOLS Decryption Module (WOLS v1.3.0 encrypted format)
 *
 * Decrypts `wemush://v1/encrypted/...` URLs, the equivalent
 * {@link EncryptedSpecimen} objects, and field-level {@link EncryptedField}
 * values, using WebCrypto only.
 *
 * Failures never throw; they return `{ success: false, error }` where `error`
 * is a {@link WolsDecryptionError} with a stable, typed `reason`.
 *
 * Every cheap check (parameter presence, encodings, IV length, iteration
 * bounds, key type) runs before PBKDF2, so a malformed or hostile label costs
 * no key derivation. The iteration count comes from the label and is bounded
 * by `maxIterations` (default 10,000,000).
 *
 * Legacy payloads (no `kdf`, pre-1.3.0 fixed salt) are rejected with
 * `legacy-format` unless `allowLegacy: true` is passed. Their passphrase key
 * is derived as 1.2.x did, without NFC normalization (see `openValue`).
 *
 * @module crypto/decrypt
 */

import type { WolsDecryptionError } from '../errors.js';
import { parseSpecimen } from '../parser.js';
import type {
  DecryptResult,
  DecryptionOptions,
  EncryptedField,
  EncryptedSpecimen,
  EncryptionKdf,
  FieldEncryptedSpecimen,
  RawEncryptionKey,
  Specimen,
} from '../types.js';

import {
  DEFAULT_MAX_DECODE_ITERATIONS,
  IDENTIFYING_FIELDS,
  LEGACY_PBKDF2_ITERATIONS,
  ENCRYPTED_URL_PREFIX,
  GCM_TAG_LENGTH,
  IV_LENGTH,
  LEGACY_PBKDF2_SALT,
  MAX_ITERATIONS,
  MIN_DECODE_ITERATIONS,
  NO_WEBCRYPTO_MESSAGE,
  base64UrlDecode,
  decryptionError,
  deriveLegacyPassphraseKey,
  derivePassphraseKey,
  fieldAad,
  hasWebCrypto,
  importAesKey,
  isPassphrase,
  isRawKey,
  resolveRawKey,
} from './shared.js';

type Failure = { success: false; error: WolsDecryptionError };
const fail = (error: WolsDecryptionError): Failure => ({ success: false, error });
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

/** Everything needed to derive the key and decrypt, all validated. */
type Prepared = {
  ciphertext: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
} & (
  | {
      mode: 'pbkdf2';
      passphrase: string;
      salt: Uint8Array<ArrayBuffer>;
      iterations: number;
      /** Pre-1.3.0 payload: derive from the passphrase as given, not NFC */
      legacy: boolean;
    }
  | { mode: 'raw'; rawKey: RawEncryptionKey }
);

/**
 * Derived keys shared across the values of one label, and the PBKDF2
 * iterations still allowed for a legacy NFC retry under `maxIterations`.
 */
interface KeyState {
  keys: Map<string, CryptoKey>;
  remainingIterations: number;
}

// =============================================================================
// URL PARSING
// =============================================================================

const SINGLE_VALUED = ['e', 'iv', 'kdf', 'salt', 'i', 'sig'] as const;

/**
 * Parse an encrypted-format URL into an {@link EncryptedSpecimen} without decrypting.
 *
 * Only checks URL structure. Parameter rules (kdf, salt, iterations) are
 * enforced on decryption. The path segment is percent-decoded to recover the ID.
 *
 * @since 1.3.0
 */
export function parseEncryptedUrl(url: string): DecryptResult<EncryptedSpecimen> {
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
    // decodeURIComponent rejects malformed escapes and invalid UTF-8; '+' stays literal.
    return fail(
      decryptionError(
        'invalid-encoding',
        'URL path has a malformed percent-encoding or is not valid UTF-8'
      )
    );
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

function toCipherParams(input: string | EncryptedSpecimen): DecryptResult<CipherParams> {
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
// VALIDATION (everything before key derivation)
// =============================================================================

function decodeParam(name: string, value: string): Uint8Array<ArrayBuffer> | Failure {
  try {
    return base64UrlDecode(value);
  } catch {
    return fail(decryptionError('invalid-parameter', `Parameter '${name}' is not valid base64url`));
  }
}

function resolveMaxIterations(options: DecryptionOptions): number | Failure {
  const max = options.maxIterations ?? DEFAULT_MAX_DECODE_ITERATIONS;
  // WOLS 1.3.0: a configured maximum may be lower than 10,000,000, never higher.
  if (!Number.isInteger(max) || max < MIN_DECODE_ITERATIONS || max > MAX_ITERATIONS) {
    return fail(
      decryptionError(
        'invalid-parameter',
        `maxIterations must be an integer from ${MIN_DECODE_ITERATIONS} to ${MAX_ITERATIONS}, got ${max}`
      )
    );
  }
  return max;
}

function parseIterations(value: string | number | undefined, max: number): number | Failure {
  // Strings (object input) must be plain decimal digits, exactly as in the URL form.
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
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
  if (n > max) {
    return fail(
      decryptionError(
        'excessive-iterations',
        `PBKDF2 iteration count ${n} exceeds maxIterations (${max})`,
        { iterations: n, maxIterations: max }
      )
    );
  }
  return n;
}

/**
 * Validate every parameter and the key type, and decode all binary values,
 * without doing any key derivation.
 */
function prepare(p: CipherParams, options: DecryptionOptions): Prepared | Failure {
  if (!hasWebCrypto()) {
    return fail(decryptionError('unsupported-environment', NO_WEBCRYPTO_MESSAGE));
  }
  if (typeof options !== 'object' || options === null) {
    return fail(decryptionError('invalid-key', 'Decryption options with a key are required'));
  }
  const { key } = options;
  const max = resolveMaxIterations(options);
  if (isFailure(max)) return max;

  // 1. kdf and which parameters must / must not be present
  if (p.kdf === undefined) {
    if (!options.allowLegacy) {
      return fail(
        decryptionError(
          'legacy-format',
          `Missing 'kdf' parameter: this is a legacy (pre-1.3.0) payload. ` +
            `Pass { allowLegacy: true } to decrypt it during migration.`,
          { legacy: true }
        )
      );
    }
    if (p.salt !== undefined) {
      return fail(
        decryptionError('unexpected-parameter', `Legacy payloads have no 'salt'; refusing to guess`)
      );
    }
  } else if (p.kdf === 'pbkdf2') {
    if (!p.salt || p.iterations === undefined) {
      return fail(
        decryptionError('missing-parameter', `kdf=pbkdf2 requires 'salt' and 'i' parameters`, {
          path: [p.salt ? 'i' : 'salt'],
        })
      );
    }
  } else if (p.kdf === 'raw') {
    if (p.salt !== undefined || p.iterations !== undefined) {
      return fail(
        decryptionError('unexpected-parameter', `'salt' and 'i' must be omitted when kdf=raw`)
      );
    }
  } else {
    return fail(decryptionError('unsupported-kdf', `Unsupported kdf '${p.kdf}'`));
  }

  // 2. ciphertext and IV
  const ciphertext = decodeParam('e', p.payload);
  if (isFailure(ciphertext)) return ciphertext;
  if (ciphertext.length < GCM_TAG_LENGTH) {
    return fail(
      decryptionError(
        'invalid-parameter',
        `Ciphertext is ${ciphertext.length} bytes; it must include the ${GCM_TAG_LENGTH}-byte GCM tag`
      )
    );
  }
  const iv = decodeParam('iv', p.iv);
  if (isFailure(iv)) return iv;
  if (iv.length !== IV_LENGTH) {
    return fail(
      decryptionError('invalid-parameter', `IV must be ${IV_LENGTH} bytes, got ${iv.length}`)
    );
  }

  // 3. key derivation inputs and key type
  if (p.kdf === 'raw' || (p.kdf === undefined && !isPassphrase(key))) {
    if (!isRawKey(key)) {
      return fail(
        decryptionError('invalid-key', 'kdf=raw requires 32 raw key bytes or an AES-GCM CryptoKey')
      );
    }
    return { ciphertext, iv, mode: 'raw', rawKey: key };
  }

  const iterations = parseIterations(
    p.kdf === undefined ? (p.iterations ?? LEGACY_PBKDF2_ITERATIONS) : p.iterations,
    max
  );
  if (isFailure(iterations)) return iterations;
  let salt: Uint8Array<ArrayBuffer>;
  if (p.kdf === undefined) {
    salt = new Uint8Array(LEGACY_PBKDF2_SALT);
  } else {
    const decoded = decodeParam('salt', p.salt ?? '');
    if (isFailure(decoded)) return decoded;
    salt = decoded;
  }
  if (!isPassphrase(key)) {
    return fail(decryptionError('invalid-key', 'kdf=pbkdf2 requires a passphrase string key'));
  }
  return {
    ciphertext,
    iv,
    mode: 'pbkdf2',
    passphrase: key,
    salt,
    iterations,
    legacy: p.kdf === undefined,
  };
}

// =============================================================================
// DECRYPTION
// =============================================================================

/** Cache key for reusing one derived key across fields of the same label. */
function derivationId(prepared: Prepared): string | undefined {
  return prepared.mode === 'pbkdf2'
    ? `${prepared.iterations}:${Array.from(prepared.salt).join(',')}`
    : undefined;
}

/**
 * Derive the AES key. A legacy passphrase is used exactly as given, as 1.2.x
 * did; `nfc: true` derives from its NFC form instead (the legacy retry).
 * Every 1.3.0 passphrase is normalized to NFC.
 */
async function deriveKey(prepared: Prepared, nfc = false): Promise<CryptoKey | Failure> {
  try {
    if (prepared.mode === 'raw') {
      const resolved = await resolveRawKey(prepared.rawKey, 'decrypt');
      return typeof resolved === 'string'
        ? fail(decryptionError('invalid-key', resolved))
        : resolved;
    }
    const derive = prepared.legacy && !nfc ? deriveLegacyPassphraseKey : derivePassphraseKey;
    const bytes = await derive(prepared.passphrase, prepared.salt, prepared.iterations);
    return await importAesKey(bytes, 'decrypt');
  } catch (err) {
    return fail(
      decryptionError(
        'invalid-key',
        `Key derivation failed: ${err instanceof Error ? err.message : String(err)}`
      )
    );
  }
}

/** Key state for decrypting a single value: no retry may exceed `maxIterations`. */
function singleKeyState(prepared: Prepared, options: DecryptionOptions): KeyState {
  const max = options.maxIterations ?? DEFAULT_MAX_DECODE_ITERATIONS; // validated by prepare()
  return {
    keys: new Map(),
    remainingIterations: prepared.mode === 'pbkdf2' ? max - prepared.iterations : 0,
  };
}

/**
 * Derive (or reuse) the key and decrypt one value.
 *
 * Legacy passphrase payloads are first opened with the key 1.2.x derived,
 * from the passphrase exactly as given. If that fails authentication and the
 * passphrase is not in NFC, one retry derives from its NFC form, which opens a
 * legacy label made from the NFC spelling of the same passphrase (the common
 * case, and what 1.3.0 did). The retry is skipped when it would take the
 * total iterations above `maxIterations`. If the retry also fails, the
 * original `authentication-failed` error is returned unchanged.
 */
async function openValue(
  prepared: Prepared,
  state: KeyState,
  aad?: Uint8Array<ArrayBuffer>
): Promise<DecryptResult<string>> {
  const id = derivationId(prepared);
  const cached = id === undefined ? undefined : state.keys.get(id);
  if (cached !== undefined) return openPrepared(prepared, cached, aad);

  const cryptoKey = await deriveKey(prepared);
  if (isFailure(cryptoKey)) return cryptoKey;
  if (id !== undefined) state.keys.set(id, cryptoKey);
  const opened = await openPrepared(prepared, cryptoKey, aad);
  if (
    opened.success ||
    opened.error.reason !== 'authentication-failed' ||
    prepared.mode !== 'pbkdf2' ||
    !prepared.legacy ||
    prepared.passphrase === prepared.passphrase.normalize('NFC') ||
    prepared.iterations > state.remainingIterations
  ) {
    return opened;
  }

  state.remainingIterations -= prepared.iterations;
  const nfcKey = await deriveKey(prepared, true);
  if (isFailure(nfcKey)) return opened;
  const retried = await openPrepared(prepared, nfcKey, aad);
  if (!retried.success && retried.error.reason === 'authentication-failed') return opened;
  // The NFC key authenticated: use it for the label's other values too.
  if (id !== undefined) state.keys.set(id, nfcKey);
  return retried;
}

/** Decrypt normalized params to UTF-8 plaintext (no ID check). */
async function openParams(
  p: CipherParams,
  options: DecryptionOptions
): Promise<DecryptResult<string>> {
  const prepared = prepare(p, options);
  if (isFailure(prepared)) return prepared;
  return openValue(prepared, singleKeyState(prepared, options));
}

/**
 * AES-GCM decrypt already-validated input with a derived key. `aad` is the
 * field-level additional data; whole-label (URL) decryption uses none.
 */
async function openPrepared(
  prepared: Prepared,
  cryptoKey: CryptoKey,
  aad?: Uint8Array<ArrayBuffer>
): Promise<DecryptResult<string>> {
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      aad === undefined
        ? { name: 'AES-GCM', iv: prepared.iv }
        : { name: 'AES-GCM', iv: prepared.iv, additionalData: aad },
      cryptoKey,
      prepared.ciphertext
    );
  } catch {
    return fail(
      decryptionError(
        'authentication-failed',
        'Decryption failed: wrong key or tampered ciphertext (GCM authentication failed)'
      )
    );
  }

  let text: string;
  try {
    // ignoreBOM keeps a leading BOM visible so it can be rejected below.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(plaintext);
  } catch {
    return fail(decryptionError('invalid-plaintext', 'Decrypted payload is not valid UTF-8'));
  }
  if (text.startsWith('\uFEFF')) {
    return fail(
      decryptionError('invalid-plaintext', 'Decrypted payload starts with a byte order mark')
    );
  }
  return { success: true, data: text };
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Decrypt an encrypted label to its exact plaintext (the embedded JSON-LD string).
 *
 * Enforces every v1.3.0 wire rule, including that the decrypted specimen's
 * `id` equals `wemush:{id}` from the URL path. For object input the check is
 * made against the object's `id`; an object without `id` is not bound to any
 * ID, so prefer the URL form for untrusted input.
 *
 * @param input - `wemush://v1/encrypted/...` URL or an {@link EncryptedSpecimen}
 * @param options - `key`, and optional `allowLegacy` and `maxIterations`
 * @since 1.3.0
 */
export async function decryptPlaintext(
  input: string | EncryptedSpecimen,
  options: DecryptionOptions
): Promise<DecryptResult<string>> {
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
      // actualId comes from the plaintext: quote it, and bound its length,
      // so it cannot inject into logs.
      const shown = JSON.stringify(String(actualId).slice(0, 100));
      return fail(
        decryptionError(
          'id-mismatch',
          `Decrypted specimen id ${shown} does not match ${JSON.stringify(expectedId)}`,
          { expectedId, actualId }
        )
      );
    }
  }

  return opened;
}

/** Parse decrypted JSON as a validated Specimen, reporting failure as `invalid-plaintext`. */
function parseDecrypted(
  json: string,
  what: string,
  options: DecryptionOptions
): DecryptResult<Specimen> {
  const parsed = parseSpecimen(
    json,
    options.onWarning === undefined ? {} : { onWarning: options.onWarning }
  );
  if (parsed.success) return parsed;
  return fail(
    decryptionError(
      'invalid-plaintext',
      `${what} is not a valid WOLS specimen: ${parsed.error.message}`,
      { parseError: parsed.error }
    )
  );
}

/**
 * Decrypt an encrypted label and parse it into a validated Specimen.
 *
 * @param input - `wemush://v1/encrypted/...` URL or an {@link EncryptedSpecimen}
 * @param options - `key`, and optional `allowLegacy` and `maxIterations`
 * @returns DecryptResult; on failure `error.reason` gives the category
 *
 * @example
 * ```typescript
 * const result = await decryptSpecimen(url, { key: 'correct horse battery staple' });
 * if (result.success) console.log(result.data.species);
 * else console.error(result.error.reason, result.error.message);
 * ```
 *
 * @since 1.3.0 Accepts encrypted URLs, raw key bytes, `allowLegacy` and `maxIterations`
 */
export async function decryptSpecimen(
  input: string | EncryptedSpecimen,
  options: DecryptionOptions
): Promise<DecryptResult<Specimen>> {
  const plaintext = await decryptPlaintext(input, options);
  if (!plaintext.success) return plaintext;
  return parseDecrypted(plaintext.data, 'Decrypted label', options);
}

/**
 * Decrypt a single field-level {@link EncryptedField} to its original value.
 *
 * `binding` names the label and field the value belongs to. It is the AES-GCM
 * additional data (`"{id}\n{field}"`, WOLS 1.3.0), so a value moved to another
 * field or copied from another label fails with `authentication-failed`.
 * Legacy (pre-1.3.0) values, which have no `kdf`, carry no binding.
 *
 * @example
 * ```typescript
 * const r = await decryptField(partial.strain, { key }, { id: partial.id, field: 'strain' });
 * ```
 *
 * @since 1.3.0
 */
export async function decryptField(
  field: EncryptedField,
  options: DecryptionOptions,
  binding: FieldBinding
): Promise<DecryptResult<unknown>> {
  if (typeof field !== 'object' || field === null || field.encrypted !== true) {
    return fail(decryptionError('invalid-parameter', 'Expected an encrypted field object'));
  }
  const aad = bindingAad(field, binding);
  if (isFailure(aad)) return aad;
  const prepared = prepare(fieldParams(field), options);
  if (isFailure(prepared)) return prepared;
  const opened = await openValue(prepared, singleKeyState(prepared, options), aad);
  if (!opened.success) return opened;
  try {
    return { success: true, data: JSON.parse(opened.data) as unknown };
  } catch {
    return fail(decryptionError('invalid-plaintext', 'Decrypted field is not valid JSON'));
  }
}

/** The label and top-level field an encrypted value belongs to. */
export interface FieldBinding {
  /** The label's full id, e.g. `"wemush:clx1a2b3c4"` */
  id: string;
  /** The top-level field name, e.g. `"strain"` */
  field: string;
}

function fieldParams(field: EncryptedField): CipherParams {
  return {
    idSuffix: undefined,
    payload: field.payload,
    iv: field.iv,
    kdf: field.kdf,
    salt: field.salt,
    iterations: field.iterations,
  };
}

/** AAD for a field value, or undefined for legacy values (no kdf, no binding). */
function bindingAad(
  field: EncryptedField,
  binding: FieldBinding | undefined
): Uint8Array<ArrayBuffer> | undefined | Failure {
  if ((field as { kdf?: unknown }).kdf === undefined) return undefined;
  if (
    typeof binding !== 'object' ||
    binding === null ||
    typeof binding.id !== 'string' ||
    !binding.id.startsWith('wemush:') ||
    binding.id.length === 'wemush:'.length ||
    typeof binding.field !== 'string' ||
    binding.field.length === 0
  ) {
    return fail(
      decryptionError(
        'invalid-parameter',
        "Field decryption needs the label's id and the field name (they are the AES-GCM additional data)"
      )
    );
  }
  return fieldAad(binding.id, binding.field);
}

/**
 * Decrypt every field-level encrypted value in a specimen produced by
 * `encryptFields()`, and return the restored, validated Specimen.
 *
 * Before any key is derived:
 * - a label whose identifying fields (`@context`, `@type`, `id`, `version`,
 *   `type`, `species`) include an encrypted object is refused
 *   (`identifying-field`); decrypted values never replace them
 * - every encrypted field is validated
 * - the iterations of each distinct (salt, iterations) pair are summed, and
 *   the label is refused if the total exceeds `maxIterations` (10,000,000)
 *
 * Fields sharing a salt and iteration count share one derivation. Each value
 * is authenticated against its AAD, `"{id}\n{field}"`, so swapped or copied
 * values fail with `authentication-failed`.
 *
 * @example
 * ```typescript
 * const partial = await encryptFields(specimen, { key, fields: ['strain'] });
 * const restored = await decryptFields(partial, { key });
 * if (restored.success) restored.data.strain?.name;
 * ```
 *
 * @since 1.3.0
 */
export async function decryptFields(
  value: FieldEncryptedSpecimen | Record<string, unknown>,
  options: DecryptionOptions
): Promise<DecryptResult<Specimen>> {
  if (typeof value !== 'object' || value === null) {
    return fail(decryptionError('invalid-parameter', 'Expected a field-encrypted specimen object'));
  }

  const fieldError = (name: string, error: WolsDecryptionError): Failure =>
    fail(
      decryptionError(error.reason, `Field '${name}': ${error.message}`, {
        ...error.details,
        path: [name],
      })
    );

  const isEncryptedValue = (v: unknown): boolean =>
    typeof v === 'object' && v !== null && (v as { encrypted?: unknown }).encrypted === true;

  // 0. Identifying fields must be cleartext, and the id is the AAD.
  const record = value as Record<string, unknown>;
  const encryptedIdentifying = IDENTIFYING_FIELDS.filter(name => isEncryptedValue(record[name]));
  if (encryptedIdentifying.length > 0) {
    return fail(
      decryptionError(
        'identifying-field',
        `Identifying field(s) ${encryptedIdentifying.join(', ')} must not be encrypted`,
        { path: encryptedIdentifying }
      )
    );
  }
  const labelId = record['id'];

  // 1. Validate every encrypted field before any key derivation.
  const pending: { name: string; prepared: Prepared; aad: Uint8Array<ArrayBuffer> | undefined }[] =
    [];
  for (const [name, fieldValue] of Object.entries(value)) {
    if (
      typeof fieldValue !== 'object' ||
      fieldValue === null ||
      (fieldValue as { encrypted?: unknown }).encrypted !== true
    ) {
      continue;
    }
    const field = fieldValue as EncryptedField;
    const prepared = prepare(fieldParams(field), options);
    if (isFailure(prepared)) return fieldError(name, prepared.error);
    const aad = bindingAad(field, { id: labelId as string, field: name });
    if (isFailure(aad)) return fieldError(name, aad.error);
    pending.push({ name, prepared, aad });
  }

  // 2. Bound the total key-derivation cost of the document.
  const max = resolveMaxIterations(options);
  if (isFailure(max)) return max;
  const derivations = new Map<string, number>();
  for (const { prepared } of pending) {
    const id = derivationId(prepared);
    if (id !== undefined && prepared.mode === 'pbkdf2') derivations.set(id, prepared.iterations);
  }
  const total = [...derivations.values()].reduce((sum, n) => sum + n, 0);
  if (total > max) {
    return fail(
      decryptionError(
        'excessive-iterations',
        `Document needs ${total} PBKDF2 iterations across ${derivations.size} distinct salts, ` +
          `exceeding maxIterations (${max})`,
        { iterations: total, maxIterations: max }
      )
    );
  }

  // 3. Derive (once per distinct salt) and decrypt. A legacy NFC retry may
  //    use only what is left of the budget.
  const state: KeyState = { keys: new Map(), remainingIterations: max - total };
  const result: Record<string, unknown> = { ...value };
  for (const { name, prepared, aad } of pending) {
    const opened = await openValue(prepared, state, aad);
    if (!opened.success) return fieldError(name, opened.error);
    try {
      result[name] = JSON.parse(opened.data) as unknown;
    } catch {
      return fieldError(
        name,
        decryptionError('invalid-plaintext', 'Decrypted field is not valid JSON')
      );
    }
  }

  let json: string;
  try {
    json = JSON.stringify(result);
  } catch (err) {
    return fail(
      decryptionError(
        'invalid-parameter',
        `Restored specimen cannot be serialized: ${err instanceof Error ? err.message : String(err)}`
      )
    );
  }
  return parseDecrypted(json, 'Restored specimen', options);
}
