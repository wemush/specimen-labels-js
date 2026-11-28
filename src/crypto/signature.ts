/**
 * WOLS signatures: Ed25519 over embedded labels and encrypted URLs (1.4.0),
 * and compact URLs (1.5.0).
 *
 * - Token: `{kid}.{sig}`, the 64-byte signature as canonical unpadded base64url.
 * - Signing input: `"WOLS-SIG-v1\n" + form + "\n" + kid + "\n" + body`.
 * - Embedded body: RFC 8785 (JCS) of the parsed label without its top-level
 *   `signature`, built from the label as parsed, never from the library model.
 * - Encrypted and compact URL body: the exact URL with its final `&sig=`
 *   parameter removed. Nothing is decoded, re-encoded or reordered.
 * - Form: a string with a URI scheme is a URL. A `wemush://v1/{one segment}`
 *   URL that isn't an encrypted URL is `compact-url`; any other URL is
 *   `encrypted-url`. Anything else is `embedded`.
 * - Keys come only from the caller's trust store, never from the label.
 *
 * Uses WebCrypto Ed25519 only (Node.js 20+, Bun, Deno, current browsers).
 * Verification never throws for a bad signature, and decoding never verifies.
 *
 * @module crypto/signature
 */

import {
  COMPACT_URL_PREFIX,
  decodeComponent,
  decodesStrictly,
  isCompactUrlShape,
  isRegisteredCompactParameter,
} from '../compact-url.js';
import { WolsSignatureError } from '../errors.js';
import type {
  KeySetEntry,
  KeySetOptions,
  SignatureForm,
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

export type { SignatureForm } from '../types.js';

const KID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const TOKEN_PATTERN = /^([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{86})$/;
/** Every character of a signable URL is in U+0021..U+007E. */
const URL_CHARS = /^[\x21-\x7e]*$/;
/** A string starting with a URI scheme is treated as a URL; JSON text can't. */
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
/** A compact URL parameter name (other than the unchecked `sig`), WOLS 1.5.0. */
const COMPACT_PARAM_NAME = /^[A-Za-z0-9_-]+$/;
/** The `https://{host}/wols/{x}` handler form that {@link unwrapWolsUrl} reads. */
const HANDLER_URL = /^https:\/\/[^/?#]+\/wols\/([\s\S]+)$/;

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

/**
 * Parse label text (or take a parsed object) as an I-JSON object, or throw
 * Malformed. Runs before anything else, whether or not the label is signed:
 * not JSON, not an object, duplicate member names (after unescaping, at any
 * depth), lone surrogates, and non-finite or overflowing numbers are all refused.
 */
function parseLabel(label: string | object): Record<string, unknown> {
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
  // JSON.parse silently keeps the last duplicate, so scan the text for them.
  if (typeof label === 'string' && hasDuplicateMemberNames(label)) {
    throw new Malformed('The label has duplicate member names');
  }
  try {
    // Rejects lone surrogates, NaN/Infinity (including overflow such as 1e400),
    // and anything else that isn't a plain JSON value.
    canonicalizeJson(value);
  } catch (err) {
    if (err instanceof JcsError) throw new Malformed(`The label is not I-JSON: ${err.message}`);
    throw err;
  }
  return value as Record<string, unknown>;
}

/** Copy of a label without its top-level `signature` (other members kept, `__proto__` safe). */
function withoutSignature(label: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(label).filter(([key]) => key !== 'signature'));
}

/** Embedded body: JCS of a parsed (already I-JSON-checked) label without its top-level signature. */
function embeddedBody(label: Record<string, unknown>): string {
  return canonicalizeJson(withoutSignature(label));
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

/** The form a string or object is read as (WOLS 1.5.0 form detection). */
function detectForm(label: string | object): SignatureForm {
  if (typeof label !== 'string' || !URL_SCHEME.test(label)) return 'embedded';
  return isCompactUrlShape(label) ? 'compact-url' : 'encrypted-url';
}

/** Rules every signable URL meets (the unsigned body and the signed URL alike). */
function checkUrlShape(url: string, form: SignatureForm): string | undefined {
  if (!URL_CHARS.test(url)) {
    return 'The URL has a character outside U+0021..U+007E; percent-encode spaces and non-ASCII';
  }
  if (url.includes('#')) return 'The URL has a fragment (#)';
  if (form === 'encrypted-url' && !url.startsWith(ENCRYPTED_URL_PREFIX)) {
    return `The URL does not start with '${ENCRYPTED_URL_PREFIX}', and isn't a signable compact URL`;
  }
  return undefined;
}

/**
 * The extra compact URL rules (WOLS 1.5.0), on the parameters before `sig`:
 * the signable shape, no empty parameter, plain names that appear once, and
 * strict escapes in every value and in the path segment.
 */
function checkCompactParts(url: string, params: readonly string[]): string | undefined {
  if (!isCompactUrlShape(url)) {
    return `The URL is not a signable compact URL ('${COMPACT_URL_PREFIX}' and one path segment)`;
  }
  const seen = new Set<string>();
  for (const p of params) {
    if (p === '') return 'The URL has an empty parameter';
    const name = paramName(p);
    if (!COMPACT_PARAM_NAME.test(name)) {
      return `Parameter name '${name}' is not plain letters, digits, '_' and '-'`;
    }
    if (seen.has(name)) return `Parameter '${name}' appears more than once`;
    seen.add(name);
    const eq = p.indexOf('=');
    if (!decodesStrictly(eq === -1 ? '' : p.slice(eq + 1))) {
      return `Parameter '${name}' has a malformed percent escape or invalid UTF-8`;
    }
  }
  const q = url.indexOf('?');
  if (!decodesStrictly(url.slice(COMPACT_URL_PREFIX.length, q === -1 ? url.length : q))) {
    return 'The ID has a malformed percent escape or invalid UTF-8';
  }
  return undefined;
}

/** The decoded parameters of a verified compact body, and the unrecognized names. */
function compactParams(params: readonly string[]): {
  params: Record<string, string>;
  unrecognizedParams: string[];
} {
  const decoded: Record<string, string> = {};
  const unrecognizedParams: string[] = [];
  for (const p of params) {
    const eq = p.indexOf('=');
    const name = paramName(p);
    Object.defineProperty(decoded, name, {
      value: decodeComponent(eq === -1 ? '' : p.slice(eq + 1), true),
      enumerable: true,
      writable: true,
      configurable: true,
    });
    if (!isRegisteredCompactParameter(name)) unrecognizedParams.push(name);
  }
  return { params: decoded, unrecognizedParams };
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
  form: SignatureForm;
  kid: string;
  signature: Uint8Array<ArrayBuffer>;
  signingInput: string;
  /** Compact URLs only: the parameters before `sig`, as printed */
  compactParams?: string[];
}

/**
 * Find the signature in a label or URL and build its signing input.
 * Returns `undefined` when unsigned; throws Malformed for any broken rule.
 */
function locate(label: string | object): Located | undefined {
  const form = detectForm(label);
  if (typeof label === 'string' && form !== 'embedded') {
    const url = label;
    const params = urlParams(url);
    const names = params.map(paramName);
    if (!names.includes('sig')) return undefined;
    const shape = checkUrlShape(url, form);
    if (shape) throw new Malformed(shape);
    if (names.filter(n => n === 'sig').length !== 1) {
      throw new Malformed('The URL has more than one sig parameter');
    }
    const last = params[params.length - 1] as string;
    if (names[names.length - 1] !== 'sig') throw new Malformed('sig is not the last parameter');
    if (params.length < 2) throw new Malformed('sig is the only parameter');
    if (!last.startsWith('sig=')) throw new Malformed('The sig parameter has no value');
    const signed = params.slice(0, -1);
    if (form === 'compact-url') {
      const problem = checkCompactParts(url, signed);
      if (problem) throw new Malformed(problem);
    }
    const token = last.slice('sig='.length);
    const { kid, signature } = parseToken(token);
    const body = url.slice(0, url.length - ('&sig='.length + token.length));
    const located: Located = {
      form,
      kid,
      signature,
      signingInput: signingInputText(form, kid, body),
    };
    if (form === 'compact-url') located.compactParams = signed;
    return located;
  }

  const object = parseLabel(label);
  if (!Object.prototype.hasOwnProperty.call(object, 'signature')) return undefined;
  const { kid, signature } = parseToken(object['signature']);
  const body = embeddedBody(object);
  return { form, kid, signature, signingInput: signingInputText('embedded', kid, body) };
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
    object = parseLabel(label);
    body = embeddedBody(object);
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
  const shape = checkUrlShape(url, 'encrypted-url');
  if (shape) throw new WolsSignatureError(`Refusing to sign: ${shape}`);
  const q = url.indexOf('?');
  if (q === -1 || q === url.length - 1) {
    throw new WolsSignatureError('Refusing to sign: the URL has no query (or an empty one)');
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
 * Sign a compact URL (WOLS 1.5.0).
 *
 * Pass the complete unsigned compact URL exactly as it will be printed (for
 * example, the output of `toCompactUrl()`). It is signed byte for byte under
 * the `compact-url` form, and `&sig={kid}.{signature}` is appended. Print the
 * result exactly; any re-encoding or reordering of its parameters invalidates
 * the signature. Short kids (1 to 3 characters, such as `w1`) keep the URL
 * small: the token adds 92 bytes plus the kid.
 *
 * @param url - The unsigned `wemush://v1/{id}?...` URL
 * @param options - `privateKey` (32-byte seed or Ed25519 CryptoKey) and `kid`
 * @returns The signed URL
 * @throws WolsSignatureError if the URL isn't a signable compact URL
 *   (exactly `wemush://v1/` and one path segment; `web+wemush://` and
 *   encrypted URLs are refused), has no query or an empty one, already has a
 *   `sig` parameter, has an empty parameter, a parameter name that isn't plain
 *   `A-Z a-z 0-9 _ -` or that appears twice, a malformed escape or invalid
 *   UTF-8, a fragment or a character outside U+0021..U+007E; if the kid or key
 *   is unusable; or if the runtime lacks WebCrypto Ed25519
 *
 * @example
 * ```typescript
 * const signed = await signCompactUrl(toCompactUrl(specimen), { privateKey: seed, kid: 'w1' });
 * ```
 *
 * @since 1.5.0
 */
export async function signCompactUrl(url: string, options: SigningOptions): Promise<string> {
  if (typeof url !== 'string') {
    throw new WolsSignatureError('Refusing to sign: the URL is not a string');
  }
  const q = url.indexOf('?');
  if (q === -1 || q === url.length - 1) {
    throw new WolsSignatureError('Refusing to sign: the URL has no query (or an empty one)');
  }
  const params = urlParams(url);
  if (params.some(p => paramName(p) === 'sig')) {
    throw new WolsSignatureError(
      'Refusing to sign: the URL already has a sig parameter; remove it to re-sign'
    );
  }
  const problem = checkUrlShape(url, 'compact-url') ?? checkCompactParts(url, params);
  if (problem) throw new WolsSignatureError(`Refusing to sign: ${problem}`);
  const token = await makeToken('compact-url', url, options);
  return `${url}&sig=${token}`;
}

/**
 * The optional unwrap step before verifying a scanned URL (WOLS 1.5.0).
 *
 * Applies exactly two transforms, in this order, and nothing else:
 *
 * 1. For `https://{host}/wols/{x}`, percent-decode `{x}` once.
 * 2. Remove a leading `web+` from `web+wemush://v1/...`.
 *
 * Returns the result if it starts with `wemush://v1/`, otherwise `null`. An
 * outer query is never merged in and `{x}` is never decoded twice, so the
 * step can make a signature fail as `invalid` but never make one `valid`.
 * The host isn't checked; it says nothing about who signed the label.
 *
 * @param text - Scanned text
 * @returns The `wemush://v1/` URL to pass to `verifySpecimen()`, or `null`
 *
 * @example
 * ```typescript
 * const url = unwrapWolsUrl(scanned);
 * const result = url === null ? undefined : await verifySpecimen(url, trustStore);
 * ```
 *
 * @since 1.5.0
 */
export function unwrapWolsUrl(text: string): string | null {
  if (typeof text !== 'string') return null;
  let url = text;
  const handler = HANDLER_URL.exec(url);
  if (handler) {
    try {
      url = decodeURIComponent(handler[1] as string);
    } catch {
      return null;
    }
  }
  if (url.startsWith(`web+${COMPACT_URL_PREFIX}`)) url = url.slice('web+'.length);
  return url.startsWith(COMPACT_URL_PREFIX) ? url : null;
}

/**
 * Verify the signature on an embedded label, an encrypted URL (WOLS 1.4.0) or
 * a compact URL (WOLS 1.5.0).
 *
 * Checks, in this fixed order: label text that isn't an I-JSON object is
 * `malformed` (signed or not); then `unsigned`; then the token and URL rules
 * (`malformed`); then the trust store (`unknown-kid`); then the signature
 * (`invalid` or `valid`). A trust store entry that is unusable (not Ed25519,
 * not 32 bytes, not a curve point) gives `invalid`; see {@link createTrustStore}.
 * Only `valid` means the label is authentic. Keys come only from `trustStore`;
 * any key or hint inside the label is ignored. No network access.
 *
 * Pass the label text exactly as scanned. A string that starts with a URI
 * scheme (such as `wemush:`) is a URL: `wemush://v1/{one segment}` that isn't
 * an encrypted URL is verified as a compact URL, any other URL as an
 * encrypted URL. Any other string is parsed as embedded label JSON. The
 * result's `form` says which. For a `web+wemush://` or
 * `https://{host}/wols/...` URL, run {@link unwrapWolsUrl} first; with `sig`
 * they are otherwise `malformed`.
 *
 * A `valid` compact URL result also carries `params` (every parameter of the
 * signed body, decoded) and `unrecognizedParams` (the names this library
 * doesn't know). Display those values, not a second parse of the URL. A parsed object is accepted, but it must be
 * the raw JSON value, never a `Specimen` rebuilt by `parseSpecimen()`: the
 * library model drops or normalizes members, which changes the signed bytes.
 *
 * A `valid` result proves only that the holder of the trust store's key for the
 * kid signed these exact bytes. It says nothing about freshness, and it doesn't
 * prove that the label belongs on the item it is attached to.
 *
 * @param label - Embedded label text, a parsed JSON object, or an encrypted or compact URL
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
  if (label === null || (typeof label !== 'string' && typeof label !== 'object')) {
    return {
      status: 'malformed',
      reason: 'Expected label text, a parsed JSON object, or a URL',
    };
  }
  const form = detectForm(label);
  try {
    located = locate(label);
  } catch (err) {
    if (err instanceof Malformed) return { status: 'malformed', form, reason: err.message };
    throw err;
  }
  if (located === undefined) {
    return { status: 'unsigned', form, reason: 'The label carries no signature' };
  }

  const { kid, signature, signingInput } = located;
  const result = (status: SignatureStatus, kid: string, reason: string): VerificationResult => ({
    status,
    form,
    kid,
    reason,
  });
  const found =
    typeof trustStore === 'object' &&
    trustStore !== null &&
    Object.prototype.hasOwnProperty.call(trustStore, kid);
  if (!found) {
    return result('unknown-kid', kid, `kid '${kid}' is not in the trust store`);
  }
  const entry = trustStore[kid] as TrustStoreEntry;
  const unusable = trustStoreEntryProblem(entry);
  if (unusable) {
    // A configuration error: the kid was found, but nothing can verify under it.
    return result('invalid', kid, `The trust store entry for '${kid}' is unusable: ${unusable}`);
  }
  if (!isCurvePoint((entry as TrustStoreEntry).publicKey)) {
    return result('invalid', kid, `The trust store key for '${kid}' is not an Ed25519 curve point`);
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
  if (!ok) {
    return result('invalid', kid, `The signature does not verify under the key for kid '${kid}'`);
  }
  const valid: VerificationResult = { status: 'valid', form, kid };
  if (located.compactParams !== undefined) {
    const decoded = compactParams(located.compactParams);
    valid.params = decoded.params;
    valid.unrecognizedParams = decoded.unrecognizedParams;
  }
  return valid;
}

/** Why a trust store entry can't be used (wrong alg, not 32 bytes), or undefined. */
function trustStoreEntryProblem(entry: unknown): string | undefined {
  if (typeof entry !== 'object' || entry === null) return 'not an object';
  const { alg, publicKey } = entry as { alg?: unknown; publicKey?: unknown };
  if (alg !== 'Ed25519') return `alg must be 'Ed25519', got '${String(alg)}'`;
  if (!(publicKey instanceof Uint8Array)) return 'publicKey must be a Uint8Array';
  if (publicKey.length !== PUBLIC_KEY_LENGTH) {
    return `publicKey must be ${PUBLIC_KEY_LENGTH} bytes, got ${publicKey.length}`;
  }
  return undefined;
}

/**
 * Build a trust store, rejecting unusable entries up front (WOLS 1.4.0 SHOULD).
 *
 * Each entry must be `{ alg: 'Ed25519', publicKey }` with a 32-byte key that
 * decodes to a point on the curve. The key bytes are copied.
 *
 * @param entries - kid to entry
 * @throws WolsSignatureError for an invalid kid or an unusable entry (a configuration error),
 *   or when the runtime lacks WebCrypto Ed25519
 * @since 1.4.0
 */
export async function createTrustStore(
  entries: Readonly<Record<string, TrustStoreEntry>>
): Promise<TrustStore> {
  const store: Record<string, TrustStoreEntry> = {};
  for (const [kid, entry] of Object.entries(entries)) {
    if (!KID_PATTERN.test(kid)) {
      throw new WolsSignatureError(`Trust store kid '${kid}' is not a valid kid`, { kid });
    }
    const problem = trustStoreEntryProblem(entry);
    if (problem) {
      throw new WolsSignatureError(`Trust store entry '${kid}' is unusable: ${problem}`, { kid });
    }
    if (!isCurvePoint(entry.publicKey)) {
      throw new WolsSignatureError(
        `Trust store entry '${kid}' is unusable: the key is not a point on the Ed25519 curve`,
        { kid }
      );
    }
    Object.defineProperty(store, kid, {
      value: Object.freeze({ alg: 'Ed25519', publicKey: owned(entry.publicKey) }),
      enumerable: true,
    });
  }
  // Confirm the runtime can verify at all, so a bad environment fails here, not per label.
  if (!(await ed25519Supported())) throw unsupported(new Error('Ed25519 unavailable'));
  return Object.freeze(store);
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 32 bytes as canonical unpadded base64url: 43 characters, the 2 unused bits zero. */
const PUBLIC_KEY_PATTERN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

/**
 * Build a trust store from a WOLS key set document (WOLS 1.4.0).
 *
 * The document has the shape an issuer may publish at
 * `https://{issuer-host}/.well-known/wols-keys.json`:
 *
 * ```json
 * { "keys": [ { "kid": "mushoh-2026", "alg": "Ed25519", "publicKey": "<32 bytes, base64url>" } ] }
 * ```
 *
 * An entry whose `alg` isn't `'Ed25519'` (compared exactly, so `'ed25519'` too)
 * is skipped without checking its other members. That keeps the format
 * forward-compatible: an issuer can add keys for a later algorithm without
 * breaking this verifier. A label signed under a skipped entry's kid verifies as
 * `unknown-kid`. Members the specification doesn't define are ignored.
 *
 * Anything else wrong rejects the whole document, because a damaged entry for a
 * supported algorithm signals corruption or tampering: a document that isn't an
 * object with a `keys` array, an entry that isn't an object with a string `alg`,
 * an Ed25519 entry with an invalid kid or a `publicKey` that isn't the canonical
 * unpadded base64url of 32 bytes encoding a curve point, or two Ed25519 entries
 * with the same kid.
 *
 * This function doesn't fetch anything. Choose the host independently of any
 * label, fetch the document over HTTPS yourself, and pass it here. Unlike this
 * loader, {@link createTrustStore} still rejects an entry whose algorithm isn't
 * Ed25519.
 *
 * @param document - The key set document, as JSON text or a parsed value
 * @param options - `onSkip` is called with each skipped entry
 * @returns A frozen trust store with one entry per Ed25519 key
 * @throws WolsSignatureError for a configuration error in the document, or when
 *   the runtime lacks WebCrypto Ed25519
 *
 * @example
 * ```typescript
 * const res = await fetch('https://mushoh.example/.well-known/wols-keys.json');
 * const trustStore = await trustStoreFromKeySet(await res.text(), {
 *   onSkip: entry => console.info(`Skipped ${entry.alg} key ${String(entry.kid)}`),
 * });
 * ```
 *
 * @since 1.4.0
 */
export async function trustStoreFromKeySet(
  document: unknown,
  options: KeySetOptions = {}
): Promise<TrustStore> {
  let doc = document;
  if (typeof doc === 'string') {
    try {
      doc = JSON.parse(doc);
    } catch (err) {
      throw new WolsSignatureError(
        `The key set is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  if (!isPlainObject(doc) || !Array.isArray(doc['keys'])) {
    throw new WolsSignatureError("The key set document must be an object with a 'keys' array");
  }
  const entries: Record<string, TrustStoreEntry> = {};
  (doc['keys'] as unknown[]).forEach((entry, index) => {
    if (!isPlainObject(entry) || typeof entry['alg'] !== 'string') {
      throw new WolsSignatureError(
        `Key set entry keys[${index}] must be an object with a string 'alg'`
      );
    }
    if (entry['alg'] !== 'Ed25519') {
      // Unsupported algorithm: skipped, other members unchecked.
      options.onSkip?.(entry as KeySetEntry);
      return;
    }
    const { kid, publicKey } = entry;
    if (typeof kid !== 'string' || !KID_PATTERN.test(kid)) {
      throw new WolsSignatureError(`Key set entry keys[${index}] has an invalid kid`);
    }
    if (typeof publicKey !== 'string' || !PUBLIC_KEY_PATTERN.test(publicKey)) {
      throw new WolsSignatureError(
        `Key set entry '${kid}' has a publicKey that isn't 32 bytes of canonical base64url`,
        { kid }
      );
    }
    if (Object.prototype.hasOwnProperty.call(entries, kid)) {
      throw new WolsSignatureError(`Key set kid '${kid}' appears more than once`, { kid });
    }
    Object.defineProperty(entries, kid, {
      value: { alg: 'Ed25519', publicKey: base64UrlDecode(publicKey) },
      enumerable: true,
    });
  });
  // createTrustStore checks each key is a curve point, and that the runtime has Ed25519.
  return createTrustStore(entries);
}

// --- Point decoding (RFC 8032 §5.1.3), used only to vet trust store keys ----

const P = (1n << 255n) - 19n;
const D = (-121665n * modInverse(121666n)) % P;
const SQRT_M1 = modPow(2n, (P - 1n) / 4n);

function mod(a: bigint): bigint {
  const r = a % P;
  return r >= 0n ? r : r + P;
}

function modPow(base: bigint, exp: bigint): bigint {
  let result = 1n;
  let b = mod(base);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % P;
    b = (b * b) % P;
    e >>= 1n;
  }
  return result;
}

function modInverse(a: bigint): bigint {
  return modPow(a, P - 2n);
}

/** Whether 32 bytes decode to a point on edwards25519 (RFC 8032 §5.1.3). */
function isCurvePoint(bytes: Uint8Array): boolean {
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(bytes[i] as number);
  const sign = y >> 255n;
  y &= (1n << 255n) - 1n;
  if (y >= P) return false;
  const y2 = (y * y) % P;
  const u = mod(y2 - 1n);
  const v = mod(D * y2 + 1n);
  // x = (u/v)^((p+3)/8), computed as u v^3 (u v^7)^((p-5)/8)
  const v3 = (v * v * v) % P;
  let x = mod(u * v3 * modPow(u * ((v3 * v3 * v) % P), (P - 5n) / 8n));
  const vx2 = mod(v * x * x);
  if (vx2 === mod(-u)) x = mod(x * SQRT_M1);
  else if (vx2 !== u) return false;
  if (x === 0n && sign === 1n) return false;
  return true;
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
