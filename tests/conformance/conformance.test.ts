/**
 * WOLS conformance vectors.
 *
 * Runs every case in tests/conformance/vectors/*.json through the public API.
 * The vectors are vendored from wemush/open-standard (see vectors/SOURCE.json
 * and tests/conformance/README.md for how to refresh them).
 *
 * - `MUST` cases are hard test failures.
 * - `SHOULD` cases are executed and reported in the summary but never fail the build.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  SIGNING_DOMAIN,
  WOLS_VERSION,
  WolsSignatureError,
  createTrustStore,
  base64UrlDecode,
  base64UrlEncode,
  createSpecimen,
  decryptFields,
  decryptPlaintext,
  decryptSpecimen,
  derivePassphraseKey,
  parseEncryptedUrl,
  signEncryptedUrl,
  signSpecimen,
  validateSpecimen,
  verifySpecimen,
  type SpecimenInput,
  type TrustStore,
  type ValidationWarning,
} from '../../src/index.js';
import { hasDuplicateMemberNames } from '../../src/crypto/jcs.js';
import { getSigningInput } from '../../src/crypto/signature.js';

type Requirement = 'MUST' | 'SHOULD';

interface VectorCase {
  id: string;
  operation: 'validate' | 'create' | 'derive' | 'decrypt' | 'decryptFields' | 'sign' | 'verify';
  requirement: Requirement;
  description: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
}

interface VectorFile {
  wolsVersion: string;
  description: string;
  cases: VectorCase[];
  /** signatures.json only */
  signingDomain?: string;
  testKeys?: Record<string, { seedBase64url: string; publicKeyBase64url: string }>;
  trustStore?: Record<string, { alg: string; publicKeyBase64url: string }>;
}

/**
 * Spec versions the vendored files may target. The 1.3.0 wire-format files are
 * unchanged by 1.4.0; signatures.json targets 1.4.0 (release candidate).
 */
const SIGNATURES_VERSION = '1.4.0';
const SUPPORTED_VECTOR_VERSIONS = new Set([WOLS_VERSION, SIGNATURES_VERSION]);

const VECTOR_DIR = join(dirname(fileURLToPath(import.meta.url)), 'vectors');
const vectorFiles = readdirSync(VECTOR_DIR)
  .filter(f => f.endsWith('.json') && f !== 'SOURCE.json')
  .sort();
const source = JSON.parse(readFileSync(join(VECTOR_DIR, 'SOURCE.json'), 'utf8')) as {
  commit: string;
  specVersion: string;
  files: string[];
  integrity: Record<string, { sha256: string; cases: number; wolsVersion?: string }>;
};
const OPERATIONS = new Set([
  'validate',
  'create',
  'derive',
  'decrypt',
  'decryptFields',
  'sign',
  'verify',
]);

type Secret = { kdf: 'pbkdf2'; passphrase: string } | { kdf: 'raw'; keyBase64url: string };
const keyFor = (secret: Secret): string | Uint8Array =>
  secret.kdf === 'pbkdf2' ? secret.passphrase : base64UrlDecode(secret.keyBase64url);

/** Thrown for a case this runner cannot execute; never downgraded to a SHOULD note. */
class UnsupportedCaseError extends Error {}

// The vendored set must be exactly what SOURCE.json records, so a removed,
// truncated or never-fetched vector file cannot let the suite pass vacuously.
describe('conformance: vendored vector set', () => {
  it('matches SOURCE.json', () => {
    expect(source.files.length).toBeGreaterThan(0);
    expect(vectorFiles).toEqual([...source.files].sort());
    expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(SUPPORTED_VECTOR_VERSIONS.has(source.specVersion)).toBe(true);
  });

  // Upstream publishes SHA256SUMS (since 1.3.0-rc.2); the vendored copy must agree.
  it('matches the vendored upstream SHA256SUMS', () => {
    const sums = new Map(
      readFileSync(join(VECTOR_DIR, 'SHA256SUMS'), 'utf8')
        .trim()
        .split('\n')
        .map(line => line.trim().split(/\s+/))
        .map(([hash, name]) => [name ?? '', hash ?? ''])
    );
    expect([...sums.keys()].sort()).toEqual([...source.files].sort());
    for (const file of source.files) {
      expect(sums.get(file), file).toBe(source.integrity[file]?.sha256);
    }
  });

  // Content integrity: a hand-edited or truncated vector file fails here.
  it.each(source.files)('%s matches its recorded SHA-256 and case count', file => {
    const text = readFileSync(join(VECTOR_DIR, file));
    const recorded = source.integrity[file];
    expect(recorded, `${file} missing from SOURCE.json integrity`).toBeDefined();
    expect(createHash('sha256').update(text).digest('hex')).toBe(recorded?.sha256);
    const doc = JSON.parse(text.toString('utf8')) as VectorFile;
    expect(doc.cases.length).toBe(recorded?.cases);
    expect(doc.wolsVersion).toBe(recorded?.wolsVersion);
  });
});

// =============================================================================
// Operations — each throws (via expect) when the case does not conform
// =============================================================================

function runValidate(c: VectorCase): void {
  const result = validateSpecimen(c.input);
  const { valid, errorField, warningField } = c.expected as {
    valid: boolean;
    errorField?: string;
    warningField?: string;
  };
  expect(result.valid, JSON.stringify(result.errors)).toBe(valid);
  if (errorField !== undefined) {
    expect(result.errors.map(e => e.path)).toContain(errorField);
  }
  if (warningField !== undefined) {
    expect(result.warnings.map(w => w.path)).toContain(warningField);
  }
}

function runCreate(c: VectorCase): void {
  const warnings: ValidationWarning[] = [];
  const specimen = createSpecimen(c.input as unknown as SpecimenInput, {
    onWarning: w => warnings.push(w),
  });
  expect({
    type: specimen.type,
    stage: specimen.stage ?? null,
    warning: warnings.length > 0,
  }).toEqual(c.expected);
  // A created specimen must itself be a valid serialized label.
  expect(validateSpecimen(specimen).valid).toBe(true);
}

async function runDerive(c: VectorCase): Promise<void> {
  const { passphrase, saltBase64url, iterations } = c.input as {
    passphrase: string;
    saltBase64url: string;
    iterations: number;
  };
  const key = await derivePassphraseKey(passphrase, base64UrlDecode(saltBase64url), iterations);
  expect(base64UrlEncode(key)).toBe(c.expected['keyBase64url']);
}

async function runDecryptFields(c: VectorCase): Promise<string | undefined> {
  const { specimen, secret } = c.input as { specimen: Record<string, unknown>; secret: Secret };
  const expected = c.expected as
    | { success: true; specimen: Record<string, unknown> }
    | { success: false; reason: string };
  const r = await decryptFields(specimen, { key: keyFor(secret) });
  if (expected.success) {
    expect(r.success, r.success ? '' : r.error.message).toBe(true);
    if (r.success) expect(r.data).toEqual(expected.specimen);
    return undefined;
  }
  expect(r.success).toBe(false);
  const reason = !r.success ? r.error.reason : undefined;
  return reason === expected.reason
    ? undefined
    : `reason '${String(reason)}' (vector suggests '${expected.reason}')`;
}

async function runDecrypt(c: VectorCase): Promise<string | undefined> {
  const { url, secret } = c.input as {
    url: string;
    secret: { kdf: 'pbkdf2'; passphrase: string } | { kdf: 'raw'; keyBase64url: string };
  };
  const key = secret.kdf === 'pbkdf2' ? secret.passphrase : base64UrlDecode(secret.keyBase64url);
  const expected = c.expected as
    | {
        success: true;
        plaintext: string;
        specimen: Record<string, unknown>;
        sig?: string;
        sigVerified?: false;
      }
    | { success: false; reason: string };

  const plain = await decryptPlaintext(url, { key });
  const parsed = await decryptSpecimen(url, { key });

  if (expected.success) {
    expect(plain.success, plain.success ? '' : plain.error.message).toBe(true);
    expect(parsed.success, parsed.success ? '' : parsed.error.message).toBe(true);
    if (plain.success) expect(plain.data).toBe(expected.plaintext);
    if (parsed.success) expect(parsed.data).toEqual(expected.specimen);
    if (expected.sig !== undefined) {
      // Decoding keeps `sig` exactly as received and never verifies it: the
      // parsed URL exposes it as an opaque string with no verification flag.
      const enc = parseEncryptedUrl(url);
      expect(enc.success).toBe(true);
      if (enc.success) {
        expect(enc.data.signature).toBe(expected.sig);
        expect(Object.keys(enc.data).some(k => /verif/i.test(k))).toBe(false);
      }
      expect(expected.sigVerified).toBe(false);
    }
    return undefined;
  }

  expect(plain.success).toBe(false);
  expect(parsed.success).toBe(false);
  // The reason is a suggested category, not a requirement; report mismatches as notes.
  const reason = !plain.success ? plain.error.reason : undefined;
  return reason === expected.reason
    ? undefined
    : `reason '${String(reason)}' (vector suggests '${expected.reason}')`;
}

// =============================================================================
// Signatures (1.4.0)
// =============================================================================

type VectorTrustStore = Record<string, { alg: string; publicKeyBase64url: string }>;

function trustStoreFor(vectorStore: VectorTrustStore | undefined): TrustStore {
  return Object.fromEntries(
    Object.entries(vectorStore ?? {}).map(([kid, e]) => [
      kid,
      { alg: e.alg as 'Ed25519', publicKey: base64UrlDecode(e.publicKeyBase64url) },
    ])
  );
}

async function runSign(c: VectorCase, doc: VectorFile): Promise<void> {
  const input = c.input as {
    form: 'embedded' | 'encrypted-url';
    label?: string;
    url?: string;
    kid: string;
    key: string;
  };
  const expected = c.expected as
    | { refused: true }
    | { signingInput: string; signature: string; url?: string };
  const testKey = doc.testKeys?.[input.key];
  if (!testKey) throw new UnsupportedCaseError(`${c.id}: unknown test key ${input.key}`);
  const options = { privateKey: base64UrlDecode(testKey.seedBase64url), kid: input.kid };

  if ('refused' in expected) {
    // The signer must refuse and produce no signature; the library throws.
    const attempt =
      input.form === 'embedded'
        ? signSpecimen(input.label as string, options)
        : signEncryptedUrl(input.url as string, options);
    await expect(attempt).rejects.toThrow(WolsSignatureError);
    return;
  }

  let signed: string;
  if (input.form === 'embedded') {
    signed = await signSpecimen(input.label as string, options);
    const label = JSON.parse(signed) as Record<string, unknown>;
    expect(label['signature']).toBe(expected.signature);
  } else if (input.form === 'encrypted-url') {
    signed = await signEncryptedUrl(input.url as string, options);
    expect(signed).toBe(expected.url);
  } else {
    throw new UnsupportedCaseError(`${c.id}: unknown form ${String(input.form)}`);
  }
  expect(getSigningInput(signed)).toBe(expected.signingInput);

  // What this library signs must verify.
  const back = await verifySpecimen(signed, trustStoreFor(doc.trustStore));
  expect(back).toEqual({ status: 'valid', kid: input.kid });
}

async function runVerify(c: VectorCase, doc: VectorFile): Promise<void> {
  const input = c.input as {
    form: 'embedded' | 'encrypted-url';
    label?: string;
    url?: string;
    trustStore?: VectorTrustStore;
  };
  const expected = c.expected as {
    status: string;
    kid?: string;
    signingInput?: string;
    configError?: boolean;
  };
  const subject = input.form === 'embedded' ? input.label : input.url;
  if (typeof subject !== 'string') {
    throw new UnsupportedCaseError(`${c.id}: unknown form ${String(input.form)}`);
  }
  // verifySpecimen takes one string and picks the form by URI scheme; it must agree.
  expect(/^[A-Za-z][A-Za-z0-9+.-]*:/.test(subject) ? 'encrypted-url' : 'embedded').toBe(input.form);
  const store = trustStoreFor(input.trustStore ?? doc.trustStore);
  if (expected.configError) {
    // Unusable entries are a configuration error: createTrustStore refuses them...
    await expect(createTrustStore(store)).rejects.toThrow(WolsSignatureError);
  }
  // ...and one that reaches verification anyway gives the expected status (invalid).
  const r = await verifySpecimen(subject, store);
  expect(r.status, r.reason).toBe(expected.status);
  if (expected.status === 'valid') {
    expect(r.kid).toBe(expected.kid);
    expect(getSigningInput(subject)).toBe(expected.signingInput);
  }
  // The same label passed as a parsed JSON value gives the same status, except
  // for duplicate member names, which JSON.parse has already collapsed.
  if (input.form === 'embedded' && !hasDuplicateMemberNames(subject)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(subject);
    } catch {
      return;
    }
    if (typeof parsed === 'object' && parsed !== null) {
      expect((await verifySpecimen(parsed, store)).status).toBe(expected.status);
    }
  }
}

async function runCase(c: VectorCase, doc: VectorFile): Promise<string | undefined> {
  switch (c.operation) {
    case 'validate':
      runValidate(c);
      return undefined;
    case 'create':
      runCreate(c);
      return undefined;
    case 'derive':
      await runDerive(c);
      return undefined;
    case 'decrypt':
      return runDecrypt(c);
    case 'decryptFields':
      return runDecryptFields(c);
    case 'sign':
      await runSign(c, doc);
      return undefined;
    case 'verify':
      await runVerify(c, doc);
      return undefined;
    default:
      throw new UnsupportedCaseError(
        `Unknown operation '${String((c as VectorCase).operation)}': update the runner`
      );
  }
}

// =============================================================================
// Runner and report
// =============================================================================

interface Tally {
  MUST: { pass: number; total: number };
  SHOULD: { pass: number; total: number };
  notes: string[];
}

const report = new Map<string, Tally>();

for (const file of vectorFiles) {
  const doc = JSON.parse(readFileSync(join(VECTOR_DIR, file), 'utf8')) as VectorFile;
  const tally: Tally = { MUST: { pass: 0, total: 0 }, SHOULD: { pass: 0, total: 0 }, notes: [] };
  report.set(file, tally);

  describe(`conformance: ${file} (WOLS ${doc.wolsVersion})`, () => {
    it('targets this library version and has MUST cases', () => {
      expect(SUPPORTED_VECTOR_VERSIONS.has(doc.wolsVersion), doc.wolsVersion).toBe(true);
      if (doc.cases.some(c => c.operation === 'sign' || c.operation === 'verify')) {
        expect(doc.wolsVersion).toBe(SIGNATURES_VERSION);
        expect(doc.signingDomain).toBe(SIGNING_DOMAIN);
      }
      expect(doc.cases.length).toBeGreaterThan(0);
      expect(doc.cases.some(c => c.requirement === 'MUST')).toBe(true);
      for (const c of doc.cases) {
        expect(OPERATIONS.has(c.operation), `${c.id}: operation ${c.operation}`).toBe(true);
        expect(['MUST', 'SHOULD'], `${c.id}: requirement`).toContain(c.requirement);
      }
    });

    for (const c of doc.cases) {
      const title = `[${c.requirement}] ${c.id}: ${c.description}`;
      tally[c.requirement].total++;

      if (c.requirement === 'MUST') {
        it(title, async () => {
          const note = await runCase(c, doc);
          tally.MUST.pass++;
          if (note) tally.notes.push(`${c.id}: ${note}`);
        });
      } else {
        // SHOULD: never fails the build; outcome goes in the report.
        it(title, async () => {
          try {
            const note = await runCase(c, doc);
            tally.SHOULD.pass++;
            if (note) tally.notes.push(`${c.id}: ${note}`);
          } catch (err) {
            if (err instanceof UnsupportedCaseError) throw err;
            tally.notes.push(`${c.id} (SHOULD, not met): ${(err as Error).message.split('\n')[0]}`);
          }
        });
      }
    }
  });
}

afterAll(() => {
  const lines = ['', 'WOLS conformance summary', '------------------------'];
  for (const [file, t] of report) {
    lines.push(
      `${file.padEnd(22)} MUST ${t.MUST.pass}/${t.MUST.total}   SHOULD ${t.SHOULD.pass}/${t.SHOULD.total}`
    );
    for (const n of t.notes) lines.push(`    note: ${n}`);
  }
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
});
