/**
 * Legacy (1.2.x) passphrase derivation behind `allowLegacy`.
 *
 * 1.2.0 derived keys from the passphrase's UTF-8 bytes exactly as given, with no
 * Unicode normalization (`deriveKey` in src/crypto/encrypt.ts and
 * src/crypto/decrypt.ts at tag 1.2.0). The legacy path must do the same, then
 * retry once with the NFC form. The 1.3.0 path always normalizes to NFC.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  base64UrlEncode,
  createSpecimen,
  decryptField,
  decryptFields,
  decryptSpecimen,
  derivePassphraseKey,
  encryptSpecimen,
  serializeSpecimen,
  type EncryptedField,
  type EncryptedSpecimen,
  type Specimen,
} from '../../src/index.js';

const NFC = 'Pilzzüchter Ångström'.normalize('NFC');
const NFD = NFC.normalize('NFD');
const ITERATIONS = 10_000; // the decode minimum; keeps the tests quick
const LEGACY_SALT = new TextEncoder().encode('@wemush/wols/crypto/v1');

const specimen = createSpecimen({
  type: 'SUBSTRATE',
  species: 'Pleurotus ostreatus',
  strain: { name: 'MO-Blue-001', generation: 'F1' },
  stage: 'COLONIZATION',
  created: '2025-12-16T10:30:00Z',
});

/** The 1.2.0 key: PBKDF2-SHA256 over the passphrase's bytes as given, fixed salt. */
async function legacyKey(passphrase: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: LEGACY_SALT, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
}

async function seal(key: CryptoKey, plaintext: string): Promise<{ payload: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return { payload: base64UrlEncode(ct), iv: base64UrlEncode(iv) };
}

/** What 1.2.0's `encryptSpecimen(specimen, { key, iterations })` returned. */
async function legacyEncrypt(passphrase: string): Promise<EncryptedSpecimen> {
  return {
    encrypted: true,
    algorithm: 'AES-256-GCM',
    ...(await seal(await legacyKey(passphrase), serializeSpecimen(specimen))),
    cryptoVersion: 'v1',
    iterations: ITERATIONS,
  };
}

/** What 1.2.0's `encryptSpecimen(specimen, { key, fields, iterations })` returned. */
async function legacyEncryptFields(
  passphrase: string,
  fields: (keyof Specimen)[]
): Promise<Record<string, unknown>> {
  const key = await legacyKey(passphrase);
  const result: Record<string, unknown> = { ...specimen };
  for (const field of fields) {
    result[field] = {
      encrypted: true,
      algorithm: 'AES-256-GCM',
      ...(await seal(key, JSON.stringify(specimen[field]))),
      cryptoVersion: 'v1',
      iterations: ITERATIONS,
    };
  }
  return result;
}

const legacyUrl = (label: EncryptedSpecimen): string =>
  `wemush://v1/encrypted/${specimen.id.slice('wemush:'.length)}?e=${label.payload}&iv=${label.iv}&i=${ITERATIONS}`;

/** Count PBKDF2 derivations made by the library during `run`. */
async function countDerivations(run: () => Promise<unknown>): Promise<number> {
  const spy = vi.spyOn(crypto.subtle, 'deriveBits');
  await run();
  const n = spy.mock.calls.length;
  spy.mockRestore();
  return n;
}

afterEach(() => vi.restoreAllMocks());

describe('legacy labels made with a non-NFC passphrase', () => {
  it('the test passphrases differ by normalization only', () => {
    expect(NFD).not.toBe(NFC);
    expect(NFD.normalize('NFC')).toBe(NFC);
  });

  it('decrypt from the same passphrase string with allowLegacy (object and URL)', async () => {
    const legacy = await legacyEncrypt(NFD);
    const byObject = await decryptSpecimen(legacy, { key: NFD, allowLegacy: true });
    expect(byObject.success && byObject.data).toEqual(specimen);
    const byUrl = await decryptSpecimen(legacyUrl(legacy), { key: NFD, allowLegacy: true });
    expect(byUrl.success && byUrl.data).toEqual(specimen);
  });

  it('decrypt in one derivation', async () => {
    const legacy = await legacyEncrypt(NFD);
    const n = await countDerivations(() =>
      decryptSpecimen(legacy, { key: NFD, allowLegacy: true })
    );
    expect(n).toBe(1);
  });

  it('decrypt field-level values from the same passphrase string', async () => {
    const legacy = await legacyEncryptFields(NFD, ['strain', 'stage']);
    const all = await decryptFields(legacy, { key: NFD, allowLegacy: true });
    expect(all.success && all.data).toEqual(specimen);

    const one = await decryptField(
      legacy['strain'] as EncryptedField,
      { key: NFD, allowLegacy: true },
      { id: specimen.id, field: 'strain' }
    );
    expect(one.success && one.data).toEqual(specimen.strain);
  });

  it('do not decrypt from the NFC spelling, as in 1.2.x', async () => {
    const legacy = await legacyEncrypt(NFD);
    const r = await decryptSpecimen(legacy, { key: NFC, allowLegacy: true });
    expect(!r.success && r.error.reason).toBe('authentication-failed');
  });
});

describe('legacy labels made with an NFC passphrase, opened with a non-NFC one', () => {
  it('decrypt through the single NFC retry', async () => {
    const legacy = await legacyEncrypt(NFC);
    let r: Awaited<ReturnType<typeof decryptSpecimen>> | undefined;
    const n = await countDerivations(async () => {
      r = await decryptSpecimen(legacy, { key: NFD, allowLegacy: true });
    });
    expect(r?.success && r.data).toEqual(specimen);
    expect(n).toBe(2);
  });

  it('decrypt field-level values, deriving the NFC key once for the label', async () => {
    const legacy = await legacyEncryptFields(NFC, ['strain', 'stage']);
    let r: Awaited<ReturnType<typeof decryptFields>> | undefined;
    const n = await countDerivations(async () => {
      r = await decryptFields(legacy, { key: NFD, allowLegacy: true });
    });
    expect(r?.success && r.data).toEqual(specimen);
    expect(n).toBe(2);
  });

  it('decrypt with an NFC passphrase in one derivation', async () => {
    const legacy = await legacyEncrypt(NFC);
    let r: Awaited<ReturnType<typeof decryptSpecimen>> | undefined;
    const n = await countDerivations(async () => {
      r = await decryptSpecimen(legacy, { key: NFC, allowLegacy: true });
    });
    expect(r?.success && r.data).toEqual(specimen);
    expect(n).toBe(1);
  });

  it('skip the retry when it would exceed maxIterations', async () => {
    const legacy = await legacyEncrypt(NFC);
    let r: Awaited<ReturnType<typeof decryptSpecimen>> | undefined;
    const n = await countDerivations(async () => {
      r = await decryptSpecimen(legacy, {
        key: NFD,
        allowLegacy: true,
        maxIterations: ITERATIONS * 2 - 1,
      });
    });
    expect(!r?.success && r?.error.reason).toBe('authentication-failed');
    expect(n).toBe(1);
  });
});

describe('a wrong passphrase on a legacy label', () => {
  it('fails with authentication-failed whether or not it is in NFC', async () => {
    const legacy = await legacyEncrypt(NFC);
    const wrongNfc = 'Pilzzüchter Ångströms'.normalize('NFC');
    const wrongNfd = wrongNfc.normalize('NFD');

    const a = await decryptSpecimen(legacy, { key: wrongNfc, allowLegacy: true });
    const b = await decryptSpecimen(legacy, { key: wrongNfd, allowLegacy: true });
    expect(!a.success && a.error.reason).toBe('authentication-failed');
    expect(!b.success && b.error.reason).toBe('authentication-failed');
    // The failed retry reports the first attempt's error unchanged.
    expect(!b.success && b.error.message).toBe(!a.success && a.error.message);

    const fields = await legacyEncryptFields(NFC, ['strain']);
    const c = await decryptFields(fields, { key: wrongNfd, allowLegacy: true });
    expect(!c.success && c.error.reason).toBe('authentication-failed');
  });
});

describe('1.3.0 labels are unchanged', () => {
  it('normalize the passphrase to NFC in derivePassphraseKey', async () => {
    const salt = new Uint8Array(16).fill(7);
    const fromNfd = await derivePassphraseKey(NFD, salt, ITERATIONS);
    const fromNfc = await derivePassphraseKey(NFC, salt, ITERATIONS);
    expect(fromNfd).toEqual(fromNfc);
  });

  it('decrypt from either spelling in one derivation, with no retry', async () => {
    const label = await encryptSpecimen(specimen, { key: NFD, iterations: 100_000 });
    for (const key of [NFC, NFD]) {
      let r: Awaited<ReturnType<typeof decryptSpecimen>> | undefined;
      const n = await countDerivations(async () => {
        r = await decryptSpecimen(label.url ?? '', { key });
      });
      expect(r?.success && r.data).toEqual(specimen);
      expect(n).toBe(1);
    }
  });

  it('a wrong non-NFC passphrase costs one derivation', async () => {
    const label = await encryptSpecimen(specimen, { key: NFC, iterations: 100_000 });
    let r: Awaited<ReturnType<typeof decryptSpecimen>> | undefined;
    const n = await countDerivations(async () => {
      r = await decryptSpecimen(label.url ?? '', { key: 'wrong u\u0308' });
    });
    expect(!r?.success && r?.error.reason).toBe('authentication-failed');
    expect(n).toBe(1);
  });
});
