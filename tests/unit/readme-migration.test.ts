/**
 * The "Migrating from 1.2" examples in README.md, run against real 1.2.0-style labels.
 *
 * `reencryptLegacy` and `reencryptLegacyFields` are copied verbatim from the README
 * (only the import path differs). If you change one, change the other.
 */
import { describe, expect, it } from 'vitest';

import {
  base64UrlEncode,
  createSpecimen,
  decryptField,
  decryptFields,
  decryptSpecimen,
  encryptFields,
  encryptSpecimen,
  isEncrypted,
  isEncryptedField,
  parseEncryptedUrl,
  serializeSpecimen,
  validateSpecimen,
  type DecryptionOptions,
  type EncryptedField,
  type EncryptedSpecimen,
  type FieldEncryptedSpecimen,
  type Specimen,
} from '../../src/index.js';

// ---- README: whole-label migration -------------------------------------------

/** A 1.2.x label has no `kdf`, in the object form or in a URL. */
function isLegacyLabel(label: string | EncryptedSpecimen): boolean {
  if (typeof label !== 'string') return label.kdf === undefined;
  const parsed = parseEncryptedUrl(label);
  return parsed.success && parsed.data.kdf === undefined;
}

/** Re-encrypt a 1.2.x label in the 1.3.0 format. Returns null if it is already 1.3.0. */
async function reencryptLegacy(
  label: string | EncryptedSpecimen,
  key: DecryptionOptions['key']
): Promise<EncryptedSpecimen | null> {
  if (!isLegacyLabel(label)) return null; // already 1.3.0, or not an encrypted label
  const decoded = await decryptSpecimen(label, { key, allowLegacy: true });
  if (!decoded.success) throw decoded.error; // a WolsDecryptionError with a `reason`
  return encryptSpecimen(decoded.data, { key }); // random salt, kdf, id and url
}

// ---- README: field-level migration -------------------------------------------

/** Re-encrypt a 1.2.x field-level label, keeping the same fields encrypted. */
async function reencryptLegacyFields(
  label: Record<string, unknown>,
  key: DecryptionOptions['key']
): Promise<FieldEncryptedSpecimen> {
  // isEncrypted, not isEncryptedField: 1.2.x field values have no kdf.
  const fields = Object.keys(label).filter(name => isEncrypted(label[name])) as (keyof Specimen)[];
  const decoded = await decryptFields(label, { key, allowLegacy: true });
  if (!decoded.success) throw decoded.error;
  return encryptFields(decoded.data, { key, fields });
}

// ---- 1.2.0 fixtures ------------------------------------------------------------

const PASSPHRASE = 'correct horse battery staple';
const LEGACY_SALT = new TextEncoder().encode('@wemush/wols/crypto/v1');

const specimen = createSpecimen({
  type: 'SUBSTRATE',
  species: 'Pleurotus ostreatus',
  strain: { name: 'MO-Blue-001', generation: 'F1' },
  stage: 'COLONIZATION',
  created: '2025-12-16T10:30:00Z',
});

/** The 1.2.0 key: PBKDF2-SHA256 over the fixed library salt, 100,000 iterations. */
async function legacyKey(passphrase: string, usages: KeyUsage[] = ['encrypt']): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: LEGACY_SALT, iterations: 100_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  );
}

async function legacySeal(
  key: CryptoKey,
  plaintext: string
): Promise<{ payload: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return { payload: base64UrlEncode(ct), iv: base64UrlEncode(iv) };
}

/** What 1.2.0's `encryptSpecimen(specimen, { key })` returned. */
async function legacyEncrypt(s: Specimen, passphrase: string): Promise<EncryptedSpecimen> {
  const sealed = await legacySeal(await legacyKey(passphrase), serializeSpecimen(s));
  return {
    encrypted: true,
    algorithm: 'AES-256-GCM',
    ...sealed,
    cryptoVersion: 'v1',
    iterations: 100_000,
  };
}

/** What 1.2.0's `encryptSpecimen(specimen, { key, fields })` returned. */
async function legacyEncryptFields(
  s: Specimen,
  passphrase: string,
  fields: (keyof Specimen)[]
): Promise<Record<string, unknown>> {
  const key = await legacyKey(passphrase);
  const result: Record<string, unknown> = { ...s };
  for (const field of fields) {
    result[field] = {
      encrypted: true,
      algorithm: 'AES-256-GCM',
      ...(await legacySeal(key, JSON.stringify(s[field]))),
      cryptoVersion: 'v1',
      iterations: 100_000,
    };
  }
  return result;
}

// ---- tests -----------------------------------------------------------------------

describe('README: Migrating from 1.2', () => {
  it('recognizes legacy labels by the missing kdf', async () => {
    const legacy = await legacyEncrypt(specimen, PASSPHRASE);
    expect(isLegacyLabel(legacy)).toBe(true);
    const legacyUrl = `wemush://v1/encrypted/${specimen.id.slice(7)}?e=${legacy.payload}&iv=${legacy.iv}`;
    expect(isLegacyLabel(legacyUrl)).toBe(true);

    const current = await encryptSpecimen(specimen, { key: PASSPHRASE, iterations: 100_000 });
    expect(isLegacyLabel(current)).toBe(false);
    expect(isLegacyLabel(current.url ?? '')).toBe(false);
  });

  it('fails a legacy label with legacy-format unless allowLegacy is set', async () => {
    const legacy = await legacyEncrypt(specimen, PASSPHRASE);
    const r = await decryptSpecimen(legacy, { key: PASSPHRASE });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.reason).toBe('legacy-format');
  });

  it('re-encrypts a legacy label so that it decrypts without allowLegacy', async () => {
    const legacy = await legacyEncrypt(specimen, PASSPHRASE);
    const migrated = await reencryptLegacy(legacy, PASSPHRASE);
    expect(migrated).not.toBeNull();
    expect(migrated?.kdf).toBe('pbkdf2');
    expect(migrated?.url).toMatch(/[?&]kdf=pbkdf2&salt=[^&]+&i=600000$/);

    const reread = await decryptSpecimen(migrated?.url ?? '', { key: PASSPHRASE });
    expect(reread.success && reread.data).toEqual(specimen);
  });

  it('leaves 1.3.0 labels alone and surfaces a wrong key', async () => {
    const current = await encryptSpecimen(specimen, { key: PASSPHRASE, iterations: 100_000 });
    expect(await reencryptLegacy(current.url ?? '', PASSPHRASE)).toBeNull();

    const legacy = await legacyEncrypt(specimen, PASSPHRASE);
    await expect(reencryptLegacy(legacy, 'wrong passphrase')).rejects.toMatchObject({
      reason: 'authentication-failed',
    });
  });

  it('re-encrypts a legacy field-level label, keeping the same fields encrypted', async () => {
    const legacy = await legacyEncryptFields(specimen, PASSPHRASE, ['strain', 'stage']);
    const migrated = await reencryptLegacyFields(legacy, PASSPHRASE);
    expect(isEncryptedField(migrated.strain)).toBe(true);
    expect(isEncryptedField(migrated.stage)).toBe(true);
    expect(migrated.species).toBe('Pleurotus ostreatus');
    expect((migrated.strain as EncryptedField).kdf).toBe('pbkdf2');

    const restored = await decryptFields(migrated, { key: PASSPHRASE });
    expect(restored.success && restored.data).toEqual(specimen);
  });

  it('decryptField needs the { id, field } binding for 1.3.0 values', async () => {
    const partial = await encryptFields(specimen, {
      key: PASSPHRASE,
      fields: ['strain'],
      iterations: 100_000,
    });
    const ok = await decryptField(
      partial.strain,
      { key: PASSPHRASE },
      { id: partial.id, field: 'strain' }
    );
    expect(ok.success && ok.data).toEqual(specimen.strain);

    const moved = await decryptField(
      partial.strain,
      { key: PASSPHRASE },
      { id: partial.id, field: 'notes' }
    );
    expect(moved.success).toBe(false);
    if (!moved.success) expect(moved.error.reason).toBe('authentication-failed');
  });

  it('refuses a legacy field-level label with an encrypted identifying field', async () => {
    const legacy = await legacyEncryptFields(specimen, PASSPHRASE, ['species']);
    await expect(reencryptLegacyFields(legacy, PASSPHRASE)).rejects.toMatchObject({
      reason: 'identifying-field',
    });
  });

  it('migrates a legacy label made with a non-NFC passphrase from the passphrase', async () => {
    const decomposed = 'u\u0308ber secret'; // not NFC
    const legacy = await legacyEncrypt(specimen, decomposed);
    const migrated = await reencryptLegacy(legacy, decomposed);
    expect(migrated?.kdf).toBe('pbkdf2');

    // The new label is NFC-normalized, so either spelling opens it.
    for (const key of [decomposed, decomposed.normalize('NFC')]) {
      const reread = await decryptSpecimen(migrated?.url ?? '', { key });
      expect(reread.success && reread.data).toEqual(specimen);
    }
  });

  it('migrates a legacy NFC-passphrase label from the decomposed spelling', async () => {
    const composed = '\u00fcber secret';
    const legacy = await legacyEncrypt(specimen, composed);
    const migrated = await reencryptLegacy(legacy, composed.normalize('NFD'));
    const reread = await decryptSpecimen(migrated?.url ?? '', { key: composed });
    expect(reread.success && reread.data).toEqual(specimen);
  });

  it("idMode: 'strict' restores the 1.2 ID check", () => {
    const loose = { ...specimen, id: 'wemush:Batch-2025/07' };
    expect(validateSpecimen(loose).valid).toBe(true);
    expect(validateSpecimen(loose, { idMode: 'strict' }).valid).toBe(false);
  });
});
