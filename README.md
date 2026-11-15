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

Implements the WOLS 1.3.0 encrypted format with WebCrypto, so it works in Node.js 18+ and in
browsers.

```
wemush://v1/encrypted/{id}?e={ciphertext}&iv={iv}&kdf=pbkdf2|raw[&salt={salt}&i={iterations}][&sig={signature}]
```

- AES-256-GCM. `e` is the ciphertext with the 16-byte tag appended. `iv` is a fresh random 12-byte IV for every encryption.
- Every binary value is base64url without padding. Decoders also accept padded input.
- `{id}` is the specimen ID without the `wemush:` prefix. It is cleartext, so don't put sensitive data in it.

```typescript
import { encryptSpecimen, decryptSpecimen } from '@wemush/wols';
// Or import from submodule:
// import { encryptSpecimen } from '@wemush/wols/crypto';
```

### `encryptSpecimen(specimen, options): Promise<EncryptedSpecimen>`

The kind of `key` you pass selects the key derivation:

| `key`                                                     | `kdf`    | Behavior                                                                          |
| --------------------------------------------------------- | -------- | --------------------------------------------------------------------------------- |
| passphrase `string`                                       | `pbkdf2` | PBKDF2-HMAC-SHA256, a fresh random 16-byte salt per label, 100,000 iterations by default |
| 32-byte `Uint8Array` / `ArrayBuffer`, or an AES-GCM 256 `CryptoKey` | `raw`    | Key shared out of band. No `salt` or `i`.                                         |

```typescript
const enc = await encryptSpecimen(specimen, { key: 'correct horse battery staple' });
enc.url;
// "wemush://v1/encrypted/clx1a2b3c4?e=...&iv=...&kdf=pbkdf2&salt=...&i=100000"

const raw = await encryptSpecimen(specimen, { key: crypto.getRandomValues(new Uint8Array(32)) });
raw.url; // "wemush://v1/encrypted/clx1a2b3c4?e=...&iv=...&kdf=raw"
```

The result also carries `payload`, `iv`, `kdf`, `salt`, `iterations` and `id`. Put `url` in the QR code.

**Encryption options:**

- `key` - A passphrase (`kdf=pbkdf2`), or raw key bytes or a `CryptoKey` (`kdf=raw`)
- `iterations` - PBKDF2 iterations. Passphrase keys only. Must be at least 100,000.
- `fields` - Field-level encryption. Each named field is replaced in place with
  `{ encrypted: true, algorithm: "AES-256-GCM", payload, iv, kdf, salt?, iterations? }`, and the
  rest of the label stays in cleartext. Restore the values with `decryptFields(obj, { key })`.

### `decryptSpecimen(input, options): Promise<ParseResult<Specimen>>`

`input` can be an encrypted URL or an `EncryptedSpecimen` object. Use `decryptPlaintext` to get the
exact decrypted JSON string instead.

```typescript
const result = await decryptSpecimen(url, { key: 'correct horse battery staple' });

if (result.success) {
  console.log(result.data.species);
} else {
  console.error(result.error.details?.reason, result.error.message);
}
```

Decryption is refused, with a stable `error.details.reason`, when:

- the decrypted specimen's `id` is not `wemush:{id}` from the URL path (`id-mismatch`)
- GCM authentication fails because the key is wrong or the ciphertext was tampered with (`authentication-failed`)
- `kdf=pbkdf2` with `i` below 10,000 (`insufficient-iterations`), or without `salt` or `i` (`missing-parameter`)
- `kdf=raw` with `salt` or `i` present (`unexpected-parameter`)
- `kdf` is unknown (`unsupported-kdf`)
- the key doesn't fit the label, for example a passphrase for a `raw` label (`invalid-key`)

**Legacy labels:** payloads from before 1.3.0 have no `kdf`. They were encrypted with a fixed
library-wide salt. They are rejected by default. Pass `{ allowLegacy: true }` to decrypt them
during a migration. They are never generated.

### Other helpers

- `toEncryptedUrl(encrypted)` / `parseEncryptedUrl(url)` - convert between the URL and the object form
- `decryptField(field, options)` / `decryptFields(obj, options)` - field-level decryption
- `derivePassphraseKey(passphrase, salt, iterations)` - raw PBKDF2 output, for debugging interoperability
- `base64UrlEncode(bytes)` / `base64UrlDecode(str)`
- `isEncrypted(value)` - whether a value is an encrypted specimen

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
  EncryptionOptions,
  DecryptionOptions,
  DecryptionFailureReason,
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

See [CHANGELOG.md](CHANGELOG.md). The changes that can break callers:

- **Encrypted generation changed.** Passphrase encryption now uses a random per-label salt and
  records `kdf`, `salt` and `i`. Labels made by 1.3.0 can't be read by 1.2.x, and 1.2.x labels
  only decrypt with `allowLegacy: true`.
- Passphrase encryption requires at least 100,000 iterations (previously 10,000).
- The default `idMode` is now `'any'`. Pass `idMode: 'strict'` to keep the old CUID-style check.

## License

[Apache-2.0](LICENSE)
