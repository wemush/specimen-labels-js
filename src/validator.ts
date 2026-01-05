/**
 * WOLS Specimen Validator
 *
 * This module provides validation functionality for WOLS specimen objects.
 *
 * @module validator
 */

import { WolsErrorCode } from './errors.js';
import {
  isGrowthStage,
  isSpecimenType,
  type Specimen,
  type Strain,
  type ValidationError,
  type ValidationOptions,
  type ValidationResult,
  type ValidationWarning,
  WOLS_CONTEXT,
} from './types.js';
import { isValidISO8601 } from './utils/iso8601.js';

// =============================================================================
// VALIDATION PATTERNS
// =============================================================================

/**
 * Pattern for valid specimen ID: wemush:[a-z0-9]+
 */
const SPECIMEN_ID_PATTERN = /^wemush:[a-z0-9]+$/;

/**
 * Pattern for valid semver version: major.minor.patch
 */
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * Pattern for valid strain generation: P, F1, F2, F3, etc.
 */
const GENERATION_PATTERN = /^(P|F\d+)$/;

/**
 * Known WOLS specimen fields (for unknown field detection).
 */
const KNOWN_FIELDS = new Set([
  '@context',
  '@type',
  'id',
  'version',
  'type',
  'species',
  'strain',
  'stage',
  'created',
  'batch',
  'organization',
  'creator',
  'custom',
  'signature',
]);

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Create a validation error.
 */
function error(path: string, code: WolsErrorCode | string, message: string): ValidationError {
  return { path, code, message };
}

/**
 * Create a validation warning.
 */
function warning(
  path: string,
  code: string,
  message: string,
  suggestion?: string
): ValidationWarning {
  const result: ValidationWarning = { path, code, message };
  if (suggestion !== undefined) {
    result.suggestion = suggestion;
  }
  return result;
}

/**
 * Check if a value is a non-empty string.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Check if a value is a plain object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// =============================================================================
// FIELD VALIDATORS
// =============================================================================

/**
 * Validate @context field.
 */
function validateContext(
  value: unknown,
  errors: ValidationError[],
  _options: ValidationOptions
): void {
  if (value === undefined || value === null) {
    errors.push(error('@context', WolsErrorCode.INVALID_CONTEXT, '@context is required'));
    return;
  }

  if (value !== WOLS_CONTEXT) {
    errors.push(
      error(
        '@context',
        WolsErrorCode.INVALID_CONTEXT,
        `@context must be '${WOLS_CONTEXT}', got '${value}'`
      )
    );
  }
}

/**
 * Validate @type field.
 */
function validateType(
  value: unknown,
  errors: ValidationError[],
  _options: ValidationOptions
): void {
  if (value === undefined || value === null) {
    errors.push(error('@type', WolsErrorCode.INVALID_TYPE, '@type is required'));
    return;
  }

  if (value !== 'Specimen') {
    errors.push(
      error('@type', WolsErrorCode.INVALID_TYPE, `@type must be 'Specimen', got '${value}'`)
    );
  }
}

/**
 * Validate id field.
 */
function validateId(value: unknown, errors: ValidationError[], _options: ValidationOptions): void {
  if (value === undefined || value === null) {
    errors.push(error('id', WolsErrorCode.REQUIRED_FIELD, 'id is required'));
    return;
  }

  if (typeof value !== 'string') {
    errors.push(error('id', WolsErrorCode.INVALID_ID_FORMAT, 'id must be a string'));
    return;
  }

  if (!SPECIMEN_ID_PATTERN.test(value)) {
    errors.push(
      error(
        'id',
        WolsErrorCode.INVALID_ID_FORMAT,
        `id must match pattern 'wemush:[a-z0-9]+', got '${value}'`
      )
    );
  }
}

/**
 * Validate version field.
 */
function validateVersion(
  value: unknown,
  errors: ValidationError[],
  _options: ValidationOptions
): void {
  if (value === undefined || value === null) {
    errors.push(error('version', WolsErrorCode.REQUIRED_FIELD, 'version is required'));
    return;
  }

  if (typeof value !== 'string') {
    errors.push(error('version', WolsErrorCode.INVALID_VERSION, 'version must be a string'));
    return;
  }

  if (!SEMVER_PATTERN.test(value)) {
    errors.push(
      error(
        'version',
        WolsErrorCode.INVALID_VERSION,
        `version must be valid semver (major.minor.patch), got '${value}'`
      )
    );
  }
}

/**
 * Validate specimen type field.
 */
function validateSpecimenType(
  value: unknown,
  errors: ValidationError[],
  _options: ValidationOptions
): void {
  if (value === undefined || value === null) {
    errors.push(error('type', WolsErrorCode.REQUIRED_FIELD, 'type is required'));
    return;
  }

  if (!isSpecimenType(value)) {
    errors.push(
      error(
        'type',
        WolsErrorCode.INVALID_SPECIMEN_TYPE,
        `type must be one of CULTURE, SPAWN, SUBSTRATE, FRUITING, HARVEST, got '${value}'`
      )
    );
  }
}

/**
 * Validate species field.
 */
function validateSpecies(
  value: unknown,
  errors: ValidationError[],
  _options: ValidationOptions
): void {
  if (value === undefined || value === null) {
    errors.push(error('species', WolsErrorCode.REQUIRED_FIELD, 'species is required'));
    return;
  }

  if (!isNonEmptyString(value)) {
    errors.push(
      error('species', WolsErrorCode.REQUIRED_FIELD, 'species must be a non-empty string')
    );
  }
}

/**
 * Validate optional stage field.
 */
function validateStage(
  value: unknown,
  errors: ValidationError[],
  warnings: ValidationWarning[],
  options: ValidationOptions
): void {
  if (value === undefined || value === null) {
    return; // Optional field
  }

  if (!isGrowthStage(value)) {
    if (options.level === 'lenient') {
      warnings.push(
        warning(
          'stage',
          'UNKNOWN_GROWTH_STAGE',
          `Unknown growth stage '${value}'`,
          'Use one of: INOCULATION, COLONIZATION, FRUITING, HARVEST'
        )
      );
    } else {
      errors.push(
        error(
          'stage',
          'INVALID_GROWTH_STAGE',
          `stage must be one of INOCULATION, COLONIZATION, FRUITING, HARVEST, got '${value}'`
        )
      );
    }
  }
}

/**
 * Validate optional created field.
 */
function validateCreated(
  value: unknown,
  errors: ValidationError[],
  warnings: ValidationWarning[],
  options: ValidationOptions
): void {
  if (value === undefined || value === null) {
    return; // Optional field
  }

  if (typeof value !== 'string') {
    errors.push(error('created', WolsErrorCode.INVALID_DATE_FORMAT, 'created must be a string'));
    return;
  }

  if (!isValidISO8601(value)) {
    if (options.level === 'lenient') {
      warnings.push(
        warning(
          'created',
          WolsErrorCode.INVALID_DATE_FORMAT,
          `Invalid ISO 8601 date format: '${value}'`,
          'Use format: YYYY-MM-DDTHH:mm:ssZ'
        )
      );
    } else {
      errors.push(
        error(
          'created',
          WolsErrorCode.INVALID_DATE_FORMAT,
          `created must be valid ISO 8601 datetime, got '${value}'`
        )
      );
    }
  }
}

/**
 * Validate strain object.
 */
function validateStrain(
  value: unknown,
  errors: ValidationError[],
  _options: ValidationOptions
): void {
  if (value === undefined || value === null) {
    return; // Optional field
  }

  if (!isPlainObject(value)) {
    errors.push(error('strain', WolsErrorCode.INVALID_FORMAT, 'strain must be an object'));
    return;
  }

  const strain = value as Partial<Strain>;

  // name is required in Strain
  if (!isNonEmptyString(strain.name)) {
    errors.push(error('strain.name', WolsErrorCode.REQUIRED_FIELD, 'strain.name is required'));
  }

  // Validate generation format if present
  if (strain.generation !== undefined) {
    if (typeof strain.generation !== 'string' || !GENERATION_PATTERN.test(strain.generation)) {
      errors.push(
        error(
          'strain.generation',
          WolsErrorCode.INVALID_GENERATION,
          `strain.generation must match pattern 'P' or 'F<number>', got '${strain.generation}'`
        )
      );
    }
  }

  // Validate clonalGeneration if present
  if (strain.clonalGeneration !== undefined) {
    if (
      typeof strain.clonalGeneration !== 'number' ||
      !Number.isInteger(strain.clonalGeneration) ||
      strain.clonalGeneration < 1
    ) {
      errors.push(
        error(
          'strain.clonalGeneration',
          WolsErrorCode.INVALID_FORMAT,
          'strain.clonalGeneration must be a positive integer'
        )
      );
    }
  }

  // Validate source if present (informational, no strict enum)
  if (strain.source !== undefined && typeof strain.source !== 'string') {
    errors.push(
      error('strain.source', WolsErrorCode.INVALID_FORMAT, 'strain.source must be a string')
    );
  }

  // Validate lineage if present
  if (strain.lineage !== undefined && typeof strain.lineage !== 'string') {
    errors.push(
      error('strain.lineage', WolsErrorCode.INVALID_FORMAT, 'strain.lineage must be a string')
    );
  }
}

/**
 * Check for unknown fields and add warnings.
 */
function checkUnknownFields(
  specimen: Record<string, unknown>,
  warnings: ValidationWarning[],
  options: ValidationOptions
): void {
  if (options.allowUnknownFields) {
    return;
  }

  for (const key of Object.keys(specimen)) {
    if (!KNOWN_FIELDS.has(key)) {
      warnings.push(
        warning(
          key,
          'UNKNOWN_FIELD',
          `Unknown field '${key}'`,
          'Unknown fields should be placed in the custom object'
        )
      );
    }
  }
}

// =============================================================================
// MAIN VALIDATION FUNCTION
// =============================================================================

/**
 * Validate a specimen object against the WOLS v1.1.0 schema.
 *
 * @param specimen - The specimen object to validate
 * @param options - Validation options
 * @returns ValidationResult with errors and warnings
 *
 * @example
 * ```typescript
 * const result = validateSpecimen(specimen);
 * if (!result.valid) {
 *   console.error('Validation errors:', result.errors);
 * }
 * ```
 */
export function validateSpecimen(
  specimen: Specimen | unknown,
  options: ValidationOptions = {}
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Default options
  const opts: ValidationOptions = {
    allowUnknownFields: options.allowUnknownFields ?? false,
    level: options.level ?? 'strict',
  };

  // Handle null/undefined input
  if (specimen === null || specimen === undefined) {
    errors.push(error('', WolsErrorCode.REQUIRED_FIELD, 'Specimen is required'));
    return { valid: false, errors, warnings };
  }

  // Handle non-object input
  if (!isPlainObject(specimen)) {
    errors.push(error('', WolsErrorCode.INVALID_FORMAT, 'Specimen must be an object'));
    return { valid: false, errors, warnings };
  }

  const data = specimen as Record<string, unknown>;

  // Validate required JSON-LD fields
  validateContext(data['@context'], errors, opts);
  validateType(data['@type'], errors, opts);

  // Validate required specimen fields
  validateId(data['id'], errors, opts);
  validateVersion(data['version'], errors, opts);
  validateSpecimenType(data['type'], errors, opts);
  validateSpecies(data['species'], errors, opts);

  // Validate optional fields
  validateStage(data['stage'], errors, warnings, opts);
  validateCreated(data['created'], errors, warnings, opts);
  validateStrain(data['strain'], errors, opts);

  // Check for unknown fields
  checkUnknownFields(data, warnings, opts);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
