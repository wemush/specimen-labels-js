# @wemush/wols

Official TypeScript library for **WOLS** (WeMush Open Labeling Standard) - the open standard for biological specimen labeling and traceability in mycology.

[![npm version](https://badge.fury.io/js/@wemush%2Fwols.svg)](https://www.npmjs.com/package/@wemush/wols)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

## Features

- 🏷️ **Create & Serialize** - Generate WOLS-compliant specimen labels
- ✅ **Validate** - Validation against the normative WOLS 1.5 JSON Schema, with detailed error reporting
- 📦 **Records Bundles** - Validate WOLS 1.5.0 bundles of specimens, strains, recipes, observations and harvests
- 📜 **Parse** - Parse JSON/QR data back to typed specimens
- 📱 **QR Codes** - Generate QR codes for specimens (PNG, SVG, Data URL)
- 🔗 **Compact URLs** - Create short URLs for space-constrained labels, following the WOLS 1.5.0 compact URL rules and species code registry
- 🔐 **Encryption** - WOLS 1.3.0 encrypted format (AES-256-GCM, per-label PBKDF2 salt or raw keys)
- ✍️ **Signatures** - Ed25519 signing and verification of embedded labels and encrypted URLs (WOLS 1.4.0) and compact URLs (WOLS 1.5.0)
- 🧪 **Conformance** - Passes every `MUST` and `SHOULD` vector in the WOLS 1.5.0 conformance suite, including the signature, data model, bundle and compact URL vectors
- 🔁 **Interop** - CI round-trips encrypted labels (URL `kdf=pbkdf2`/`kdf=raw` and field-level) with the Python [`wols`](https://github.com/wemush/specimen-labels-py) library in both directions, against its PyPI release and its `main` branch (see [`tests/interop/`](tests/interop/))

## Installation

```bash
npm install @wemush/wols
# or
bun add @wemush/wols
# or
pnpm add @wemush/wols
```

### Optional Peer Dependency

For QR code generation, install the `qrcode` package:

```bash
npm install qrcode
```

## Quick Start

```typescript
import { createSpecimen, parseSpecimen, validateSpecimen } from '@wemush/wols';

// Create a specimen
const specimen = createSpecimen({
  type: 'CULTURE',
  species: 'Pleurotus ostreatus',
  strain: 'Blue Oyster',
  stage: 'COLONIZATION',
});

console.log(specimen.id); // "wemush:abc123..."
console.log(specimen['@context']); // "https://wemush.com/wols/v1"
```

## Core Module API

### `createSpecimen(input: SpecimenInput, options?): Specimen`

Creates a new specimen with auto-generated ID and JSON-LD fields.

```typescript
const specimen = createSpecimen({
  type: 'SPAWN',
  species: 'Hericium erinaceus',
  strain: { name: "Lion's Mane", generation: 'F2', clonalGeneration: 3, transferDepth: 4 },
  stage: 'INOCULATION',
  created: '2025-12-16T10:30:00Z',
  batch: 'BATCH-2024-001',
  organization: 'org_123',
  custom: { substrate: 'hardwood' },
});
```

**Parameters:**

- `type` - Specimen type: `'CULTURE'`, `'SPAWN'`, `'SUBSTRATE'`, `'FRUITING'`, `'HARVEST'`, or an alias such as `'LC'`, `'GRAIN_SPAWN'`, `'BAG'`, `'PINNING'` (case-insensitive)
- `species` - Scientific species name
- `strain` - String (auto-expands to `{ name: string }`) or full `Strain` object
- `stage` - Growth stage: `'INOCULATION'`, `'INCUBATION'`, `'COLONIZATION'`, `'PRIMORDIA'`, `'FRUITING'`, `'SENESCENCE'`, `'HARVEST'`
- `created` - Creation timestamp, an ISO 8601 string or a `Date` (omitted when not supplied; invalid values throw)
- `batch` - Batch identifier
- `organization` - Organization ID
- `creator` - Creator user ID
- `custom` - Custom vendor-specific fields

**Options:**

- `onWarning(warning)` - Receives non-fatal warnings. If omitted, warnings go to `console.warn`.

#### `PRIMORDIA` as a type

`PRIMORDIA` is a growth stage, not a specimen type. Because people often supply it as a type,
WOLS 1.3.0 makes it a reserved alias. When `type` is `PRIMORDIA` (in any case), the library:

- resolves the type to `FRUITING`
- sets `stage: 'PRIMORDIA'` if no stage was supplied, and never overrides a supplied stage
- emits a `PRIMORDIA_AS_TYPE` warning that recommends `type: 'FRUITING', stage: 'PRIMORDIA'`
- never serializes `PRIMORDIA` as a `type`. `serializeSpecimen` applies the same resolution to hand-built objects.

```typescript
const s = createSpecimen(
  { type: 'primordia', species: 'Pleurotus ostreatus' },
  { onWarning: w => log.info(w.message) }
);
// s.type === 'FRUITING', s.stage === 'PRIMORDIA'
```

`validateSpecimen` still rejects `type: "PRIMORDIA"` in a serialized label.

#### Generation, subculture, and transfer depth

`strain` carries three independent counters (WOLS 1.3.0):

| Field              | Meaning                                                    | Original culture |
| ------------------ | ---------------------------------------------------------- | ---------------- |
| `generation`       | Filial generation (`P`, `F1`, `G2`, `3`, …)                | `P`              |
| `clonalGeneration` | Culture-to-culture subcultures                             | `0`              |
| `transferDepth`    | Transfers of any kind (subculture, to grain, to substrate) | `0`              |

Both counters must be non-negative integers. Validation warns when `transferDepth` is less
than `clonalGeneration`.

`generation` is always a string, and the library always writes one. A label that carries it as
a JSON integer (`wols` for Python 1.3.0 wrote `"generation": 1`) still decodes: parsing and
decryption read it as the decimal string (`"1"`) and report a `NUMERIC_GENERATION` warning to
`onWarning`, or to `console.warn` if no callback is given (WOLS 1.4.0).

### `serializeSpecimen(specimen: Specimen): string`

Serializes a specimen to a JSON-LD string, suitable for QR encoding.

```typescript
const json = serializeSpecimen(specimen);
// Output: {"@context":"https://wemush.com/wols/v1","@type":"Specimen",...}
```

### `parseSpecimen(json: string): ParseResult<Specimen>`

Parses a JSON string into a validated Specimen object.

```typescript
const result = parseSpecimen(qrCodeContent);

if (result.success) {
  console.log(result.data.species);
} else {
  console.error(result.error.code, result.error.message);
}
```

### `validateSpecimen(data: unknown, options?): ValidationResult`

Validates a specimen object against the WOLS schema.

```typescript
const result = validateSpecimen(specimen, { level: 'strict' });

if (!result.valid) {
  for (const error of result.errors) {
    console.log(`${error.path}: ${error.message}`);
  }
}
```

**Options:**

- `allowUnknownFields` - Allow unknown fields in custom namespace
- `level` - Validation strictness: `'strict'` or `'lenient'`
- `idMode` - ID check. Every mode requires the `wemush:` prefix.
  - `'any'` (default): any non-empty suffix, as WOLS requires. CUIDs, ULIDs, UUIDs and human-readable IDs are all accepted.
  - `'strict'` (opt-in): the suffix must be a CUID-style `[a-z0-9]+`.
  - `'ulid'` / `'uuid'` (opt-in): the suffix must be a ULID or a UUID.
- `customIdValidator` - Your own `(id) => boolean` check, which takes precedence over `idMode`

#### WOLS 1.5 label members

`Specimen` and `SpecimenInput` have the members WOLS 1.5.0 adds, and `validateSpecimen` checks
them against the 1.5 JSON Schema. All are optional, and 1.4.0 labels are unaffected.

| Member | Type | Notes |
| ------ | ---- | ----- |
| `taxon` | `Taxon` | `scientificName` (required), `authorship`, `rank`, `identifiers` (`{ scheme, value }`), `hybridOf` (two or more parents) |
| `form` | `SpecimenForm` | Physical form, such as `LIQUID_CULTURE` or `FRUITING_BLOCK`, or an `x-` extension |
| `derivedFrom` | `ParentLink[]` | Parents, primary first: `{ id, relation?, quantity? }`. `strain.lineage`, when present, must equal `derivedFrom[0].id` |
| `condition` | `Condition` | `ACTIVE`, `CONTAMINATED`, `EXHAUSTED`, `DISPOSED` or `ARCHIVED` (absent means `ACTIVE`) |
| `container` | `Container` | `{ format, capacity?: Quantity }`, where `format` is `JAR`, `BAG` and so on, or an `x-` extension |
| `lot` | `string` | Non-empty |
| `strain.accession` | `string` | A culture collection or vendor accession |

`strain.name` is optional from 1.5.0. The constants `SPECIMEN_FORMS`, `CONDITIONS`,
`CONTAINER_FORMATS`, `PARENT_RELATIONS` and `TAXON_IDENTIFIER_SCHEMES` list the allowed values.
`parseSpecimen` reads snake_case `_meta` keys (`source_id`) as camelCase (`sourceId`).

### `validateBundle(bundle: unknown, options?): ValidationResult`

Validates a WOLS 1.5 Records Bundle (`@type: "Bundle"`): the bundle schema, every entry of
`specimens` as a label (with the same rules as `validateSpecimen`), and that every reference
resolves within the bundle (`strainRef`, `recipeRef`, and the `specimen` of each observation and
harvest; an unresolved one is `WOLS_UNRESOLVED_REFERENCE`). Error paths start at the bundle root,
such as `specimens.0.stage` or `observations.0.specimen`.

```typescript
import { validateBundle } from '@wemush/wols';

const result = validateBundle(JSON.parse(bundleText));
if (!result.valid) console.error(result.errors.map(e => `${e.path}: ${e.message}`));
```

## QR Code Module API

Generate QR codes for specimens. Requires the `qrcode` peer dependency.

```typescript
import { toQRCode, toQRCodeDataURL, toQRCodeSVG } from '@wemush/wols';
// Or import from submodule:
// import { toQRCode } from '@wemush/wols/qr';
```

### `toQRCode(specimen, options?): Promise<Buffer>`

Generate a QR code as a PNG buffer.

```typescript
import { writeFileSync } from 'fs';

const buffer = await toQRCode(specimen, {
  size: 400,
  errorCorrection: 'H',
});
writeFileSync('specimen.png', buffer);
```

### `toQRCodeDataURL(specimen, options?): Promise<string>`

Generate a QR code as a data URL for web embedding.

```typescript
const dataUrl = await toQRCodeDataURL(specimen);
document.getElementById('qr').src = dataUrl;
```

### `toQRCodeSVG(specimen, options?): Promise<string>`

Generate a QR code as an SVG string.

```typescript
const svg = await toQRCodeSVG(specimen);
document.getElementById('qr-container').innerHTML = svg;
```

**QR Options:**

- `size` - Width/height in pixels (default: 300)
- `errorCorrection` - Error correction level: `'L'`, `'M'`, `'Q'`, `'H'` (default: `'M'`)
- `format` - Encoding format: `'embedded'` (full JSON) or `'compact'` (URL)
- `margin` - Quiet zone modules (default: 1)
- `color.dark` - Dark module color (default: `'#000000'`)
- `color.light` - Light module color (default: `'#ffffff'`)

### Compact URL for Smaller QR Codes

Use compact URLs for space-constrained labels:

```typescript
import { toCompactUrl, parseCompactUrl } from '@wemush/wols';

const url = toCompactUrl(specimen);
// Output: "wemush://v1/abc123?s=POSTR&ty=CULTURE&st=COLONIZATION&sn=Blue+Oyster&sg=F2&td=3"

const result = parseCompactUrl(url, { onWarning: w => console.warn(w.message) });
if (result.success) {
  console.log(result.data.species); // "Pleurotus ostreatus"
}
```

Compact URLs follow the WOLS 1.5.0 compact URL rules:

- `toCompactUrl` writes the registered parameters in order (`s`, `ty`, `st`, `t`, `b`, `sn`,
  `sg`, `td`), percent-encodes the ID, and uses a code from the species code registry when there
  is one (else the species name).
- `parseCompactUrl` accepts `wemush://v1/` and `web+wemush://v1/`. It percent-decodes the ID, reads
  the 27 registry codes and the 24 frozen two-letter legacy codes (`PO`, with a
  `LEGACY_SPECIES_CODE` warning), stage codes (`COL`), `sg` without `sn`, and `td`. A malformed
  `td` is dropped with a warning. Parameters it doesn't recognize are kept in `unrecognized`, and
  `sig` is kept, never verified.
- It refuses another version (`unsupported-version`), an encrypted URL (`encrypted-url`), bad
  percent-encoding (`invalid-encoding`), a missing `s` (`missing-parameter`), a bad `ty`, `st`,
  `t` or `sg` (`invalid-parameter`), a repeated parameter (`duplicate-parameter`), and a fragment
  (`invalid-url`). The error is a `WolsCompactUrlError` (a `WolsParseError`) with `reason`.
- `STAGE_CODES`, `LEGACY_SPECIES_CODES` and `COMPACT_URL_PARAMETERS` export the registries.
  `registerSpeciesCode` can't reassign a registered or legacy code.

## Encryption Module API

Implements the WOLS 1.3.0 encrypted format with WebCrypto, so it works in Node.js 20+, browsers,
Deno and Bun.

```
wemush://v1/encrypted/{id}?e={ciphertext}&iv={iv}&kdf=pbkdf2|raw[&salt={salt}&i={iterations}][&sig={signature}]
```

- AES-256-GCM. `e` is the ciphertext with the 16-byte tag appended. `iv` is a fresh random 12-byte IV for every encryption.
- Every binary value is base64url without padding. Decoders also accept padded input.
- `{id}` is the specimen ID without the `wemush:` prefix, percent-encoded as one URL path segment (`encodeURIComponent`). Decoders percent-decode it as UTF-8 before the `id` check, keep `+` as a literal character, and reject malformed escapes or invalid UTF-8. It is cleartext, so don't put sensitive data in it.
- Passphrases are normalized to Unicode NFC before PBKDF2, so a passphrase typed in composed or decomposed form (for example `ü` as one code point, or `u` plus a combining mark) gives the same key.

```typescript
import { encryptSpecimen, decryptSpecimen } from '@wemush/wols';
// Or import from submodule:
// import { encryptSpecimen } from '@wemush/wols/crypto';
```

### `encryptSpecimen(specimen, options): Promise<EncryptedSpecimen>`

Encrypts the whole label. The kind of `key` you pass selects the key derivation:

| `key`                                                               | `kdf`    | Behavior                                                                                 |
| ------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| passphrase `string`                                                 | `pbkdf2` | PBKDF2-HMAC-SHA256 over the NFC-normalized passphrase, a fresh random 16-byte salt per label, 600,000 iterations by default |
| 32-byte `Uint8Array` / `ArrayBuffer`, or an AES-GCM 256 `CryptoKey` | `raw`    | Key shared out of band. No `salt` or `i`.                                                |

```typescript
const enc = await encryptSpecimen(specimen, { key: 'correct horse battery staple' });
enc.url;
// "wemush://v1/encrypted/clx1a2b3c4?e=...&iv=...&kdf=pbkdf2&salt=...&i=600000"

const raw = await encryptSpecimen(specimen, { key: crypto.getRandomValues(new Uint8Array(32)) });
raw.url; // "wemush://v1/encrypted/clx1a2b3c4?e=...&iv=...&kdf=raw"
```

The result also carries `payload`, `iv`, `kdf`, `salt`, `iterations` and `id`. Put `url` in the QR code.

**Options:**

- `key` - A passphrase (`kdf=pbkdf2`), or raw key bytes or a `CryptoKey` (`kdf=raw`)
- `iterations` - PBKDF2 iterations. Passphrase keys only. The default is 600,000, and anything
  from 100,000 to 10,000,000 is allowed.
- `fields` - **Deprecated.** Use `encryptFields` instead.

### `encryptFields(specimen, { key, fields }): Promise<FieldEncryptedSpecimen>`

Field-level encryption. Each named field's value is replaced in place with
`{ encrypted: true, algorithm: "AES-256-GCM", payload, iv, kdf, salt?, iterations? }`, and the rest
of the label stays in cleartext. Every name in `fields` must be a field the specimen actually has.
A misspelled or missing field throws instead of being left unprotected. `@context`, `@type`, `id`,
`version`, `type` and `species` identify the label, so they can't be encrypted. The result is typed
precisely: the named fields are `EncryptedField`, and every other field keeps its cleartext type.

```typescript
const partial = await encryptFields(specimen, { key: passphrase, fields: ['strain'] });
partial.species; // cleartext
partial.strain; // { encrypted: true, kdf: 'pbkdf2', ... }

const restored = await decryptFields(partial, { key: passphrase });
if (restored.success) restored.data.strain?.name; // a validated Specimen
```

Each value is bound to its label and field. The AES-GCM additional data is the UTF-8 encoding of
the label's full `id`, a line feed, and the field name, for example `"wemush:clx1a2b3c4\nstrain"`.
Every field gets its own random IV. A value moved to another field, copied from another label, or
left behind after the `id` changes fails with `authentication-failed`.

`decryptFields` refuses a label in which an identifying field is encrypted (`identifying-field`).
It never substitutes a decrypted value for one. Before deriving any key, it adds up the iterations
of each distinct salt and iteration-count pair, and refuses the label when the total exceeds
`maxIterations`.

To decrypt one value, pass its binding: `decryptField(partial.strain, { key }, { id: partial.id, field: 'strain' })`.

### `decryptSpecimen(input, options): Promise<DecryptResult<Specimen>>`

`input` can be an encrypted URL or an `EncryptedSpecimen` object. Use `decryptPlaintext` to get the
exact decrypted JSON string instead. Decryption never throws. A failure carries a
`WolsDecryptionError` with a typed `reason`:

```typescript
const result = await decryptSpecimen(url, { key: 'correct horse battery staple' });

if (result.success) {
  console.log(result.data.species);
} else if (result.error.reason === 'legacy-format') {
  // a pre-1.3.0 label: see "Legacy labels" below
} else {
  console.error(result.error.reason, result.error.message);
}
```

**Options:**

- `key` - The passphrase or raw key
- `allowLegacy` - Decrypt pre-1.3.0 labels (see below)
- `maxIterations` - The largest PBKDF2 iteration count accepted from a label. The default and the
  maximum are both 10,000,000. You can set it lower, never higher. The count comes from the label,
  so this caps how much CPU a hostile QR code can cost. A server that decodes untrusted labels
  should set it close to the count it generates with. `decryptFields` applies it to the whole
  label: fields that share a salt share one key derivation, and the total across distinct salts
  must stay under the limit.

Every cheap check runs before key derivation, so a malformed label costs no PBKDF2 work. The
failure reasons are:

| `reason` | When |
| --- | --- |
| `id-mismatch` | The decrypted specimen's `id` isn't `wemush:{id}` from the URL path |
| `authentication-failed` | The key is wrong, or the ciphertext was tampered with |
| `insufficient-iterations` / `excessive-iterations` | `i` is below 10,000, or above `maxIterations` (alone, or in total for field-level) |
| `missing-parameter` | `e` or `iv` is missing, or `kdf=pbkdf2` lacks `salt` or `i` |
| `unexpected-parameter` | `kdf=raw` has `salt` or `i`, or a legacy label has `salt` |
| `invalid-parameter` | Bad base64url, `i` that isn't plain decimal digits, an IV that isn't 12 bytes, ciphertext shorter than the tag, a duplicate parameter |
| `invalid-encoding` | The ID in the URL path has a malformed percent-escape or isn't valid UTF-8 |
| `identifying-field` | A field-level label has an encrypted `@context`, `@type`, `id`, `version`, `type` or `species` |
| `unsupported-kdf` | `kdf` is something other than `pbkdf2` or `raw` |
| `invalid-key` | The key doesn't fit the label, for example a passphrase for a `raw` label |
| `legacy-format` | No `kdf`: a pre-1.3.0 label, and `allowLegacy` wasn't set |
| `invalid-plaintext` | The decrypted bytes aren't UTF-8 JSON (or start with a BOM), or aren't a valid specimen |
| `invalid-url` | Not a `wemush://v1/encrypted/...` URL |
| `unsupported-environment` | The runtime has no WebCrypto |

The `id` check applies to the URL form and to objects that carry an `id`. An object without `id`
isn't bound to any ID, so prefer URLs for input you don't trust.

After a label authenticates, error messages and `details` can contain decrypted content, such as
the mismatched `id` or the specimen validation errors. Don't forward them to untrusted parties.

**Legacy labels:** payloads from before 1.3.0 have no `kdf`. They were encrypted with a fixed
library-wide salt, and they fail with `legacy-format` by default. Pass `{ allowLegacy: true }` only
when you are decrypting labels you know are old, for example during a migration. Re-encrypt them
with `encryptSpecimen`. Legacy labels are never generated.

### Other helpers

- `toEncryptedUrl(encrypted)` / `parseEncryptedUrl(url)` - convert between the URL and the object form. `toEncryptedUrl` refuses objects that would make a non-conformant label: values that aren't canonical unpadded base64url, an IV that isn't 12 bytes, fewer than 100,000 iterations, a salt that is short or byte-equal to the legacy salt, or `salt` with `kdf=raw`.
- `decryptField(field, options, { id, field })` - decrypt a single encrypted field value. The third argument names the label's `id` and the field, which the value is bound to (legacy values carry no binding).
- `isEncryptedSpecimen(value)` / `isEncryptedField(value)` - tell a whole-label encryption from a field-level one. `isEncrypted(value)` matches either.
- `derivePassphraseKey(passphrase, salt, iterations)` - raw PBKDF2 output, for debugging interoperability. It doesn't apply the label rules.
- `base64UrlEncode(bytes)` / `base64UrlDecode(str)`

## Signing and verifying

A WOLS signature is an Ed25519 signature over a label's exact content. Embedded labels carry it
in the top-level `signature` member. Encrypted URLs, and from WOLS 1.5.0 compact URLs, carry it in
a final `&sig=` parameter. All hold a token of the form `{kid}.{signature}`, where the kid names
the key that signed it.

```typescript
import {
  createTrustStore,
  getSigningPublicKey,
  serializeSpecimen,
  signCompactUrl,
  signEncryptedUrl,
  signSpecimen,
  toCompactUrl,
  verifySpecimen,
} from '@wemush/wols';

// The issuer keeps a 32-byte Ed25519 seed secret, and publishes its public key under a kid.
const seed = crypto.getRandomValues(new Uint8Array(32));
const publicKey = await getSigningPublicKey(seed);

// Sign label text. The result is the label with `signature` set: print it exactly as returned.
const signedLabel = await signSpecimen(serializeSpecimen(specimen), { privateKey: seed, kid: 'mushoh-2026' });

// Sign an encrypted URL. `&sig={kid}.{signature}` is appended to the exact URL bytes.
const signedUrl = await signEncryptedUrl(encrypted.url!, { privateKey: seed, kid: 'mushoh-2026' });

// Sign a compact URL (WOLS 1.5.0). Same token, under its own `compact-url` form.
const signedCompact = await signCompactUrl(toCompactUrl(specimen), { privateKey: seed, kid: 'w1' });

// The verifier supplies its own trust store: kid -> public key, from sources it already trusts.
// createTrustStore rejects unusable entries (not Ed25519, not 32 bytes, not a curve point) up front.
const trustStore = await createTrustStore({ 'mushoh-2026': { alg: 'Ed25519', publicKey } });
const result = await verifySpecimen(scannedText, trustStore); // label text or a URL
if (result.status === 'valid') {
  console.log(`Signed by ${result.kid} (${result.form})`);
}
```

`verifySpecimen` picks the form from the text: text that starts with a URI scheme is a URL, and a
URL is `compact-url` when it has the compact shape (`wemush://v1/{id}?...`, one path segment, not
`encrypted/`), else `encrypted-url`; anything else is an `embedded` label. Every result has
`form`. A valid compact URL result also has `params` (each signed parameter, decoded) and
`unrecognizedParams` (the names this library doesn't know). The signature vouches for those
values only as the signer's statement.

For a compact URL that reached you wrapped, `unwrapWolsUrl(text)` returns the `wemush://v1/` URL
to verify, or `null`: it strips a leading `web+`, and decodes a `https://{host}/wols/{url}` handler
link once. Verify the result, not the wrapper.

`verifySpecimen` never throws for a bad signature. It returns one status, checked in this order:

| Status | Meaning |
| ------ | ------- |
| `malformed` | Label text that isn't an I-JSON object, signed or not: not JSON, not an object, duplicate member names, lone surrogates, `NaN`/`Infinity` or overflowing numbers such as `1e400`. Also a signature whose token or URL breaks a rule |
| `unsigned` | Well-formed, but no `signature` member, or no `sig` parameter |
| `unknown-kid` | The kid isn't in your trust store |
| `invalid` | The kid is in your trust store, but the signature doesn't match these bytes, or the store's entry for it is unusable |
| `valid` | The trusted key for the kid signed exactly these bytes |

Only `valid` means authenticated. Anyone can remove a signature, so if you require signatures,
treat `unsigned` as a failure too.

**What a `valid` result proves:** the holder of the private key that *your trust store* lists for
the kid signed these exact bytes, as this form (embedded label, encrypted URL or compact URL).

**What it doesn't prove:**

- **Freshness.** There is no timestamp, nonce or expiry, and `created` is whatever the signer
  wrote. An older validly signed label, from an earlier stage or another batch, still verifies
  when it is reprinted or swapped in.
- **That the label belongs on this item.** A valid label can be copied onto another bag.
- **That the content is true.** The signer vouches for it, nothing more.
- **That the signer knew the plaintext** of an encrypted URL or of encrypted fields. Signatures
  cover the ciphertext as printed, so anyone can sign someone else's ciphertext under their own
  kid. To authenticate the plaintext too, sign the embedded label first, then encrypt it.

**Keys never come from the label.** The verifier looks the kid up only in the trust store you
pass. A public key, URL or hint inside the label is ignored, because whoever edits the label
controls all of it. Verification makes no network requests. Build the trust store beforehand, for
example from keys shipped with your app, or from a `/.well-known/wols-keys.json` document on a
host you chose independently of any label.

`trustStoreFromKeySet(document, { onSkip })` builds a trust store from a key set document, given
as JSON text or a parsed value. It doesn't fetch anything:

```typescript
import { trustStoreFromKeySet } from '@wemush/wols';

// Fetch from a host you chose in advance, never one named by a label.
const res = await fetch('https://mushoh.example/.well-known/wols-keys.json');
const trustStore = await trustStoreFromKeySet(await res.text(), {
  onSkip: entry => console.info(`Skipped ${entry.alg} key ${String(entry.kid)}`),
});
```

It is forward-compatible: an entry whose `alg` isn't `Ed25519` (compared exactly) is skipped
without checking its other members, so an issuer can add keys for a later algorithm without
breaking your verifier. A label signed under a skipped kid verifies as `unknown-kid`. Anything
else wrong throws `WolsSignatureError` for the whole document, because a damaged entry for a
supported algorithm points to corruption or tampering: an `Ed25519` entry with a bad kid or a key
that isn't canonical base64url of 32 bytes on the curve, two `Ed25519` entries with the same kid,
or a document that isn't an object with a `keys` array of objects with a string `alg`.

Other rules to know:

- **Verify the label text as scanned.** The embedded signature covers the RFC 8785 (JCS) form of
  the label as parsed, including members this library doesn't know. Don't verify the `Specimen`
  that `parseSpecimen()` returns: it drops unknown members and normalizes values, so it no longer
  matches. A parsed JSON object (`JSON.parse` output) is accepted.
- **Re-emit signed labels unchanged.** Any change to a signed URL's bytes, including
  re-encoding or reordering parameters, invalidates it. `toEncryptedUrl(parseEncryptedUrl(url))`
  reproduces a URL that this library generated.
- **Decoding never verifies.** `parseSpecimen`, `validateSpecimen`, `decryptSpecimen` and
  `parseEncryptedUrl` keep `signature` and `sig` exactly as received and never check them.
- **Signers refuse** labels that aren't I-JSON objects (duplicate member names, lone surrogates,
  non-finite numbers), and URLs with no query, an empty query, or an existing `sig` parameter.
  `signCompactUrl` also refuses a URL that isn't a well-formed compact URL (an empty or repeated
  parameter, bad percent-encoding, a parameter name outside `[A-Za-z0-9_-]`). Errors are thrown
  as `WolsSignatureError`.
- **Trust store mistakes are configuration errors.** `createTrustStore` throws for an entry that
  isn't `Ed25519`, isn't 32 bytes, or isn't a point on the curve (only `trustStoreFromKeySet`
  skips other algorithms, and only in key set documents). If such an entry reaches
  `verifySpecimen` anyway, the result is `invalid`, never `unknown-kid`.
- **Keep numbers in the safe range.** JCS rounds numbers to doubles, so integers beyond ±2^53
  that differ only past double precision share a signature. Put such values in strings.
- **Compact URLs** can be signed from WOLS 1.5.0 (`signCompactUrl`). A 1.4.0 verifier reports
  them as `malformed`.
- **Runtime:** WebCrypto Ed25519, available in Node.js 20+, Bun, Deno and current browsers. No
  extra dependency.

Other exports: `createTrustStore(entries)` validates a trust store, `trustStoreFromKeySet(document)`
loads one from a key set document, `getSigningPublicKey(seed)`
derives a seed's 32-byte public key, and
`canonicalizeJson(value)` is the RFC 8785 canonicalization the signatures use.

## Types

All types are exported for TypeScript users:

```typescript
import type {
  Specimen,
  SpecimenInput,
  SpecimenId,
  SpecimenType,
  GrowthStage,
  Strain,
  Taxon,
  ParentLink,
  Container,
  Bundle,
  SpecimenRef,
  CompactUrlFailureReason,
  ParseResult,
  ValidationResult,
  ValidationError,
  EncryptedSpecimen,
  EncryptedField,
  FieldEncryptedSpecimen,
  EncryptionOptions,
  FieldEncryptionOptions,
  DecryptionOptions,
  DecryptionFailureReason,
  DecryptResult,
  SignatureForm,
  SignatureStatus,
  SigningOptions,
  TrustStore,
  VerificationResult,
  QRCodeOptions,
} from '@wemush/wols';
```

## Error Handling

All errors include a stable error code for programmatic handling:

```typescript
import { WolsErrorCode } from '@wemush/wols';

const result = parseSpecimen(invalidJson);
if (!result.success) {
  switch (result.error.code) {
    case WolsErrorCode.INVALID_JSON:
      console.error('Invalid JSON syntax');
      break;
    case WolsErrorCode.REQUIRED_FIELD:
      console.error('Missing required field');
      break;
    case WolsErrorCode.INVALID_ID_FORMAT:
      console.error('Invalid specimen ID format');
      break;
  }
}
```

## WOLS Specification

This library implements **WOLS v1.5.0**: the 1.5 label members, Records Bundles, the compact
URL rules and compact URL signatures, as well as the 1.4.0 signature scheme (see
[Signing and verifying](#signing-and-verifying)). New labels are written as `"version": "1.5.0"`.
For the full specification, see the
[WOLS Specification](https://github.com/wemush/open-standard/blob/main/SPECIFICATION.md).

### Conformance

The shared [WOLS conformance vectors](https://github.com/wemush/open-standard/tree/main/conformance)
are vendored in `tests/conformance/vectors` and run with `npm test` (or `npm run test:conformance`).
Every `MUST` case passes. `SHOULD` cases are reported but don't fail the build. The 1.5 JSON
Schemas are vendored too, and the suite checks that they agree with the vectors. See
[`tests/conformance/README.md`](tests/conformance/README.md) for how to refresh them.

### Upgrading from 1.4

1.5.0 adds optional label members, Records Bundles, the compact URL rules and compact URL
signatures. 1.4.x labels read the same way, and so do labels written by the 1.5.0 release
candidates (`"version": "1.5.0-rc.1"` or `"1.5.0-rc.2"`). See [CHANGELOG.md](CHANGELOG.md),
including the breaking changes listed under 1.5.0-rc.2. Things that may affect callers:

- `WOLS_VERSION` is `'1.5.0'`, so new labels say `"version": "1.5.0"`. `isOutdated('1.4.0')` is
  now `true`, and `migrate()` on a 1.4.x label needs a registered handler. Setting `version` is
  enough: `registerMigration('1.4.0', '1.5.0', s => ({ ...s, version: '1.5.0' }))`. Labels with
  a 1.5.0 pre-release version are not outdated.
- `@wemush/wols` 1.4.x reads 1.5.0 labels (it accepts any semver `version`), but it warns about
  the 1.5 members and doesn't keep them. Upgrade readers before writers if you use them.

### Upgrading from 1.3

1.4.0 adds signing and verification and doesn't change the wire format. 1.3.0 labels decode the
same way, and 1.3.0 reads labels written by 1.4.0. See [CHANGELOG.md](CHANGELOG.md). Things that
may affect callers:

- `WOLS_VERSION` is `'1.4.0'`, so new labels say `"version": "1.4.0"`. `isOutdated('1.3.0')` is
  now `true`, and `migrate()` on a 1.3.0 label needs a registered handler. Setting `version` is
  enough: `registerMigration('1.3.0', '1.4.0', s => ({ ...s, version: '1.4.0' }))`.
- A numeric `strain.generation` (as `wols` for Python 1.3.0 wrote it) now decodes as its decimal
  string with a `NUMERIC_GENERATION` warning, where 1.3.0 rejected the label.
- Legacy (1.2.x) labels made with a non-NFC passphrase decrypt again with `allowLegacy`.

### Upgrading from 1.2

See [CHANGELOG.md](CHANGELOG.md). Every change that can break a 1.2.x caller:

- **Encrypted generation changed.** Passphrase encryption now uses a random per-label salt and
  records `kdf`, `salt` and `i`. Labels made by 1.3.0 can't be read by 1.2.x, so upgrade readers
  before writers. 1.2.x labels fail with `legacy-format` unless you pass `allowLegacy: true`.
- Passphrase encryption defaults to 600,000 iterations and allows 100,000 to 10,000,000. It used
  to default to 100,000, with a minimum of 10,000. Passphrases are now normalized to NFC (legacy
  labels still derive from the passphrase as given, as 1.2.x did).
- A `CryptoKey` must now be AES-GCM with a length of 256 and allow `encrypt` or `decrypt`. That
  applies to legacy labels too.
- Field-level encryption (`fields`) throws for a field the specimen doesn't have. It used to skip
  the field silently, leaving it in cleartext. Field values use the 1.3.0 shape (`kdf`, `salt`,
  `iterations` instead of `cryptoVersion`).
- The default `idMode` is now `'any'`. Pass `idMode: 'strict'` to keep the old CUID-style check.
  This loosens validation, so if `validateSpecimen` gates untrusted input, decide which mode you
  want.
- `createSpecimen({ type: 'PRIMORDIA' })` now sets `stage: 'PRIMORDIA'` and warns through
  `console.warn` unless you pass `onWarning`. `registerTypeAlias('PRIMORDIA', …)` with anything other
  than `FRUITING` throws.
- `isEncrypted` now narrows to `EncryptedSpecimen | EncryptedField`.
- The encryption functions need a global WebCrypto, which means Node.js 20 or later.

For the steps to take, see [Migrating from 1.2](#migrating-from-12).

## Migrating from 1.2

### 1. Upgrade readers before writers

1.2.x can't decrypt labels made by 1.3.0. It reads only the object form, not URLs, and it
always derives passphrase keys from its fixed salt, so a 1.3.0 label with its own random salt
fails to authenticate. 1.3.0 still reads 1.2.x labels when you pass `allowLegacy: true`.

Upgrade every app and service that scans or decrypts labels first. Then upgrade the ones that
print them. Don't print 1.3.0 labels while anything that reads them is still on 1.2.x.

### 2. Check your runtime

The encryption functions use the global WebCrypto (`crypto.subtle`), so they need Node.js 20 or
later, a browser, Deno or Bun. Node.js 18 has no global `crypto` by default. There, encryption
throws and decryption returns reason `unsupported-environment`. The package declares
`"engines": { "node": ">=20.0.0" }`.

### 3. Re-encrypt legacy labels

A legacy label is one made by 1.2.x. You can recognize it by the missing `kdf`: the object form
has no `kdf` property (1.2.x wrote `cryptoVersion: 'v1'` and `iterations` instead), and a URL
has no `kdf=` parameter. 1.3.0 always writes `kdf=pbkdf2` or `kdf=raw`. A legacy label fails with
reason `legacy-format` unless you pass `allowLegacy: true` to `decryptSpecimen`,
`decryptPlaintext`, `decryptFields` or `decryptField`.

Legacy labels are weaker than 1.3.0 labels:

- 1.2.0 derived every passphrase key from the same fixed salt, `@wemush/wols/crypto/v1`, so one
  precomputed guess works against every label.
- 1.2.x field values have no field binding. Nothing ties a value to its field or its label, so
  a value moved to another field, or copied from another label, still decrypts.
- 1.2.x objects carry no `id`, so the decrypted specimen isn't checked against one.

The WOLS spec leaves legacy labels to each implementation. `allowLegacy` reads only the format
made by this library (`@wemush/wols` 1.2.x), not legacy labels made by other WOLS libraries,
and they don't read this one.

Turn on `allowLegacy` only for labels you know are old: decrypt them, then encrypt them again
with 1.3.0. Legacy labels are never generated.

```typescript
import {
  decryptSpecimen,
  encryptSpecimen,
  parseEncryptedUrl,
  type DecryptionOptions,
  type EncryptedSpecimen,
} from '@wemush/wols';

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

const migrated = await reencryptLegacy(storedLabel, passphrase);
if (migrated) {
  // Store the new label and reprint its QR code from migrated.url.
}
```

`isLegacyLabel` reads only cleartext parameters, so it costs no key derivation.

A 1.2.x field-level label, made with `encryptSpecimen(s, { key, fields })`, migrates the same way
with `decryptFields` and `encryptFields`. Find the encrypted fields with `isEncrypted`, because
`isEncryptedField` matches only 1.3.0 values, which have a `kdf`. A label in which 1.2.x
encrypted an identifying field (`id`, `type`, `species`, ...) fails with `identifying-field`.
1.3.0 never decrypts those.

```typescript
import {
  decryptFields,
  encryptFields,
  isEncrypted,
  type DecryptionOptions,
  type FieldEncryptedSpecimen,
  type Specimen,
} from '@wemush/wols';

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
```

Both functions are tested in
[`tests/unit/readme-migration.test.ts`](tests/unit/readme-migration.test.ts) against labels made
the 1.2.0 way.

1.2.x didn't normalize passphrases, so `allowLegacy` derives a legacy key from the passphrase
exactly as given. A legacy label made with a passphrase that wasn't in NFC (for example one typed
with combining accents) decrypts from that same passphrase. If that fails and the passphrase
isn't in NFC, the library tries its NFC form once, so a label made from the composed spelling
also opens from the decomposed one. That retry costs a second key derivation and is skipped
when it would exceed `maxIterations`. A wrong passphrase still fails with
`authentication-failed`. Labels you re-encrypt with 1.3.0 are NFC-normalized, so either spelling
opens them.

### 4. Decide on ID validation

The default `idMode` is now `'any'`: any non-empty suffix after `wemush:` passes, as the spec
requires. 1.2.x defaulted to `'strict'`, which allowed only `wemush:[a-z0-9]+`. This loosens
validation. If `validateSpecimen` gates untrusted input, choose a mode explicitly:

```typescript
validateSpecimen(data, { idMode: 'strict' }); // the 1.2.x default: wemush:[a-z0-9]+
validateSpecimen(data, { idMode: 'ulid' }); // or 'uuid'
```

A `customIdValidator` takes precedence over `idMode`. `parseSpecimen`, `decryptSpecimen` and
`decryptFields` always validate with the default, so to apply a stricter mode there, call
`validateSpecimen` on their result.

### 5. Move field-level encryption to `encryptFields`

`encryptSpecimen(specimen, { key, fields })` still works but is deprecated. Use
`encryptFields(specimen, { key, fields })`. Its result is typed precisely: the named fields are
`EncryptedField` and the rest keep their cleartext types. Restore the label with
`decryptFields`.

```typescript
// 1.2.x, deprecated in 1.3.0
const before = await encryptSpecimen(specimen, { key, fields: ['strain'] });
// 1.3.0
const partial = await encryptFields(specimen, { key, fields: ['strain'] });
const restored = await decryptFields(partial, { key });
```

Both throw for a field the specimen doesn't have, where 1.2.x skipped it silently and left it in
cleartext. They also throw for a field named twice. Identifying fields (`@context`, `@type`,
`id`, `version`, `type`, `species`) can't be encrypted.

`decryptField`, which decrypts one value, is new in 1.3.0 (1.2.x had no field-level decryption).
Each 1.3.0 field value is bound to its label and field name, so it takes that binding as a third
argument:

```typescript
const strain = await decryptField(partial.strain, { key }, { id: partial.id, field: 'strain' });
```

The second argument is the options object, `{ key }`, not the key itself. A value checked
against the wrong `id` or `field` fails with `authentication-failed`. `decryptFields` supplies
the binding for you.

## License

[Apache-2.0](LICENSE)
