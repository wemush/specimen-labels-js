/**
 * WOLS TypeScript Library - Core Types
 *
 * This module defines all the core types, interfaces, and enums
 * for the WeMush Open Labeling Standard (WOLS) v1.1.0.
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
export const WOLS_VERSION = '1.1.0';

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

/**
 * Growth stage enum representing specimen lifecycle.
 */
export type GrowthStage = 'INOCULATION' | 'COLONIZATION' | 'FRUITING' | 'HARVEST';

/**
 * Array of valid growth stages for validation.
 */
export const GROWTH_STAGES: readonly GrowthStage[] = [
  'INOCULATION',
  'COLONIZATION',
  'FRUITING',
  'HARVEST',
] as const;

// =============================================================================
// CORE INTERFACES
// =============================================================================

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
}

// =============================================================================
// INPUT TYPES
// =============================================================================

/**
 * Input type for createSpecimen().
 * Strain can be a string (auto-expanded) or full Strain object.
 */
export interface SpecimenInput {
  /** Cultivation stage type */
  type: SpecimenType;
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

/**
 * Validation options.
 */
export interface ValidationOptions {
  /** Allow unknown fields in custom namespace */
  allowUnknownFields?: boolean;
  /** Validation strictness level */
  level?: 'strict' | 'lenient';
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
 * Encryption options.
 */
export interface EncryptionOptions {
  /** CryptoKey or password string for PBKDF2 */
  key: CryptoKey | string;
  /** Fields to encrypt (partial encryption) */
  fields?: string[];
}

/**
 * Encrypted specimen wrapper.
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
