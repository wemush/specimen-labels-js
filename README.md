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
- `{id}` is the specimen ID without the `wemush:` prefix, percent-encoded when needed. It is cleartext, so don't put sensitive data in it.

```typescript
import { encryptSpecimen, decryptSpecimen } from '@wemush/wols';
// Or import from submodule:
// import { encryptSpecimen } from '@wemush/wols/crypto';
```

### `encryptSpecimen(specimen, options): Promise<EncryptedSpecimen>`

Encrypts the whole label. The kind of `key` you pass selects the key derivation:

| `key`                                                               | `kdf`    | Behavior                                                                                 |
| ------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| passphrase `string`                                                 | `pbkdf2` | PBKDF2-HMAC-SHA256, a fresh random 16-byte salt per label, 100,000 iterations by default |
| 32-byte `Uint8Array` / `ArrayBuffer`, or an AES-GCM 256 `CryptoKey` | `raw`    | Key shared out of band. No `salt` or `i`.                                                |

```typescript
const enc = await encryptSpecimen(specimen, { key: 'correct horse battery staple' });
enc.url;
// "wemush://v1/encrypted/clx1a2b3c4?e=...&iv=...&kdf=pbkdf2&salt=...&i=100000"

const raw = await encryptSpecimen(specimen, { key: crypto.getRandomValues(new Uint8Array(32)) });
raw.url; // "wemush://v1/encrypted/clx1a2b3c4?e=...&iv=...&kdf=raw"
```

The result also carries `payload`, `iv`, `kdf`, `salt`, `iterations` and `id`. Put `url` in the QR code.

**Options:**

- `key` - A passphrase (`kdf=pbkdf2`), or raw key bytes or a `CryptoKey` (`kdf=raw`)
- `iterations` - PBKDF2 iterations. Passphrase keys only. Must be at least 100,000.
- `fields` - **Deprecated.** Use `encryptFields` instead.

### `encryptFields(specimen, { key, fields }): Promise<FieldEncryptedSpecimen>`

Field-level encryption. Each named field's value is replaced in place with
`{ encrypted: true, algorithm: "AES-256-GCM", payload, iv, kdf, salt?, iterations? }`, and the rest
of the label stays in cleartext. Every name in `fields` must be a field the specimen actually has.
A misspelled or missing field throws instead of being left unprotected. `@context`, `@type`, `id`
and `version` identify the label, so they can't be encrypted. The result is typed precisely: the
named fields are `EncryptedField`, and every other field keeps its cleartext type.

```typescript
const partial = await encryptFields(specimen, { key: passphrase, fields: ['strain'] });
partial.species; // cleartext
partial.strain; // { encrypted: true, kdf: 'pbkdf2', ... }

const restored = await decryptFields(partial, { key: passphrase });
if (restored.success) restored.data.strain?.name; // a validated Specimen
```

Field-level encryption protects each value's confidentiality only. Values aren't bound to their
field name or to their label. Anyone who can edit the cleartext document can move an encrypted
value somewhere else, so sign the label when placement matters.

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
- `maxIterations` - The largest PBKDF2 iteration count accepted from a label. The default is
  10,000,000. The count comes from the label, so this caps how much CPU a hostile QR code can cost.
  A server that decodes untrusted labels should set it close to the count it generates with.
  `decryptFields` applies it to the whole document: fields that share a salt share one key
  derivation, and the total across distinct salts must stay under the limit.

Every cheap check runs before key derivation, so a malformed label costs no PBKDF2 work. The
failure reasons are:

| `reason` | When |
| --- | --- |
| `id-mismatch` | The decrypted specimen's `id` isn't `wemush:{id}` from the URL path |
| `authentication-failed` | The key is wrong, or the ciphertext was tampered with |
| `insufficient-iterations` / `excessive-iterations` | `i` is below 10,000, or above `maxIterations` |
| `missing-parameter` | `e` or `iv` is missing, or `kdf=pbkdf2` lacks `salt` or `i` |
| `unexpected-parameter` | `kdf=raw` has `salt` or `i`, or a legacy label has `salt` |
| `invalid-parameter` | Bad base64url, an IV that isn't 12 bytes, ciphertext shorter than the tag, a duplicate parameter |
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
- Passphrase encryption requires at least 100,000 iterations (previously 10,000).
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

## License

[Apache-2.0](LICENSE)
