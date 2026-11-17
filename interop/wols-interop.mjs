#!/usr/bin/env node
/**
 * WOLS cross-implementation round-trip harness (TypeScript side).
 *
 * This file is kept identical in wemush/specimen-labels-js and
 * wemush/specimen-labels-py. Its Python twin is wols_interop.py.
 *
 *   node interop/wols-interop.mjs generate --lib <package dir> [--matrix interop/matrix.json] --out corpus.json
 *   node interop/wols-interop.mjs verify   --lib <package dir> corpus.json [corpus2.json ...]
 *
 * `--lib` is the root of an @wemush/wols package: a built checkout of
 * specimen-labels-js, or node_modules/@wemush/wols from npm.
 *
 * `generate` encrypts every matrix case with the library and writes a corpus
 * of `decrypt` / `decryptFields` cases in the conformance-vector shape.
 * `verify` checks a corpus, typically one written by another implementation:
 * the generator-side wire rules of WOLS 1.3.0 (checked independently of any
 * library), then that the library decrypts every case back to the input
 * exactly. Exits non-zero on any failure.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PREFIX = 'wemush://v1/encrypted/';
const MIN_GENERATE_ITERATIONS = 100_000;
const MAX_ITERATIONS = 10_000_000;
const FIELD_KEYS = new Set([
  'encrypted',
  'algorithm',
  'payload',
  'iv',
  'kdf',
  'salt',
  'iterations',
]);
const URL_PARAMS = new Set(['e', 'iv', 'kdf', 'salt', 'i', 'sig']);

// ---------------------------------------------------------------------------
// helpers

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command, files: [] };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith('--')) opts[arg.slice(2)] = rest[++i];
    else opts.files.push(arg);
  }
  return opts;
}

async function loadLib(dir) {
  if (!dir) throw new Error('--lib <package dir> is required');
  const root = resolve(dir);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const exp = pkg.exports?.['.'];
  const entry = exp?.import?.default ?? exp?.import ?? pkg.module ?? pkg.main;
  const lib = await import(pathToFileURL(join(root, entry)).href);
  return { lib, name: pkg.name, version: pkg.version };
}

/** Strict JSON equality: same types (true is not 1), same keys, same order-free objects. */
function jsonEqual(a, b) {
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return a === b;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.hasOwn(b, k) && jsonEqual(a[k], b[k]));
}

const b64urlDecode = s => new Uint8Array(Buffer.from(s, 'base64url'));

/** Canonical unpadded base64url (WOLS 1.3.0 generator rule); returns the decoded bytes. */
function canonicalB64(name, value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) {
    throw new Error(`${name} is not unpadded base64url: ${JSON.stringify(value)}`);
  }
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) {
    throw new Error(`${name} is not canonical base64url (non-zero trailing bits): ${value}`);
  }
  return bytes;
}

/** Strict UTF-8 percent-decoding of a path segment; '+' is literal. */
function percentDecode(segment) {
  if (/%(?![0-9A-Fa-f]{2})/.test(segment))
    throw new Error(`malformed percent-escape in ${segment}`);
  const bytes = [];
  for (let i = 0; i < segment.length; i++) {
    if (segment[i] === '%') {
      bytes.push(parseInt(segment.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(segment[i], 'utf8'));
    }
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
}

function iterationsInRange(n) {
  return Number.isInteger(n) && n >= MIN_GENERATE_ITERATIONS && n <= MAX_ITERATIONS;
}

function decryptSecretOf(secret) {
  return secret.kdf === 'raw'
    ? { kdf: 'raw', keyBase64url: secret.keyBase64url }
    : { kdf: 'pbkdf2', passphrase: secret.decryptPassphrase ?? secret.passphrase };
}

function libKey(secret) {
  return secret.kdf === 'raw' ? b64urlDecode(secret.keyBase64url) : secret.passphrase;
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

// ---------------------------------------------------------------------------
// generate

async function generateCase(lib, c) {
  const { input } = c;
  const encryptKey = libKey(input.secret);
  const decryptSecret = decryptSecretOf(input.secret);
  const decryptKey = libKey(decryptSecret);
  const base = {
    id: c.id,
    category: c.category,
    requirement: 'MUST',
    description: c.description,
  };

  if (c.operation === 'encrypt') {
    const options = { key: encryptKey };
    if (input.iterations !== undefined) options.iterations = input.iterations;
    const enc = await lib.encryptSpecimen(input.specimen, options);
    const url =
      input.sig === undefined ? enc.url : lib.toEncryptedUrl({ ...enc, signature: input.sig });

    // Self-check with the generator's own decoder; record its exact plaintext.
    const opened = await lib.decryptPlaintext(url, { key: decryptKey });
    if (!opened.success) throw new Error(`self-decrypt failed: ${opened.error.message}`);
    if (!jsonEqual(JSON.parse(opened.data), input.specimen)) {
      throw new Error(`generator did not preserve the specimen: ${opened.data}`);
    }
    return {
      ...base,
      operation: 'decrypt',
      input: { url, secret: decryptSecret },
      expected: {
        success: true,
        id: input.specimen.id,
        signature: input.sig ?? null,
        kdf: enc.kdf,
        iterations: enc.iterations ?? null,
        plaintext: opened.data,
        specimen: input.specimen,
      },
      generatorInput: input,
    };
  }

  if (c.operation === 'encryptFields') {
    const options = { key: encryptKey, fields: input.fields };
    if (input.iterations !== undefined) options.iterations = input.iterations;
    const label = await lib.encryptFields(input.specimen, options);
    const first = label[input.fields[0]];
    const restored = await lib.decryptFields(label, { key: decryptKey });
    if (!restored.success) throw new Error(`self-decrypt failed: ${restored.error.message}`);
    return {
      ...base,
      operation: 'decryptFields',
      input: { specimen: label, secret: decryptSecret },
      expected: {
        success: true,
        encryptedFields: input.fields,
        kdf: first.kdf,
        iterations: first.iterations ?? null,
        specimen: input.specimen,
      },
      generatorInput: input,
    };
  }

  throw new Error(`unknown matrix operation '${c.operation}'`);
}

async function generate(opts) {
  const { lib, name, version } = await loadLib(opts.lib);
  const matrixPath = opts.matrix ?? join(HERE, 'matrix.json');
  const matrixText = readFileSync(matrixPath, 'utf8');
  const matrix = JSON.parse(matrixText);
  const cases = [];
  for (const c of matrix.cases) {
    try {
      cases.push(await generateCase(lib, c));
    } catch (err) {
      throw new Error(`[${c.id}] ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const corpus = {
    format: 'wols-interop-corpus',
    formatVersion: 1,
    wolsVersion: matrix.wolsVersion,
    description:
      'Labels generated by one WOLS implementation from interop/matrix.json. ' +
      'Every implementation must decrypt each case and recover expected.plaintext ' +
      '(decrypt) or expected.specimen (decryptFields) exactly, and return ' +
      'expected.id and expected.signature from the URL.',
    specSection: matrix.specSection,
    generator: {
      implementation: name,
      version,
      language: 'typescript',
      runtime: `node ${process.version}`,
    },
    matrixSha256: sha256(matrixText),
    cases,
  };
  if (!opts.out) throw new Error('--out <corpus.json> is required');
  writeFileSync(opts.out, `${JSON.stringify(corpus, null, 2)}\n`);
  console.log(`generated ${cases.length} cases with ${name} ${version} -> ${opts.out}`);
}

// ---------------------------------------------------------------------------
// verify: generator-side wire rules (independent of the library under test)

function checkUrlWire(c) {
  const { url } = c.input;
  const { expected } = c;
  if (!url.startsWith(PREFIX)) throw new Error(`URL must start with ${PREFIX}`);
  const rest = url.slice(PREFIX.length);
  const q = rest.indexOf('?');
  if (q === -1) throw new Error('URL has no query');
  const segment = rest.slice(0, q);
  // RFC 3986 pchar, minus '+' which WOLS 1.3.0 requires generators to encode.
  if (!/^(?:[A-Za-z0-9\-._~!$&'()*,;=:@]|%[0-9A-Fa-f]{2})+$/.test(segment)) {
    throw new Error(`ID segment is not a single, fully percent-encoded path segment: ${segment}`);
  }
  if (`wemush:${percentDecode(segment)}` !== expected.id) {
    throw new Error(`ID segment ${segment} does not decode to ${JSON.stringify(expected.id)}`);
  }
  const params = new Map();
  for (const pair of rest.slice(q + 1).split('&')) {
    const eq = pair.indexOf('=');
    const key = eq === -1 ? pair : pair.slice(0, eq);
    if (!URL_PARAMS.has(key)) throw new Error(`unexpected URL parameter '${key}'`);
    if (params.has(key)) throw new Error(`duplicate URL parameter '${key}'`);
    params.set(key, eq === -1 ? '' : pair.slice(eq + 1));
  }
  const kdf = params.get('kdf');
  if (kdf !== c.input.secret.kdf || kdf !== expected.kdf) {
    throw new Error(`kdf=${kdf}, expected ${c.input.secret.kdf}`);
  }
  if (canonicalB64('e', params.get('e')).length < 16)
    throw new Error('e is shorter than the GCM tag');
  if (canonicalB64('iv', params.get('iv')).length !== 12) throw new Error('iv is not 12 bytes');
  if (kdf === 'pbkdf2') {
    if (canonicalB64('salt', params.get('salt')).length < 16)
      throw new Error('salt is shorter than 16 bytes');
    const i = params.get('i');
    if (!/^[1-9][0-9]*$/.test(i ?? '')) throw new Error(`i is not plain decimal digits: ${i}`);
    if (Number(i) !== expected.iterations || !iterationsInRange(Number(i))) {
      throw new Error(`i=${i}, expected ${expected.iterations} within 100,000..10,000,000`);
    }
    const requested = c.generatorInput?.iterations;
    if (requested !== undefined && Number(i) !== requested) {
      throw new Error(`i=${i}, but the matrix requested ${requested}`);
    }
  } else if (params.has('salt') || params.has('i')) {
    throw new Error('kdf=raw URL carries salt or i');
  }
  const sig = params.get('sig');
  const sigDecoded = sig === undefined ? null : decodeURIComponent(sig.replace(/\+/g, ' '));
  if (sigDecoded !== expected.signature) {
    throw new Error(
      `sig decodes to ${JSON.stringify(sigDecoded)}, expected ${JSON.stringify(expected.signature)}`
    );
  }
}

function checkFieldsWire(c) {
  const label = c.input.specimen;
  const original = c.expected.specimen;
  const encrypted = new Set(c.expected.encryptedFields);
  for (const [name, value] of Object.entries(original)) {
    if (!encrypted.has(name) && !jsonEqual(label[name], value)) {
      throw new Error(`cleartext field '${name}' was changed`);
    }
  }
  if (!jsonEqual(Object.keys(label).sort(), Object.keys(original).sort())) {
    throw new Error('field-encrypted label does not have the same fields as the input');
  }
  for (const name of encrypted) {
    const f = label[name];
    if (typeof f !== 'object' || f === null || f.encrypted !== true) {
      throw new Error(`field '${name}' is not an encryption object`);
    }
    for (const key of Object.keys(f)) {
      if (!FIELD_KEYS.has(key)) throw new Error(`field '${name}' has unexpected member '${key}'`);
    }
    if (f.algorithm !== 'AES-256-GCM') throw new Error(`field '${name}' algorithm ${f.algorithm}`);
    if (f.kdf !== c.input.secret.kdf) throw new Error(`field '${name}' kdf ${f.kdf}`);
    if (canonicalB64(`${name}.payload`, f.payload).length < 16)
      throw new Error(`${name}.payload too short`);
    if (canonicalB64(`${name}.iv`, f.iv).length !== 12)
      throw new Error(`${name}.iv is not 12 bytes`);
    if (f.kdf === 'pbkdf2') {
      if (canonicalB64(`${name}.salt`, f.salt).length < 16)
        throw new Error(`${name}.salt too short`);
      if (!iterationsInRange(f.iterations) || f.iterations !== c.expected.iterations) {
        throw new Error(`${name}.iterations=${f.iterations}, expected ${c.expected.iterations}`);
      }
      const requested = c.generatorInput?.iterations;
      if (requested !== undefined && f.iterations !== requested) {
        throw new Error(
          `${name}.iterations=${f.iterations}, but the matrix requested ${requested}`
        );
      }
    } else if (f.salt !== undefined || f.iterations !== undefined) {
      throw new Error(`kdf=raw field '${name}' carries salt or iterations`);
    }
  }
}

// ---------------------------------------------------------------------------
// verify: decryption with the library under test

async function verifyCase(lib, c) {
  const key = libKey(c.input.secret);
  if (c.operation === 'decrypt') {
    checkUrlWire(c);
    const parsed = lib.parseEncryptedUrl(c.input.url);
    if (!parsed.success) throw new Error(`parseEncryptedUrl: ${parsed.error.message}`);
    if (parsed.data.id !== c.expected.id) {
      throw new Error(
        `parsed id ${JSON.stringify(parsed.data.id)}, expected ${JSON.stringify(c.expected.id)}`
      );
    }
    if ((parsed.data.signature ?? null) !== c.expected.signature) {
      throw new Error(
        `parsed sig ${JSON.stringify(parsed.data.signature)}, expected ${JSON.stringify(c.expected.signature)}`
      );
    }
    const opened = await lib.decryptPlaintext(c.input.url, { key });
    if (!opened.success)
      throw new Error(`decryptPlaintext: [${opened.error.reason}] ${opened.error.message}`);
    if (opened.data !== c.expected.plaintext)
      throw new Error('decrypted plaintext differs from expected.plaintext');
    if (!jsonEqual(JSON.parse(opened.data), c.expected.specimen)) {
      throw new Error('decrypted specimen differs from expected.specimen');
    }
    const specimen = await lib.decryptSpecimen(c.input.url, { key });
    if (!specimen.success)
      throw new Error(`decryptSpecimen: [${specimen.error.reason}] ${specimen.error.message}`);
    if (specimen.data.id !== c.expected.id)
      throw new Error(`decryptSpecimen id ${specimen.data.id}`);
    return;
  }
  if (c.operation === 'decryptFields') {
    checkFieldsWire(c);
    const restored = await lib.decryptFields(c.input.specimen, { key });
    if (!restored.success)
      throw new Error(`decryptFields: [${restored.error.reason}] ${restored.error.message}`);
    // Compare the members the input had: a parsed Specimen may add nothing else.
    if (!jsonEqual(JSON.parse(JSON.stringify(restored.data)), c.expected.specimen)) {
      throw new Error(
        `restored specimen differs from expected.specimen:\n  got      ${JSON.stringify(restored.data)}\n  expected ${JSON.stringify(c.expected.specimen)}`
      );
    }
    return;
  }
  throw new Error(`unknown corpus operation '${c.operation}'`);
}

async function verify(opts) {
  const { lib, name, version } = await loadLib(opts.lib);
  if (opts.files.length === 0) throw new Error('verify needs at least one corpus file');
  let failures = 0;
  for (const file of opts.files) {
    const corpus = JSON.parse(readFileSync(file, 'utf8'));
    if (corpus.format !== 'wols-interop-corpus' || corpus.formatVersion !== 1) {
      throw new Error(`${file} is not a wols-interop-corpus v1 file`);
    }
    const gen = corpus.generator ?? {};
    console.log(
      `verify ${file}: ${corpus.cases.length} cases from ${gen.implementation} ${gen.version} (${gen.language}) with ${name} ${version}`
    );
    const byCategory = new Map();
    for (const c of corpus.cases) {
      const tally = byCategory.get(c.category) ?? { pass: 0, fail: 0 };
      byCategory.set(c.category, tally);
      try {
        await verifyCase(lib, c);
        tally.pass++;
      } catch (err) {
        tally.fail++;
        failures++;
        console.log(`  FAIL ${c.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    for (const [category, { pass, fail }] of byCategory) {
      console.log(`  ${fail === 0 ? 'ok  ' : 'FAIL'} ${category}: ${pass}/${pass + fail}`);
    }
  }
  if (failures > 0) {
    console.log(`${failures} case(s) failed`);
    process.exit(1);
  }
  console.log('all cases passed');
}

// ---------------------------------------------------------------------------

const opts = parseArgs(process.argv.slice(2));
const commands = { generate, verify };
if (!commands[opts.command]) {
  console.error('usage: wols-interop.mjs generate|verify --lib <package dir> ...');
  process.exit(2);
}
commands[opts.command](opts).catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
