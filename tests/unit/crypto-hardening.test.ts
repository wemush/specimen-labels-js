/**
 * Hardening from the 1.3.0 review: bounded and cheap-first decoding, typed
 * decryption errors, strict field-level encryption, generator floors in
 * toEncryptedUrl, and the split encrypted-value type guards.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  WolsDecryptionError,
  base64UrlDecode,
  base64UrlEncode,
  createSpecimen,
  decryptField,
  decryptFields,
  decryptPlaintext,
  decryptSpecimen,
  encryptFields,
  encryptSpecimen,
  isEncrypted,
  isEncryptedField,
  isEncryptedSpecimen,
  mapToWolsType,
  resolveTypeAndStage,
  serializeSpecimen,
  toEncryptedUrl,
  type EncryptedField,
  type EncryptedSpecimen,
  type Specimen,
} from '../../src/index.js';

const PASSPHRASE = 'correct horse battery staple';
const SALT = 'AAECAwQFBgcICQoLDA0ODw'; // 16 bytes
const IV = 'ZGVmZ2hpamtsbW5v'; // 12 bytes
const E = base64UrlEncode(new Uint8Array(48)); // >= 16-byte tag, junk

const specimen = createSpecimen({
  type: 'SUBSTRATE',
  species: 'Pleurotus ostreatus',
  strain: { name: 'MO-Blue-001', generation: 'F1' },
  stage: 'COLONIZATION',
  created: '2025-12-16T10:30:00Z',
});

const pbkdf2Url = (i: string | number, extra = ''): string =>
  `wemush://v1/encrypted/x?e=${E}&iv=${IV}&kdf=pbkdf2&salt=${SALT}&i=${i}${extra}`;

/** Seal arbitrary bytes with a raw key and build a kdf=raw URL for id suffix `id`. */
async function rawLabel(
  id: string,
  plaintext: Uint8Array
): Promise<{ url: string; key: Uint8Array<ArrayBuffer> }> {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    k,
    plaintext as Uint8Array<ArrayBuffer>
  );
  return {
    url: `wemush://v1/encrypted/${id}?e=${base64UrlEncode(ct)}&iv=${base64UrlEncode(iv)}&kdf=raw`,
    key,
  };
}

describe('decryption never throws and is bounded', () => {
  it('returns excessive-iterations for counts beyond WebCrypto range instead of throwing', async () => {
    const r = await decryptPlaintext(pbkdf2Url('99999999999999999999'), { key: 'p' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toBeInstanceOf(WolsDecryptionError);
      expect(r.error.reason).toBe('excessive-iterations');
    }
  });

  it('rejects counts above the default maxIterations (10,000,000)', async () => {
    const r = await decryptSpecimen(pbkdf2Url(10_000_001), { key: 'p' });
    expect(!r.success && r.error.reason).toBe('excessive-iterations');
    expect(!r.success && r.error.details?.['maxIterations']).toBe(10_000_000);
  });

  it('honors a custom maxIterations and rejects an invalid one', async () => {
    const enc = await encryptSpecimen(specimen, { key: PASSPHRASE, iterations: 200_000 });
    const tight = await decryptSpecimen(enc.url ?? '', { key: PASSPHRASE, maxIterations: 150_000 });
    expect(!tight.success && tight.error.reason).toBe('excessive-iterations');
    const ok = await decryptSpecimen(enc.url ?? '', { key: PASSPHRASE, maxIterations: 200_000 });
    expect(ok.success).toBe(true);
    for (const maxIterations of [5, 1.5, 2 ** 33]) {
      const bad = await decryptSpecimen(enc.url ?? '', { key: PASSPHRASE, maxIterations });
      expect(!bad.success && bad.error.reason).toBe('invalid-parameter');
    }
  });

  it('checks cheap parameters before deriving the key', async () => {
    // A wrong IV with an expensive count must fail without running PBKDF2.
    const started = performance.now();
    const r = await decryptPlaintext(
      `wemush://v1/encrypted/x?e=${E}&iv=AAAA&kdf=pbkdf2&salt=${SALT}&i=9000000`,
      { key: 'p' }
    );
    expect(!r.success && r.error.reason).toBe('invalid-parameter');
    expect(performance.now() - started).toBeLessThan(100);
  });

  it('rejects ciphertext shorter than the GCM tag', async () => {
    const r = await decryptPlaintext(
      `wemush://v1/encrypted/x?e=AAAA&iv=${IV}&kdf=pbkdf2&salt=${SALT}&i=100000`,
      { key: 'p' }
    );
    expect(!r.success && r.error.reason).toBe('invalid-parameter');
  });

  it('rejects a salt on a legacy (kdf-less) payload', async () => {
    const r = await decryptPlaintext(`wemush://v1/encrypted/x?e=${E}&iv=${IV}&salt=${SALT}`, {
      key: 'p',
      allowLegacy: true,
    });
    expect(!r.success && r.error.reason).toBe('unexpected-parameter');
  });

  it('rejects a plaintext that starts with a byte order mark', async () => {
    const json = serializeSpecimen({ ...specimen, id: 'wemush:bom' } as Specimen);
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(json)]);
    const { url, key } = await rawLabel('bom', bytes);
    const r = await decryptPlaintext(url, { key });
    expect(!r.success && r.error.reason).toBe('invalid-plaintext');
  });

  it('reports a decrypted label that is not a valid specimen as invalid-plaintext', async () => {
    const { url, key } = await rawLabel('x', new TextEncoder().encode('{"id":"wemush:x"}'));
    expect((await decryptPlaintext(url, { key })).success).toBe(true);
    const r = await decryptSpecimen(url, { key });
    expect(!r.success && r.error.reason).toBe('invalid-plaintext');
    expect(!r.success && r.error.details?.['parseError']).toBeDefined();
  });

  it('without WebCrypto: decryption fails with unsupported-environment; encryption throws', async () => {
    const enc = await encryptSpecimen(specimen, { key: PASSPHRASE });
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      const r = await decryptSpecimen(enc.url ?? '', { key: PASSPHRASE });
      expect(!r.success && r.error.reason).toBe('unsupported-environment');
      await expect(encryptSpecimen(specimen, { key: PASSPHRASE })).rejects.toThrow(/WebCrypto/);
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original);
    }
    expect(typeof globalThis.crypto.subtle).toBe('object');
  });
});

describe('typed decryption errors', () => {
  it('exposes reason as a typed property and in details', async () => {
    const enc = await encryptSpecimen(specimen, { key: PASSPHRASE });
    const r = await decryptSpecimen(enc.url ?? '', { key: 'wrong' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const reason: 'authentication-failed' | string = r.error.reason;
      expect(reason).toBe('authentication-failed');
      expect(r.error.details?.['reason']).toBe('authentication-failed');
      expect(r.error.code).toBe('WOLS_DECRYPTION_ERROR');
      expect(r.error.name).toBe('WolsDecryptionError');
    }
  });
});

describe('encryptFields', () => {
  it('encrypts named fields and decryptFields restores a validated Specimen', async () => {
    const partial = await encryptFields(specimen, { key: PASSPHRASE, fields: ['strain', 'stage'] });
    expect(partial.species).toBe(specimen.species);
    expect(isEncryptedField(partial.strain)).toBe(true);
    expect(isEncryptedField(partial.stage)).toBe(true);
    const restored = await decryptFields(partial, { key: PASSPHRASE });
    expect(restored.success && restored.data).toEqual(specimen);
  });

  it.each([
    [['strian'], /no such field/],
    [['constructor'], /no such field/],
    [['__proto__'], /no such field/],
    [['strain', 'strain'], /more than once/],
    [[], /non-empty/],
  ])('refuses fields %j', async (fields, message) => {
    await expect(encryptFields(specimen, { key: PASSPHRASE, fields })).rejects.toThrow(message);
  });

  it('refuses a field whose value is undefined', async () => {
    const s = { ...specimen, batch: undefined } as unknown as Specimen;
    await expect(encryptFields(s, { key: PASSPHRASE, fields: ['batch'] })).rejects.toThrow(
      /undefined/
    );
  });

  it('deprecated encryptSpecimen({ fields }) keeps working and is just as strict', async () => {
    const legacyStyle = (await encryptSpecimen(specimen, {
      key: PASSPHRASE,
      fields: ['strain'],
    })) as unknown as Record<string, unknown>;
    expect(isEncryptedField(legacyStyle['strain'])).toBe(true);
    await expect(
      encryptSpecimen(specimen, { key: PASSPHRASE, fields: ['strian'] })
    ).rejects.toThrow(/no such field/);
  });

  it('decryptFields reports a restored object that is not a valid specimen', async () => {
    const partial = await encryptFields(specimen, { key: PASSPHRASE, fields: ['strain'] });
    const broken = { ...partial, species: '' };
    const r = await decryptFields(broken, { key: PASSPHRASE });
    expect(!r.success && r.error.reason).toBe('invalid-plaintext');
  });

  it('decryptField rejects a non-encrypted value', async () => {
    const r = await decryptField({ encrypted: false } as unknown as EncryptedField, {
      key: PASSPHRASE,
    });
    expect(!r.success && r.error.reason).toBe('invalid-parameter');
  });
});

describe('toEncryptedUrl generator floors', () => {
  const base = (over: Partial<EncryptedSpecimen>): EncryptedSpecimen => ({
    encrypted: true,
    algorithm: 'AES-256-GCM',
    payload: E,
    iv: IV,
    id: 'wemush:x',
    kdf: 'pbkdf2',
    salt: SALT,
    iterations: 100_000,
    ...over,
  });

  it('accepts a conformant object', () => {
    expect(toEncryptedUrl(base({}))).toBe(pbkdf2Url(100_000));
  });

  it.each([
    [{ iterations: 99_999 }, /from 100000 to 10000000/],
    [{ iterations: 10_000_001 }, /from 100000 to 10000000/],
    [{ salt: 'AAECAwQFBgcICQoLDA0O' }, /at least 16 bytes/],
    [{ salt: base64UrlEncode(new TextEncoder().encode('@wemush/wols/crypto/v1')) }, /library salt/],
    [{ salt: 'not base64!' }, /base64url/],
    [{ kdf: 'raw' as const }, /must not carry salt/],
  ])('refuses %j', (over, message) => {
    expect(() => toEncryptedUrl(base(over))).toThrow(message);
  });
});

describe('encrypted value type guards', () => {
  it('tell whole-label and field-level encryption apart', async () => {
    const whole = await encryptSpecimen(specimen, { key: PASSPHRASE });
    const partial = await encryptFields(specimen, { key: PASSPHRASE, fields: ['strain'] });
    expect(isEncryptedSpecimen(whole)).toBe(true);
    expect(isEncryptedField(whole)).toBe(false);
    expect(isEncryptedField(partial.strain)).toBe(true);
    expect(isEncryptedSpecimen(partial.strain)).toBe(false);
    expect(isEncrypted(whole) && isEncrypted(partial.strain)).toBe(true);
    expect(isEncryptedSpecimen(partial)).toBe(false);
    expect(
      isEncryptedSpecimen({ encrypted: true, payload: 'x', iv: 'y', algorithm: 'AES-256-GCM' })
    ).toBe(true); // legacy wrapper
  });
});

describe('resolveTypeAndStage (single PRIMORDIA rule)', () => {
  it('applies the reserved PRIMORDIA rule and plain alias resolution', () => {
    expect(resolveTypeAndStage('primordia')).toEqual({
      type: 'FRUITING',
      stage: 'PRIMORDIA',
      primordia: true,
    });
    expect(resolveTypeAndStage('PRIMORDIA', 'SENESCENCE')).toEqual({
      type: 'FRUITING',
      stage: 'SENESCENCE',
      primordia: true,
    });
    expect(resolveTypeAndStage('lc')).toEqual({
      type: 'CULTURE',
      stage: undefined,
      primordia: false,
    });
    expect(resolveTypeAndStage('nonsense')).toBeNull();
  });

  it('mapToWolsType maps the type only', () => {
    expect(mapToWolsType('Primordia')).toBe('FRUITING');
  });
});

describe('round-2 hardening', () => {
  const LEGACY_B64 = base64UrlEncode(new TextEncoder().encode('@wemush/wols/crypto/v1'));
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const obj = (over: Partial<EncryptedSpecimen>): EncryptedSpecimen => ({
    encrypted: true,
    algorithm: 'AES-256-GCM',
    payload: E,
    iv: IV,
    id: 'wemush:x',
    kdf: 'pbkdf2',
    salt: SALT,
    iterations: 100_000,
    ...over,
  });

  it('toEncryptedUrl compares the legacy salt as bytes, rejecting non-canonical spellings', () => {
    const lastIndex = ALPHABET.indexOf(LEGACY_B64.at(-1) ?? '');
    const variant =
      LEGACY_B64.slice(0, -1) + ALPHABET[(lastIndex & ~0b1111) | ((lastIndex + 1) & 0b1111)];
    expect(variant).not.toBe(LEGACY_B64);
    expect(() => toEncryptedUrl(obj({ salt: LEGACY_B64 }))).toThrow(/library salt/);
    expect(() => toEncryptedUrl(obj({ salt: variant }))).toThrow(/canonical/);
    expect(() => toEncryptedUrl(obj({ salt: `${SALT}==` }))).toThrow(/canonical/);
  });

  it.each([
    [{ payload: 'x&kdf=raw' }, /payload must be canonical/],
    [{ payload: 'AAAA' }, /GCM tag/],
    [{ iv: 'AAAA' }, /12 bytes/],
    [{ iterations: 2 ** 32 }, /10000000/],
  ])('toEncryptedUrl refuses %j', (over, message) => {
    expect(() => toEncryptedUrl(obj(over))).toThrow(message);
  });

  it('encryptSpecimen rejects iterations above the WebCrypto limit with a WolsEncryptionError', async () => {
    await expect(
      encryptSpecimen(specimen, { key: PASSPHRASE, iterations: 2 ** 32 })
    ).rejects.toMatchObject({
      name: 'WolsEncryptionError',
    });
  });

  it('object-form iteration strings must be plain decimal digits', async () => {
    const enc = await encryptSpecimen(specimen, { key: PASSPHRASE });
    const asString = {
      ...enc,
      url: undefined,
      iterations: '600000',
    } as unknown as EncryptedSpecimen;
    delete (asString as { url?: unknown }).url;
    expect((await decryptSpecimen(asString, { key: PASSPHRASE })).success).toBe(true);
    for (const bad of ['1e5', '0x186a0', ' 100000', '']) {
      const r = await decryptSpecimen(
        { ...asString, iterations: bad } as unknown as EncryptedSpecimen,
        {
          key: PASSPHRASE,
        }
      );
      expect(!r.success && r.error.reason, bad).toBe('invalid-parameter');
    }
  });

  it('missing options return a failure instead of throwing', async () => {
    const r = await decryptSpecimen(pbkdf2Url(100_000), undefined as unknown as { key: string });
    expect(!r.success && r.error.reason).toBe('invalid-key');
  });

  it('includes a quoted, bounded actualId in id-mismatch messages', async () => {
    const longId = `wemush:${'a'.repeat(500)}\nINJECTED`;
    const json = serializeSpecimen({ ...specimen, id: longId } as Specimen);
    const { url, key } = await rawLabel('other', new TextEncoder().encode(json));
    const r = await decryptPlaintext(url, { key });
    expect(!r.success && r.error.reason).toBe('id-mismatch');
    if (!r.success) {
      expect(r.error.message).not.toContain('\n');
      expect(r.error.message.length).toBeLessThan(200);
    }
  });

  it('encryptFields refuses the fields that identify the label', async () => {
    for (const field of ['@context', '@type', 'id', 'version'] as const) {
      await expect(encryptFields(specimen, { key: PASSPHRASE, fields: [field] })).rejects.toThrow(
        /identifies the label/
      );
    }
  });

  describe('decryptFields cost is bounded per document', () => {
    const fieldAt = (iterations: number, salt: Uint8Array): EncryptedField => ({
      encrypted: true,
      algorithm: 'AES-256-GCM',
      payload: E,
      iv: IV,
      kdf: 'pbkdf2',
      salt: base64UrlEncode(salt),
      iterations,
    });

    it('rejects many distinct expensive salts before deriving anything', async () => {
      const doc: Record<string, unknown> = { ...specimen };
      for (let i = 0; i < 20; i++) doc[`f${i}`] = fieldAt(9_000_000, new Uint8Array(16).fill(i));
      const started = performance.now();
      const r = await decryptFields(doc, { key: PASSPHRASE });
      expect(!r.success && r.error.reason).toBe('excessive-iterations');
      expect(performance.now() - started).toBeLessThan(100);
    });

    it('validates every field before the first derivation', async () => {
      const doc = {
        ...specimen,
        strain: fieldAt(9_000_000, new Uint8Array(16).fill(1)),
        stage: { ...fieldAt(100_000, new Uint8Array(16).fill(1)), iv: 'AAAA' },
      };
      const started = performance.now();
      const r = await decryptFields(doc, { key: PASSPHRASE });
      expect(!r.success && r.error.reason).toBe('invalid-parameter');
      expect(!r.success && r.error.details?.['path']).toEqual(['stage']);
      expect(performance.now() - started).toBeLessThan(100);
    });

    it('derives once for fields that share a salt', async () => {
      const partial = await encryptFields(specimen, {
        key: PASSPHRASE,
        fields: ['strain', 'stage', 'created'],
        iterations: 100_000,
      });
      // Three fields at 100k each would exceed a 150k budget if derived separately.
      const r = await decryptFields(partial, { key: PASSPHRASE, maxIterations: 150_000 });
      expect(r.success && r.data).toEqual(specimen);
    });

    it('keeps the original failure details on field errors', async () => {
      const doc = { ...specimen, strain: fieldAt(20_000_000, new Uint8Array(16).fill(3)) };
      const r = await decryptFields(doc, { key: PASSPHRASE });
      expect(!r.success && r.error.details?.['maxIterations']).toBe(10_000_000);
      expect(!r.success && r.error.details?.['path']).toEqual(['strain']);
    });
  });
});

describe('failure vectors: exact reasons (stricter than the conformance runner)', () => {
  const vectors = JSON.parse(
    readFileSync(new URL('../conformance/vectors/encrypted.json', import.meta.url), 'utf8')
  ) as {
    cases: {
      id: string;
      operation: string;
      input: { url: string; secret: { kdf: string; passphrase?: string; keyBase64url?: string } };
      expected: { success: boolean; reason?: string };
    }[];
  };
  const failures = vectors.cases.filter(c => c.operation === 'decrypt' && !c.expected.success);

  it('covers the failure vectors', () => {
    expect(failures.length).toBeGreaterThan(0);
  });

  it.each(failures.map(c => [c.id, c] as const))('%s', async (_id, c) => {
    const key =
      c.input.secret.kdf === 'raw'
        ? base64UrlDecode(c.input.secret.keyBase64url ?? '')
        : (c.input.secret.passphrase ?? '');
    const r = await decryptSpecimen(c.input.url, { key });
    expect(!r.success && r.error.reason).toBe(c.expected.reason);
  });
});
