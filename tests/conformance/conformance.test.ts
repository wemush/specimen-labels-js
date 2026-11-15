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
  WOLS_VERSION,
  base64UrlDecode,
  base64UrlEncode,
  createSpecimen,
  decryptFields,
  decryptPlaintext,
  decryptSpecimen,
  derivePassphraseKey,
  validateSpecimen,
  type SpecimenInput,
  type ValidationWarning,
} from '../../src/index.js';

type Requirement = 'MUST' | 'SHOULD';

interface VectorCase {
  id: string;
  operation: 'validate' | 'create' | 'derive' | 'decrypt' | 'decryptFields';
  requirement: Requirement;
  description: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
}

interface VectorFile {
  wolsVersion: string;
  description: string;
  cases: VectorCase[];
}

const VECTOR_DIR = join(dirname(fileURLToPath(import.meta.url)), 'vectors');
const vectorFiles = readdirSync(VECTOR_DIR)
  .filter(f => f.endsWith('.json') && f !== 'SOURCE.json')
  .sort();
const source = JSON.parse(readFileSync(join(VECTOR_DIR, 'SOURCE.json'), 'utf8')) as {
  commit: string;
  specVersion: string;
  files: string[];
  integrity: Record<string, { sha256: string; cases: number }>;
};
const OPERATIONS = new Set(['validate', 'create', 'derive', 'decrypt', 'decryptFields']);

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
    expect(source.specVersion).toBe(WOLS_VERSION);
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
    expect((JSON.parse(text.toString('utf8')) as VectorFile).cases.length).toBe(recorded?.cases);
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
    | { success: true; plaintext: string; specimen: Record<string, unknown> }
    | { success: false; reason: string };

  const plain = await decryptPlaintext(url, { key });
  const parsed = await decryptSpecimen(url, { key });

  if (expected.success) {
    expect(plain.success, plain.success ? '' : plain.error.message).toBe(true);
    expect(parsed.success, parsed.success ? '' : parsed.error.message).toBe(true);
    if (plain.success) expect(plain.data).toBe(expected.plaintext);
    if (parsed.success) expect(parsed.data).toEqual(expected.specimen);
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

async function runCase(c: VectorCase): Promise<string | undefined> {
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
      expect(doc.wolsVersion).toBe(source.specVersion);
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
          const note = await runCase(c);
          tally.MUST.pass++;
          if (note) tally.notes.push(`${c.id}: ${note}`);
        });
      } else {
        // SHOULD: never fails the build; outcome goes in the report.
        it(title, async () => {
          try {
            const note = await runCase(c);
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
      `${file.padEnd(16)} MUST ${t.MUST.pass}/${t.MUST.total}   SHOULD ${t.SHOULD.pass}/${t.SHOULD.total}`
    );
    for (const n of t.notes) lines.push(`    note: ${n}`);
  }
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
});
