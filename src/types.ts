/**
 * WOLS TypeScript Library - Core Types
 *
 * This module defines all the core types, interfaces, and enums
 * for the WeMush Open Labeling Standard (WOLS) v1.2.0.
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
export const WOLS_VERSION = '1.2.0';

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
  ['PRIMORDIA', 'FRUITING'], // Scientifically precise term for pin initiation stage
  ['FRUIT', 'FRUITING'],
  ['FIRST_FLUSH', 'FRUITING'],
  // Harvest aliases
  ['FRESH', 'HARVEST'],
  ['DRIED', 'HARVEST'],
  ['PROCESSED', 'HARVEST'],
  ['EXTRACT', 'HARVEST'],
]);

/**
 * Register a custom type alias.
 *
 * @param alias - The alias string (case-insensitive, stored uppercase)
 * @param wolsType - The canonical WOLS SpecimenType
 *
 * @example
 * ```typescript
 * registerTypeAlias('MYCELIUM_BLOCK', 'SUBSTRATE');
 * ```
 */
export function registerTypeAlias(alias: string, wolsType: SpecimenType): void {
  TYPE_ALIAS_REGISTRY.set(alias.toUpperCase(), wolsType);
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
  /** Subculture/clone count (1, 2, 3...) */
  clonalGeneration?: number;
  /** Parent specimen ID reference */
  lineage?: string;
  /** Origin: "spore", "tissue", "agar", "liquid" */
  source?: string;
}

/**
 * Primary specimen entity following WOLS v1.1.0 JSON-LD schema.
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
  /** Cultivation stage type (accepts aliases like 'LIQUID_CULTURE' -> 'CULTURE') */
  type: SpecimenType | string;
  /** Scientific species name */
  species: string;
  /** String shorthand expands to { name: string } */
  strain?: string | Strain;
  /** Current growth stage */
  stage?: GrowthStage;
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
export type IdValidationMode = 'strict' | 'ulid' | 'uuid' | 'any';

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
   * ID format validation mode.
   *
   * - 'strict': ID must match `wemush:[a-z0-9]+` (default)
   * - 'ulid': ID must be a valid ULID after wemush: prefix
   * - 'uuid': ID must be a valid UUID v4 after wemush: prefix
   * - 'any': Any non-empty string after wemush: prefix
   *
   * @since 1.2.0
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

// TODO(wols-spec): These encryption types should be formally documented in the
// upstream WOLS specification (wemush/open-standard/SPECIFICATION.md) in v1.2.1+.
// See src/crypto/encrypt.ts module doc for full list of spec updates needed.

/**
 * Encryption options.
 *
 * @since 1.2.0 Added `iterations` option for configurable PBKDF2 strength
 */
export interface EncryptionOptions {
  /** CryptoKey or password string for PBKDF2 */
  key: CryptoKey | string;
  /** Fields to encrypt (partial encryption) */
  fields?: string[];
  /**
   * PBKDF2 iteration count for password-based key derivation.
   *
   * Higher values increase security but slow down encryption/decryption.
   * Ignored when `key` is a CryptoKey (already derived).
   *
   * - Default: 100000 (100k)
   * - Minimum: 10000 (10k) - lower values will throw an error
   * - Recommended: 100000-600000 depending on performance requirements
   *
   * @since 1.2.0
   */
  iterations?: number;
}

/**
 * Encrypted specimen wrapper.
 *
 * @since 1.2.0 Added `cryptoVersion` and `iterations` fields for migration support
 */
export interface EncryptedSpecimen {
  /** Flag indicating this is encrypted */
  encrypted: true;
  /** Base64url encoded ciphertext */
  payload: string;
  /** Base64url encoded initialization vector */
  iv: string;
  /** Encryption algorithm used */
  algorithm: 'AES-256-GCM';
  /** Authentication tag (for GCM) */
  tag?: string;
  /**
   * Crypto schema version for forward-compatible migrations.
   * Allows future versions to change key derivation while maintaining
   * backward compatibility for decryption.
   *
   * @since 1.2.0
   */
  cryptoVersion?: 'v1';
  /**
   * PBKDF2 iteration count used during encryption.
   * Stored in payload for self-describing decryption (no need to guess).
   * If absent, defaults to 100000 for backward compatibility.
   *
   * @since 1.2.0
   */
  iterations?: number;
}

/**
 * Decryption options.
 */
export interface DecryptionOptions {
  /** CryptoKey or password string for PBKDF2 */
  key: CryptoKey | string;
}

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
