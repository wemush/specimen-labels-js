# WOLS Library Implementation Specification

> **Purpose**: This document specifies the requirements for implementing official WOLS client libraries in TypeScript/JavaScript and Python.
>
> **Target Libraries**:
>
> - `@wemush/wols` (npm) — TypeScript/JavaScript
> - `wols` (PyPI) — Python
>
> **Specification Version**: 1.2.0
> **Date**: January 26, 2026

---

## Table of Contents

1. [Overview](#overview)
2. [Core Types & Interfaces](#core-types--interfaces)
3. [API Surface](#api-surface)
4. [QR Code Generation](#qr-code-generation)
5. [QR Code Parsing](#qr-code-parsing)
6. [Validation](#validation)
7. [Encryption Support](#encryption-support)
8. [Error Handling](#error-handling)
9. [TypeScript Implementation](#typescript-implementation)
10. [Python Implementation](#python-implementation)
11. [Testing Requirements](#testing-requirements)
12. [Release & Versioning](#release--versioning)

---

## Overview

### Design Goals

1. **Spec Compliance**: Libraries MUST produce and consume JSON-LD compliant WOLS v1.2.0 specimens
2. **Type Safety**: Full TypeScript types / Python type hints with strict validation
3. **Zero Dependencies** (core): Minimal dependencies for the core parser/validator
4. **QR Optional**: QR code generation/scanning as optional peer dependencies
5. **Offline-First**: All validation works without network access
6. **Extensible**: Support for custom namespaces without breaking validation

### Package Structure

```bash
@wemush/wols (npm)
├── core/           # Types, validation, serialization
├── qr/             # QR code generation (optional)
└── crypto/         # Encryption utilities (optional)

wols (PyPI)
├── wols/
│   ├── core/       # Types, validation, serialization
│   ├── qr/         # QR code generation (optional)
│   └── crypto/     # Encryption utilities (optional)
└── tests/
```

---

## Core Types & Interfaces

### Specimen Label (Primary Type)

```typescript
// TypeScript
interface Specimen {
  // JSON-LD Context (Required)
  "@context": "https://wemush.com/wols/v1";
  "@type": "Specimen";

  // Required Fields
  id: string;                    // Format: "wemush:{cuid}" e.g., "wemush:clx1a2b3c4"
  version: string;               // Semver, e.g., "1.1.0"
  type: SpecimenType;
  species: string;               // Scientific name

  // Optional Fields
  strain?: Strain;
  stage?: GrowthStage;
  created?: string;              // ISO 8601
  batch?: string;
  organization?: string;
  creator?: string;
  custom?: Record<string, unknown>;

  // Implementation Metadata (v1.2.0)
  _meta?: SpecimenMeta;

  // Verification
  signature?: string;
}

// v1.2.0: Metadata for round-trip preservation
interface SpecimenMeta {
  sourceId?: string;             // Original ID from source system
  sourceSystem?: string;         // Importing system identifier
  importedAt?: string;           // ISO 8601 import timestamp
  schemaVersion?: string;        // Source schema version
  [key: string]: unknown;        // Extensible
}

interface Strain {
  name: string;
  generation?: string;           // Filial generation: "F1", "F2", "P"
  clonalGeneration?: number;     // Subculture count: 1, 2, 3...
  lineage?: string;              // Parent specimen ID
  source?: string;               // "spore", "tissue", "agar", "liquid"
}

type SpecimenType =
  | "CULTURE"
  | "SPAWN"
  | "SUBSTRATE"
  | "FRUITING"
  | "HARVEST";

type GrowthStage =
  | "INOCULATION"
  | "COLONIZATION"
  | "FRUITING"
  | "HARVEST";
```

```python
# Python
from dataclasses import dataclass
from typing import Optional, Dict, Any, Literal
from datetime import datetime

SpecimenType = Literal["CULTURE", "SPAWN", "SUBSTRATE", "FRUITING", "HARVEST"]
GrowthStage = Literal["INOCULATION", "COLONIZATION", "FRUITING", "HARVEST"]

@dataclass
class Strain:
    name: str
    generation: Optional[str] = None        # Filial: "F1", "F2", "P"
    clonal_generation: Optional[int] = None # Subculture count: 1, 2, 3...
    lineage: Optional[str] = None           # Parent specimen ID
    source: Optional[str] = None            # "spore", "tissue", "agar", "liquid"

@dataclass
class Specimen:
    # Required
    id: str
    version: str
    type: SpecimenType
    species: str

    # JSON-LD (auto-populated)
    context: str = "https://wemush.com/wols/v1"
    rdf_type: str = "Specimen"

    # Optional
    strain: Optional[Strain] = None
    stage: Optional[GrowthStage] = None
    created: Optional[datetime] = None
    batch: Optional[str] = None
    organization: Optional[str] = None
    creator: Optional[str] = None
    custom: Optional[Dict[str, Any]] = None
    signature: Optional[str] = None
```

---

## API Surface

### Factory Functions

```typescript
// TypeScript - @wemush/wols

// Create a new specimen with auto-generated ID
function createSpecimen(input: SpecimenInput): Specimen;

// Parse from JSON string (QR code content)
function parseSpecimen(json: string): ParseResult<Specimen>;

// Parse from compact URL format
function parseCompactUrl(url: string): ParseResult<SpecimenRef>;

// v1.2.0: Convenience methods for compact URL parsing
function parseCompactUrlOrThrow(url: string): SpecimenRef;
function parseCompactUrlOrNull(url: string): SpecimenRef | null;

// Validate an existing specimen object
function validateSpecimen(specimen: unknown): ValidationResult;

// Serialize to JSON string (for QR encoding)
function serializeSpecimen(specimen: Specimen): string;

// Generate compact URL (for small QR codes)
function toCompactUrl(specimen: Specimen): string;

// v1.2.0: Type Alias System
function registerTypeAlias(alias: string, wolsType: SpecimenType): void;
function resolveTypeAlias(typeOrAlias: string): SpecimenType | string;
function getTypeAliases(): ReadonlyMap<string, SpecimenType>;

// v1.2.0: Type Mapping
function mapToWolsType(platformType: string): SpecimenType | null;
function mapFromWolsType(wolsType: SpecimenType): readonly string[];
function registerPlatformType(platformType: string, wolsType: SpecimenType): void;

// v1.2.0: Generation Format
function normalizeGeneration(generation: string, format?: GenerationFormat): string;
function isValidGeneration(generation: string): boolean;

// v1.2.0: Environment Detection
function isServer(): boolean;
function isBrowser(): boolean;
function isCryptoSupported(): boolean;
function getRuntimeEnvironment(): RuntimeEnvironment;

// v1.2.0: Migration Utilities
function compareVersions(a: string, b: string): VersionComparison;
function isOutdated(specimen: Specimen | string): boolean;
function migrate(specimen: Specimen): Specimen;
function registerMigration(from: string, to: string, handler: MigrationHandler): void;
```

```python
# Python - wemush_wols

def create_specimen(
    type: SpecimenType,
    species: str,
    strain: Optional[Strain] = None,
    stage: Optional[GrowthStage] = None,
    batch: Optional[str] = None,
    organization: Optional[str] = None,
    **custom_fields
) -> Specimen:
    """Create a new specimen with auto-generated ID."""

def parse_specimen(json_str: str) -> Specimen:
    """Parse specimen from JSON string. Raises WolsParseError on failure."""

def parse_compact_url(url: str) -> SpecimenRef:
    """Parse compact wemush:// URL format."""

# v1.2.0: Convenience methods
def parse_compact_url_or_raise(url: str) -> SpecimenRef:
    """Parse compact URL, raising WolsParseError on failure."""

def parse_compact_url_or_none(url: str) -> Optional[SpecimenRef]:
    """Parse compact URL, returning None on failure."""

def validate_specimen(data: dict) -> ValidationResult:
    """Validate a specimen dictionary against the schema."""

def serialize_specimen(specimen: Specimen) -> str:
    """Serialize specimen to JSON-LD string."""

def to_compact_url(specimen: Specimen) -> str:
    """Generate compact URL for small QR codes."""

# v1.2.0: Type Alias System
def register_type_alias(alias: str, wols_type: SpecimenType) -> None: ...
def resolve_type_alias(type_or_alias: str) -> str: ...
def get_type_aliases() -> Dict[str, SpecimenType]: ...

# v1.2.0: Generation Format
def normalize_generation(generation: str, format: str = "preserve") -> str: ...
def is_valid_generation(generation: str) -> bool: ...

# v1.2.0: Type Mapping
def map_to_wols_type(platform_type: str) -> Optional[SpecimenType]: ...
def map_from_wols_type(wols_type: SpecimenType) -> List[str]: ...
def register_platform_type(platform_type: str, wols_type: SpecimenType) -> None: ...

# v1.2.0: Environment Detection
def is_crypto_supported() -> bool: ...
def get_runtime_environment() -> str: ...

# v1.2.0: Migration Utilities
def compare_versions(a: str, b: str) -> int: ...
def is_outdated(specimen: Union[Specimen, str]) -> bool: ...
def is_newer(specimen: Union[Specimen, str]) -> bool: ...
def migrate(specimen: Specimen) -> Specimen: ...
def register_migration(from_version: str, to_version: str, handler: Callable) -> None: ...
def can_migrate(specimen: Specimen) -> bool: ...
```

### Input Types

```typescript
// TypeScript
interface SpecimenInput {
  type: SpecimenType;
  species: string;
  strain?: string | Strain;      // Accept string shorthand or full object
  stage?: GrowthStage;
  batch?: string;
  organization?: string;
  creator?: string;
  custom?: Record<string, unknown>;
}

// Strain shorthand expansion
// "Blue Oyster" → { name: "Blue Oyster" }
// { name: "Blue Oyster", generation: "F2" } → as-is
```

### Result Types

```typescript
// TypeScript
type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: WolsError };

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

interface ValidationError {
  path: string;           // JSON path, e.g., "strain.name"
  code: string;           // Error code, e.g., "REQUIRED_FIELD"
  message: string;
}
```

---

## QR Code Generation

### Dependencies

- **TypeScript**: `qrcode` (peer dependency)
- **Python**: `qrcode` or `segno` (optional dependency)

### API

```typescript
// TypeScript - @wemush/wols/qr
import { toQRCode, toQRCodeDataURL, toQRCodeSVG } from '@wemush/wols/qr';

// Generate QR code as PNG buffer
async function toQRCode(
  specimen: Specimen,
  options?: QRCodeOptions
): Promise<Buffer>;

// Generate as data URL (for <img> tags)
async function toQRCodeDataURL(
  specimen: Specimen,
  options?: QRCodeOptions
): Promise<string>;

// Generate as SVG string
async function toQRCodeSVG(
  specimen: Specimen,
  options?: QRCodeOptions
): Promise<string>;

interface QRCodeOptions {
  size?: number;                 // Width/height in pixels (default: 300)
  errorCorrection?: 'L' | 'M' | 'Q' | 'H';  // Default: 'M'
  format?: 'embedded' | 'compact';           // Default: 'embedded'
  margin?: number;               // Quiet zone modules (default: 1)
}
```

```python
# Python - wemush_wols.qr
from wemush_wols.qr import to_qr_code, to_qr_code_svg, to_qr_code_base64

def to_qr_code(
    specimen: Specimen,
    size: int = 300,
    error_correction: str = 'M',
    format: str = 'embedded'
) -> bytes:
    """Generate QR code as PNG bytes."""

def to_qr_code_svg(specimen: Specimen, **options) -> str:
    """Generate QR code as SVG string."""

def to_qr_code_base64(specimen: Specimen, **options) -> str:
    """Generate QR code as base64 data URL."""
```

### Format Selection

| Format     | Size        | Use Case          | Content                                        |
|------------|-------------|-------------------|------------------------------------------------|
| `embedded` | ~400 bytes  | Most applications | Full JSON-LD                                   |
| `compact`  | ~80 bytes   | Small labels      | `wemush://v1/{id}?s={species_code}&st={stage}` |

---

## QR Code Parsing

### Browser/Mobile Scanning

```typescript
// TypeScript - browser integration with @zxing/browser
import { createScanner } from '@wemush/wols/qr';

const scanner = createScanner({
  videoElement: document.getElementById('video'),
  onScan: (result) => {
    if (result.success) {
      console.log('Scanned specimen:', result.data);
    }
  },
  onError: (error) => {
    console.error('Scan error:', error);
  }
});

await scanner.start();
// ... later
scanner.stop();
```

### Server-Side Parsing

```typescript
// Parse from image file
import { parseQRCodeImage } from '@wemush/wols/qr';

const specimen = await parseQRCodeImage('./label.png');
```

---

## Validation

### Schema Validation Rules

| Field | Rule | Error Code |
| ----- | ---- | ---------- |
| `@context` | Must be `https://wols.wemush.com/v1` | `INVALID_CONTEXT` |
| `@type` | Must be `Specimen` | `INVALID_TYPE` |
| `id` | Must match `wemush:.+` (prefix required, suffix flexible) | `INVALID_ID_FORMAT` |
| `version` | Must be valid semver | `INVALID_VERSION` |
| `type` | Must be valid SpecimenType (or registered alias) | `INVALID_SPECIMEN_TYPE` |
| `species` | Required, non-empty string | `REQUIRED_FIELD` |
| `created` | Must be valid ISO 8601 | `INVALID_DATE_FORMAT` |
| `strain.generation` | Should match pattern like F1, F2, G1, P, or numeric | `INVALID_GENERATION` (warning) |
| `_meta` | Reserved namespace for implementation metadata | _(no validation)_ |

### Validation Options (v1.2.0)

```typescript
interface ValidationOptions {
  allowUnknownFields?: boolean;   // Allow fields not in spec (default: true)
  level?: 'strict' | 'lenient';   // Validation strictness (default: 'strict')
  idMode?: IdValidationMode;      // ID format validation mode (default: 'strict')
  customIdValidator?: IdValidator; // Custom ID validation function
}

type IdValidationMode = 'strict' | 'ulid' | 'uuid' | 'any';
type IdValidator = (id: string) => boolean;
```

| `idMode` | Pattern | Description |
| -------- | ------- | ----------- |
| `strict` | `wemush:[a-z0-9]{8,}` | CUID format (default) |
| `ulid` | `wemush:[0-9A-HJKMNP-TV-Z]{26}` | ULID format |
| `uuid` | `wemush:{uuid-v1-5}` | UUID format |
| `any` | `wemush:.+` | Any non-empty suffix |

### Validation API

```typescript
import { validateSpecimen, ValidationLevel } from '@wemush/wols';

const result = validateSpecimen(data, {
  level: ValidationLevel.Strict,    // or 'Lenient'
  allowUnknownFields: true,         // For custom namespaces
});

if (!result.valid) {
  result.errors.forEach(err => {
    console.error(`${err.path}: ${err.message}`);
  });
}
```

---

## Encryption Support

### Encrypted Format

For proprietary/sensitive data:

```typescript
// TypeScript - @wemush/wols/crypto
import { encryptSpecimen, decryptSpecimen } from '@wemush/wols/crypto';

// Encrypt entire specimen
const encrypted = await encryptSpecimen(specimen, {
  algorithm: 'AES-256-GCM',
  key: sharedKey,                    // or publicKey for asymmetric
});
// Returns: { encrypted: true, payload: "...", algorithm: "..." }

// Decrypt
const decrypted = await decryptSpecimen(encrypted, {
  key: sharedKey,
});
```

### Partial Encryption

Encrypt only sensitive fields while keeping species/stage public:

```typescript
const partiallyEncrypted = await encryptSpecimenFields(specimen, {
  fields: ['strain', 'custom.substrate_recipe'],
  key: organizationKey,
});
```

---

## Error Handling

### Error Types

```typescript
// TypeScript
class WolsError extends Error {
  code: string;
  details?: Record<string, unknown>;
}

class WolsParseError extends WolsError {
  code: 'PARSE_ERROR' | 'INVALID_JSON' | 'INVALID_FORMAT';
  position?: number;
}

class WolsValidationError extends WolsError {
  code: 'VALIDATION_ERROR';
  errors: ValidationError[];
}

class WolsEncryptionError extends WolsError {
  code: 'ENCRYPTION_ERROR' | 'DECRYPTION_ERROR' | 'INVALID_KEY';
}
```

```python
# Python
class WolsError(Exception):
    """Base exception for WOLS library."""
    code: str
    details: Optional[Dict[str, Any]]

class WolsParseError(WolsError):
    """Raised when parsing fails."""

class WolsValidationError(WolsError):
    """Raised when validation fails."""
    errors: List[ValidationError]

class WolsEncryptionError(WolsError):
    """Raised when encryption/decryption fails."""
```

---

## TypeScript Implementation

### Package Setup

```json
{
  "name": "@wemush/wols",
  "version": "1.2.0",
  "description": "Official WOLS (WeMush Open Labeling Standard) library",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./qr": "./dist/qr/index.js",
    "./crypto": "./dist/crypto/index.js"
  },
  "peerDependencies": {
    "qrcode": "^1.5.0"
  },
  "peerDependenciesMeta": {
    "qrcode": { "optional": true }
  },
  "keywords": ["wols", "wemush", "mycology", "qr-code", "traceability"],
  "license": "MIT"
}
```

### File Structure

```bash
src/
├── index.ts              # Main exports
├── types.ts              # TypeScript interfaces, type aliases, mappings
├── errors.ts             # Custom error classes
├── specimen.ts           # createSpecimen, serializeSpecimen
├── parser.ts             # parseSpecimen
├── validator.ts          # validateSpecimen
├── compact-url.ts        # toCompactUrl, parseCompactUrl
├── utils/
│   ├── cuid.ts           # ID generation
│   ├── iso8601.ts        # Date utilities
│   ├── environment.ts    # Runtime detection (v1.2.0)
│   └── migration.ts      # Version migration (v1.2.0)
├── qr/
│   ├── index.ts
│   ├── generate.ts       # QR code generation
│   └── scan.ts           # QR code scanning
└── crypto/
    ├── index.ts
    ├── encrypt.ts
    └── decrypt.ts
```

---

## Python Implementation

### Python Package Setup

```toml
# pyproject.toml
[project]
name = "wols"
version = "1.2.0"
description = "Official WOLS (WeMush Open Labeling Standard) library"
readme = "README.md"
license = "MIT"
requires-python = ">=3.9"
keywords = ["wols", "wemush", "mycology", "qr-code", "traceability"]

dependencies = []

[project.optional-dependencies]
qr = ["qrcode[pil]>=7.0", "pillow>=9.0"]
crypto = ["cryptography>=40.0"]
all = ["wemush-wols[qr,crypto]"]

[project.urls]
Homepage = "https://wemush.com/open-standard"
Repository = "https://github.com/wemush/specimen-labels-py"
Documentation = "https://wemush.com/open-standard/specification"
```

### Python File Structure

```bash
wemush_wols/
├── __init__.py           # Main exports
├── types.py              # Dataclasses, type definitions, aliases
├── errors.py             # Custom exception classes
├── specimen.py           # create_specimen, serialize_specimen
├── parser.py             # parse_specimen
├── validator.py          # validate_specimen
├── compact_url.py        # to_compact_url, parse_compact_url
├── utils/
│   ├── __init__.py
│   ├── cuid.py           # ID generation
│   ├── iso8601.py        # Date utilities
│   ├── environment.py    # Runtime detection (v1.2.0)
│   └── migration.py      # Version migration (v1.2.0)
├── qr/
│   ├── __init__.py
│   ├── generate.py
│   └── scan.py
├── crypto/
│   ├── __init__.py
│   ├── encrypt.py
│   └── decrypt.py
└── py.typed              # PEP 561 marker
```

---

## Testing Requirements

### Test Coverage

- **Unit Tests**: 100% coverage for core module
- **Integration Tests**: QR round-trip (generate → scan → parse)
- **Compatibility Tests**: Cross-language (TS generates, Python parses)
- **Fuzz Tests**: Random malformed input handling

### Test Cases (Minimum)

| Category | Test Case |
| -------- | --------- |
| Creation | Create specimen with all fields |
| Creation | Create specimen with minimal fields |
| Creation | Strain shorthand expansion |
| Creation | Create specimen with type alias (v1.2.0) |
| Creation | Create specimen with `_meta` field (v1.2.0) |
| Parsing | Parse valid JSON-LD specimen |
| Parsing | Parse compact URL format |
| Parsing | Reject invalid JSON |
| Parsing | Handle unknown fields gracefully |
| Parsing | Preserve `_meta` through round-trip (v1.2.0) |
| Parsing | parseCompactUrlOrThrow throws on invalid (v1.2.0) |
| Parsing | parseCompactUrlOrNull returns null on invalid (v1.2.0) |
| Validation | Validate required fields |
| Validation | Validate field types |
| Validation | Validate ID format (CUID) |
| Validation | Validate ID format (ULID) with idMode (v1.2.0) |
| Validation | Validate ID format (UUID) with idMode (v1.2.0) |
| Validation | Validate with custom ID validator (v1.2.0) |
| Validation | Validate date format |
| Validation | Validate generation formats (F1, G1, numeric) (v1.2.0) |
| Type Alias | Register and resolve custom alias (v1.2.0) |
| Type Alias | Built-in aliases (LIQUID_CULTURE → CULTURE) (v1.2.0) |
| Type Mapping | mapToWolsType finds correct type (v1.2.0) |
| Type Mapping | mapFromWolsType returns platform types (v1.2.0) |
| Generation | normalizeGeneration converts formats (v1.2.0) |
| Generation | isValidGeneration accepts valid patterns (v1.2.0) |
| Environment | Detect runtime environment (v1.2.0) |
| Environment | Detect crypto support (v1.2.0) |
| Migration | compareVersions returns correct order (v1.2.0) |
| Migration | isOutdated detects old versions (v1.2.0) |
| Migration | migrate applies registered handlers (v1.2.0) |
| QR | Generate embedded format QR |
| QR | Generate compact format QR |
| QR | Parse QR code image |
| Crypto | Encrypt and decrypt specimen |
| Crypto | Partial field encryption |
| Compat | TS-generated, Python-parsed |
| Compat | Python-generated, TS-parsed |

---

## Release & Versioning

### Version Alignment

Library versions MUST align with WOLS specification versions:

| Spec Version | Library Version      | Notes            |
|--------------|----------------------|------------------|
| WOLS 1.0.0   | `@wemush/wols@1.0.x` | Initial release  |
| WOLS 1.1.0   | `@wemush/wols@1.1.x` | JSON-LD format   |
| WOLS 1.2.0   | `@wemush/wols@1.2.x` | Integration enhancements |

### Release Process

1. Update spec version in code constants
2. Run full test suite
3. Update CHANGELOG.md
4. Create GitHub release with immutable tag
5. Publish to npm/PyPI
6. Update documentation site

### GitHub Releases Format

```markdown
## v1.1.0 - January 4, 2026

### 🚀 Features
- JSON-LD format support with `@context` and `@type` fields
- Structured `strain` object with `name`, `generation`, `lineage`
- ID prefix `wols:` for namespace clarity

### 📦 Breaking Changes
- None (backwards compatible with v1.0.x parsers)

### 🐛 Bug Fixes
- (none in this release)

### 📚 Documentation
- Updated specification document
- Added JSON-LD examples

### 🔗 Links
- [Specification](https://wemush.com/open-standard/specification)
- [npm package](https://www.npmjs.com/package/@wemush/wols)
- [PyPI package](https://pypi.org/project/wemush-wols/)
```

---

## Appendix: Species Codes (Compact Format)

|Code|Species|
|----|---|
|POSTR|Pleurotus ostreatus|
|PCITRI|Pleurotus citrinopileatus|
|PDJAR|Pleurotus djamor|
|PERYN|Pleurotus eryngii|
|HERIN|Hericium erinaceus|
|GLUCI|Ganoderma lucidum|
|LPUDE|Laetiporus pudens|
|LLENC|Lentinula edodes|
|APOLY|Agrocybe polyphylla|
|STRUG|Stropharia rugosoannulata|

Additional codes can be registered at [github.com/wemush/open-standard](https://github.com/wemush/open-standard).

---

## Contact

**Maintainer**: WeMush Foundation
**Email**: [developers@wemush.com](mailto:developers@wemush.com)
**GitHub**: [github.com/wemush](https://github.com/wemush)
