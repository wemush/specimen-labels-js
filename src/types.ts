/**
 * WOLS TypeScript Library - Core Types
 *
 * This module defines all the core types, interfaces, and enums
 * for the WeMush Open Labeling Standard (WOLS) v1.3.0.
 *
 * @packageDocumentation
 * @module @wemush/wols
 */

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * WOLS specification version implemented by this library.
 */
export const WOLS_VERSION = '1.3.0';

/**
 * JSON-LD context URL for WOLS specimens.
 */
export const WOLS_CONTEXT = 'https://wemush.com/wols/v1';

// =============================================================================
// BRANDED TYPES
// =============================================================================

/**
 * Branded type pattern for nominal typing.
 * Creates a compile-time unique type that is runtime-compatible with the base type.
 */
export type Brand<K, T> = K & { readonly __brand: T };

/**
 * Specimen ID type (format: "wemush:{cuid}").
 * This is a branded string type for type safety.
 */
export type SpecimenId = Brand<string, 'SpecimenId'>;

/**
 * Create a SpecimenId from a string.
 * Does not validate the format - use isValidSpecimenId for validation.
 */
export function asSpecimenId(id: string): SpecimenId {
  return id as SpecimenId;
}

// =============================================================================
// ENUMERATIONS
// =============================================================================

/**
 * Specimen type enum representing cultivation stages.
 */
export type SpecimenType = 'CULTURE' | 'SPAWN' | 'SUBSTRATE' | 'FRUITING' | 'HARVEST';

/**
 * Array of valid specimen types for validation.
 */
export const SPECIMEN_TYPES: readonly SpecimenType[] = [
  'CULTURE',
  'SPAWN',
  'SUBSTRATE',
  'FRUITING',
  'HARVEST',
] as const;

// =============================================================================
// TYPE ALIAS SYSTEM (v1.2.0)
// =============================================================================

/**
 * Type alias registry for mapping platform-specific types to WOLS types.
 * @internal
 */
const TYPE_ALIAS_REGISTRY: Map<string, SpecimenType> = new Map([
  // Culture aliases
  ['LIQUID_CULTURE', 'CULTURE'],
  ['LC', 'CULTURE'],
  ['AGAR', 'CULTURE'],
  ['PETRI', 'CULTURE'],
  ['SLANT', 'CULTURE'],
  ['CULTURE_PLATE', 'CULTURE'],
  // Spawn aliases
  ['GRAIN_SPAWN', 'SPAWN'],
  ['SAWDUST_SPAWN', 'SPAWN'],
  ['PLUG_SPAWN', 'SPAWN'],
  ['DOWEL', 'SPAWN'],
  // Substrate aliases
  ['BLOCK', 'SUBSTRATE'],
  ['BAG', 'SUBSTRATE'],
  ['BED', 'SUBSTRATE'],
  ['LOG', 'SUBSTRATE'],
  ['BUCKET', 'SUBSTRATE'],
  // Fruiting aliases
  ['FLUSH', 'FRUITING'],
  ['PINNING', 'FRUITING'],
  // PRIMORDIA is a reserved alias (v1.3.0): it resolves to FRUITING, and
  // createSpecimen() additionally sets stage PRIMORDIA. See PRIMORDIA_TYPE_ALIAS.
  ['PRIMORDIA', 'FRUITING'],
  ['FRUIT', 'FRUITING'],
  ['FIRST_FLUSH', 'FRUITING'],
  // Harvest aliases
  ['FRESH', 'HARVEST'],
  ['DRIED', 'HARVEST'],
  ['PROCESSED', 'HARVEST'],
  ['EXTRACT', 'HARVEST'],
]);

/**
 * Reserved type alias with special handling (WOLS v1.3.0).
 *
 * `PRIMORDIA` is a GrowthStage, not a SpecimenType. When it is supplied as a
 * type, it resolves to `FRUITING` and `createSpecimen()` sets
 * `stage: 'PRIMORDIA'` unless a stage was supplied.
 *
 * @since 1.3.0
 */
export const PRIMORDIA_TYPE_ALIAS = 'PRIMORDIA';

/**
 * Register a custom type alias.
 *
 * @param alias - The alias string (case-insensitive, stored uppercase)
 * @param wolsType - The canonical WOLS SpecimenType
 * @throws Error if `alias` is the reserved `PRIMORDIA` alias
 *
 * @example
 * ```typescript
 * registerTypeAlias('MYCELIUM_BLOCK', 'SUBSTRATE');
 * ```
 */
export function registerTypeAlias(alias: string, wolsType: SpecimenType): void {
  const upper = alias.toUpperCase();
  if (upper === PRIMORDIA_TYPE_ALIAS && wolsType !== 'FRUITING') {
    throw new Error(
      `'${PRIMORDIA_TYPE_ALIAS}' is a reserved alias for FRUITING and cannot be remapped`
    );
  }
  TYPE_ALIAS_REGISTRY.set(upper, wolsType);
}

/**
 * Resolve a type alias to its canonical WOLS type.
 * Returns the input if it's already a valid SpecimenType or no alias exists.
 *
 * @param typeOrAlias - Type string or alias to resolve
 * @returns Canonical SpecimenType or original string if not found
 *
 * @example
 * ```typescript
 * resolveTypeAlias('LIQUID_CULTURE') // Returns 'CULTURE'
 * resolveTypeAlias('CULTURE')        // Returns 'CULTURE'
 * resolveTypeAlias('unknown')        // Returns 'unknown'
 * ```
 */
export function resolveTypeAlias(typeOrAlias: string): SpecimenType | string {
  const upper = typeOrAlias.toUpperCase();

  // Already a valid type?
  if (SPECIMEN_TYPES.includes(upper as SpecimenType)) {
    return upper as SpecimenType;
  }

  // Check alias registry
  const resolved = TYPE_ALIAS_REGISTRY.get(upper);
  return resolved ?? typeOrAlias;
}

/**
 * Get all registered type aliases.
 *
 * @returns ReadonlyMap of alias -> SpecimenType mappings
 */
export function getTypeAliases(): ReadonlyMap<string, SpecimenType> {
  return TYPE_ALIAS_REGISTRY;
}

// =============================================================================
// TYPE MAPPING EXPORTS (v1.2.0)
// =============================================================================

/**
 * Mapping from WOLS types to common platform type names.
 *
 * This provides a centralized lookup for integrations that need to
 * display user-friendly type names or map to platform-specific values.
 *
 * @since 1.2.0
 */
export const WOLS_TO_PLATFORM_MAP: Readonly<Record<SpecimenType, readonly string[]>> = {
  CULTURE: ['Liquid Culture', 'LC', 'Agar', 'Petri', 'Slant', 'Culture Plate'],
  SPAWN: ['Grain Spawn', 'Sawdust Spawn', 'Plug Spawn', 'Dowel'],
  SUBSTRATE: ['Block', 'Bag', 'Bed', 'Log', 'Bucket'],
  FRUITING: ['Pinning', 'Primordia', 'Fruiting', 'Flush', 'First Flush'],
  HARVEST: ['Fresh', 'Dried', 'Processed', 'Extract'],
};

/**
 * Map a platform-specific type to a WOLS SpecimenType.
 *
 * First checks registered aliases, then falls back to direct lookup.
 *
 * @param platformType - Platform-specific type name
 * @returns Matching SpecimenType or null if not found
 *
 * @example
 * ```typescript
 * mapToWolsType('Liquid Culture') // Returns 'CULTURE'
 * mapToWolsType('LC')             // Returns 'CULTURE'
 * mapToWolsType('Unknown Type')   // Returns null
 * ```
 *
 * @since 1.2.0
 */
export function mapToWolsType(platformType: string): SpecimenType | null {
  // First try the alias registry
  const resolved = resolveTypeAlias(platformType);
  if (isSpecimenType(resolved)) {
    return resolved;
  }

  // Fall back to searching WOLS_TO_PLATFORM_MAP
  const normalized = platformType.toUpperCase().replace(/\s+/g, '_');
  for (const [wolsType, platformTypes] of Object.entries(WOLS_TO_PLATFORM_MAP)) {
    for (const pt of platformTypes) {
      if (pt.toUpperCase().replace(/\s+/g, '_') === normalized) {
        return wolsType as SpecimenType;
      }
    }
  }

  return null;
}

/**
 * Get all platform type names for a WOLS SpecimenType.
 *
 * @param wolsType - WOLS SpecimenType
 * @returns Array of platform type names
 *
 * @example
 * ```typescript
 * mapFromWolsType('CULTURE')
 * // Returns ['Liquid Culture', 'LC', 'Agar', 'Petri', 'Slant', 'Culture Plate']
 * ```
 *
 * @since 1.2.0
 */
export function mapFromWolsType(wolsType: SpecimenType): readonly string[] {
  return WOLS_TO_PLATFORM_MAP[wolsType] ?? [];
}

/**
 * Register a custom platform type mapping.
 *
 * This adds to both the alias registry (for resolveTypeAlias) and
 * can be used for custom platform integrations.
 *
 * @param platformType - Platform-specific type name
 * @param wolsType - WOLS SpecimenType to map to
 *
 * @example
 * ```typescript
 * registerPlatformType('Mycelium Block', 'SUBSTRATE');
 * mapToWolsType('Mycelium Block') // Returns 'SUBSTRATE'
 * ```
 *
 * @since 1.2.0
 */
export function registerPlatformType(platformType: string, wolsType: SpecimenType): void {
  // Add to alias registry for resolveTypeAlias support
  registerTypeAlias(platformType, wolsType);
}

/**
 * Growth stage enum representing specimen lifecycle.
 *
 * v1.2.0 introduces research-grade lifecycle tracking with 7 stages:
 * - INOCULATION: Initial introduction of spawn/culture to substrate
 * - INCUBATION: Post-inoculation rest period before visible growth (v1.2.0)
 * - COLONIZATION: Active mycelial growth through substrate
 * - PRIMORDIA: Pin initiation and early fruit body formation (v1.2.0)
 * - FRUITING: Active fruit body development and maturation
 * - SENESCENCE: Declining productivity, end-of-life phase (v1.2.0)
 * - HARVEST: Mushrooms harvested and processed
 */
export type GrowthStage =
  | 'INOCULATION'
  | 'INCUBATION'
  | 'COLONIZATION'
  | 'PRIMORDIA'
  | 'FRUITING'
  | 'SENESCENCE'
  | 'HARVEST';

/**
 * Array of valid growth stages for validation.
 * Ordered by typical lifecycle progression.
 */
export const GROWTH_STAGES: readonly GrowthStage[] = [
  'INOCULATION',
  'INCUBATION',
  'COLONIZATION',
  'PRIMORDIA',
  'FRUITING',
  'SENESCENCE',
  'HARVEST',
] as const;

// =============================================================================
// GENERATION FORMAT SYSTEM (v1.2.0)
// =============================================================================

/**
 * Output format for generation normalization.
 *
 * - 'preserve': Keep original format
 * - 'filial': Normalize to F{n} format (F1, F2, etc.)
 * - 'numeric': Normalize to numeric format (1, 2, etc.)
 *
 * @since 1.2.0
 */
export type GenerationFormat = 'preserve' | 'filial' | 'numeric';

/**
 * Pattern for parsing generation strings.
 * Matches: P, P1, F{n}, G{n}, or plain numbers.
 */
const GENERATION_PARSE_PATTERN = /^(P|P1|F(\d+)|G(\d+)|(\d+))$/i;

/**
 * Normalize a generation string to the specified format.
 *
 * Accepts multiple input formats:
 * - Filial: F1, F2, F3, etc.
 * - Parental: P or P1
 * - Generational: G1, G2, G3, etc.
 * - Numeric: 1, 2, 3, etc.
 *
 * @param generation - The generation string to normalize
 * @param format - Target format (default: 'preserve')
 * @returns Normalized generation string, or original if not parseable
 *
 * @example
 * ```typescript
 * normalizeGeneration('G2', 'filial')  // Returns 'F2'
 * normalizeGeneration('3', 'filial')   // Returns 'F3'
 * normalizeGeneration('F1', 'numeric') // Returns '1'
 * normalizeGeneration('P', 'filial')   // Returns 'P'
 * ```
 *
 * @since 1.2.0
 */
export function normalizeGeneration(
  generation: string,
  format: GenerationFormat = 'preserve'
): string {
  const trimmed = generation.trim().toUpperCase();

  // Handle parental generation specially
  if (trimmed === 'P' || trimmed === 'P1') {
    return format === 'numeric' ? '0' : 'P';
  }

  const match = GENERATION_PARSE_PATTERN.exec(trimmed);
  if (!match) {
    return generation; // Return original if not parseable
  }

  // Extract the numeric value
  let numericValue: number;
  if (match[2] !== undefined) {
    // F{n} format
    numericValue = parseInt(match[2], 10);
  } else if (match[3] !== undefined) {
    // G{n} format
    numericValue = parseInt(match[3], 10);
  } else if (match[4] !== undefined) {
    // Plain number
    numericValue = parseInt(match[4], 10);
  } else {
    return generation; // Shouldn't reach here
  }

  switch (format) {
    case 'preserve':
      return trimmed;
    case 'filial':
      return `F${numericValue}`;
    case 'numeric':
      return String(numericValue);
    default:
      return generation;
  }
}

/**
 * Check if a generation string is valid.
 *
 * @param generation - The generation string to validate
 * @returns True if valid, false otherwise
 *
 * @since 1.2.0
 */
export function isValidGeneration(generation: string): boolean {
  const trimmed = generation.trim().toUpperCase();
  return GENERATION_PARSE_PATTERN.test(trimmed);
}

// =============================================================================
// CORE INTERFACES
// =============================================================================

/**
 * Metadata for specimen round-trip preservation.
 *
 * The `_meta` namespace is reserved for implementation-specific metadata
 * that should be preserved through import/export operations but is not
 * part of the core WOLS specification.
 *
 * @since 1.2.0
 */
export interface SpecimenMeta {
  /** Original ID from source system before WOLS normalization */
  sourceId?: string;
  /** ISO 8601 timestamp when specimen was imported */
  importedAt?: string;
  /** Identifier of the source system (e.g., "wemush-platform", "mycology-db") */
  sourceSystem?: string;
  /** Schema version used by source system */
  schemaVersion?: string;
  /** Extensible: additional implementation-specific fields */
  [key: string]: unknown;
}

/**
 * Strain information for a specimen.
 */
export interface Strain {
  /** Strain name or identifier */
  name: string;
  /** Filial generation (e.g., "F1", "F2", "P") */
  generation?: string;
  /**
   * Culture-to-culture subculture count. The original culture is `0`.
   * Expansion to grain or substrate does not increment it.
   */
  clonalGeneration?: number;
  /**
   * Total transfers of any kind from the original culture of this strain
   * (subculture, culture to grain, grain to grain, grain to substrate).
   * The original culture is `0`. Non-negative integer; SHOULD be at least
   * `clonalGeneration` when both are present.
   *
   * @since 1.3.0
   */
  transferDepth?: number;
  /** Parent specimen ID reference */
  lineage?: string;
  /** Origin: "spore", "tissue", "agar", "liquid" */
  source?: string;
}

/**
 * Primary specimen entity following the WOLS v1.3.0 JSON-LD schema.
 */
export interface Specimen {
  /** JSON-LD context URL */
  '@context': typeof WOLS_CONTEXT;
  /** JSON-LD entity type */
  '@type': 'Specimen';
  /** Unique specimen ID (format: wemush:{cuid}) */
  id: SpecimenId;
  /** WOLS specification version */
  version: string;
  /** Cultivation stage type */
  type: SpecimenType;
  /** Scientific species name */
  species: string;
  /** Strain/genetic information */
  strain?: Strain;
  /** Current growth stage */
  stage?: GrowthStage;
  /** Creation timestamp (ISO 8601) */
  created?: string;
  /** Batch identifier */
  batch?: string;
  /** Organization ID */
  organization?: string;
  /** Creator user ID */
  creator?: string;
  /** Custom vendor-specific fields */
  custom?: Record<string, unknown>;
  /** Cryptographic signature */
  signature?: string;
  /**
   * Implementation metadata (preserved through operations).
   * @since 1.2.0
   */
  _meta?: SpecimenMeta;
}

// =============================================================================
// INPUT TYPES
// =============================================================================

/**
 * Input type for createSpecimen().
 * Strain can be a string (auto-expanded) or full Strain object.
 * Type accepts aliases (e.g., 'LIQUID_CULTURE' -> 'CULTURE') via resolveTypeAlias().
 */
export interface SpecimenInput {
  /**
   * Cultivation stage type. Accepts aliases case-insensitively
   * (e.g. 'LIQUID_CULTURE' -> 'CULTURE'). `PRIMORDIA` resolves to `FRUITING`
   * and sets `stage: 'PRIMORDIA'` when no stage is supplied (v1.3.0).
   */
  type: SpecimenType | string;
  /** Scientific species name */
  species: string;
  /** String shorthand expands to { name: string } */
  strain?: string | Strain;
  /** Current growth stage */
  stage?: GrowthStage;
  /**
   * Creation timestamp (ISO 8601 string, or a Date converted with toISOString()).
   * Omitted from the specimen when not supplied.
   *
   * @since 1.3.0
   */
  created?: string | Date;
  /** Batch identifier */
  batch?: string;
  /** Organization ID */
  organization?: string;
  /** Creator user ID */
  creator?: string;
  /** Custom vendor-specific fields */
  custom?: Record<string, unknown>;
  /**
   * Implementation metadata (preserved through operations).
   * @since 1.2.0
   */
  _meta?: SpecimenMeta;
}

/**
 * Options for createSpecimen().
 *
 * @since 1.3.0
 */
export interface CreateSpecimenOptions {
  /**
   * Receives non-fatal warnings raised while creating the specimen, such as
   * `PRIMORDIA` supplied as a type. When omitted, warnings go to console.warn.
   */
  onWarning?: (warning: ValidationWarning) => void;
}

// =============================================================================
// RESULT TYPES
// =============================================================================

/**
 * Import error types for use in ParseResult.
 * Circular dependency avoided by using forward reference.
 */
import type { WolsError } from './errors.js';

/**
 * Parse result discriminated union.
 * @template T The type of data on success
 */
export type ParseResult<T> = { success: true; data: T } | { success: false; error: WolsError };

/**
 * Validation error detail.
 */
export interface ValidationError {
  /** JSON path to invalid field (e.g., "strain.name") */
  path: string;
  /** Stable error code */
  code: string;
  /** Human-readable error message */
  message: string;
}

/**
 * Validation warning detail.
 */
export interface ValidationWarning {
  /** JSON path to field */
  path: string;
  /** Warning code */
  code: string;
  /** Human-readable warning message */
  message: string;
  /** Suggested fix */
  suggestion?: string;
}

/**
 * Validation result with errors and warnings.
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Validation errors (causes valid: false) */
  errors: ValidationError[];
  /** Validation warnings (informational) */
  warnings: ValidationWarning[];
}

// =============================================================================
// ID VALIDATION OPTIONS (v1.2.0)
// =============================================================================

/**
 * ID validation mode for flexible ID format support.
 *
 * @since 1.2.0
 */
export type IdValidationMode = 'any' | 'strict' | 'ulid' | 'uuid';

/**
 * Custom ID validator function signature.
 *
 * @since 1.2.0
 */
export type IdValidator = (id: string) => boolean;

/**
 * Validation options.
 */
export interface ValidationOptions {
  /** Allow unknown fields in custom namespace */
  allowUnknownFields?: boolean;
  /** Validation strictness level */
  level?: 'strict' | 'lenient';
  /**
   * ID format validation mode. Every mode requires the `wemush:` prefix.
   *
   * - 'any': any non-empty suffix after `wemush:` (default; required by WOLS)
   * - 'strict': opt-in CUID-style check, suffix must match `[a-z0-9]+`
   * - 'ulid': opt-in check, suffix must be a valid ULID
   * - 'uuid': opt-in check, suffix must be a valid UUID
   *
   * @since 1.2.0
   * @since 1.3.0 Default changed from 'strict' to 'any'
   */
  idMode?: IdValidationMode;
  /**
   * Custom ID validator function.
   * If provided, overrides idMode.
   *
   * @since 1.2.0
   */
  customIdValidator?: IdValidator;
}

// =============================================================================
// COMPACT URL TYPES
// =============================================================================

/**
 * Reference data extracted from a compact URL.
 *
 * Contains the minimal information encoded in the compact format.
 * Full specimen data must be retrieved via API lookup using the id.
 */
export interface SpecimenRef {
  /** Full specimen ID with wemush: prefix */
  id: string;
  /** Species name (resolved from code if known) */
  species: string;
  /** Specimen type (CULTURE, SPAWN, etc.) */
  type?: SpecimenType;
  /** Growth stage */
  stage?: GrowthStage;
  /** Unix timestamp of creation */
  timestamp?: number;
  /** Batch identifier */
  batch?: string;
  /** Strain information */
  strain?: {
    name: string;
    generation?: string;
  };
  /** Version (from URL path) */
  version: string;
}

// =============================================================================
// QR CODE TYPES
// =============================================================================

/**
 * QR code generation options.
 */
export interface QRCodeOptions {
  /** Width/height in pixels (default: 300) */
  size?: number;
  /** Error correction level (default: 'M') */
  errorCorrection?: 'L' | 'M' | 'Q' | 'H';
  /** Encoding format (default: 'embedded') */
  format?: 'embedded' | 'compact';
  /** Quiet zone modules (default: 1) */
  margin?: number;
  /** QR code colors */
  color?: {
    dark?: string;
    light?: string;
  };
}

// =============================================================================
// ENCRYPTION TYPES
// =============================================================================

/**
 * Key derivation function recorded in an encrypted label (WOLS v1.3.0).
 *
 * - 'pbkdf2': key derived from a passphrase with PBKDF2-HMAC-SHA256 and a per-label salt
 * - 'raw': a 32-byte AES-256 key shared out of band
 *
 * @since 1.3.0
 */
export type EncryptionKdf = 'pbkdf2' | 'raw';

/**
 * Raw AES-256 key material: 32 bytes, or an AES-GCM CryptoKey of length 256.
 * Selects `kdf=raw`.
 *
 * @since 1.3.0
 */
export type RawEncryptionKey = Uint8Array | ArrayBuffer | CryptoKey;

/**
 * Encryption options.
 *
 * A passphrase string selects `kdf=pbkdf2` (fresh random 16-byte salt per label).
 * Raw key bytes or a CryptoKey select `kdf=raw`.
 *
 * @since 1.2.0 Added `iterations` option for configurable PBKDF2 strength
 * @since 1.3.0 Raw key bytes accepted; per-label random salt; minimum 100,000 iterations
 */
export interface EncryptionOptions {
  /** Passphrase (kdf=pbkdf2) or raw 32-byte key / AES-GCM CryptoKey (kdf=raw) */
  key: string | RawEncryptionKey;
  /** Fields to encrypt in place (field-level encryption) instead of the whole specimen */
  fields?: string[];
  /**
   * PBKDF2 iteration count for passphrase keys. Ignored for raw keys.
   *
   * - Default: 100000
   * - Minimum when generating: 100000 (WOLS v1.3.0); lower values throw
   *
   * @since 1.2.0
   */
  iterations?: number;
}

/**
 * Field-level encrypted value (WOLS v1.3.0). Replaces the value of an
 * encrypted field inside an embedded label. The plaintext is the UTF-8 JSON
 * serialization of the original field value.
 *
 * @since 1.3.0
 */
export interface EncryptedField {
  encrypted: true;
  algorithm: 'AES-256-GCM';
  /** Ciphertext with the 16-byte GCM tag appended, base64url without padding */
  payload: string;
  /** 12-byte IV, base64url without padding */
  iv: string;
  kdf: EncryptionKdf;
  /** PBKDF2 salt, base64url without padding (kdf=pbkdf2 only) */
  salt?: string;
  /** PBKDF2 iteration count (kdf=pbkdf2 only) */
  iterations?: number;
}

/**
 * Encrypted specimen.
 *
 * Objects produced by v1.3.0 always carry `kdf`, `id` and `url`; `url` is the
 * `wemush://v1/encrypted/{id}?e=&iv=&kdf=...` wire format to put in a QR code.
 * Objects without `kdf` are legacy (pre-1.3.0) and decrypt only with
 * `allowLegacy: true`.
 *
 * @since 1.2.0 Added `cryptoVersion` and `iterations` fields for migration support
 * @since 1.3.0 Added `kdf`, `salt`, `id`, `url` and `signature`
 */
export interface EncryptedSpecimen {
  /** Flag indicating this is encrypted */
  encrypted: true;
  /** Ciphertext with the 16-byte GCM tag appended, base64url without padding */
  payload: string;
  /** 12-byte IV, base64url without padding */
  iv: string;
  /** Encryption algorithm used */
  algorithm: 'AES-256-GCM';
  /**
   * Key derivation function. Absent only on legacy (pre-1.3.0) payloads.
   * @since 1.3.0
   */
  kdf?: EncryptionKdf;
  /**
   * PBKDF2 salt, base64url without padding (kdf=pbkdf2 only).
   * @since 1.3.0
   */
  salt?: string;
  /** PBKDF2 iteration count (kdf=pbkdf2, or legacy payloads) */
  iterations?: number;
  /**
   * Full specimen ID (`wemush:...`). Cleartext; must match the decrypted specimen.
   * @since 1.3.0
   */
  id?: string;
  /**
   * Encrypted-format URL for QR encoding.
   * @since 1.3.0
   */
  url?: string;
  /**
   * Detached `sig` parameter from an encrypted URL. Preserved, not verified.
   * @since 1.3.0
   */
  signature?: string;
  /** @deprecated Unused; the GCM tag is appended to `payload`. */
  tag?: string;
  /** @deprecated Legacy (pre-1.3.0) crypto schema marker. */
  cryptoVersion?: 'v1';
}

/**
 * Decryption options.
 *
 * @since 1.3.0 Raw key bytes accepted; `allowLegacy` added
 */
export interface DecryptionOptions {
  /** Passphrase (kdf=pbkdf2) or raw 32-byte key / AES-GCM CryptoKey (kdf=raw) */
  key: string | RawEncryptionKey;
  /**
   * Decrypt legacy payloads that have no `kdf` (pre-1.3.0, fixed library salt).
   * Off by default. Legacy payloads are never generated.
   *
   * @since 1.3.0
   */
  allowLegacy?: boolean;
}

/**
 * Category of a decryption failure, available as `error.details.reason`.
 *
 * @since 1.3.0
 */
export type DecryptionFailureReason =
  | 'invalid-url'
  | 'missing-parameter'
  | 'invalid-parameter'
  | 'unexpected-parameter'
  | 'unsupported-kdf'
  | 'insufficient-iterations'
  | 'invalid-key'
  | 'legacy-format'
  | 'authentication-failed'
  | 'invalid-plaintext'
  | 'id-mismatch';

// =============================================================================
// TYPE GUARDS
// =============================================================================

/**
 * Type guard to check if a value is a valid SpecimenType.
 */
export function isSpecimenType(value: unknown): value is SpecimenType {
  return typeof value === 'string' && SPECIMEN_TYPES.includes(value as SpecimenType);
}

/**
 * Type guard to check if a value is a valid GrowthStage.
 */
export function isGrowthStage(value: unknown): value is GrowthStage {
  return typeof value === 'string' && GROWTH_STAGES.includes(value as GrowthStage);
}

/**
 * Type guard to check if a value is a Strain object.
 */
export function isStrain(value: unknown): value is Strain {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof (value as Strain).name === 'string'
  );
}
