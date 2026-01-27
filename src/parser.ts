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
  type GrowthStage,
  type ParseResult,
  type Specimen,
  type SpecimenMeta,
  type Strain,
  WOLS_CONTEXT,
  asSpecimenId,
} from './types.js';
import { validateSpecimen } from './validator.js';

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
 * @param json - The JSON string to parse
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
 */
export function parseSpecimen(json: string): ParseResult<Specimen> {
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
    specimen.strain = strainValue as Strain;
  }

  const stageValue = data['stage'];
  if (stageValue !== undefined && stageValue !== null) {
    specimen.stage = stageValue as GrowthStage;
  }

  if (data['created'] !== undefined) {
    specimen.created = data['created'] as string;
  }

  if (data['batch'] !== undefined) {
    specimen.batch = data['batch'] as string;
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
    specimen._meta = data['_meta'] as SpecimenMeta;
  }

  return {
    success: true,
    data: specimen,
  };
}
