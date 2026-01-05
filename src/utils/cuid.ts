/**
 * CUID2 Generator - Zero-dependency implementation
 *
 * Generates collision-resistant unique identifiers following the CUID2 algorithm.
 * This is a minimal implementation focused on the needs of WOLS specimen IDs.
 *
 * @module utils/cuid
 */

// Character set for base36 encoding (0-9, a-z)
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

// Default length for generated IDs
const DEFAULT_LENGTH = 24;

// Counter for additional entropy
let counter = 0;

/**
 * Get cryptographically secure random bytes.
 * Uses Web Crypto API (works in Node.js 18+ and modern browsers).
 */
function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  // Use globalThis.crypto for cross-platform compatibility
  const cryptoObj =
    typeof globalThis !== 'undefined'
      ? (globalThis as unknown as { crypto?: Crypto }).crypto
      : undefined;

  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    // Fallback for older environments (should not happen with Node 18+)
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytes;
}

/**
 * Convert a byte array to a base36 string.
 */
function toBase36(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) {
    result += ALPHABET[byte % 36];
  }
  return result;
}

/**
 * Get a timestamp component for the ID.
 * Uses high-resolution time when available.
 */
function getTimestamp(): string {
  const now = Date.now();
  return now.toString(36);
}

/**
 * Get counter component to ensure uniqueness within same millisecond.
 */
function getCounter(): string {
  counter = (counter + 1) % 1679616; // Max 4 base36 chars
  return counter.toString(36).padStart(4, '0');
}

/**
 * Generate a fingerprint based on environment.
 * In browsers, uses navigator info. In Node.js, uses process info.
 */
function getFingerprint(): string {
  const parts: string[] = [];

  // Node.js environment - use globalThis for cross-platform compatibility
  const processObj =
    typeof globalThis !== 'undefined'
      ? (globalThis as unknown as { process?: NodeJS.Process }).process
      : undefined;

  const navigatorObj =
    typeof globalThis !== 'undefined'
      ? (globalThis as unknown as { navigator?: Navigator }).navigator
      : undefined;

  if (processObj?.pid) {
    parts.push(processObj.pid.toString(36));
    const hrtime = processObj.hrtime?.();
    if (hrtime) {
      parts.push((hrtime[1] ?? 0).toString(36));
    }
  }

  // Browser environment
  if (navigatorObj) {
    parts.push((navigatorObj.userAgent?.length ?? 0).toString(36));
    parts.push((navigatorObj.language?.length ?? 0).toString(36));
  }

  // Fallback random
  if (parts.length === 0) {
    const random = getRandomBytes(4);
    parts.push(toBase36(random));
  }

  return parts.join('').slice(0, 4);
}

/**
 * Generate a CUID2-style identifier.
 *
 * The ID format is: [random][timestamp][counter][fingerprint][random]
 * All components are base36 encoded for URL safety.
 *
 * @param length - Length of the generated ID (default: 24)
 * @returns A unique, URL-safe identifier
 *
 * @example
 * ```typescript
 * const id = createId();
 * // Returns something like: "clx1a2b3c4d5e6f7g8h9i0j1"
 * ```
 */
export function createId(length: number = DEFAULT_LENGTH): string {
  const timestamp = getTimestamp();
  const count = getCounter();
  const fingerprint = getFingerprint();

  // Calculate random bytes needed
  const fixedLength = timestamp.length + count.length + fingerprint.length;
  const randomLength = Math.max(0, length - fixedLength);

  // Generate random component
  const randomBytes = getRandomBytes(randomLength);
  const random = toBase36(randomBytes);

  // Combine components
  const id = (random + timestamp + count + fingerprint).slice(0, length);

  return id;
}

/**
 * Generate a specimen ID with the WOLS prefix.
 *
 * @returns A specimen ID in format "wemush:{cuid}"
 *
 * @example
 * ```typescript
 * const specimenId = createSpecimenId();
 * // Returns: "wemush:clx1a2b3c4d5e6f7g8h9i0j1"
 * ```
 */
export function createSpecimenId(): string {
  return `wemush:${createId()}`;
}

/**
 * Validate a specimen ID format.
 *
 * @param id - The ID to validate
 * @returns true if the ID matches the expected format
 */
export function isValidSpecimenId(id: string): boolean {
  return /^wemush:[a-z0-9]+$/.test(id);
}
