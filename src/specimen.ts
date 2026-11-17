/**
 * Specimen Creation and Serialization
 *
 * This module provides functions to create and serialize
 * WOLS v1.3.0 compliant specimen objects.
 *
 * @module specimen
 */

import type {
  CreateSpecimenOptions,
  Specimen,
  SpecimenInput,
  Strain,
  ValidationWarning,
} from './types.js';
import {
  WOLS_CONTEXT,
  WOLS_VERSION,
  asSpecimenId,
  isStrain,
  resolveTypeAndStage,
} from './types.js';
import { createSpecimenId } from './utils/cuid.js';
import {
  isIntegerGeneration,
  numericGenerationWarning,
  reportWarning,
  withStringGeneration,
} from './utils/generation.js';
import { isValidISO8601 } from './utils/iso8601.js';

/**
 * Warning code emitted when `PRIMORDIA` is supplied as a specimen type.
 *
 * @since 1.3.0
 */
export const PRIMORDIA_AS_TYPE_WARNING = 'PRIMORDIA_AS_TYPE';

function primordiaWarning(): ValidationWarning {
  return {
    path: 'type',
    code: PRIMORDIA_AS_TYPE_WARNING,
    message: `'PRIMORDIA' is a growth stage, not a specimen type; resolved to type 'FRUITING'`,
    suggestion: `Use type: 'FRUITING', stage: 'PRIMORDIA'`,
  };
}

/**
 * Expand a strain input to a full Strain object.
 * String inputs are expanded to { name: string }.
 *
 * @param strain - String or Strain object input
 * @returns Strain object or undefined
 */
function expandStrain(strain: string | Strain | undefined): Strain | undefined {
  if (strain === undefined) {
    return undefined;
  }

  if (typeof strain === 'string') {
    return { name: strain };
  }

  if (isStrain(strain)) {
    return strain;
  }

  return undefined;
}

/**
 * Create a new specimen with auto-generated ID and JSON-LD fields.
 *
 * This function creates a fully-formed WOLS v1.3.0 compliant Specimen
 * with automatic ID generation, version assignment, and JSON-LD context.
 *
 * Type aliases resolve case-insensitively. `PRIMORDIA` supplied as a type
 * resolves to `FRUITING`, sets `stage: 'PRIMORDIA'` when no stage was given
 * (a supplied stage is never overridden), and emits a warning.
 *
 * `strain.generation` is always written as a string. A number supplied by an
 * untyped caller is converted to its decimal string, with a warning.
 *
 * @param input - Specimen creation parameters
 * @param options - `onWarning` receives non-fatal warnings (default: console.warn)
 * @returns Fully-formed Specimen with JSON-LD fields
 * @throws Error if the type is unknown or `created` is not ISO 8601
 *
 * @example
 * ```typescript
 * // Minimal specimen
 * const culture = createSpecimen({
 *   type: 'CULTURE',
 *   species: 'Pleurotus ostreatus',
 * });
 *
 * // Full specimen with strain info
 * const substrate = createSpecimen({
 *   type: 'SUBSTRATE',
 *   species: 'Hericium erinaceus',
 *   strain: {
 *     name: "Lion's Mane Premium",
 *     generation: 'F2',
 *     clonalGeneration: 3,
 *   },
 *   stage: 'COLONIZATION',
 *   batch: 'batch_2025_12_001',
 *   organization: 'org_mushoh',
 * });
 *
 * // String strain shorthand
 * const spawn = createSpecimen({
 *   type: 'SPAWN',
 *   species: 'Ganoderma lucidum',
 *   strain: 'Reishi Red',  // Auto-expands to { name: 'Reishi Red' }
 * });
 *
 * // PRIMORDIA as a type (v1.3.0) -> type FRUITING, stage PRIMORDIA, plus a warning
 * const pinning = createSpecimen(
 *   { type: 'PRIMORDIA', species: 'Pleurotus ostreatus' },
 *   { onWarning: w => console.info(w.message) }
 * );
 *
 * // Explicit creation timestamp (v1.3.0)
 * const dated = createSpecimen({
 *   type: 'CULTURE',
 *   species: 'Pleurotus ostreatus',
 *   created: '2025-12-16T10:30:00Z',
 * });
 * ```
 */
export function createSpecimen(
  input: SpecimenInput,
  options: CreateSpecimenOptions = {}
): Specimen {
  const id = asSpecimenId(createSpecimenId());
  const strain = expandStrain(input.strain);

  // Resolve type alias to canonical WOLS type (e.g., 'LIQUID_CULTURE' -> 'CULTURE')
  const resolved = resolveTypeAndStage(input.type, input.stage);
  if (resolved === null) {
    throw new Error(
      `Invalid specimen type: '${input.type}'. ` +
        `Must be one of: CULTURE, SPAWN, SUBSTRATE, FRUITING, HARVEST ` +
        `(or a registered alias).`
    );
  }

  let created: string | undefined;
  if (input.created !== undefined) {
    if (input.created instanceof Date) {
      if (Number.isNaN(input.created.getTime())) {
        throw new Error('Invalid created timestamp: Date is invalid. Must be ISO 8601.');
      }
      created = input.created.toISOString();
    } else {
      created = input.created;
    }
    if (typeof created !== 'string' || !isValidISO8601(created)) {
      throw new Error(`Invalid created timestamp: '${String(input.created)}'. Must be ISO 8601.`);
    }
  }

  if (resolved.primordia) {
    reportWarning(primordiaWarning(), options.onWarning);
  }

  // WOLS 1.4.0: generators MUST write strain.generation as a string.
  const generation: unknown = strain?.generation;
  if (isIntegerGeneration(generation)) {
    reportWarning(numericGenerationWarning(generation), options.onWarning);
  }

  // Build specimen with required fields
  const specimen: Specimen = {
    '@context': WOLS_CONTEXT,
    '@type': 'Specimen',
    id,
    version: WOLS_VERSION,
    type: resolved.type,
    species: input.species,
  };

  // Add optional fields only if defined
  if (strain !== undefined) {
    specimen.strain = withStringGeneration(strain);
  }

  if (resolved.stage !== undefined) {
    specimen.stage = resolved.stage;
  }

  if (created !== undefined) {
    specimen.created = created;
  }

  if (input.batch !== undefined) {
    specimen.batch = input.batch;
  }

  if (input.organization !== undefined) {
    specimen.organization = input.organization;
  }

  if (input.creator !== undefined) {
    specimen.creator = input.creator;
  }

  if (input.custom !== undefined) {
    specimen.custom = input.custom;
  }

  if (input._meta !== undefined) {
    specimen._meta = input._meta;
  }

  return specimen;
}

/**
 * Serialize a specimen to JSON-LD string.
 *
 * The output is formatted with JSON-LD fields (@context, @type) first,
 * followed by id, version, and remaining fields. Undefined fields are omitted.
 *
 * @param specimen - Specimen to serialize
 * @returns JSON string suitable for QR encoding
 *
 * @example
 * ```typescript
 * const specimen = createSpecimen({
 *   type: 'CULTURE',
 *   species: 'Pleurotus ostreatus',
 * });
 *
 * const json = serializeSpecimen(specimen);
 * // Returns: '{"@context":"https://wemush.com/wols/v1","@type":"Specimen",...}'
 * ```
 */
export function serializeSpecimen(specimen: Specimen): string {
  // WOLS v1.3.0: PRIMORDIA is never emitted as a type. A specimen object built
  // by hand with type PRIMORDIA gets the same resolution as createSpecimen()
  // (shared resolveTypeAndStage). Any other type is emitted as given.
  let type: string = specimen.type;
  let stage = specimen.stage;
  const resolved = resolveTypeAndStage(type, stage);
  if (resolved?.primordia) {
    type = resolved.type;
    stage = resolved.stage;
  }

  // Build ordered object with JSON-LD fields first
  const ordered: Record<string, unknown> = {
    '@context': specimen['@context'],
    '@type': specimen['@type'],
    id: specimen.id,
    version: specimen.version,
    type,
    species: specimen.species,
  };

  // Add optional fields in order, only if defined. strain.generation is
  // always written as a string (WOLS 1.4.0), even on a hand-built object.
  if (specimen.strain !== undefined) {
    ordered['strain'] = withStringGeneration(specimen.strain);
  }

  if (stage !== undefined) {
    ordered['stage'] = stage;
  }

  if (specimen.created !== undefined) {
    ordered['created'] = specimen.created;
  }

  if (specimen.batch !== undefined) {
    ordered['batch'] = specimen.batch;
  }

  if (specimen.organization !== undefined) {
    ordered['organization'] = specimen.organization;
  }

  if (specimen.creator !== undefined) {
    ordered['creator'] = specimen.creator;
  }

  if (specimen.custom !== undefined) {
    ordered['custom'] = specimen.custom;
  }

  if (specimen.signature !== undefined) {
    ordered['signature'] = specimen.signature;
  }

  if (specimen._meta !== undefined) {
    ordered['_meta'] = specimen._meta;
  }

  return JSON.stringify(ordered);
}
