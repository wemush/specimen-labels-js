/**
 * Compact URL Format Functions
 *
 * This module provides functions to generate and parse compact URL format
 * for WOLS specimens. The compact format is designed for small QR codes
 * (petri dishes, culture tubes) where space is limited.
 *
 * Format: wemush://v1/{id}?s={species_code}&st={stage}&t={timestamp}
 *
 * @module compact-url
 */

import { WolsErrorCode, WolsParseError } from './errors.js';
import type { Specimen, GrowthStage, SpecimenType, ParseResult, SpecimenRef } from './types.js';

/**
 * Standard species codes from the WOLS specification
 *
 * @see https://github.com/wemush/open-standard for additional codes
 */
export const SPECIES_CODES: Record<string, string> = {
  POSTR: 'Pleurotus ostreatus',
  PCITRI: 'Pleurotus citrinopileatus',
  PDJAR: 'Pleurotus djamor',
  PERYN: 'Pleurotus eryngii',
  HERIN: 'Hericium erinaceus',
  GLUCI: 'Ganoderma lucidum',
  LPUDE: 'Laetiporus pudens',
  LLENC: 'Lentinula edodes',
  APOLY: 'Agrocybe polyphylla',
  STRUG: 'Stropharia rugosoannulata',
};

/**
 * Reverse lookup map: species name → code
 */
const SPECIES_TO_CODE: Record<string, string> = {};

// Initialize reverse lookup
for (const [code, species] of Object.entries(SPECIES_CODES)) {
  SPECIES_TO_CODE[species] = code;
}

/**
 * Get the full species name from a species code
 *
 * @param code - Species code (e.g., "POSTR")
 * @returns Species name or undefined if code is unknown
 *
 * @example
 * ```typescript
 * getSpeciesFromCode('POSTR') // Returns "Pleurotus ostreatus"
 * getSpeciesFromCode('XXXXX') // Returns undefined
 * ```
 */
export function getSpeciesFromCode(code: string): string | undefined {
  return SPECIES_CODES[code];
}

/**
 * Get the species code from a species name
 *
 * @param species - Full species name (e.g., "Pleurotus ostreatus")
 * @returns Species code or undefined if species is not registered
 *
 * @example
 * ```typescript
 * getCodeFromSpecies('Pleurotus ostreatus') // Returns "POSTR"
 * getCodeFromSpecies('Unknown species') // Returns undefined
 * ```
 */
export function getCodeFromSpecies(species: string): string | undefined {
  return SPECIES_TO_CODE[species];
}

/**
 * Register a custom species code
 *
 * Use this to add species codes that are not in the standard WOLS list.
 *
 * @param code - Species code (uppercase, 5 characters recommended)
 * @param species - Full species name
 *
 * @example
 * ```typescript
 * registerSpeciesCode('CCOMA', 'Coprinus comatus');
 * getSpeciesFromCode('CCOMA') // Returns "Coprinus comatus"
 * ```
 */
export function registerSpeciesCode(code: string, species: string): void {
  // Remove old reverse lookup if code is being overwritten
  const oldSpecies = SPECIES_CODES[code];
  if (oldSpecies !== undefined) {
    delete SPECIES_TO_CODE[oldSpecies];
  }

  SPECIES_CODES[code] = species;
  SPECIES_TO_CODE[species] = code;
}

/**
 * Generate a compact URL from a specimen
 *
 * The compact URL format is designed for small QR codes:
 * ```
 * wemush://v1/{id}?s={species_code}&st={stage}&t={timestamp}
 * ```
 *
 * @param specimen - The specimen to encode
 * @returns Compact URL string
 *
 * @example
 * ```typescript
 * const specimen = createSpecimen({
 *   type: 'CULTURE',
 *   species: 'Pleurotus ostreatus',
 *   stage: 'COLONIZATION'
 * });
 *
 * const url = toCompactUrl(specimen);
 * // wemush://v1/clx1a2b3c4?s=POSTR&st=COLONIZATION&ty=CULTURE&t=1734307200
 * ```
 */
export function toCompactUrl(specimen: Specimen): string {
  // Extract ID without prefix
  const idWithoutPrefix = specimen.id.replace(/^wemush:/, '');

  // Start building URL
  let url = `wemush://v1/${idWithoutPrefix}`;

  // Build query parameters
  const params = new URLSearchParams();

  // Species: use code if known, otherwise full name
  const speciesCode = getCodeFromSpecies(specimen.species);
  if (speciesCode !== undefined) {
    params.set('s', speciesCode);
  } else {
    params.set('s', specimen.species);
  }

  // Type
  params.set('ty', specimen.type);

  // Stage (if present)
  if (specimen.stage !== undefined) {
    params.set('st', specimen.stage);
  }

  // Timestamp: convert ISO date to Unix timestamp
  if (specimen.created !== undefined) {
    const timestamp = Math.floor(new Date(specimen.created).getTime() / 1000);
    params.set('t', timestamp.toString());
  }

  // Optional: Batch
  if (specimen.batch !== undefined) {
    params.set('b', specimen.batch);
  }

  // Optional: Strain name
  if (specimen.strain?.name !== undefined) {
    params.set('sn', specimen.strain.name);
  }

  // Optional: Strain generation
  if (specimen.strain?.generation !== undefined) {
    params.set('sg', specimen.strain.generation);
  }

  // Append query string
  const queryString = params.toString();
  if (queryString) {
    url += `?${queryString}`;
  }

  return url;
}

/**
 * Parse a compact URL into a SpecimenRef
 *
 * Returns a reference object containing the minimal information
 * encoded in the compact URL. Use the id to fetch full specimen
 * data from the API if needed.
 *
 * @param url - Compact URL to parse (wemush://v1/...)
 * @returns ParseResult with SpecimenRef on success, error on failure
 *
 * @example
 * ```typescript
 * const result = parseCompactUrl('wemush://v1/clx1a2b3c4?s=POSTR&st=COLONIZATION');
 *
 * if (result.success) {
 *   console.log(result.data.species); // "Pleurotus ostreatus"
 * }
 * ```
 */
export function parseCompactUrl(url: string): ParseResult<SpecimenRef> {
  // Validate URL scheme
  if (!url.startsWith('wemush://')) {
    return {
      success: false,
      error: new WolsParseError(WolsErrorCode.INVALID_URL, 'URL must start with wemush://', {
        url,
      }),
    };
  }

  // Parse URL parts
  const withoutScheme = url.slice('wemush://'.length);
  const [pathPart, queryPart] = withoutScheme.split('?');

  if (!pathPart) {
    return {
      success: false,
      error: new WolsParseError(
        WolsErrorCode.INVALID_URL,
        'Invalid compact URL format: missing path',
        { url }
      ),
    };
  }

  // Parse path: v1/{id}
  const pathSegments = pathPart.split('/');
  if (pathSegments.length < 2 || !pathSegments[1]) {
    return {
      success: false,
      error: new WolsParseError(
        WolsErrorCode.INVALID_URL,
        'Invalid compact URL format: missing specimen ID',
        { url }
      ),
    };
  }

  const version = pathSegments[0] === 'v1' ? '1.1.0' : '1.0.0';
  const idWithoutPrefix = pathSegments[1];

  // Parse query parameters
  const params = new URLSearchParams(queryPart ?? '');

  // Extract species (resolve code if known)
  const speciesParam = params.get('s');
  let species: string;
  if (speciesParam !== null) {
    const resolvedSpecies = getSpeciesFromCode(speciesParam);
    species = resolvedSpecies ?? speciesParam;
  } else {
    return {
      success: false,
      error: new WolsParseError(
        WolsErrorCode.INVALID_URL,
        'Invalid compact URL format: missing species parameter',
        { url }
      ),
    };
  }

  // Build result object
  const result: SpecimenRef = {
    id: `wemush:${idWithoutPrefix}`,
    species,
    version,
  };

  // Extract type
  const typeParam = params.get('ty');
  if (typeParam !== null) {
    result.type = typeParam as SpecimenType;
  }

  // Extract stage
  const stageParam = params.get('st');
  if (stageParam !== null) {
    result.stage = stageParam as GrowthStage;
  }

  // Extract timestamp
  const timestampParam = params.get('t');
  if (timestampParam !== null) {
    result.timestamp = parseInt(timestampParam, 10);
  }

  // Extract batch
  const batchParam = params.get('b');
  if (batchParam !== null) {
    result.batch = batchParam;
  }

  // Extract strain info
  const strainNameParam = params.get('sn');
  const strainGenParam = params.get('sg');
  if (strainNameParam !== null) {
    result.strain = {
      name: strainNameParam,
    };
    if (strainGenParam !== null) {
      result.strain.generation = strainGenParam;
    }
  }

  return {
    success: true,
    data: result,
  };
}
