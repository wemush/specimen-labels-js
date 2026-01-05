/**
 * QR Code Generation Module
 *
 * This module provides QR code generation functionality for WOLS specimens.
 * Requires the 'qrcode' package as an optional peer dependency.
 *
 * @module qr/generate
 */

import { WolsError, WolsErrorCode } from '../errors.js';
import { serializeSpecimen } from '../specimen.js';
import type { Specimen, QRCodeOptions } from '../types.js';

// =============================================================================
// QR CODE LIBRARY DYNAMIC IMPORT
// =============================================================================

/**
 * QR code library options (subset of qrcode package options).
 */
interface QRNodeOptions {
  type?: 'png' | 'svg' | 'terminal';
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  width?: number;
  margin?: number;
  color?: {
    dark?: string;
    light?: string;
  };
}

// Cached reference to the qrcode library
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let qrLib: any = null;
let qrLibLoadAttempted = false;

/**
 * Dynamically load the qrcode library.
 * Returns null if the library is not installed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadQRLib(): Promise<any> {
  if (qrLibLoadAttempted) {
    return qrLib;
  }

  qrLibLoadAttempted = true;

  try {
    // Dynamic import of optional peer dependency
    const module = await import('qrcode');
    qrLib = module.default ?? module;
    return qrLib;
  } catch {
    // qrcode package not installed
    qrLib = null;
    return null;
  }
}

/**
 * Ensure qrcode library is available.
 * Throws an error if not installed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireQRLib(): Promise<any> {
  const lib = await loadQRLib();

  if (!lib) {
    throw new WolsError(
      WolsErrorCode.UNKNOWN_ERROR,
      'QR code generation requires the "qrcode" package. Install it with: npm install qrcode',
      { missingDependency: 'qrcode' }
    );
  }

  return lib;
}

// =============================================================================
// COMPACT URL FORMAT
// =============================================================================

/**
 * Species code mapping for compact URLs.
 */
const SPECIES_CODES: Record<string, string> = {
  'Pleurotus ostreatus': 'POSTR',
  'Pleurotus citrinopileatus': 'PCITRI',
  'Pleurotus djamor': 'PDJAR',
  'Pleurotus eryngii': 'PERYN',
  'Hericium erinaceus': 'HERIN',
  'Ganoderma lucidum': 'GLUCI',
  'Laetiporus pudens': 'LPUDE',
  'Lentinula edodes': 'LLENC',
  'Agrocybe polyphylla': 'APOLY',
  'Stropharia rugosoannulata': 'STRUG',
};

/**
 * Growth stage to short code mapping.
 */
const STAGE_CODES: Record<string, string> = {
  INOCULATION: 'IN',
  COLONIZATION: 'CO',
  FRUITING: 'FR',
  HARVEST: 'HA',
};

/**
 * Convert specimen to compact URL format.
 * Format: wemush://v1/{id}?s={species}&st={stage}&t={timestamp}
 */
function toCompactUrl(specimen: Specimen): string {
  // Extract the CUID part from the full ID
  const cuidPart = specimen.id.replace('wemush:', '');

  // Build query params
  const params = new URLSearchParams();

  // Add species code
  const speciesCode = SPECIES_CODES[specimen.species];
  if (speciesCode) {
    params.set('s', speciesCode);
  }

  // Add stage if present
  if (specimen.stage) {
    const stageCode = STAGE_CODES[specimen.stage];
    if (stageCode) {
      params.set('st', stageCode);
    }
  }

  // Add timestamp if created is present
  if (specimen.created) {
    const timestamp = Math.floor(new Date(specimen.created).getTime() / 1000);
    params.set('t', String(timestamp));
  }

  const queryString = params.toString();
  return `wemush://v1/${cuidPart}${queryString ? '?' + queryString : ''}`;
}

// =============================================================================
// QR CODE GENERATION
// =============================================================================

/**
 * Generate QR code content based on format option.
 */
function getQRContent(specimen: Specimen, format: 'embedded' | 'compact'): string {
  if (format === 'compact') {
    return toCompactUrl(specimen);
  }
  return serializeSpecimen(specimen);
}

/**
 * Map QRCodeOptions to library options.
 */
function mapOptions(options: QRCodeOptions = {}): QRNodeOptions {
  const result: QRNodeOptions = {
    errorCorrectionLevel: options.errorCorrection ?? 'M',
    width: options.size ?? 300,
    margin: options.margin ?? 1,
  };

  if (options.color) {
    result.color = options.color;
  }

  return result;
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Check if QR code generation is available.
 * Returns true if the qrcode library is installed.
 */
export async function isQRAvailable(): Promise<boolean> {
  const lib = await loadQRLib();
  return lib !== null;
}

/**
 * Synchronous check if QR code generation is available.
 * Note: Only accurate after first async call to any QR function.
 */
export function isQRAvailableSync(): boolean {
  return qrLib !== null;
}

/**
 * Generate QR code as PNG buffer.
 *
 * @param specimen - The specimen to encode
 * @param options - QR code generation options
 * @returns PNG buffer containing the QR code
 *
 * @example
 * ```typescript
 * const buffer = await toQRCode(specimen, { size: 400 });
 * fs.writeFileSync('specimen-qr.png', buffer);
 * ```
 */
export async function toQRCode(specimen: Specimen, options: QRCodeOptions = {}): Promise<Buffer> {
  const lib = await requireQRLib();
  const content = getQRContent(specimen, options.format ?? 'embedded');
  const qrOptions = mapOptions(options);

  try {
    return await lib.toBuffer(content, { ...qrOptions, type: 'png' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WolsError(WolsErrorCode.SIZE_EXCEEDED, `Failed to generate QR code: ${message}`, {
      originalError: message,
    });
  }
}

/**
 * Generate QR code as data URL (base64 encoded PNG).
 *
 * @param specimen - The specimen to encode
 * @param options - QR code generation options
 * @returns Data URL string (data:image/png;base64,...)
 *
 * @example
 * ```typescript
 * const dataUrl = await toQRCodeDataURL(specimen);
 * // Use in HTML: <img src={dataUrl} />
 * ```
 */
export async function toQRCodeDataURL(
  specimen: Specimen,
  options: QRCodeOptions = {}
): Promise<string> {
  const lib = await requireQRLib();
  const content = getQRContent(specimen, options.format ?? 'embedded');
  const qrOptions = mapOptions(options);

  try {
    return await lib.toDataURL(content, qrOptions);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WolsError(WolsErrorCode.SIZE_EXCEEDED, `Failed to generate QR code: ${message}`, {
      originalError: message,
    });
  }
}

/**
 * Generate QR code as SVG string.
 *
 * @param specimen - The specimen to encode
 * @param options - QR code generation options
 * @returns SVG string
 *
 * @example
 * ```typescript
 * const svg = await toQRCodeSVG(specimen, { color: { dark: '#000', light: '#fff' } });
 * fs.writeFileSync('specimen-qr.svg', svg);
 * ```
 */
export async function toQRCodeSVG(
  specimen: Specimen,
  options: QRCodeOptions = {}
): Promise<string> {
  const lib = await requireQRLib();
  const content = getQRContent(specimen, options.format ?? 'embedded');
  const qrOptions = mapOptions(options);

  try {
    const svg = await lib.toString(content, { ...qrOptions, type: 'svg' });

    // Ensure the SVG has proper dimensions based on size option
    const size = options.size ?? 300;
    return svg
      .replace(/width="[^"]*"/, `width="${size}"`)
      .replace(/height="[^"]*"/, `height="${size}"`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WolsError(WolsErrorCode.SIZE_EXCEEDED, `Failed to generate QR code: ${message}`, {
      originalError: message,
    });
  }
}
