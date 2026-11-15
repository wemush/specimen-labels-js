/**
 * WOLS v1.3.0 encrypted wire format:
 * wemush://v1/encrypted/{id}?e=&iv=&kdf=pbkdf2|raw[&salt=&i=][&sig=]
 */
import { describe, expect, it } from 'vitest';

import {
  base64UrlDecode,
  base64UrlEncode,
  createSpecimen,
  decryptFields,
  decryptPlaintext,
  decryptSpecimen,
  derivePassphraseKey,
  encryptSpecimen,
  parseEncryptedUrl,
  serializeSpecimen,
  toEncryptedUrl,
  type EncryptedField,
  type EncryptedSpecimen,
  type Specimen,
} from '../../src/index.js';

const PASSPHRASE = 'correct horse battery staple';

const specimen = createSpecimen({
  type: 'SUBSTRATE',
  species: 'Pleurotus ostreatus',
  strain: { name: 'MO-Blue-001', generation: 'F1', clonalGeneration: 2, transferDepth: 4 },
  stage: 'COLONIZATION',
  created: '2025-12-16T10:30:00Z',
});

const rawKey = (): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(32));

function query(url: string): URLSearchParams {
  return new URLSearchParams(url.slice(url.indexOf('?') + 1));
}

async function reasonOf(
  p: Promise<{ success: boolean; error?: { details?: Record<string, unknown> | undefined } }>
): Promise<unknown> {
  const r = await p;
  expect(r.success).toBe(false);
  return r.error?.details?.['reason'];
}

describe('base64url helpers', () => {
  it('encode without padding and decode padded or unpadded input', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xfe, 0x00, 0x01]);
    const encoded = base64UrlEncode(bytes);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Array.from(base64UrlDecode(encoded))).toEqual(Array.from(bytes));
    expect(Array.from(base64UrlDecode(`${encoded}=`))).toEqual(Array.from(bytes));
  });

  it('reject characters outside the base64url alphabet', () => {
    expect(() => base64UrlDecode('ab+/')).toThrow();
    expect(() => base64UrlDecode('a')).toThrow();
  });
});

describe('derivePassphraseKey', () => {
  it('derives 32 bytes deterministically for a given salt', async () => {
    const salt = new Uint8Array(16).fill(7);
    const a = await derivePassphraseKey(PASSPHRASE, salt, 10_000);
    const b = await derivePassphraseKey(PASSPHRASE, salt, 10_000);
    expect(a).toHaveLength(32);
    expect(base64UrlEncode(a)).toBe(base64UrlEncode(b));
  });
});

describe('encryptSpecimen with a passphrase (kdf=pbkdf2)', () => {
  it('produces the v1.3.0 URL with a per-label 16-byte salt and 100k iterations', async () => {
    const enc = await encryptSpecimen(specimen, { key: PASSPHRASE });
    expect(enc).toMatchObject({
      encrypted: true,
      algorithm: 'AES-256-GCM',
      kdf: 'pbkdf2',
      id: specimen.id,
    });
    expect(enc.iterations).toBe(100_000);
    expect(enc.cryptoVersion).toBeUndefined();

    const url = enc.url ?? '';
    expect(url.startsWith(`wemush://v1/encrypted/${specimen.id.slice(7)}?`)).toBe(true);
    const q = query(url);
    expect([...q.keys()]).toEqual(['e', 'iv', 'kdf', 'salt', 'i']);
    expect(q.get('kdf')).toBe('pbkdf2');
    expect(q.get('i')).toBe('100000');
    for (const k of ['e', 'iv', 'salt']) expect(q.get(k)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(base64UrlDecode(q.get('salt') ?? '')).toHaveLength(16);
    expect(base64UrlDecode(q.get('iv') ?? '')).toHaveLength(12);
    // ciphertext = plaintext length + 16-byte GCM tag
    expect(base64UrlDecode(q.get('e') ?? '')).toHaveLength(
      new TextEncoder().encode(serializeSpecimen(specimen)).length + 16
    );
  });

  it('uses a fresh random salt and IV for every label', async () => {
    const a = await encryptSpecimen(specimen, { key: PASSPHRASE });
    const b = await encryptSpecimen(specimen, { key: PASSPHRASE });
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.payload).not.toBe(b.payload);
  });

  it('never uses the pre-1.3.0 fixed salt', async () => {
    const enc = await encryptSpecimen(specimen, { key: PASSPHRASE });
    // The old fixed-salt scheme must not open a newly generated label.
    const legacyView = { ...enc, kdf: undefined, salt: undefined } as unknown as EncryptedSpecimen;
    delete (legacyView as { kdf?: unknown }).kdf;
    delete (legacyView as { salt?: unknown }).salt;
    const r = await decryptSpecimen(legacyView, { key: PASSPHRASE, allowLegacy: true });
    expect(r.success).toBe(false);
  });

  it('records custom iterations of at least 100,000', async () => {
    const enc = await encryptSpecimen(specimen, { key: PASSPHRASE, iterations: 150_000 });
    expect(query(enc.url ?? '').get('i')).toBe('150000');
    expect((await decryptSpecimen(enc.url ?? '', { key: PASSPHRASE })).success).toBe(true);
  });

  it.each([99_999, 10_000, 1.5e5 + 0.5])(
    'refuses to generate with %d iterations',
    async iterations => {
      await expect(encryptSpecimen(specimen, { key: PASSPHRASE, iterations })).rejects.toThrow(
        /iterations/
      );
    }
  );

  it('round-trips via URL and via object', async () => {
    const enc = await encryptSpecimen(specimen, { key: PASSPHRASE });
    for (const input of [enc.url ?? '', enc]) {
      const plain = await decryptPlaintext(input, { key: PASSPHRASE });
      expect(plain).toEqual({ success: true, data: serializeSpecimen(specimen) });
      const parsed = await decryptSpecimen(input, { key: PASSPHRASE });
      expect(parsed.success && parsed.data).toEqual(specimen);
    }
  });

  it('fails authentication with the wrong passphrase', async () => {
    const enc = await encryptSpecimen(specimen, { key: PASSPHRASE });
    expect(await reasonOf(decryptSpecimen(enc.url ?? '', { key: 'nope' }))).toBe(
      'authentication-failed'
    );
  });
});

describe('encryptSpecimen with raw key bytes (kdf=raw)', () => {
  it('omits salt and i', async () => {
    const key = rawKey();
    const enc = await encryptSpecimen(specimen, { key });
    expect(enc.kdf).toBe('raw');
    expect(enc.salt).toBeUndefined();
    expect(enc.iterations).toBeUndefined();
    expect([...query(enc.url ?? '').keys()]).toEqual(['e', 'iv', 'kdf']);
    const r = await decryptSpecimen(enc.url ?? '', { key });
    expect(r.success && r.data).toEqual(specimen);
  });

  it('accepts ArrayBuffer and AES-GCM CryptoKey keys', async () => {
    const bytes = rawKey();
    const cryptoKey = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, [
      'encrypt',
      'decrypt',
    ]);
    const viaBuffer = await encryptSpecimen(specimen, { key: bytes.slice().buffer });
    const viaCryptoKey = await encryptSpecimen(specimen, { key: cryptoKey });
    expect(viaCryptoKey.kdf).toBe('raw');
    // Same key material, so either form decrypts either label.
    expect((await decryptSpecimen(viaBuffer.url ?? '', { key: cryptoKey })).success).toBe(true);
    expect((await decryptSpecimen(viaCryptoKey.url ?? '', { key: bytes })).success).toBe(true);
  });

  it('rejects keys that are not exactly 32 bytes', async () => {
    await expect(encryptSpecimen(specimen, { key: new Uint8Array(16) })).rejects.toThrow(
      /32 bytes/
    );
    const enc = await encryptSpecimen(specimen, { key: rawKey() });
    expect(await reasonOf(decryptSpecimen(enc.url ?? '', { key: new Uint8Array(31) }))).toBe(
      'invalid-key'
    );
  });

  it('rejects a non-256-bit CryptoKey', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, false, [
      'encrypt',
    ]);
    await expect(encryptSpecimen(specimen, { key })).rejects.toThrow(/256/);
  });

  it('rejects a passphrase for a raw label and raw bytes for a pbkdf2 label', async () => {
    const raw = await encryptSpecimen(specimen, { key: rawKey() });
    expect(await reasonOf(decryptSpecimen(raw.url ?? '', { key: PASSPHRASE }))).toBe('invalid-key');
    const pbkdf2 = await encryptSpecimen(specimen, { key: PASSPHRASE });
    expect(await reasonOf(decryptSpecimen(pbkdf2.url ?? '', { key: rawKey() }))).toBe(
      'invalid-key'
    );
  });
});

describe('decoding rules', () => {
  it('rejects a decrypted id that does not match the URL path', async () => {
    const enc = await encryptSpecimen(specimen, { key: PASSPHRASE });
    const swapped = (enc.url ?? '').replace(
      `/encrypted/${specimen.id.slice(7)}?`,
      '/encrypted/someoneelse?'
    );
    expect(await reasonOf(decryptSpecimen(swapped, { key: PASSPHRASE }))).toBe('id-mismatch');
    expect(
      await reasonOf(decryptSpecimen({ ...enc, id: 'wemush:someoneelse' }, { key: PASSPHRASE }))
    ).toBe('id-mismatch');
  });

  it('rejects iteration counts below 10,000 and non-integer counts', async () => {
    const enc = await encryptSpecimen(specimen, { key: PASSPHRASE });
    const url = enc.url ?? '';
    expect(
      await reasonOf(decryptSpecimen(url.replace('i=100000', 'i=9999'), { key: PASSPHRASE }))
    ).toBe('insufficient-iterations');
    expect(
      await reasonOf(decryptSpecimen(url.replace('i=100000', 'i=1e5'), { key: PASSPHRASE }))
    ).toBe('invalid-parameter');
  });

  it('requires salt and i for pbkdf2, and forbids them for raw', async () => {
    const enc = await encryptSpecimen(specimen, { key: PASSPHRASE });
    const url = enc.url ?? '';
    expect(await reasonOf(decryptSpecimen(url.replace(/&i=\d+/, ''), { key: PASSPHRASE }))).toBe(
      'missing-parameter'
    );
    const key = rawKey();
    const raw = (await encryptSpecimen(specimen, { key })).url ?? '';
    expect(await reasonOf(decryptSpecimen(`${raw}&i=100000`, { key }))).toBe(
      'unexpected-parameter'
    );
  });

  it('rejects unknown kdf values, malformed URLs and bad IVs', async () => {
    const enc = await encryptSpecimen(specimen, { key: PASSPHRASE });
    const url = enc.url ?? '';
    expect(
      await reasonOf(decryptSpecimen(url.replace('kdf=pbkdf2', 'kdf=argon2'), { key: PASSPHRASE }))
    ).toBe('unsupported-kdf');
    expect(
      await reasonOf(decryptSpecimen('wemush://v1/clx1a2b3c4?e=x&iv=y', { key: PASSPHRASE }))
    ).toBe('invalid-url');
    expect(
      await reasonOf(decryptSpecimen(url.replace(/iv=[^&]+/, 'iv=AAAA'), { key: PASSPHRASE }))
    ).toBe('invalid-parameter');
    expect(await reasonOf(decryptSpecimen(`${url}&kdf=raw`, { key: PASSPHRASE }))).toBe(
      'invalid-parameter'
    );
  });

  it('accepts padded base64url parameters', async () => {
    const enc = await encryptSpecimen(specimen, { key: PASSPHRASE });
    // 16-byte salt -> 22 unpadded chars; padded form ends in "=="
    const padded = (enc.url ?? '').replace(`salt=${enc.salt}`, `salt=${enc.salt}==`);
    expect((await decryptSpecimen(padded, { key: PASSPHRASE })).success).toBe(true);
  });

  it('leaves sig alone: preserved on parse, ignored by decryption', async () => {
    const enc = await encryptSpecimen(specimen, { key: PASSPHRASE });
    const signed = `${enc.url}&sig=abc_DEF-123`;
    const parsed = parseEncryptedUrl(signed);
    expect(parsed.success && parsed.data.signature).toBe('abc_DEF-123');
    expect((await decryptSpecimen(signed, { key: PASSPHRASE })).success).toBe(true);
    if (parsed.success) expect(toEncryptedUrl(parsed.data)).toBe(signed);
  });

  it('round-trips IDs with characters that need URL encoding', async () => {
    const odd = { ...specimen, id: 'wemush:WM LC/25#01' } as Specimen;
    const enc = await encryptSpecimen(odd, { key: PASSPHRASE });
    expect(enc.url).toContain('/encrypted/WM%20LC%2F25%2301?');
    const r = await decryptSpecimen(enc.url ?? '', { key: PASSPHRASE });
    expect(r.success && r.data.id).toBe('wemush:WM LC/25#01');
  });

  it('refuses to encrypt a specimen without a usable id', async () => {
    const bad = { ...specimen, id: 'wemush:' } as Specimen;
    await expect(encryptSpecimen(bad, { key: PASSPHRASE })).rejects.toThrow(/non-empty suffix/);
  });
});

describe('field-level encryption', () => {
  it('replaces each field with the v1.3.0 encrypted-field object', async () => {
    const out = (await encryptSpecimen(specimen, {
      key: PASSPHRASE,
      fields: ['strain', 'stage'],
    })) as unknown as Record<string, unknown>;
    expect(out['species']).toBe(specimen.species);
    for (const name of ['strain', 'stage']) {
      const field = out[name] as EncryptedField;
      expect(Object.keys(field).sort()).toEqual(
        ['algorithm', 'encrypted', 'iterations', 'iv', 'kdf', 'payload', 'salt'].sort()
      );
      expect(field).toMatchObject({
        encrypted: true,
        algorithm: 'AES-256-GCM',
        kdf: 'pbkdf2',
        iterations: 100_000,
      });
      expect(base64UrlDecode(field.salt ?? '')).toHaveLength(16);
    }
    // One salt per label, a fresh IV per field.
    expect((out['strain'] as EncryptedField).salt).toBe((out['stage'] as EncryptedField).salt);
    expect((out['strain'] as EncryptedField).iv).not.toBe((out['stage'] as EncryptedField).iv);

    const restored = await decryptFields(out, { key: PASSPHRASE });
    expect(restored.success && restored.data).toEqual(specimen);
  });

  it('uses kdf=raw without salt or iterations for raw keys', async () => {
    const key = rawKey();
    const out = (await encryptSpecimen(specimen, { key, fields: ['strain'] })) as unknown as Record<
      string,
      unknown
    >;
    expect(Object.keys(out['strain'] as object).sort()).toEqual(
      ['algorithm', 'encrypted', 'iv', 'kdf', 'payload'].sort()
    );
    const restored = await decryptFields(out, { key });
    expect(restored.success && restored.data['strain']).toEqual(specimen.strain);
  });

  it('reports which field failed', async () => {
    const out = (await encryptSpecimen(specimen, {
      key: PASSPHRASE,
      fields: ['strain'],
    })) as unknown as Record<string, unknown>;
    const r = await decryptFields(out, { key: 'wrong' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.details?.['reason']).toBe('authentication-failed');
      expect(r.error.message).toContain('strain');
    }
  });
});

describe('legacy (pre-1.3.0) payloads', () => {
  // Reproduce the 1.2.0 scheme: PBKDF2 over a fixed library-wide salt, no kdf/salt fields.
  async function legacyEncrypt(s: Specimen, passphrase: string): Promise<EncryptedSpecimen> {
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: new TextEncoder().encode('@wemush/wols/crypto/v1'),
        iterations: 100_000,
        hash: 'SHA-256',
      },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(serializeSpecimen(s))
    );
    return {
      encrypted: true,
      algorithm: 'AES-256-GCM',
      payload: base64UrlEncode(ct),
      iv: base64UrlEncode(iv),
      cryptoVersion: 'v1',
      iterations: 100_000,
    };
  }

  it('are rejected by default', async () => {
    const legacy = await legacyEncrypt(specimen, PASSPHRASE);
    const r = await decryptSpecimen(legacy, { key: PASSPHRASE });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.details?.['reason']).toBe('missing-parameter');
      expect(r.error.message).toContain('allowLegacy');
    }
  });

  it('decrypt as objects and as kdf-less URLs with allowLegacy', async () => {
    const legacy = await legacyEncrypt(specimen, PASSPHRASE);
    const asObject = await decryptSpecimen(legacy, { key: PASSPHRASE, allowLegacy: true });
    expect(asObject.success && asObject.data).toEqual(specimen);

    const url = `wemush://v1/encrypted/${specimen.id.slice(7)}?e=${legacy.payload}&iv=${legacy.iv}`;
    expect((await decryptSpecimen(url, { key: PASSPHRASE })).success).toBe(false);
    const asUrl = await decryptSpecimen(url, { key: PASSPHRASE, allowLegacy: true });
    expect(asUrl.success && asUrl.data).toEqual(specimen);
  });

  it('are never generated', async () => {
    const legacy = await legacyEncrypt(specimen, PASSPHRASE);
    expect(() => toEncryptedUrl({ ...legacy, id: specimen.id })).toThrow(/legacy/);
  });
});
