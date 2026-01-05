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
- 🔐 **Encryption** - AES-256-GCM encryption for sensitive data

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

### `createSpecimen(input: SpecimenInput): Specimen`

Creates a new specimen with auto-generated ID and JSON-LD fields.

```typescript
const specimen = createSpecimen({
  type: 'SPAWN',
  species: 'Hericium erinaceus',
  strain: { name: "Lion's Mane", generation: 'F2' },
  stage: 'INOCULATION',
  batch: 'BATCH-2024-001',
  organization: 'org_123',
  custom: { substrate: 'hardwood' },
});
```

**Parameters:**

- `type` - Specimen type: `'CULTURE'`, `'SPAWN'`, `'SUBSTRATE'`, `'FRUITING'`, `'HARVEST'`
- `species` - Scientific species name
- `strain` - String (auto-expands to `{ name: string }`) or full `Strain` object
- `stage` - Growth stage: `'INOCULATION'`, `'COLONIZATION'`, `'FRUITING'`, `'HARVEST'`
- `batch` - Batch identifier
- `organization` - Organization ID
- `creator` - Creator user ID
- `custom` - Custom vendor-specific fields

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

Encrypt specimens using AES-256-GCM for secure data handling.

```typescript
import { encryptSpecimen, decryptSpecimen, isEncrypted } from '@wemush/wols';
// Or import from submodule:
// import { encryptSpecimen } from '@wemush/wols/crypto';
```

### `encryptSpecimen(specimen, options): Promise<EncryptedSpecimen>`

Encrypt a specimen with a password or CryptoKey.

```typescript
const encrypted = await encryptSpecimen(specimen, {
  key: 'my-secret-password',
});

console.log(encrypted);
// { encrypted: true, payload: "...", iv: "...", algorithm: "AES-256-GCM" }
```

### `decryptSpecimen(encrypted, options): Promise<ParseResult<Specimen>>`

Decrypt an encrypted specimen.

```typescript
const result = await decryptSpecimen(encrypted, {
  key: 'my-secret-password',
});

if (result.success) {
  console.log(result.data.species);
} else {
  console.error('Decryption failed:', result.error.message);
}
```

### `isEncrypted(value): boolean`

Check if a value is an encrypted specimen.

```typescript
if (isEncrypted(data)) {
  // Handle encrypted specimen
}
```

**Encryption Options:**

- `key` - Password string (uses PBKDF2) or `CryptoKey`
- `fields` - Encrypt only specific fields (partial encryption)

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
  EncryptionOptions,
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

This library implements **WOLS v1.1.0**. For the full specification, see the [WOLS Specification](https://wemush.com/open-standard).

## License

[Apache-2.0](LICENSE)
