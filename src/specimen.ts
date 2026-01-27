/**
 * Specimen Creation and Serialization
 *
 * This module provides functions to create and serialize
 * WOLS v1.1.0 compliant specimen objects.
 *
 * @module specimen
 */

import type { Specimen, SpecimenInput, Strain } from './types.js';
import {
  WOLS_CONTEXT,
  WOLS_VERSION,
  asSpecimenId,
  isSpecimenType,
  isStrain,
  resolveTypeAlias,
} from './types.js';
import { createSpecimenId } from './utils/cuid.js';

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
 * This function creates a fully-formed WOLS v1.1.0 compliant Specimen
 * with automatic ID generation, version assignment, and JSON-LD context.
 *
 * @param input - Specimen creation parameters
 * @returns Fully-formed Specimen with JSON-LD fields
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
 * ```
 */
export function createSpecimen(input: SpecimenInput): Specimen {
  const id = asSpecimenId(createSpecimenId());
  const strain = expandStrain(input.strain);

  // Resolve type alias to canonical WOLS type (e.g., 'LIQUID_CULTURE' -> 'CULTURE')
  const resolvedType = resolveTypeAlias(input.type);
  if (!isSpecimenType(resolvedType)) {
    throw new Error(
      `Invalid specimen type: '${input.type}'. ` +
        `Must be one of: CULTURE, SPAWN, SUBSTRATE, FRUITING, HARVEST ` +
        `(or a registered alias).`
    );
  }

  // Build specimen with required fields
  const specimen: Specimen = {
    '@context': WOLS_CONTEXT,
    '@type': 'Specimen',
    id,
    version: WOLS_VERSION,
    type: resolvedType,
    species: input.species,
  };

  // Add optional fields only if defined
  if (strain !== undefined) {
    specimen.strain = strain;
  }

  if (input.stage !== undefined) {
    specimen.stage = input.stage;
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
  // Build ordered object with JSON-LD fields first
  const ordered: Record<string, unknown> = {
    '@context': specimen['@context'],
    '@type': specimen['@type'],
    id: specimen.id,
    version: specimen.version,
    type: specimen.type,
    species: specimen.species,
  };

  // Add optional fields in order, only if defined
  if (specimen.strain !== undefined) {
    ordered['strain'] = specimen.strain;
  }

  if (specimen.stage !== undefined) {
    ordered['stage'] = specimen.stage;
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
