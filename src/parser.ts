/**
 * WOLS Specimen Parser
 *
 * This module provides parsing functionality for WOLS specimen JSON.
 *
 * @module parser
 */

import {
  parseErrorFromException,
  WolsErrorCode,
  WolsParseError,
  WolsValidationError,
} from './errors.js';
import {
  type Condition,
  type Container,
  type GrowthStage,
  type ParentLink,
  type ParseOptions,
  type ParseResult,
  type Specimen,
  type SpecimenForm,
  type SpecimenMeta,
  type Strain,
  type Taxon,
  WOLS_CONTEXT,
  asSpecimenId,
} from './types.js';
import {
  NUMERIC_GENERATION_WARNING,
  reportWarning,
  withStringGeneration,
} from './utils/generation.js';
import { isKnownSpecimenField, validateSpecimen } from './validator.js';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if a value is a plain object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Get the first validation error code from a ValidationResult.
 */
function getFirstErrorCode(errors: { code: string }[]): WolsErrorCode {
  if (errors.length === 0) {
    return WolsErrorCode.INVALID_FORMAT;
  }

  const firstError = errors[0];
  if (!firstError) {
    return WolsErrorCode.INVALID_FORMAT;
  }

  const code = firstError.code;

  // Map string codes to WolsErrorCode enum
  if (Object.values(WolsErrorCode).includes(code as WolsErrorCode)) {
    return code as WolsErrorCode;
  }

  return WolsErrorCode.INVALID_FORMAT;
}

/**
 * The snake_case `_meta` keys the Python `wols` 1.4.0 library wrote, and the
 * camelCase keys WOLS requires. Decoders SHOULD accept the snake_case keys and
 * re-encode them in camelCase (WOLS 1.5.0).
 */
const META_SNAKE_TO_CAMEL: Readonly<Record<string, string>> = {
  source_id: 'sourceId',
  source_system: 'sourceSystem',
  imported_at: 'importedAt',
  schema_version: 'schemaVersion',
};

/**
 * Rename the standard snake_case `_meta` keys to camelCase, keeping key order.
 * A snake_case key whose camelCase key is also present is kept as it is, so
 * nothing is lost. Other keys are kept unchanged.
 */
function camelCaseMeta(meta: unknown): unknown {
  if (!isPlainObject(meta)) return meta;
  const renames = Object.keys(meta).some(
    key =>
      Object.prototype.hasOwnProperty.call(META_SNAKE_TO_CAMEL, key) &&
      !Object.prototype.hasOwnProperty.call(meta, META_SNAKE_TO_CAMEL[key] as string)
  );
  if (!renames) return meta;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    const camel = Object.prototype.hasOwnProperty.call(META_SNAKE_TO_CAMEL, key)
      ? (META_SNAKE_TO_CAMEL[key] as string)
      : undefined;
    const target =
      camel !== undefined && !Object.prototype.hasOwnProperty.call(meta, camel) ? camel : key;
    Object.defineProperty(result, target, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return result;
}

// =============================================================================
// MAIN PARSE FUNCTION
// =============================================================================

/**
 * Parse a JSON string into a validated Specimen object.
 *
 * This function performs both JSON parsing and WOLS validation.
 * If the JSON is invalid or the parsed object doesn't conform to WOLS,
 * it returns a failure result with a detailed error.
 *
 * A `strain.generation` written as a JSON integer (as `wols` for Python 1.3.0
 * did) is read as its decimal string, and a `NUMERIC_GENERATION` warning goes
 * to `options.onWarning` (default: console.warn).
 *
 * @param json - The JSON string to parse
 * @param options - `onWarning` receives non-fatal warnings (default: console.warn)
 * @returns ParseResult with either the parsed Specimen or an error
 *
 * @example
 * ```typescript
 * const result = parseSpecimen('{"@context": "https://wemush.com/wols/v1", ...}');
 * if (result.success) {
 *   console.log('Specimen ID:', result.data.id);
 * } else {
 *   console.error('Parse error:', result.error.message);
 * }
 * ```
 *
 * @since 1.4.0 Accepts a numeric `strain.generation`; `options` added
 */
export function parseSpecimen(json: string, options: ParseOptions = {}): ParseResult<Specimen> {
  // Step 1: Parse JSON
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return {
      success: false,
      error: parseErrorFromException(err, json),
    };
  }

  // Step 2: Verify it's an object
  if (!isPlainObject(parsed)) {
    return {
      success: false,
      error: new WolsParseError(WolsErrorCode.INVALID_FORMAT, 'Specimen must be a JSON object', {
        receivedType: parsed === null ? 'null' : typeof parsed,
      }),
    };
  }

  // Step 3: Validate against WOLS schema
  const validation = validateSpecimen(parsed);

  if (!validation.valid) {
    // Get the most specific error code
    const errorCode = getFirstErrorCode(validation.errors);
    const firstError = validation.errors[0];

    // Create appropriate error
    const errorMessage = validation.errors.map(e => `${e.path}: ${e.message}`).join('; ');

    if (validation.errors.length === 1 && firstError) {
      return {
        success: false,
        error: new WolsParseError(errorCode, firstError.message, {
          path: firstError.path,
        }),
      };
    }

    return {
      success: false,
      error: new WolsValidationError(`Validation failed: ${errorMessage}`, validation.errors),
    };
  }

  // Step 4: Cast to Specimen type (validation guarantees the shape)
  const data = parsed as Record<string, unknown>;

  const specimen: Specimen = {
    '@context': WOLS_CONTEXT,
    '@type': 'Specimen',
    id: asSpecimenId(data['id'] as string),
    version: data['version'] as string,
    type: data['type'] as Specimen['type'],
    species: data['species'] as string,
  };

  // Copy optional fields if present
  const strainValue = data['strain'];
  if (strainValue !== undefined && strainValue !== null) {
    specimen.strain = withStringGeneration(strainValue as Strain);
  }
  for (const warning of validation.warnings) {
    if (warning.code === NUMERIC_GENERATION_WARNING) reportWarning(warning, options.onWarning);
  }

  // WOLS 1.5.0 members (validated against the 1.5 schema above)
  if (data['taxon'] !== undefined) {
    specimen.taxon = data['taxon'] as Taxon;
  }

  if (data['form'] !== undefined) {
    specimen.form = data['form'] as SpecimenForm;
  }

  if (data['derivedFrom'] !== undefined) {
    specimen.derivedFrom = data['derivedFrom'] as ParentLink[];
  }

  const stageValue = data['stage'];
  if (stageValue !== undefined && stageValue !== null) {
    specimen.stage = stageValue as GrowthStage;
  }

  if (data['condition'] !== undefined) {
    specimen.condition = data['condition'] as Condition;
  }

  if (data['container'] !== undefined) {
    specimen.container = data['container'] as Container;
  }

  if (data['created'] !== undefined) {
    specimen.created = data['created'] as string;
  }

  if (data['batch'] !== undefined) {
    specimen.batch = data['batch'] as string;
  }

  if (data['lot'] !== undefined) {
    specimen.lot = data['lot'] as string;
  }

  if (data['organization'] !== undefined) {
    specimen.organization = data['organization'] as string;
  }

  if (data['creator'] !== undefined) {
    specimen.creator = data['creator'] as string;
  }

  if (data['custom'] !== undefined) {
    specimen.custom = data['custom'] as Record<string, unknown>;
  }

  if (data['signature'] !== undefined) {
    specimen.signature = data['signature'] as string;
  }

  if (data['_meta'] !== undefined) {
    specimen._meta = camelCaseMeta(data['_meta']) as SpecimenMeta;
  }

  // WOLS 1.5.0: keep unknown top-level members so re-serializing doesn't
  // lose them. Validation has already warned about each one.
  const unknownMembers: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    if (!isKnownSpecimenField(key)) unknownMembers[key] = data[key];
  }
  if (Object.keys(unknownMembers).length > 0) {
    specimen.unknownMembers = unknownMembers;
  }

  return {
    success: true,
    data: specimen,
  };
}
