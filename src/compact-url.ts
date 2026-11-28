/**
 * Compact URL Format Functions
 *
 * This module provides functions to generate and parse compact URL format
 * for WOLS specimens. The compact format is designed for small QR codes
 * (petri dishes, culture tubes) where space is limited.
 *
 * Format: wemush://v1/{id}?s={species}[&ty=][&st=][&t=][&b=][&sn=][&sg=][&td=][&sig=]
 *
 * From WOLS 1.5.0 the format is normative: a parameter registry, a species
 * code registry (with the frozen two-letter legacy codes), stage codes, and
 * exact percent-decoding and refusal rules.
 *
 * @module compact-url
 */

import { WolsCompactUrlError, WolsError, WolsErrorCode } from './errors.js';
import {
  GROWTH_STAGES,
  isGrowthStage,
  isSpecimenType,
  type CompactUrlFailureReason,
  type GrowthStage,
  type ParseOptions,
  type ParseResult,
  type Specimen,
  type SpecimenRef,
  type ValidationWarning,
} from './types.js';
import { reportWarning } from './utils/generation.js';

// =============================================================================
// REGISTRIES (WOLS 1.5.0)
// =============================================================================

/**
 * The WOLS species code registry (`registries/species-codes.json`), plus any
 * codes added with {@link registerSpeciesCode}. Generators write these codes.
 *
 * The registry is append-only: a code is never removed, renamed or reassigned.
 *
 * @see https://github.com/wemush/open-standard/blob/main/registries/species-codes.json
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
  // WOLS 1.5.0
  PPULM: 'Pleurotus pulmonarius',
  GAPPL: 'Ganoderma applanatum',
  HCORA: 'Hericium coralloides',
  FVELU: 'Flammulina velutipes',
  ABISP: 'Agaricus bisporus',
  AARVE: 'Agaricus arvensis',
  PCUBE: 'Psilocybe cubensis',
  CMILI: 'Cordyceps militaris',
  TVERS: 'Trametes versicolor',
  GFRON: 'Grifola frondosa',
  LSULP: 'Laetiporus sulphureus',
  CAEGE: 'Cyclocybe aegerita',
  PNAME: 'Pholiota nameko',
  HTESS: 'Hypsizygus tessellatus',
  CCOMA: 'Coprinus comatus',
  AMELL: 'Armillaria mellea',
  MESCU: 'Morchella esculenta',
};

/**
 * The frozen legacy species codes (WOLS 1.5.0). The Python `wols` library
 * wrote these two-letter codes before 1.5. Decoders read them, with a warning;
 * generators never write them.
 *
 * @since 1.5.0
 */
export const LEGACY_SPECIES_CODES: Readonly<Record<string, string>> = Object.freeze({
  PO: 'Pleurotus ostreatus',
  PE: 'Pleurotus eryngii',
  PC: 'Pleurotus citrinopileatus',
  PP: 'Pleurotus pulmonarius',
  GL: 'Ganoderma lucidum',
  GA: 'Ganoderma applanatum',
  LE: 'Lentinula edodes',
  HE: 'Hericium erinaceus',
  HC: 'Hericium coralloides',
  FL: 'Flammulina velutipes',
  AB: 'Agaricus bisporus',
  AA: 'Agaricus arvensis',
  PS: 'Psilocybe cubensis',
  CA: 'Cordyceps militaris',
  TA: 'Trametes versicolor',
  GF: 'Grifola frondosa',
  LP: 'Laetiporus sulphureus',
  CM: 'Cyclocybe aegerita',
  ST: 'Stropharia rugosoannulata',
  PH: 'Pholiota nameko',
  HY: 'Hypsizygus tessellatus',
  CO: 'Coprinus comatus',
  AM: 'Armillaria mellea',
  MO: 'Morchella esculenta',
});

/**
 * The 3-letter stage codes a compact URL's `st` may use instead of the full
 * growth stage name (WOLS 1.5.0).
 *
 * @since 1.5.0
 */
export const STAGE_CODES: Readonly<Record<string, GrowthStage>> = Object.freeze({
  INO: 'INOCULATION',
  INC: 'INCUBATION',
  COL: 'COLONIZATION',
  PRI: 'PRIMORDIA',
  FRU: 'FRUITING',
  SEN: 'SENESCENCE',
  HAR: 'HARVEST',
});

/**
 * The registered compact URL parameters, in registry order (WOLS 1.5.0).
 * Any other parameter is unregistered; new ones defined outside the
 * specification use an `x-` prefix.
 *
 * @since 1.5.0
 */
export const COMPACT_URL_PARAMETERS = Object.freeze([
  's',
  'ty',
  'st',
  't',
  'b',
  'sn',
  'sg',
  'td',
  'sig',
] as const);

/** Warning code for a legacy two-letter species code in `s`. @since 1.5.0 */
export const LEGACY_SPECIES_CODE_WARNING = 'LEGACY_SPECIES_CODE';

/** Warning code for a malformed `td` value, which is ignored. @since 1.5.0 */
export const MALFORMED_TRANSFER_DEPTH_WARNING = 'MALFORMED_TRANSFER_DEPTH';

const OFFICIAL_SPECIES_CODES: ReadonlyMap<string, string> = new Map(Object.entries(SPECIES_CODES));
const OFFICIAL_CODE_FOR_SPECIES: ReadonlyMap<string, string> = new Map(
  Object.entries(SPECIES_CODES).map(([code, species]) => [species, code])
);
const REGISTERED_PARAMETERS: ReadonlySet<string> = new Set(COMPACT_URL_PARAMETERS);

/** Reverse lookup map: species name -> code (registry codes win over custom ones). */
const SPECIES_TO_CODE = new Map<string, string>(OFFICIAL_CODE_FOR_SPECIES);

const own = (record: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

/**
 * Get the full species name from a species code
 *
 * Looks up registered codes (the WOLS registry and any custom codes), not
 * the legacy two-letter codes; see {@link LEGACY_SPECIES_CODES}.
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
  return typeof code === 'string' && own(SPECIES_CODES, code) ? SPECIES_CODES[code] : undefined;
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
  return SPECIES_TO_CODE.get(species);
}

/**
 * Register a custom species code
 *
 * Use this to add species codes that are not in the WOLS registry. A code
 * registered here is read by {@link parseCompactUrl} and written by
 * {@link toCompactUrl}. For a species that has a WOLS registry code, the
 * registry code is still the one written.
 *
 * @param code - Species code (uppercase, 4 to 8 letters recommended)
 * @param species - Full species name
 * @throws WolsError if the code is a WOLS registry or legacy code for a
 *   different species (registry codes are never reassigned)
 *
 * @example
 * ```typescript
 * registerSpeciesCode('MIMPO', 'Morchella importuna');
 * getSpeciesFromCode('MIMPO') // Returns "Morchella importuna"
 * ```
 */
export function registerSpeciesCode(code: string, species: string): void {
  const official = OFFICIAL_SPECIES_CODES.get(code) ?? LEGACY_SPECIES_CODES[code];
  if (own(LEGACY_SPECIES_CODES, code) || OFFICIAL_SPECIES_CODES.has(code)) {
    if (official !== species) {
      throw new WolsError(
        WolsErrorCode.INVALID_FORMAT,
        `Species code '${code}' is a WOLS registry code for '${String(official)}' and can't be reassigned`,
        { code, species }
      );
    }
    return;
  }

  // Remove old reverse lookup if code is being overwritten
  const oldSpecies = own(SPECIES_CODES, code) ? SPECIES_CODES[code] : undefined;
  if (oldSpecies !== undefined && SPECIES_TO_CODE.get(oldSpecies) === code) {
    SPECIES_TO_CODE.delete(oldSpecies);
  }

  Object.defineProperty(SPECIES_CODES, code, {
    value: species,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  if (!OFFICIAL_CODE_FOR_SPECIES.has(species)) {
    SPECIES_TO_CODE.set(species, code);
  }
}

// =============================================================================
// SHARED COMPACT URL RULES (also used by compact URL signatures)
// =============================================================================

/** The only prefix a generator or signer writes. @internal */
export const COMPACT_URL_PREFIX = 'wemush://v1/';
const ENCRYPTED_PREFIX = 'wemush://v1/encrypted/';
const DECODER_SCHEMES = ['wemush://', 'web+wemush://'] as const;

/** Thrown by {@link decodeComponent} for a bad escape or invalid UTF-8. */
class BadEncoding extends Error {}

/**
 * Percent-decode one URL component as UTF-8, strictly. In a value, `+` is a
 * space; in the path it is literal.
 * @internal
 */
export function decodeComponent(text: string, isValue: boolean): string {
  try {
    return decodeURIComponent(isValue ? text.replace(/\+/g, ' ') : text);
  } catch {
    throw new BadEncoding(text);
  }
}

/**
 * Whether `decodeComponent` accepts the text.
 * @internal
 */
export function decodesStrictly(text: string): boolean {
  try {
    decodeURIComponent(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a URL has the signable compact shape: exactly `wemush://v1/`, one
 * non-empty path segment without `/`, and not an encrypted URL (WOLS 1.5.0).
 * @internal
 */
export function isCompactUrlShape(url: string): boolean {
  if (!url.startsWith(COMPACT_URL_PREFIX) || url.startsWith(ENCRYPTED_PREFIX)) return false;
  const q = url.indexOf('?');
  const segment = url.slice(COMPACT_URL_PREFIX.length, q === -1 ? url.length : q);
  return segment !== '' && !segment.includes('/');
}

/**
 * Whether `name` is a registered compact URL parameter.
 * @internal
 */
export function isRegisteredCompactParameter(name: string): boolean {
  return REGISTERED_PARAMETERS.has(name);
}

// =============================================================================
// GENERATION
// =============================================================================

/** `name=value`, with the value form-encoded (space as `+`), as URLSearchParams writes it. */
function param(name: string, value: string): string {
  return new URLSearchParams([[name, value]]).toString();
}

/**
 * Generate a compact URL from a specimen
 *
 * The compact URL format is designed for small QR codes:
 * ```
 * wemush://v1/{id}?s={species}&ty={type}[&st=][&t=][&b=][&sn=][&sg=][&td=]
 * ```
 *
 * Parameters are written in registry order. `s` is the registered species
 * code when the species has one, otherwise the full name. The ID suffix is
 * percent-encoded as for encrypted URLs (WOLS 1.5.0), so an ID with `/`,
 * `+`, `%` or a space survives the round trip. `t` is written only for a
 * `created` time at or after 1970-01-01T00:00:00Z, and `td` only for a
 * non-negative integer `strain.transferDepth`.
 *
 * To sign the result, pass it unchanged to `signCompactUrl()`.
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
 * // wemush://v1/clx1a2b3c4?s=POSTR&ty=CULTURE&st=COLONIZATION&t=1734307200
 * ```
 */
export function toCompactUrl(specimen: Specimen): string {
  const suffix = specimen.id.replace(/^wemush:/, '');
  let encodedId: string;
  try {
    encodedId = encodeURIComponent(suffix);
  } catch {
    throw new WolsError(
      WolsErrorCode.INVALID_FORMAT,
      'The specimen id is not well-formed Unicode (it has a lone surrogate)',
      { id: specimen.id }
    );
  }

  const params: string[] = [];

  // Species: the registered code if there is one, otherwise the full name
  params.push(param('s', getCodeFromSpecies(specimen.species) ?? specimen.species));

  params.push(param('ty', specimen.type));

  if (specimen.stage !== undefined) {
    params.push(param('st', specimen.stage));
  }

  // Timestamp: Unix seconds as plain digits
  if (specimen.created !== undefined) {
    const timestamp = Math.floor(new Date(specimen.created).getTime() / 1000);
    if (Number.isSafeInteger(timestamp) && timestamp >= 0) {
      params.push(param('t', String(timestamp)));
    }
  }

  if (specimen.batch !== undefined) {
    params.push(param('b', specimen.batch));
  }

  const strain = specimen.strain;
  if (strain?.name !== undefined) {
    params.push(param('sn', strain.name));
  }
  if (strain?.generation !== undefined) {
    // Generators write the notation's letters uppercase (WOLS 1.5.0-rc.2).
    params.push(param('sg', String(strain.generation).toUpperCase()));
  }
  const depth = strain?.transferDepth;
  if (typeof depth === 'number' && Number.isSafeInteger(depth) && depth >= 0) {
    params.push(param('td', String(depth)));
  }

  return `${COMPACT_URL_PREFIX}${encodedId}?${params.join('&')}`;
}

// =============================================================================
// PARSING
// =============================================================================

/** The generation notation (`P`, `P<n>`, `F<n>`, `G<n>`, `<n>`), letters in either case. */
const GENERATION = /^(P\d*|F\d+|G\d+|\d+)$/i;
const DIGITS = /^\d+$/;
/** 9999-12-31T23:59:59Z, the last second an RFC 3339 date-time can write. */
const MAX_TIMESTAMP = 253402300799;

function refuse(
  reason: CompactUrlFailureReason,
  message: string,
  url: string,
  parameter?: string
): { success: false; error: WolsCompactUrlError } {
  const details: Record<string, unknown> = { url };
  if (parameter !== undefined) details['parameter'] = parameter;
  return { success: false, error: new WolsCompactUrlError(reason, message, details) };
}

function compactWarning(path: string, code: string, message: string, suggestion: string) {
  const w: ValidationWarning = { path, code, message, suggestion };
  return w;
}

/**
 * Parse a compact URL into a SpecimenRef (WOLS 1.5.0 compact URL rules).
 *
 * - Accepts `wemush://v1/` and `web+wemush://v1/`; any other version segment
 *   is refused (`unsupported-version`), and so is an encrypted URL.
 * - The ID is the percent-decoded path segment (`+` is literal there). In
 *   values, `+` is a space. A malformed escape or invalid UTF-8 is refused.
 * - `s` is required. A registered code resolves to its species; a legacy
 *   two-letter code too, with a warning; anything else is the species name.
 * - `ty` must be a specimen type, `st` a growth stage or its 3-letter code,
 *   `t` plain digits and `sg` the generation notation, or the URL is refused.
 *   A malformed `td` is ignored, with a warning.
 * - A registered parameter that appears twice is refused. Unregistered
 *   parameters are kept in `unrecognized` (the last value wins).
 * - `sig` is kept as printed, never verified; use `verifySpecimen()`.
 *
 * On failure, `error` is a {@link WolsCompactUrlError} whose `reason` says why.
 *
 * @param url - Compact URL to parse (wemush://v1/...)
 * @param options - `onWarning` receives non-fatal warnings (default: console.warn)
 * @returns ParseResult with SpecimenRef on success, error on failure
 *
 * @example
 * ```typescript
 * const result = parseCompactUrl('wemush://v1/clx1a2b3c4?s=POSTR&st=COL');
 *
 * if (result.success) {
 *   console.log(result.data.species); // "Pleurotus ostreatus"
 *   console.log(result.data.stage);   // "COLONIZATION"
 * }
 * ```
 */
export function parseCompactUrl(url: string, options: ParseOptions = {}): ParseResult<SpecimenRef> {
  if (typeof url !== 'string') {
    return refuse('invalid-url', 'The compact URL is not a string', String(url));
  }
  const scheme = DECODER_SCHEMES.find(s => url.startsWith(s));
  if (scheme === undefined) {
    return refuse('invalid-url', 'URL must start with wemush:// or web+wemush://', url);
  }
  if (url.includes('#')) {
    return refuse('invalid-url', 'A compact URL has no fragment (#)', url);
  }
  const rest = url.slice(scheme.length);
  const version = /^(v\d+)\//.exec(rest);
  if (!version) {
    return refuse('invalid-url', 'Invalid compact URL format: missing version segment', url);
  }
  if (version[1] !== 'v1') {
    return refuse('unsupported-version', `Unsupported compact URL version '${version[1]}'`, url);
  }
  const after = rest.slice('v1/'.length);
  if (after.startsWith('encrypted/')) {
    return refuse('encrypted-url', 'This is an encrypted URL; use decryptSpecimen()', url);
  }
  const q = after.indexOf('?');
  const segment = q === -1 ? after : after.slice(0, q);
  if (segment === '' || segment.includes('/')) {
    return refuse(
      'invalid-url',
      'Invalid compact URL format: the ID must be one non-empty path segment',
      url
    );
  }

  let id: string;
  const params = new Map<string, string>();
  const unrecognized: Record<string, string> = {};
  try {
    id = decodeComponent(segment, false);
    const query = q === -1 ? '' : after.slice(q + 1);
    for (const pair of query === '' ? [] : query.split('&')) {
      if (pair === '') continue; // an empty piece (`&&`) carries nothing
      const eq = pair.indexOf('=');
      const name = eq === -1 ? pair : pair.slice(0, eq);
      const value = decodeComponent(eq === -1 ? '' : pair.slice(eq + 1), true);
      if (!REGISTERED_PARAMETERS.has(name)) {
        Object.defineProperty(unrecognized, name, {
          value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
        continue;
      }
      if (params.has(name)) {
        return refuse(
          'duplicate-parameter',
          `Parameter '${name}' appears more than once`,
          url,
          name
        );
      }
      params.set(name, value);
    }
  } catch (err) {
    if (err instanceof BadEncoding) {
      return refuse(
        'invalid-encoding',
        'The URL has a malformed percent escape or invalid UTF-8',
        url
      );
    }
    throw err;
  }

  const s = params.get('s');
  if (s === undefined || s === '') {
    return refuse(
      'missing-parameter',
      'Invalid compact URL format: missing species parameter',
      url,
      's'
    );
  }

  const warnings: ValidationWarning[] = [];
  let species: string;
  const registered = getSpeciesFromCode(s);
  if (registered !== undefined) {
    species = registered;
  } else if (own(LEGACY_SPECIES_CODES, s)) {
    species = LEGACY_SPECIES_CODES[s] as string;
    const code = getCodeFromSpecies(species);
    warnings.push(
      compactWarning(
        's',
        LEGACY_SPECIES_CODE_WARNING,
        `'${s}' is a legacy species code for ${species}`,
        code === undefined ? 'Write the full species name' : `Write the registered code '${code}'`
      )
    );
  } else {
    species = s;
  }

  const result: SpecimenRef = {
    id: `wemush:${id}`,
    species,
    version: '1.1.0',
  };

  const ty = params.get('ty');
  if (ty !== undefined) {
    if (!isSpecimenType(ty)) {
      return refuse('invalid-parameter', `ty must be a specimen type, got '${ty}'`, url, 'ty');
    }
    result.type = ty;
  }

  const st = params.get('st');
  if (st !== undefined) {
    const stage = isGrowthStage(st) ? st : own(STAGE_CODES, st) ? STAGE_CODES[st] : undefined;
    if (stage === undefined) {
      return refuse(
        'invalid-parameter',
        `st must be one of ${GROWTH_STAGES.join(', ')} or a 3-letter stage code, got '${st}'`,
        url,
        'st'
      );
    }
    result.stage = stage;
  }

  const t = params.get('t');
  if (t !== undefined) {
    const seconds = DIGITS.test(t) ? Number(t) : NaN;
    if (!(seconds <= MAX_TIMESTAMP)) {
      return refuse('invalid-parameter', `t must be Unix time in seconds, got '${t}'`, url, 't');
    }
    result.timestamp = seconds;
    result.created = new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  const b = params.get('b');
  if (b !== undefined) {
    result.batch = b;
  }

  const strain: NonNullable<SpecimenRef['strain']> = {};
  const sn = params.get('sn');
  if (sn !== undefined) strain.name = sn;
  const sg = params.get('sg');
  if (sg !== undefined) {
    if (!GENERATION.test(sg)) {
      return refuse(
        'invalid-parameter',
        `sg must be P, P<n>, F<n>, G<n> or <n>, got '${sg}'`,
        url,
        'sg'
      );
    }
    strain.generation = sg;
  }
  const td = params.get('td');
  if (td !== undefined) {
    const depth = DIGITS.test(td) ? Number(td) : NaN;
    if (Number.isSafeInteger(depth)) {
      strain.transferDepth = depth;
    } else {
      warnings.push(
        compactWarning(
          'td',
          MALFORMED_TRANSFER_DEPTH_WARNING,
          `td is not a non-negative integer ('${td}'); ignored`,
          'Write td as plain decimal digits'
        )
      );
    }
  }
  if (Object.keys(strain).length > 0) result.strain = strain;

  if (Object.keys(unrecognized).length > 0) result.unrecognized = unrecognized;

  const sig = params.get('sig');
  if (sig !== undefined) result.sig = sig;

  for (const warning of warnings) reportWarning(warning, options.onWarning);

  return {
    success: true,
    data: result,
  };
}

// =============================================================================
// CONVENIENCE METHODS (v1.2.0)
// =============================================================================

/**
 * Parse a compact URL, throwing an error on failure.
 *
 * This is a convenience wrapper around parseCompactUrl() for cases
 * where you prefer exceptions over result types.
 *
 * @param url - Compact URL to parse (wemush://v1/...)
 * @param options - `onWarning` receives non-fatal warnings (default: console.warn)
 * @returns SpecimenRef on success
 * @throws WolsCompactUrlError (a WolsParseError) on parse failure
 *
 * @example
 * ```typescript
 * try {
 *   const ref = parseCompactUrlOrThrow('wemush://v1/clx1a2b3c4?s=POSTR');
 *   console.log(ref.species); // "Pleurotus ostreatus"
 * } catch (err) {
 *   console.error('Failed to parse:', err.message);
 * }
 * ```
 *
 * @since 1.2.0
 */
export function parseCompactUrlOrThrow(url: string, options: ParseOptions = {}): SpecimenRef {
  const result = parseCompactUrl(url, options);
  if (!result.success) {
    throw result.error;
  }
  return result.data;
}

/**
 * Parse a compact URL, returning null on failure.
 *
 * This is a convenience wrapper around parseCompactUrl() for cases
 * where you want to handle failures with nullish coalescing.
 *
 * @param url - Compact URL to parse (wemush://v1/...)
 * @param options - `onWarning` receives non-fatal warnings (default: console.warn)
 * @returns SpecimenRef on success, null on failure
 *
 * @example
 * ```typescript
 * const ref = parseCompactUrlOrNull('wemush://v1/clx1a2b3c4?s=POSTR');
 * if (ref !== null) {
 *   console.log(ref.species);
 * }
 *
 * // Or with nullish coalescing:
 * const species = parseCompactUrlOrNull(url)?.species ?? 'Unknown';
 * ```
 *
 * @since 1.2.0
 */
export function parseCompactUrlOrNull(url: string, options: ParseOptions = {}): SpecimenRef | null {
  // Guard against null/undefined/non-string input to prevent runtime errors
  if (url === null || url === undefined || typeof url !== 'string') {
    return null;
  }
  const result = parseCompactUrl(url, options);
  return result.success ? result.data : null;
}
