/**
 * WOLS Specimen Validator
 *
 * This module provides validation functionality for WOLS specimen objects.
 *
 * @module validator
 */

import { WolsErrorCode } from './errors.js';
import { evaluateSchema, type JsonSchema, type SchemaError } from './schema/evaluate.js';
import { LABEL_SCHEMA_1_5 } from './schema/wols-1.5.js';
import {
  GROWTH_STAGES,
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
import { isIntegerGeneration, numericGenerationWarning } from './utils/generation.js';
import { isValidISO8601 } from './utils/iso8601.js';

// =============================================================================
// VALIDATION PATTERNS
// =============================================================================

/**
 * Pattern for the opt-in 'strict' ID mode (CUID-style): wemush:[a-z0-9]+
 */
const SPECIMEN_ID_PATTERN_STRICT = /^wemush:[a-z0-9]+$/;

/**
 * Pattern for valid specimen ID with ULID suffix.
 * ULID: 26 characters from Crockford's Base32 alphabet (excluding I, L, O, U).
 */
const SPECIMEN_ID_PATTERN_ULID = /^wemush:[0-9A-HJKMNP-TV-Z]{26}$/i;

/**
 * Pattern for valid specimen ID with UUID v4 suffix.
 */
const SPECIMEN_ID_PATTERN_UUID =
  /^wemush:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Pattern for valid semver version: major.minor.patch
 */
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/**
 * Pattern for valid strain generation: P, P1, F1, F2, G1, G2, or numeric (v1.2.0).
 * Letters are read in either case (WOLS 1.5.0-rc.2); generators write uppercase.
 */
const GENERATION_PATTERN = /^(P\d*|F\d+|G\d+|\d+)$/i;

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
  '_meta', // v1.2.0: Implementation metadata namespace
  // v1.5.0 data model
  'taxon',
  'form',
  'derivedFrom',
  'condition',
  'container',
  'lot',
]);

/** Top-level members added in WOLS 1.5.0, checked against the 1.5 schema. */
const MEMBERS_1_5 = ['taxon', 'form', 'derivedFrom', 'condition', 'container', 'lot'] as const;

const LABEL_DOCUMENT = {
  id: LABEL_SCHEMA_1_5['$id'] as string,
  schema: LABEL_SCHEMA_1_5,
};

/**
 * Members that identify a label and MUST stay in plaintext. Any other member
 * may hold a field-level encryption object (WOLS 1.5.0-rc.2).
 */
const NEVER_ENCRYPTED = new Set([
  '@context',
  '@type',
  'id',
  'version',
  'type',
  'species',
  'signature',
]);

/** A field-level encryption object (`{ encrypted: true, ... }`) in place of a value. */
function isEncryptedValue(value: unknown): boolean {
  return isPlainObject(value) && value['encrypted'] === true;
}

/**
 * Whether `key` is a top-level specimen member this library knows. Anything
 * else is an unknown member: valid, warned about, and kept on re-serialization.
 * @internal
 */
export function isKnownSpecimenField(key: string): boolean {
  return KNOWN_FIELDS.has(key);
}

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
 * Validate id field with flexible ID format support.
 *
 * WOLS requires implementations to accept any non-empty suffix after
 * `wemush:`, so that is the default. Format checks are opt-in:
 * - 'any': wemush:{non-empty-string} (default since v1.3.0)
 * - 'strict': wemush:[a-z0-9]+ (CUID-style)
 * - 'ulid': wemush:{ULID}
 * - 'uuid': wemush:{UUID}
 * - Custom validator function
 */
function validateId(value: unknown, errors: ValidationError[], options: ValidationOptions): void {
  if (value === undefined || value === null) {
    errors.push(error('id', WolsErrorCode.REQUIRED_FIELD, 'id is required'));
    return;
  }

  if (typeof value !== 'string') {
    errors.push(error('id', WolsErrorCode.INVALID_ID_FORMAT, 'id must be a string'));
    return;
  }

  // Custom validator takes precedence
  if (options.customIdValidator) {
    if (!options.customIdValidator(value)) {
      errors.push(
        error('id', WolsErrorCode.INVALID_ID_FORMAT, `id failed custom validation: '${value}'`)
      );
    }
    return;
  }

  // Check wemush: prefix requirement (all modes require this)
  if (!value.startsWith('wemush:')) {
    errors.push(
      error('id', WolsErrorCode.INVALID_ID_FORMAT, `id must start with 'wemush:', got '${value}'`)
    );
    return;
  }

  // Get ID mode (default: 'any', as required by WOLS)
  const mode = options.idMode ?? 'any';

  switch (mode) {
    case 'strict':
      if (!SPECIMEN_ID_PATTERN_STRICT.test(value)) {
        errors.push(
          error(
            'id',
            WolsErrorCode.INVALID_ID_FORMAT,
            `id must match pattern 'wemush:[a-z0-9]+', got '${value}'`
          )
        );
      }
      break;

    case 'ulid':
      if (!SPECIMEN_ID_PATTERN_ULID.test(value)) {
        errors.push(
          error(
            'id',
            WolsErrorCode.INVALID_ID_FORMAT,
            `id must be a valid ULID after 'wemush:' prefix, got '${value}'`
          )
        );
      }
      break;

    case 'uuid':
      if (!SPECIMEN_ID_PATTERN_UUID.test(value)) {
        errors.push(
          error(
            'id',
            WolsErrorCode.INVALID_ID_FORMAT,
            `id must be a valid UUID after 'wemush:' prefix, got '${value}'`
          )
        );
      }
      break;

    case 'any':
      // Just check for non-empty suffix after wemush:
      if (value.length <= 7) {
        // 'wemush:'.length = 7
        errors.push(
          error('id', WolsErrorCode.INVALID_ID_FORMAT, `id suffix cannot be empty after 'wemush:'`)
        );
      }
      break;
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
        `version must be valid semver (major.minor.patch, optional pre-release suffix), got '${value}'`
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
    const stages = GROWTH_STAGES.join(', ');
    if (options.level === 'lenient') {
      warnings.push(
        warning(
          'stage',
          'UNKNOWN_GROWTH_STAGE',
          `Unknown growth stage '${String(value)}'`,
          `Use one of: ${stages}`
        )
      );
    } else {
      errors.push(
        error(
          'stage',
          'INVALID_GROWTH_STAGE',
          `stage must be one of ${stages}, got '${String(value)}'`
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
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function validateStrain(
  value: unknown,
  errors: ValidationError[],
  warnings: ValidationWarning[],
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

  // name is optional from WOLS 1.5.0, but must be a non-empty string when present
  if (strain.name !== undefined && !isNonEmptyString(strain.name)) {
    errors.push(
      error('strain.name', WolsErrorCode.INVALID_FORMAT, 'strain.name must be a non-empty string')
    );
  }

  // Validate generation format if present. A JSON integer is read as its
  // decimal string, with a warning (WOLS 1.4.0; wols for Python 1.3.0 wrote one).
  const generation: unknown = strain.generation;
  if (generation !== undefined) {
    const text = isIntegerGeneration(generation) ? String(generation) : generation;
    if (typeof text !== 'string' || !GENERATION_PATTERN.test(text)) {
      errors.push(
        error(
          'strain.generation',
          WolsErrorCode.INVALID_GENERATION,
          `strain.generation must be P, P<n>, F<n>, G<n> or <n>, got '${String(generation)}'`
        )
      );
    } else if (isIntegerGeneration(generation)) {
      warnings.push(numericGenerationWarning(generation));
    }
  }

  // Validate clonalGeneration if present (0 = original culture)
  if (strain.clonalGeneration !== undefined && !isNonNegativeInteger(strain.clonalGeneration)) {
    errors.push(
      error(
        'strain.clonalGeneration',
        WolsErrorCode.INVALID_FORMAT,
        'strain.clonalGeneration must be a non-negative integer (0 = original culture)'
      )
    );
  }

  // Validate transferDepth if present (v1.3.0; 0 = original culture)
  if (strain.transferDepth !== undefined) {
    if (!isNonNegativeInteger(strain.transferDepth)) {
      errors.push(
        error(
          'strain.transferDepth',
          WolsErrorCode.INVALID_FORMAT,
          `strain.transferDepth must be a non-negative integer, got ${JSON.stringify(strain.transferDepth)}`
        )
      );
    } else if (
      isNonNegativeInteger(strain.clonalGeneration) &&
      strain.transferDepth < strain.clonalGeneration
    ) {
      warnings.push(
        warning(
          'strain.transferDepth',
          'TRANSFER_DEPTH_BELOW_CLONAL_GENERATION',
          `strain.transferDepth (${strain.transferDepth}) is less than strain.clonalGeneration (${strain.clonalGeneration})`,
          'transferDepth counts every transfer, including subcultures, so it should be at least clonalGeneration'
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

  // Validate accession if present (v1.5.0)
  if (strain.accession !== undefined && typeof strain.accession !== 'string') {
    errors.push(
      error('strain.accession', WolsErrorCode.INVALID_FORMAT, 'strain.accession must be a string')
    );
  }
}

/** Turn 1.5 schema errors into validation errors. */
function schemaErrors(found: SchemaError[], errors: ValidationError[]): void {
  for (const e of found) {
    errors.push(
      error(
        e.path,
        e.keyword === 'required' ? WolsErrorCode.REQUIRED_FIELD : WolsErrorCode.INVALID_FORMAT,
        `${e.path} ${e.message}`
      )
    );
  }
}

/**
 * Validate the WOLS 1.5.0 members (`taxon`, `form`, `derivedFrom`,
 * `condition`, `container`, `lot`) against the 1.5 schema, and the rule that
 * `strain.lineage` equals `derivedFrom[0].id` when both are present.
 */
function validateMembers15(data: Record<string, unknown>, errors: ValidationError[]): void {
  const properties = LABEL_SCHEMA_1_5['properties'] as Record<string, JsonSchema>;
  for (const member of MEMBERS_1_5) {
    if (data[member] === undefined) continue;
    schemaErrors(
      evaluateSchema(properties[member] as JsonSchema, data[member], {
        documents: [LABEL_DOCUMENT],
        path: member,
      }),
      errors
    );
  }

  const strain = data['strain'];
  const parents = data['derivedFrom'];
  if (
    isPlainObject(strain) &&
    strain['lineage'] !== undefined &&
    Array.isArray(parents) &&
    parents.length > 0
  ) {
    const first: unknown = parents[0];
    const primary = isPlainObject(first) ? first['id'] : undefined;
    if (strain['lineage'] !== primary) {
      errors.push(
        error(
          'strain.lineage',
          WolsErrorCode.INVALID_FORMAT,
          `strain.lineage must equal derivedFrom[0].id ('${String(primary)}'), got '${String(strain['lineage'])}'`
        )
      );
    }
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
    // A parsed Specimen carries its kept unknown members in `unknownMembers`,
    // which is library state, not a wire member.
    if (key === 'unknownMembers' && isPlainObject(specimen[key])) continue;
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
 * Validate a specimen object against the WOLS data model.
 *
 * Checks the 1.4.0 members as before, and from 1.5.0 the new members
 * (`taxon`, `form`, `derivedFrom`, `condition`, `container`, `lot`,
 * `strain.accession`) against the 1.5 schema, plus the rule that
 * `strain.lineage` equals `derivedFrom[0].id` when both are present.
 * `strain.name` is optional from 1.5.0. Unknown members are valid, with an
 * `UNKNOWN_FIELD` warning.
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

  // Default options - spread to include all optional properties
  const opts: ValidationOptions = {
    ...options,
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

  const all = specimen as Record<string, unknown>;

  // An encrypted member is checked for shape only; its plaintext is checked
  // after decryption (WOLS 1.5.0-rc.2). The other checks see the plaintext members.
  const data: Record<string, unknown> = {};
  const encryptedField = (LABEL_SCHEMA_1_5['$defs'] as Record<string, JsonSchema>)[
    'EncryptedField'
  ];
  for (const [key, value] of Object.entries(all)) {
    if (!NEVER_ENCRYPTED.has(key) && isEncryptedValue(value)) {
      schemaErrors(
        evaluateSchema(encryptedField as JsonSchema, value, {
          documents: [LABEL_DOCUMENT],
          path: key,
        }),
        errors
      );
    } else {
      data[key] = value;
    }
  }

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
  validateStrain(data['strain'], errors, warnings, opts);

  // WOLS 1.5.0 members
  validateMembers15(data, errors);

  // Check for unknown fields
  checkUnknownFields(all, warnings, opts);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
