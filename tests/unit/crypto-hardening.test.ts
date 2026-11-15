/**
 * Hardening from the 1.3.0 review: bounded and cheap-first decoding, typed
 * decryption errors, strict field-level encryption, generator floors in
 * toEncryptedUrl, and the split encrypted-value type guards.
 */
import { describe, expect, it } from 'vitest';

import {
  WolsDecryptionError,
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
    [{ iterations: 99_999 }, /at least 100000 iterations/],
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
