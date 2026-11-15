/**
 * WOLS 1.3.0-rc.2 encryption rules: NFC passphrases, iteration limits,
 * field-level AAD, identifying fields, total cost, ID path encoding.
 */
import { describe, expect, it } from 'vitest';

import {
  base64UrlEncode,
  createSpecimen,
  decryptField,
  decryptFields,
  decryptSpecimen,
  derivePassphraseKey,
  encryptFields,
  encryptSpecimen,
  serializeSpecimen,
  type EncryptedField,
  type Specimen,
} from '../../src/index.js';

const NFC = 'Pilzzüchter Ångström'.normalize('NFC');
const NFD = NFC.normalize('NFD');
const PASSPHRASE = 'correct horse battery staple';
const FAST = 100_000; // keep test encryption quick

const specimen = createSpecimen({
  type: 'SUBSTRATE',
  species: 'Pleurotus ostreatus',
  strain: { name: 'MO-Blue-001', generation: 'F1' },
  stage: 'COLONIZATION',
  batch: 'batch_2025_12_001',
});

describe('NFC passphrase normalization', () => {
  it('derives the same key for composed and decomposed input', async () => {
    expect(NFC).not.toBe(NFD);
    const salt = new Uint8Array(16).fill(9);
    const a = await derivePassphraseKey(NFC, salt, 10_000);
    const b = await derivePassphraseKey(NFD, salt, 10_000);
    expect(base64UrlEncode(a)).toBe(base64UrlEncode(b));
  });

  it('decrypts a label encrypted with an NFC passphrase using NFD input, and vice versa', async () => {
    const byNfc = await encryptSpecimen(specimen, { key: NFC, iterations: FAST });
    expect((await decryptSpecimen(byNfc.url ?? '', { key: NFD })).success).toBe(true);
    const byNfd = await encryptFields(specimen, { key: NFD, fields: ['strain'], iterations: FAST });
    expect((await decryptFields(byNfd, { key: NFC })).success).toBe(true);
  });
});

describe('iteration limits', () => {
  it('generates with 600,000 iterations by default', async () => {
    const enc = await encryptSpecimen(specimen, { key: PASSPHRASE });
    expect(enc.iterations).toBe(600_000);
    expect(enc.url).toContain('&i=600000');
  });

  it('allows 100,000 to 10,000,000 when generating', async () => {
    expect(
      (await encryptSpecimen(specimen, { key: PASSPHRASE, iterations: 100_000 })).iterations
    ).toBe(100_000);
    for (const iterations of [99_999, 10_000_001]) {
      await expect(encryptSpecimen(specimen, { key: PASSPHRASE, iterations })).rejects.toThrow(
        /from 100000 to 10000000/
      );
    }
  });

  it('accepts a lower maxIterations but never one above 10,000,000', async () => {
    const enc = await encryptSpecimen(specimen, { key: PASSPHRASE, iterations: FAST });
    const lower = await decryptSpecimen(enc.url ?? '', { key: PASSPHRASE, maxIterations: 50_000 });
    expect(!lower.success && lower.error.reason).toBe('excessive-iterations');
    const higher = await decryptSpecimen(enc.url ?? '', {
      key: PASSPHRASE,
      maxIterations: 10_000_001,
    });
    expect(!higher.success && higher.error.reason).toBe('invalid-parameter');
  });
});

describe('field-level AAD binding', () => {
  const encrypt = (s: Specimen, key: string | Uint8Array = PASSPHRASE) =>
    encryptFields(s, { key, fields: ['strain', 'batch'], iterations: FAST }) as Promise<
      Record<string, unknown>
    >;

  it('round-trips with the AAD of the label id and field name', async () => {
    const partial = await encrypt(specimen);
    const r = await decryptFields(partial, { key: PASSPHRASE });
    expect(r.success && r.data).toEqual(specimen);
  });

  it('rejects values swapped between fields', async () => {
    const partial = await encrypt(specimen);
    const swapped = { ...partial, strain: partial['batch'], batch: partial['strain'] };
    const r = await decryptFields(swapped, { key: PASSPHRASE });
    expect(!r.success && r.error.reason).toBe('authentication-failed');
  });

  it('rejects a value copied from another label', async () => {
    const other = createSpecimen({
      type: 'SUBSTRATE',
      species: 'Pleurotus ostreatus',
      strain: 'x',
    });
    const fromOther = await encryptFields(other, {
      key: PASSPHRASE,
      fields: ['strain'],
      iterations: FAST,
    });
    const partial = await encrypt(specimen);
    const r = await decryptFields({ ...partial, strain: fromOther.strain }, { key: PASSPHRASE });
    expect(!r.success && r.error.reason).toBe('authentication-failed');
  });

  it('rejects a label whose id was changed', async () => {
    const partial = await encrypt(specimen);
    const r = await decryptFields({ ...partial, id: 'wemush:somethingelse' }, { key: PASSPHRASE });
    expect(!r.success && r.error.reason).toBe('authentication-failed');
  });

  it('binds raw-key fields too', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const partial = await encrypt(specimen, key);
    expect((await decryptFields(partial, { key })).success).toBe(true);
    const swapped = { ...partial, strain: partial['batch'], batch: partial['strain'] };
    expect((await decryptFields(swapped, { key })).success).toBe(false);
  });

  it('uses a fresh IV for every field', async () => {
    const partial = await encrypt(specimen);
    expect((partial['strain'] as EncryptedField).iv).not.toBe(
      (partial['batch'] as EncryptedField).iv
    );
  });

  it('decryptField needs the id and field name, and checks them', async () => {
    const partial = await encrypt(specimen);
    const strain = partial['strain'] as EncryptedField;
    const ok = await decryptField(
      strain,
      { key: PASSPHRASE },
      { id: specimen.id, field: 'strain' }
    );
    expect(ok.success && ok.data).toEqual(specimen.strain);
    const wrongField = await decryptField(
      strain,
      { key: PASSPHRASE },
      { id: specimen.id, field: 'batch' }
    );
    expect(!wrongField.success && wrongField.error.reason).toBe('authentication-failed');
    const missing = await decryptField(
      strain,
      { key: PASSPHRASE },
      undefined as unknown as { id: string; field: string }
    );
    expect(!missing.success && missing.error.reason).toBe('invalid-parameter');
  });
});

describe('identifying fields', () => {
  it.each(['@context', '@type', 'id', 'version', 'type', 'species'] as const)(
    'encryptFields refuses %s',
    async field => {
      await expect(encryptFields(specimen, { key: PASSPHRASE, fields: [field] })).rejects.toThrow(
        /identifies the label/
      );
    }
  );

  it('decryptFields refuses a label with an encrypted identifying field, before deriving keys', async () => {
    const partial = await encryptFields(specimen, {
      key: PASSPHRASE,
      fields: ['strain'],
      iterations: FAST,
    });
    const tampered = { ...partial, type: partial.strain };
    const started = performance.now();
    const r = await decryptFields(tampered, { key: PASSPHRASE });
    expect(!r.success && r.error.reason).toBe('identifying-field');
    expect(!r.success && r.error.details?.['path']).toEqual(['type']);
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe('ID path percent-encoding', () => {
  it.each(['Lab A/plate+3%', 'Pilz-ü', 'a?b#c', 'tab\there'])('round-trips %j', async suffix => {
    const s = { ...specimen, id: `wemush:${suffix}` } as Specimen;
    const enc = await encryptSpecimen(s, { key: PASSPHRASE, iterations: FAST });
    expect(enc.url).toContain(`/encrypted/${encodeURIComponent(suffix)}?`);
    const r = await decryptSpecimen(enc.url ?? '', { key: PASSPHRASE });
    expect(r.success && r.data.id).toBe(`wemush:${suffix}`);
  });

  it("treats '+' in the path as a literal character", async () => {
    const s = { ...specimen, id: 'wemush:a+b' } as Specimen;
    const enc = await encryptSpecimen(s, { key: PASSPHRASE, iterations: FAST });
    const literal = (enc.url ?? '').replace('/encrypted/a%2Bb?', '/encrypted/a+b?');
    const r = await decryptSpecimen(literal, { key: PASSPHRASE });
    expect(r.success && r.data.id).toBe('wemush:a+b');
  });

  it.each([
    ['malformed escape', 'clx%zz'],
    ['truncated escape', 'clx%C'],
    ['invalid UTF-8', 'clx%C3%28'],
  ])('rejects a %s as invalid-encoding', async (_label, path) => {
    const url = `wemush://v1/encrypted/${path}?e=${base64UrlEncode(new Uint8Array(32))}&iv=ZGVmZ2hpamtsbW5v&kdf=raw`;
    const r = await decryptSpecimen(url, { key: new Uint8Array(32) });
    expect(!r.success && r.error.reason).toBe('invalid-encoding');
  });
});

describe('legacy field values', () => {
  it('still decrypt with allowLegacy (no kdf, no AAD)', async () => {
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(PASSPHRASE),
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
      new TextEncoder().encode(JSON.stringify(specimen.strain))
    );
    const legacy = {
      ...JSON.parse(serializeSpecimen(specimen)),
      strain: {
        encrypted: true,
        algorithm: 'AES-256-GCM',
        payload: base64UrlEncode(ct),
        iv: base64UrlEncode(iv),
        cryptoVersion: 'v1',
        iterations: 100_000,
      },
    };
    expect((await decryptFields(legacy, { key: PASSPHRASE })).success).toBe(false);
    const r = await decryptFields(legacy, { key: PASSPHRASE, allowLegacy: true });
    expect(r.success && r.data.strain).toEqual(specimen.strain);
  });
});
