# @wemush/wols

Official TypeScript library for **WOLS** (WeMush Open Labeling Standard) - the open standard for biological specimen labeling and traceability in mycology.

[![npm version](https://badge.fury.io/js/@wemush%2Fwols.svg)](https://www.npmjs.com/package/@wemush/wols)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

## Features

- 🏷️ **Create & Serialize** - Generate WOLS-compliant specimen labels
- ✅ **Validate** - Schema validation with detailed error reporting
- 📜 **Parse** - Parse JSON/QR data back to typed specimens
- 📱 **QR Codes** - Generate QR codes for specimens (PNG, SVG, Data URL)
- 🔗 **Compact URLs** - Create short URLs for space-constrained labels
- 🔐 **Encryption** - WOLS 1.3.0 encrypted format (AES-256-GCM, per-label PBKDF2 salt or raw keys)
- 🧪 **Conformance** - Passes every `MUST` vector in the WOLS 1.3.0 conformance suite

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
// Output: "wemush://v1/abc123?s=POSTR&st=COLONIZATION&ty=CULTURE"

const result = parseCompactUrl(url);
if (result.success) {
  console.log(result.data.species); // "Pleurotus ostreatus"
}
```

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
- `decryptField(field, options)` - decrypt a single encrypted field value
- `isEncryptedSpecimen(value)` / `isEncryptedField(value)` - tell a whole-label encryption from a field-level one. `isEncrypted(value)` matches either.
- `derivePassphraseKey(passphrase, salt, iterations)` - raw PBKDF2 output, for debugging interoperability. It doesn't apply the label rules.
- `base64UrlEncode(bytes)` / `base64UrlDecode(str)`

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

This library implements **WOLS v1.3.0**. For the full specification, see the
[WOLS Specification](https://github.com/wemush/open-standard/blob/main/SPECIFICATION.md).

### Conformance

The shared [WOLS conformance vectors](https://github.com/wemush/open-standard/tree/main/conformance)
are vendored in `tests/conformance/vectors` and run with `npm test` (or `npm run test:conformance`).
Every `MUST` case passes. `SHOULD` cases are reported but don't fail the build. See
[`tests/conformance/README.md`](tests/conformance/README.md) for how to refresh the vectors.

### Upgrading from 1.2

See [CHANGELOG.md](CHANGELOG.md). Every change that can break a 1.2.x caller:

- **Encrypted generation changed.** Passphrase encryption now uses a random per-label salt and
  records `kdf`, `salt` and `i`. Labels made by 1.3.0 can't be read by 1.2.x, so upgrade readers
  before writers. 1.2.x labels fail with `legacy-format` unless you pass `allowLegacy: true`.
- Passphrase encryption defaults to 600,000 iterations and allows 100,000 to 10,000,000. It used
  to default to 100,000, with a minimum of 10,000. Passphrases are now normalized to NFC.
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

1.3.0 normalizes passphrases to NFC, legacy labels included, and 1.2.x didn't. A legacy label
encrypted with a passphrase that wasn't in NFC (for example one typed with combining accents)
won't decrypt from the passphrase. Derive the 1.2.0 key yourself (PBKDF2-SHA256 over the
passphrase's UTF-8 bytes as typed, salt `@wemush/wols/crypto/v1`, the label's `iterations`) as an
AES-GCM 256 `CryptoKey`, and pass that as `key` with `allowLegacy: true`.

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
