/**
 * WOLS 1.4.0 signatures: Ed25519 over embedded labels and encrypted URLs.
 *
 * - Token: `{kid}.{sig}`, the 64-byte signature as canonical unpadded base64url.
 * - Signing input: `"WOLS-SIG-v1\n" + form + "\n" + kid + "\n" + body`.
 * - Embedded body: RFC 8785 (JCS) of the parsed label without its top-level
 *   `signature`, built from the label as parsed, never from the library model.
 * - Encrypted URL body: the exact URL with its final `&sig=` parameter removed.
 * - Keys come only from the caller's trust store, never from the label.
 *
 * Uses WebCrypto Ed25519 only (Node.js 20+, Bun, Deno, current browsers).
 * Verification never throws for a bad signature, and decoding never verifies.
 *
 * @module crypto/signature
 */

import { WolsSignatureError } from '../errors.js';
import type {
  SignatureStatus,
  SigningOptions,
  TrustStore,
  TrustStoreEntry,
  VerificationResult,
} from '../types.js';

import { JcsError, canonicalizeJson, hasDuplicateMemberNames } from './jcs.js';
import { ENCRYPTED_URL_PREFIX, base64UrlDecode, base64UrlEncode, isCryptoKey } from './shared.js';

// =============================================================================
// CONSTANTS
// =============================================================================

/** First line of every WOLS 1.4.0 signing input. */
export const SIGNING_DOMAIN = 'WOLS-SIG-v1';

/** Signature form: an embedded label or an encrypted URL. */
export type SignatureForm = 'embedded' | 'encrypted-url';

const KID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const TOKEN_PATTERN = /^([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{86})$/;
/** Every character of a signable URL is in U+0021..U+007E. */
const URL_CHARS = /^[\x21-\x7e]*$/;
/** A string starting with a URI scheme is treated as a URL; JSON text can't. */
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

const SEED_LENGTH = 32;
const PUBLIC_KEY_LENGTH = 32;
const SIGNATURE_LENGTH = 64;

/** Ed25519 group order L = 2^252 + 27742317777372353535851937790883648493. */
const GROUP_ORDER = (1n << 252n) + 27742317777372353535851937790883648493n;

/** PKCS#8 wrapping of a 32-byte Ed25519 seed (RFC 8410): this prefix, then the seed. */
const PKCS8_ED25519_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

const ED25519 = { name: 'Ed25519' } as const;

// =============================================================================
// INTERNALS
// =============================================================================

/** A rule in the signature section is broken: the status is `malformed`. */
class Malformed extends Error {}

const encoder = new TextEncoder();

function subtle(): SubtleCrypto {
  const s = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!s) {
    throw new WolsSignatureError(
      'WebCrypto (globalThis.crypto.subtle) is not available in this runtime. ' +
        'Use Node.js 20+, a current browser, Deno or Bun.'
    );
  }
  return s;
}

function unsupported(err: unknown): WolsSignatureError {
  return new WolsSignatureError(
    'This runtime does not support Ed25519 in WebCrypto. ' +
      'Use Node.js 20+, Bun, Deno, or a browser with WebCrypto Ed25519.',
    { cause: err instanceof Error ? err.message : String(err) }
  );
}

/** Copy into a fresh ArrayBuffer-backed view (WebCrypto-safe). */
function owned(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

/** The signing input string. Everything before `body` is ASCII; encode as UTF-8. */
function signingInputText(form: SignatureForm, kid: string, body: string): string {
  return `${SIGNING_DOMAIN}\n${form}\n${kid}\n${body}`;
}

/** Split a token into kid and signature bytes, or throw Malformed. */
function parseToken(token: unknown): { kid: string; signature: Uint8Array<ArrayBuffer> } {
  if (typeof token !== 'string') {
    throw new Malformed('The signature token is not a string');
  }
  const m = TOKEN_PATTERN.exec(token);
  if (!m) {
    throw new Malformed('The signature token does not match `{kid}.{86 base64url characters}`');
  }
  const kid = m[1] as string;
  const sig = m[2] as string;
  const signature = base64UrlDecode(sig);
  // 86 characters carry 516 bits; the last 4 must be zero (one encoding per signature).
  if (signature.length !== SIGNATURE_LENGTH || base64UrlEncode(signature) !== sig) {
    throw new Malformed('The signature is not the canonical encoding of 64 bytes');
  }
  return { kid, signature };
}

/** Parse label text (or take a parsed object) into a JSON object, or throw Malformed. */
function toLabelObject(label: string | object): Record<string, unknown> {
  let value: unknown = label;
  if (typeof label === 'string') {
    try {
      value = JSON.parse(label);
    } catch {
      throw new Malformed('The label is not valid JSON');
    }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Malformed('The label is not a JSON object');
  }
  return value as Record<string, unknown>;
}

/** Copy of a label without its top-level `signature` (other members kept, `__proto__` safe). */
function withoutSignature(label: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(label).filter(([key]) => key !== 'signature'));
}

/** Embedded body: JCS of the label without its top-level signature. Throws Malformed. */
function embeddedBody(label: Record<string, unknown>, text: string | undefined): string {
  if (text !== undefined && hasDuplicateMemberNames(text)) {
    throw new Malformed('The label has duplicate member names');
  }
  try {
    return canonicalizeJson(withoutSignature(label));
  } catch (err) {
    if (err instanceof JcsError) throw new Malformed(`The label is not I-JSON: ${err.message}`);
    throw err;
  }
}

/** Exact parameter names of a URL query: text before the first `=`, no decoding. */
function urlParams(url: string): string[] {
  const q = url.indexOf('?');
  return q === -1 ? [] : url.slice(q + 1).split('&');
}

function paramName(param: string): string {
  const eq = param.indexOf('=');
  return eq === -1 ? param : param.slice(0, eq);
}

/** Rules every signable URL meets (the unsigned body and the signed URL alike). */
function checkUrlShape(url: string): string | undefined {
  if (!URL_CHARS.test(url)) {
    return 'The URL has a character outside U+0021..U+007E; percent-encode spaces and non-ASCII';
  }
  if (url.includes('#')) return 'The URL has a fragment (#)';
  if (!url.startsWith(ENCRYPTED_URL_PREFIX)) {
    return `The URL does not start with '${ENCRYPTED_URL_PREFIX}'`;
  }
  return undefined;
}

/** Ed25519 S value (little-endian, second half of the signature) is less than L. */
function hasCanonicalS(signature: Uint8Array): boolean {
  let s = 0n;
  for (let i = SIGNATURE_LENGTH - 1; i >= SIGNATURE_LENGTH / 2; i--) {
    s = (s << 8n) | BigInt(signature[i] as number);
  }
  return s < GROUP_ORDER;
}

async function importPrivateKey(privateKey: Uint8Array | CryptoKey): Promise<CryptoKey> {
  if (isCryptoKey(privateKey)) {
    const name = (privateKey.algorithm as { name?: string }).name;
    if (
      name !== 'Ed25519' ||
      privateKey.type !== 'private' ||
      !privateKey.usages.includes('sign')
    ) {
      throw new WolsSignatureError(
        'privateKey must be an Ed25519 private CryptoKey with the sign usage'
      );
    }
    return privateKey;
  }
  if (!(privateKey instanceof Uint8Array) || privateKey.length !== SEED_LENGTH) {
    throw new WolsSignatureError(
      `privateKey must be the ${SEED_LENGTH}-byte Ed25519 seed or an Ed25519 CryptoKey`
    );
  }
  const pkcs8 = new Uint8Array(PKCS8_ED25519_PREFIX.length + SEED_LENGTH);
  pkcs8.set(PKCS8_ED25519_PREFIX);
  pkcs8.set(privateKey, PKCS8_ED25519_PREFIX.length);
  const s = subtle();
  try {
    return await s.importKey('pkcs8', pkcs8, ED25519, false, ['sign']);
  } catch (err) {
    throw unsupported(err);
  } finally {
    pkcs8.fill(0);
  }
}

function checkKid(kid: unknown): asserts kid is string {
  if (typeof kid !== 'string' || !KID_PATTERN.test(kid)) {
    throw new WolsSignatureError('kid must be 1 to 64 characters from A-Z, a-z, 0-9, - and _', {
      kid,
    });
  }
}

/** Sign a signing input and return the token. */
async function makeToken(
  form: SignatureForm,
  body: string,
  options: SigningOptions
): Promise<string> {
  if (typeof options !== 'object' || options === null) {
    throw new WolsSignatureError('Signing requires { privateKey, kid }');
  }
  const { kid, privateKey } = options;
  checkKid(kid);
  const key = await importPrivateKey(privateKey);
  const message = encoder.encode(signingInputText(form, kid, body));
  let signature: ArrayBuffer;
  try {
    signature = await subtle().sign(ED25519, key, message);
  } catch (err) {
    throw unsupported(err);
  }
  return `${kid}.${base64UrlEncode(signature)}`;
}

// =============================================================================
// SIGNING INPUT (shared by sign and verify; exported for tests and debugging)
// =============================================================================

/** Signature parts located in a label or URL, ready to check. */
interface Located {
  kid: string;
  signature: Uint8Array<ArrayBuffer>;
  signingInput: string;
}

/**
 * Find the signature in a label or URL and build its signing input.
 * Returns `undefined` when unsigned; throws Malformed for any broken rule.
 */
function locate(label: string | object): Located | undefined {
  if (typeof label === 'string' && URL_SCHEME.test(label)) {
    const url = label;
    const params = urlParams(url);
    const names = params.map(paramName);
    if (!names.includes('sig')) return undefined;
    const shape = checkUrlShape(url);
    if (shape) throw new Malformed(shape);
    if (names.filter(n => n === 'sig').length !== 1) {
      throw new Malformed('The URL has more than one sig parameter');
    }
    const last = params[params.length - 1] as string;
    if (names[names.length - 1] !== 'sig') throw new Malformed('sig is not the last parameter');
    if (params.length < 2) throw new Malformed('sig is the only parameter');
    if (!last.startsWith('sig=')) throw new Malformed('The sig parameter has no value');
    const token = last.slice('sig='.length);
    const { kid, signature } = parseToken(token);
    const body = url.slice(0, url.length - ('&sig='.length + token.length));
    return { kid, signature, signingInput: signingInputText('encrypted-url', kid, body) };
  }

  const object = toLabelObject(label);
  if (!Object.prototype.hasOwnProperty.call(object, 'signature')) return undefined;
  const { kid, signature } = parseToken(object['signature']);
  const body = embeddedBody(object, typeof label === 'string' ? label : undefined);
  return { kid, signature, signingInput: signingInputText('embedded', kid, body) };
}

/**
 * The signing input a verifier would check for this label or URL, or
 * `undefined` if it is unsigned or malformed. For debugging and tests.
 *
 * @internal
 */
export function getSigningInput(label: string | object): string | undefined {
  try {
    return locate(label)?.signingInput;
  } catch (err) {
    if (err instanceof Malformed) return undefined;
    throw err;
  }
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Sign an embedded label (WOLS 1.4.0).
 *
 * Removes any existing top-level `signature`, signs the RFC 8785 canonical form
 * of the rest, and returns the label text with `signature` set to the new token
 * (as the last member). The returned text is exactly what was signed; print it
 * as is. Re-signing replaces the old signature.
 *
 * Pass label text (for a library `Specimen`, `serializeSpecimen(specimen)`), or
 * a parsed JSON object. Objects must be plain JSON values.
 *
 * @param label - Embedded label text, or a parsed JSON object
 * @param options - `privateKey` (32-byte seed or Ed25519 CryptoKey) and `kid`
 * @returns The signed label text
 * @throws WolsSignatureError if the label isn't a JSON object, has duplicate
 *   member names, a lone surrogate or a non-finite number; if the kid or key is
 *   unusable; or if the runtime lacks WebCrypto Ed25519
 *
 * @example
 * ```typescript
 * const signed = await signSpecimen(serializeSpecimen(specimen), {
 *   privateKey: seed, // 32 bytes, kept secret
 *   kid: 'mushoh-2026',
 * });
 * ```
 *
 * @since 1.4.0
 */
export async function signSpecimen(
  label: string | object,
  options: SigningOptions
): Promise<string> {
  let object: Record<string, unknown>;
  let body: string;
  try {
    object = toLabelObject(label);
    body = embeddedBody(object, typeof label === 'string' ? label : undefined);
  } catch (err) {
    if (err instanceof Malformed) throw new WolsSignatureError(`Refusing to sign: ${err.message}`);
    throw err;
  }
  const token = await makeToken('embedded', body, options);
  const signed = withoutSignature(object);
  Object.defineProperty(signed, 'signature', {
    value: token,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return JSON.stringify(signed);
}

/**
 * Sign an encrypted URL (WOLS 1.4.0).
 *
 * The URL is signed byte for byte as given, and `&sig={kid}.{signature}` is
 * appended. Print the result exactly; any re-encoding or reordering of its
 * parameters invalidates the signature.
 *
 * @param url - The complete unsigned `wemush://v1/encrypted/...` URL
 * @param options - `privateKey` (32-byte seed or Ed25519 CryptoKey) and `kid`
 * @returns The signed URL
 * @throws WolsSignatureError if the URL already has a `sig` parameter, has no
 *   query, has a fragment or a character outside U+0021..U+007E, or isn't an
 *   encrypted URL; if the kid or key is unusable; or if the runtime lacks
 *   WebCrypto Ed25519
 *
 * @since 1.4.0
 */
export async function signEncryptedUrl(url: string, options: SigningOptions): Promise<string> {
  if (typeof url !== 'string') {
    throw new WolsSignatureError('Refusing to sign: the URL is not a string');
  }
  const shape = checkUrlShape(url);
  if (shape) throw new WolsSignatureError(`Refusing to sign: ${shape}`);
  if (!url.includes('?')) {
    // Without a query, `&sig=` would not be a parameter and the result would verify as unsigned.
    throw new WolsSignatureError('Refusing to sign: the URL has no query parameters');
  }
  if (urlParams(url).some(p => paramName(p) === 'sig')) {
    throw new WolsSignatureError(
      'Refusing to sign: the URL already has a sig parameter; remove it to re-sign'
    );
  }
  const token = await makeToken('encrypted-url', url, options);
  return `${url}&sig=${token}`;
}

/**
 * Verify the signature on an embedded label or an encrypted URL (WOLS 1.4.0).
 *
 * Checks, in this fixed order: `unsigned`, then every `malformed` rule, then
 * the trust store (`unknown-kid`), then the signature (`invalid` or `valid`).
 * Only `valid` means the label is authentic. Keys come only from `trustStore`;
 * any key or hint inside the label is ignored. No network access.
 *
 * Pass the label text exactly as scanned. A string that starts with a URI
 * scheme (such as `wemush:`) is verified as an encrypted URL; any other string
 * is parsed as embedded label JSON. A parsed object is accepted, but it must be
 * the raw JSON value, never a `Specimen` rebuilt by `parseSpecimen()`: the
 * library model drops or normalizes members, which changes the signed bytes.
 *
 * A `valid` result proves only that the holder of the trust store's key for the
 * kid signed these exact bytes. It says nothing about freshness, and it doesn't
 * prove that the label belongs on the item it is attached to.
 *
 * @param label - Embedded label text, a parsed JSON object, or an encrypted URL
 * @param trustStore - kid to `{ alg: 'Ed25519', publicKey }` (32 bytes)
 * @returns The status (never throws for a bad signature)
 * @throws WolsSignatureError only if the runtime lacks WebCrypto Ed25519
 *
 * @example
 * ```typescript
 * const result = await verifySpecimen(scannedText, {
 *   'mushoh-2026': { alg: 'Ed25519', publicKey: mushohPublicKey },
 * });
 * if (result.status === 'valid') showVerifiedBadge(result.kid);
 * ```
 *
 * @since 1.4.0
 */
export async function verifySpecimen(
  label: string | object,
  trustStore: TrustStore
): Promise<VerificationResult> {
  let located: Located | undefined;
  try {
    if (label === null || (typeof label !== 'string' && typeof label !== 'object')) {
      throw new Malformed('Expected label text, a parsed JSON object, or an encrypted URL');
    }
    located = locate(label);
  } catch (err) {
    if (err instanceof Malformed) return { status: 'malformed', reason: err.message };
    throw err;
  }
  if (located === undefined) {
    return { status: 'unsigned', reason: 'The label carries no signature' };
  }

  const { kid, signature, signingInput } = located;
  const entry: TrustStoreEntry | undefined =
    typeof trustStore === 'object' &&
    trustStore !== null &&
    Object.prototype.hasOwnProperty.call(trustStore, kid)
      ? trustStore[kid]
      : undefined;
  if (
    !entry ||
    entry.alg !== 'Ed25519' ||
    !(entry.publicKey instanceof Uint8Array) ||
    entry.publicKey.length !== PUBLIC_KEY_LENGTH
  ) {
    return result('unknown-kid', kid, `kid '${kid}' is not an Ed25519 key in the trust store`);
  }

  // RFC 8032 §5.1.7 with S < L enforced here, whatever the WebCrypto backend does.
  if (!hasCanonicalS(signature)) {
    return result('invalid', kid, 'The signature S value is not less than the group order');
  }

  const s = subtle();
  let publicKey: CryptoKey;
  try {
    publicKey = await s.importKey('raw', owned(entry.publicKey), ED25519, false, ['verify']);
  } catch (err) {
    if (await ed25519Supported()) {
      // The bytes don't decode to a curve point: RFC 8032 says the signature is invalid.
      return result('invalid', kid, 'The trust store key is not a valid Ed25519 public key');
    }
    throw unsupported(err);
  }
  let ok: boolean;
  try {
    ok = await s.verify(ED25519, publicKey, signature, encoder.encode(signingInput));
  } catch {
    ok = false;
  }
  return ok
    ? { status: 'valid', kid }
    : result('invalid', kid, `The signature does not verify under the key for kid '${kid}'`);
}

function result(status: SignatureStatus, kid: string, reason: string): VerificationResult {
  return { status, kid, reason };
}

let ed25519Probe: Promise<boolean> | undefined;

/** Whether this runtime's WebCrypto supports Ed25519 (cached). */
function ed25519Supported(): Promise<boolean> {
  ed25519Probe ??= (async () => {
    try {
      await subtle().generateKey(ED25519, false, ['sign', 'verify']);
      return true;
    } catch {
      return false;
    }
  })();
  return ed25519Probe;
}

/**
 * Derive the 32-byte Ed25519 public key for a private key seed, for building
 * trust stores or publishing a key set document.
 *
 * @param privateKey - The 32-byte Ed25519 seed
 * @throws WolsSignatureError for a key that isn't 32 bytes, or a runtime without WebCrypto Ed25519
 * @since 1.4.0
 */
export async function getSigningPublicKey(privateKey: Uint8Array): Promise<Uint8Array> {
  if (!(privateKey instanceof Uint8Array) || privateKey.length !== SEED_LENGTH) {
    throw new WolsSignatureError(`privateKey must be the ${SEED_LENGTH}-byte Ed25519 seed`);
  }
  const pkcs8 = new Uint8Array(PKCS8_ED25519_PREFIX.length + SEED_LENGTH);
  pkcs8.set(PKCS8_ED25519_PREFIX);
  pkcs8.set(privateKey, PKCS8_ED25519_PREFIX.length);
  const s = subtle();
  let jwk: JsonWebKey;
  try {
    const key = await s.importKey('pkcs8', pkcs8, ED25519, true, ['sign']);
    jwk = await s.exportKey('jwk', key);
  } catch (err) {
    throw unsupported(err);
  } finally {
    pkcs8.fill(0);
  }
  if (typeof jwk.x !== 'string') throw unsupported(new Error('JWK export has no x'));
  return base64UrlDecode(jwk.x);
}
