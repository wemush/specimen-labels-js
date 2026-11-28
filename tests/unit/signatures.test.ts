/**
 * WOLS 1.4.0 signatures (and 1.5.0 compact URL signatures): behavior beyond
 * the conformance vectors.
 */
import { describe, expect, it } from 'vitest';

import {
  WolsSignatureError,
  base64UrlDecode,
  base64UrlEncode,
  canonicalizeJson,
  createSpecimen,
  createTrustStore,
  trustStoreFromKeySet,
  decryptPlaintext,
  decryptSpecimen,
  encryptSpecimen,
  getSigningPublicKey,
  parseCompactUrl,
  parseEncryptedUrl,
  parseSpecimen,
  serializeSpecimen,
  signCompactUrl,
  signEncryptedUrl,
  signSpecimen,
  toCompactUrl,
  toEncryptedUrl,
  unwrapWolsUrl,
  validateSpecimen,
  verifySpecimen,
  type TrustStore,
} from '../../src/index.js';
import { hasDuplicateMemberNames } from '../../src/crypto/jcs.js';

// Published conformance test keys (signatures.json). Never use them for real labels.
const SEED = base64UrlDecode('nmZ96bzKA4895n6UU0TsUATfSUVyfH30brZ5FSlpRvM');
const PUBLIC_KEY = base64UrlDecode('_Xjcp4sgkJNoEkWum4ZM1qTsy7MTKr3Sk6dbrHip2to');
const KID = 'mushoh-2026';
const STORE: TrustStore = { [KID]: { alg: 'Ed25519', publicKey: PUBLIC_KEY } };
const OPTIONS = { privateKey: SEED, kid: KID };
const PASSPHRASE = 'correct horse battery staple';

const specimen = createSpecimen({
  type: 'SUBSTRATE',
  species: 'Pleurotus ostreatus',
  strain: { name: 'MO-Blue-001', generation: 'F1' },
  stage: 'COLONIZATION',
  batch: 'batch_2025_12_001',
});
const LABEL = serializeSpecimen(specimen);

/** Replace S with S + L: the malleated form that RFC 8032 verifiers must reject. */
function malleate(sig: string): string {
  const L = (1n << 252n) + 27742317777372353535851937790883648493n;
  const bytes = base64UrlDecode(sig);
  let s = 0n;
  for (let i = 63; i >= 32; i--) s = (s << 8n) | BigInt(bytes[i] as number);
  s += L;
  for (let i = 32; i < 64; i++) {
    bytes[i] = Number(s & 0xffn);
    s >>= 8n;
  }
  return base64UrlEncode(bytes);
}

describe('canonicalizeJson (RFC 8785)', () => {
  it('sorts members by UTF-16 code units and formats numbers like ECMAScript', () => {
    expect(canonicalizeJson({ b: 1, a: [1.0, -0, 1e21, 1e-7], '\u{1F344}': 1, ﬁ: 2 })).toBe(
      '{"a":[1,0,1e+21,1e-7],"b":1,"\u{1F344}":1,"ﬁ":2}'
    );
  });

  it('escapes only quote, backslash and control characters', () => {
    expect(canonicalizeJson('/ \u007f\u0001"\\\n')).toBe('"/ \u007f\\u0001\\"\\\\\\n"');
  });

  it.each([
    ['NaN', { n: Number.NaN }],
    ['Infinity', { n: Number.POSITIVE_INFINITY }],
    ['undefined member', { u: undefined }],
    ['function', { f: () => 1 }],
    ['bigint', { b: 1n }],
    ['Date', { d: new Date(0) }],
    ['lone high surrogate', { s: '\uD83C' }],
    ['lone low surrogate in a name', { '\uDF44': 1 }],
    ['sparse array', { a: [1, , 3] }], // eslint-disable-line no-sparse-arrays
  ])('refuses a %s', (_name, value) => {
    expect(() => canonicalizeJson(value)).toThrow();
  });

  it('refuses cycles', () => {
    const a: Record<string, unknown> = {};
    a['self'] = a;
    expect(() => canonicalizeJson(a)).toThrow(/cycle/);
  });

  it('keeps a __proto__ member as an ordinary member', () => {
    const parsed = JSON.parse('{"__proto__":{"x":1},"a":2}') as object;
    expect(canonicalizeJson(parsed)).toBe('{"__proto__":{"x":1},"a":2}');
  });
});

describe('hasDuplicateMemberNames', () => {
  it.each([
    ['{"a":1,"a":2}', true],
    ['{"a":1,"\\u0061":2}', true],
    ['{"a":{"b":1,"b":2}}', true],
    ['[{"a":1},{"a":2}]', false],
    ['{"a":"\\"a\\"","b":["a","a"]}', false],
    ['{"a":{"a":1},"b":{}}', false],
  ])('%s -> %s', (text, expected) => {
    expect(hasDuplicateMemberNames(text)).toBe(expected);
  });
});

describe('getSigningPublicKey', () => {
  it('derives the published test public key from its seed', async () => {
    expect(base64UrlEncode(await getSigningPublicKey(SEED))).toBe(base64UrlEncode(PUBLIC_KEY));
  });

  it('refuses a key that is not 32 bytes', async () => {
    await expect(getSigningPublicKey(new Uint8Array(31))).rejects.toThrow(WolsSignatureError);
  });
});

describe('signSpecimen', () => {
  it('signs serialized label text, puts the token last, and verifies', async () => {
    const signed = await signSpecimen(LABEL, OPTIONS);
    const keys = Object.keys(JSON.parse(signed) as object);
    expect(keys[keys.length - 1]).toBe('signature');
    expect(await verifySpecimen(signed, STORE)).toEqual({
      status: 'valid',
      form: 'embedded',
      kid: KID,
    });
  });

  it('accepts a parsed JSON object and gives the same token as its text', async () => {
    const fromText = JSON.parse(await signSpecimen(LABEL, OPTIONS)) as Record<string, unknown>;
    const fromObject = JSON.parse(
      await signSpecimen(JSON.parse(LABEL) as object, OPTIONS)
    ) as Record<string, unknown>;
    expect(fromObject['signature']).toBe(fromText['signature']);
  });

  it('accepts an Ed25519 CryptoKey', async () => {
    const pkcs8 = new Uint8Array([
      ...[0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22],
      ...[0x04, 0x20],
      ...SEED,
    ]);
    const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
    const a = await signSpecimen(LABEL, { privateKey: key, kid: KID });
    expect(a).toBe(await signSpecimen(LABEL, OPTIONS));
  });

  it('replaces an existing signature', async () => {
    const once = await signSpecimen(LABEL, OPTIONS);
    expect(await signSpecimen(once, OPTIONS)).toBe(once);
  });

  it('keeps unknown members, which the signature covers', async () => {
    const label = JSON.stringify({ ...JSON.parse(LABEL), extension: { a: 1 } });
    const signed = await signSpecimen(label, OPTIONS);
    expect((JSON.parse(signed) as Record<string, unknown>)['extension']).toEqual({ a: 1 });
    expect((await verifySpecimen(signed, STORE)).status).toBe('valid');
  });

  it.each([
    ['not JSON', '{'],
    ['not an object', '[1]'],
    ['duplicate members', '{"a":1,"a":2}'],
    ['a lone surrogate', '{"a":"\\ud83c"}'],
  ])('refuses %s', async (_name, label) => {
    await expect(signSpecimen(label, OPTIONS)).rejects.toThrow(WolsSignatureError);
  });

  it('refuses objects that are not plain JSON', async () => {
    await expect(signSpecimen({ n: Number.NaN }, OPTIONS)).rejects.toThrow(WolsSignatureError);
    await expect(signSpecimen({ d: new Date(0) }, OPTIONS)).rejects.toThrow(WolsSignatureError);
  });

  it.each(['', 'a.b', 'has space', 'x'.repeat(65), 'ünï'])('refuses kid %j', async kid => {
    await expect(signSpecimen(LABEL, { privateKey: SEED, kid })).rejects.toThrow(
      WolsSignatureError
    );
  });

  it('refuses a private key that is not 32 bytes', async () => {
    await expect(signSpecimen(LABEL, { privateKey: new Uint8Array(64), kid: KID })).rejects.toThrow(
      WolsSignatureError
    );
  });
});

describe('verifySpecimen', () => {
  it('never throws for bad input; every outcome is a status', async () => {
    for (const input of ['', 'not json', '42', 'null', '"text"'] as const) {
      expect((await verifySpecimen(input, STORE)).status).toBe('malformed');
    }
    expect((await verifySpecimen(42 as unknown as object, STORE)).status).toBe('malformed');
    expect((await verifySpecimen(null as unknown as object, STORE)).status).toBe('malformed');
  });

  it('checks I-JSON before anything else: unsigned labels can be malformed', async () => {
    for (const text of [
      '{"a":"\\ud83c"}',
      '{"a":1,"a":2}',
      '{"a":{"b":1,"\\u0062":2}}',
      '{"a":1e400}',
      '{"a":NaN}',
    ]) {
      expect((await verifySpecimen(text, STORE)).status).toBe('malformed');
    }
    expect((await verifySpecimen({ a: Number.NaN }, STORE)).status).toBe('malformed');
    expect((await verifySpecimen(LABEL, STORE)).status).toBe('unsigned');
  });

  it('treats duplicate member names as malformed (SHOULD)', async () => {
    const signed = await signSpecimen(LABEL, OPTIONS);
    const duplicated = signed.replace('{', '{"stage":"HARVEST",');
    expect((await verifySpecimen(duplicated, STORE)).status).toBe('malformed');
  });

  it('rejects S >= L itself, whatever the WebCrypto backend does', async () => {
    const signed = JSON.parse(await signSpecimen(LABEL, OPTIONS)) as Record<string, string>;
    const [kid, sig] = (signed['signature'] as string).split('.') as [string, string];
    const tampered = JSON.stringify({ ...signed, signature: `${kid}.${malleate(sig)}` });
    const r = await verifySpecimen(tampered, STORE);
    expect(r.status).toBe('invalid');
    expect(r.reason).toMatch(/group order/);
  });

  it('resolves kids only as own trust store entries', async () => {
    for (const kid of ['constructor', 'toString', 'hasOwnProperty']) {
      const signed = await signSpecimen(LABEL, { privateKey: SEED, kid });
      expect((await verifySpecimen(signed, STORE)).status).toBe('unknown-kid');
    }
  });

  const OFF_CURVE = base64UrlDecode('AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  const UNUSABLE: unknown[] = [
    { alg: 'Ed448', publicKey: PUBLIC_KEY },
    { alg: 'Ed25519', publicKey: PUBLIC_KEY.slice(1) },
    { alg: 'Ed25519', publicKey: 'not bytes' },
    { alg: 'Ed25519', publicKey: OFF_CURVE },
    null,
  ];

  it('treats an unusable trust store entry as invalid, not unknown-kid', async () => {
    const signed = await signSpecimen(LABEL, OPTIONS);
    for (const entry of UNUSABLE) {
      const r = await verifySpecimen(signed, { [KID]: entry } as unknown as TrustStore);
      expect(r).toMatchObject({ status: 'invalid', kid: KID });
    }
  });

  it('createTrustStore rejects unusable entries and accepts good ones', async () => {
    for (const entry of UNUSABLE) {
      await expect(createTrustStore({ [KID]: entry } as unknown as TrustStore)).rejects.toThrow(
        WolsSignatureError
      );
    }
    await expect(
      createTrustStore({ 'bad kid': { alg: 'Ed25519', publicKey: PUBLIC_KEY } })
    ).rejects.toThrow(WolsSignatureError);
    const store = await createTrustStore(STORE);
    expect(Object.isFrozen(store)).toBe(true);
    const signed = await signSpecimen(LABEL, OPTIONS);
    expect((await verifySpecimen(signed, store)).status).toBe('valid');
    // Every published test key is a curve point.
    for (const key of [
      '_Xjcp4sgkJNoEkWum4ZM1qTsy7MTKr3Sk6dbrHip2to',
      'mj4xN_P2kbWmyZmUixRTIjb8CCtJHmDYkc7NJDKnUHA',
      'HBM5fYMP0BenkRfYgtn3h6wj-deDwAk6Eltkb0PWfr4',
    ]) {
      await expect(
        createTrustStore({ k: { alg: 'Ed25519', publicKey: base64UrlDecode(key) } })
      ).resolves.toBeDefined();
    }
  });

  it('ignores a public key carried in the label', async () => {
    const attackerSeed = new Uint8Array(32).fill(7);
    const attackerKey = await getSigningPublicKey(attackerSeed);
    const forged = await signSpecimen(
      JSON.stringify({ ...JSON.parse(LABEL), publicKey: base64UrlEncode(attackerKey) }),
      { privateKey: attackerSeed, kid: KID }
    );
    expect((await verifySpecimen(forged, STORE)).status).toBe('invalid');
  });

  it('fails on the library model when parsing changed the label', async () => {
    // parseSpecimen drops members it doesn't know, so its model is not what was signed.
    const label = JSON.stringify({ ...JSON.parse(LABEL), extension: true });
    const signed = await signSpecimen(label, OPTIONS);
    const model = parseSpecimen(signed);
    expect(model.success).toBe(true);
    expect((await verifySpecimen(signed, STORE)).status).toBe('valid');
    if (!model.success) throw model.error;
    expect('extension' in model.data).toBe(false);
    expect((await verifySpecimen(model.data, STORE)).status).toBe('invalid');
  });

  it('does not change decoding or validation of a signed label', async () => {
    const signed = await signSpecimen(LABEL, OPTIONS);
    const parsed = parseSpecimen(signed);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.signature).toBe((JSON.parse(signed) as { signature: string }).signature);
    }
    expect(validateSpecimen(JSON.parse(signed)).valid).toBe(true);
  });
});

describe('signEncryptedUrl', () => {
  it('signs an encrypted URL that still decrypts and survives re-serialization', async () => {
    const enc = await encryptSpecimen(specimen, { key: PASSPHRASE, iterations: 100_000 });
    const signed = await signEncryptedUrl(enc.url as string, OPTIONS);
    expect(signed.startsWith(`${enc.url as string}&sig=${KID}.`)).toBe(true);
    expect(await verifySpecimen(signed, STORE)).toEqual({
      status: 'valid',
      form: 'encrypted-url',
      kid: KID,
    });

    // Decoding ignores the signature and keeps it.
    const plain = await decryptPlaintext(signed, { key: PASSPHRASE });
    expect(plain.success && plain.data).toBe(LABEL);
    const parsed = parseEncryptedUrl(signed);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(signed.endsWith(`&sig=${parsed.data.signature as string}`)).toBe(true);
      // Re-emitting from the parsed object reproduces the signed bytes.
      const { url: _url, ...rest } = parsed.data;
      expect(toEncryptedUrl(rest)).toBe(signed);
    }
  });

  it('supports sign-then-encrypt: the decrypted label verifies as embedded', async () => {
    const signedLabel = await signSpecimen(LABEL, OPTIONS);
    const inner = parseSpecimen(signedLabel);
    if (!inner.success) throw inner.error;
    const enc = await encryptSpecimen(inner.data, { key: PASSPHRASE, iterations: 100_000 });
    const plain = await decryptPlaintext(enc.url as string, { key: PASSPHRASE });
    if (!plain.success) throw plain.error;
    expect((await verifySpecimen(plain.data, STORE)).status).toBe('valid');
    expect((await decryptSpecimen(enc.url as string, { key: PASSPHRASE })).success).toBe(true);
  });

  const BASE = 'wemush://v1/encrypted/clx1a2b3c4?e=AAAA&iv=BBBB&kdf=raw';
  it.each([
    ['an existing sig', `${BASE}&sig=x`],
    ['no query', 'wemush://v1/encrypted/clx1a2b3c4'],
    ['an empty query', 'wemush://v1/encrypted/clx1a2b3c4?'],
    ['a fragment', `${BASE}#frag`],
    ['a space', `${BASE}&x=a b`],
    ['non-ASCII', `${BASE}&x=ü`],
    ['another scheme', 'wemush://v1/clx1a2b3c4?s=POSTR'],
  ])('refuses a URL with %s', async (_name, url) => {
    await expect(signEncryptedUrl(url, OPTIONS)).rejects.toThrow(WolsSignatureError);
  });

  it('reports URL rule violations as malformed', async () => {
    const signed = await signEncryptedUrl(BASE, OPTIONS);
    const token = signed.slice(signed.indexOf('&sig=') + 5);
    expect((await verifySpecimen(`${BASE}&sig`, STORE)).status).toBe('malformed');
    expect((await verifySpecimen(`wemush://v1/encrypted/x?sig=${token}`, STORE)).status).toBe(
      'malformed'
    );
    expect((await verifySpecimen(`${signed}&e=1`, STORE)).status).toBe('malformed');
    expect((await verifySpecimen(BASE, STORE)).status).toBe('unsigned');
    // From 1.5.0 a compact URL is its own form: an encrypted-url token copied
    // onto one is checked as compact-url, and fails (domain separation).
    const crossForm = await verifySpecimen(`wemush://v1/clx1a2b3c4?s=POSTR&sig=${token}`, STORE);
    expect(crossForm).toMatchObject({ status: 'invalid', form: 'compact-url' });
  });
});

describe('signCompactUrl (WOLS 1.5.0)', () => {
  const COMPACT = toCompactUrl(specimen);

  it('signs what toCompactUrl writes, and the result verifies with its parameters', async () => {
    const signed = await signCompactUrl(COMPACT, OPTIONS);
    expect(signed.startsWith(`${COMPACT}&sig=${KID}.`)).toBe(true);
    const r = await verifySpecimen(signed, STORE);
    expect(r).toMatchObject({ status: 'valid', form: 'compact-url', kid: KID });
    expect(r.params).toMatchObject({ s: 'POSTR', st: 'COLONIZATION', sn: 'MO-Blue-001' });
    expect(r.params).not.toHaveProperty('sig');
    expect(r.unrecognizedParams).toEqual([]);
  });

  it('lists unrecognized parameters, which are signed facts only of the signer', async () => {
    const signed = await signCompactUrl(`${COMPACT}&x-acme-room=B2`, OPTIONS);
    const r = await verifySpecimen(signed, STORE);
    expect(r.status).toBe('valid');
    expect(r.params?.['x-acme-room']).toBe('B2');
    expect(r.unrecognizedParams).toEqual(['x-acme-room']);
  });

  it('gives results without params for the other forms', async () => {
    const r = await verifySpecimen(await signSpecimen(LABEL, OPTIONS), STORE);
    expect(r.params).toBeUndefined();
    expect(r.unrecognizedParams).toBeUndefined();
  });

  it.each([
    ['no query', 'wemush://v1/clx1a2b3c4'],
    ['an empty query', 'wemush://v1/clx1a2b3c4?'],
    ['an existing sig', 'wemush://v1/clx1a2b3c4?s=POSTR&sig=x'],
    ['an encrypted URL', 'wemush://v1/encrypted/clx1a2b3c4?e=AAAA&iv=BBBB&kdf=raw'],
    ['two path segments', 'wemush://v1/a/b?s=POSTR'],
    ['a fragment', 'wemush://v1/clx1a2b3c4?s=POSTR#x'],
    ['a duplicate parameter', 'wemush://v1/clx1a2b3c4?s=POSTR&s=HERIN'],
    ['an empty parameter', 'wemush://v1/clx1a2b3c4?s=POSTR&&st=COL'],
    ['a malformed escape', 'wemush://v1/clx1a2b3c4?s=PO%ZZ'],
  ])('refuses a URL with %s', async (_name, url) => {
    await expect(signCompactUrl(url, OPTIONS)).rejects.toThrow(WolsSignatureError);
  });

  it('the signed URL still parses, keeping sig', async () => {
    const signed = await signCompactUrl(COMPACT, OPTIONS);
    const parsed = parseCompactUrl(signed);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(signed.endsWith(`&sig=${parsed.data.sig as string}`)).toBe(true);
  });
});

describe('unwrapWolsUrl (WOLS 1.5.0)', () => {
  const URL_ = 'wemush://v1/clx1a2b3c4?s=POSTR';

  it('returns a wemush://v1/ URL unchanged and strips web+', () => {
    expect(unwrapWolsUrl(URL_)).toBe(URL_);
    expect(unwrapWolsUrl(`web+${URL_}`)).toBe(URL_);
  });

  it('decodes a handler URL once', () => {
    expect(unwrapWolsUrl(`https://wemush.com/wols/${encodeURIComponent(URL_)}`)).toBe(URL_);
    const twice = encodeURIComponent(encodeURIComponent(URL_));
    expect(unwrapWolsUrl(`https://wemush.com/wols/${twice}`)).toBeNull();
  });

  it('returns null for anything else', () => {
    expect(unwrapWolsUrl('https://example.com/v1/clx1a2b3c4?s=POSTR')).toBeNull();
    expect(unwrapWolsUrl('wemush://v2/clx1a2b3c4?s=POSTR')).toBeNull();
    expect(unwrapWolsUrl('https://wemush.com/wols/%ZZ')).toBeNull();
  });
});

describe('trustStoreFromKeySet', () => {
  const PUB = '_Xjcp4sgkJNoEkWum4ZM1qTsy7MTKr3Sk6dbrHip2to';
  const ACME = 'mj4xN_P2kbWmyZmUixRTIjb8CCtJHmDYkc7NJDKnUHA';
  const ed = (kid: unknown, publicKey: unknown = PUB) => ({ kid, alg: 'Ed25519', publicKey });

  it('loads Ed25519 keys from a document or its text', async () => {
    const doc = { keys: [ed(KID), ed('acme-lab-1', ACME)] };
    for (const input of [doc, JSON.stringify(doc)]) {
      const store = await trustStoreFromKeySet(input);
      expect(Object.isFrozen(store)).toBe(true);
      expect(Object.keys(store).sort()).toEqual(['acme-lab-1', KID]);
      expect(store[KID]?.publicKey).toEqual(PUBLIC_KEY);
    }
    const store = await trustStoreFromKeySet(doc);
    expect((await verifySpecimen(await signSpecimen(LABEL, OPTIONS), store)).status).toBe('valid');
  });

  it('skips unsupported algorithms and reports them', async () => {
    const future = { kid: 'future-1', alg: 'ML-DSA-44', publicKey: 'A'.repeat(1750) };
    const sloppy = { alg: 'Ed448' }; // a skipped entry's other members aren't checked
    const lowercase = { kid: 'lower', alg: 'ed25519', publicKey: PUB };
    const skipped: unknown[] = [];
    const store = await trustStoreFromKeySet(
      { keys: [future, ed(KID), sloppy, lowercase] },
      { onSkip: entry => skipped.push(entry) }
    );
    expect(Object.keys(store)).toEqual([KID]);
    expect(skipped).toEqual([future, sloppy, lowercase]);
    expect((await verifySpecimen(await signSpecimen(LABEL, OPTIONS), store)).status).toBe('valid');
  });

  it('gives unknown-kid for a kid whose only entry was skipped', async () => {
    const store = await trustStoreFromKeySet({
      keys: [{ kid: KID, alg: 'ML-DSA-44', publicKey: PUB }],
    });
    expect(store).toEqual({});
    const r = await verifySpecimen(await signSpecimen(LABEL, OPTIONS), store);
    expect(r.status).toBe('unknown-kid');
  });

  it('lets a skipped entry share a kid with an Ed25519 entry', async () => {
    const store = await trustStoreFromKeySet({
      keys: [{ kid: KID, alg: 'ML-DSA-44', publicKey: 'A'.repeat(1750) }, ed(KID)],
    });
    expect(Object.keys(store)).toEqual([KID]);
  });

  it('rejects the whole document for a configuration error', async () => {
    const bad: unknown[] = [
      'not json',
      null,
      [ed(KID)],
      {},
      { keys: {} },
      { keys: ['x'] },
      { keys: [{ kid: KID, publicKey: PUB }] },
      { keys: [{ kid: KID, alg: 25519, publicKey: PUB }] },
      { keys: [ed('bad kid')] },
      { keys: [ed('k'.repeat(65))] },
      { keys: [ed(7)] },
      { keys: [{ kid: KID, alg: 'Ed25519' }] },
      { keys: [ed(KID, PUB.slice(0, -1))] },
      { keys: [ed(KID, `${PUB}=`)] },
      { keys: [ed(KID, `${PUB.slice(0, -1)}p`)] }, // unused bits set
      { keys: [ed(KID, 'AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')] }, // off the curve
      { keys: [ed(KID), ed(KID)] },
      { keys: [ed(KID), ed(KID, ACME)] },
      { keys: [ed('acme-lab-1', ACME), ed(KID, 'short')] },
    ];
    for (const doc of bad) {
      await expect(trustStoreFromKeySet(doc), JSON.stringify(doc)).rejects.toThrow(
        WolsSignatureError
      );
    }
  });

  it('leaves createTrustStore rejecting other algorithms', async () => {
    await expect(
      createTrustStore({ [KID]: { alg: 'Ed448', publicKey: PUBLIC_KEY } } as unknown as TrustStore)
    ).rejects.toThrow(WolsSignatureError);
  });
});
