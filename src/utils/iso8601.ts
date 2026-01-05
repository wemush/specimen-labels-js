/**
 * ISO 8601 Date Utilities
 *
 * Provides parsing and formatting for ISO 8601 date strings
 * as used in WOLS specimens.
 *
 * @module utils/iso8601
 */

/**
 * Regular expression for validating ISO 8601 date strings.
 * Matches formats like:
 * - 2025-12-16T10:30:00Z
 * - 2025-12-16T10:30:00.000Z
 * - 2025-12-16T10:30:00+00:00
 * - 2025-12-16T10:30:00-05:00
 */
const ISO8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Simple date-only regex for partial dates
 */
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Check if a string is a valid ISO 8601 date.
 *
 * @param value - The string to validate
 * @returns true if valid ISO 8601 format
 *
 * @example
 * ```typescript
 * isValidISO8601('2025-12-16T10:30:00Z'); // true
 * isValidISO8601('2025-12-16'); // false (date-only)
 * isValidISO8601('invalid'); // false
 * ```
 */
export function isValidISO8601(value: string): boolean {
  if (!ISO8601_REGEX.test(value)) {
    return false;
  }

  // Also verify it's a parseable date
  const date = new Date(value);
  return !isNaN(date.getTime());
}

/**
 * Check if a string is a valid date-only format (YYYY-MM-DD).
 *
 * @param value - The string to validate
 * @returns true if valid date-only format
 */
export function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY_REGEX.test(value)) {
    return false;
  }

  const date = new Date(value + 'T00:00:00Z');
  return !isNaN(date.getTime());
}

/**
 * Get the current timestamp in ISO 8601 format.
 *
 * @returns Current time as ISO 8601 string
 *
 * @example
 * ```typescript
 * const now = getCurrentISO8601();
 * // Returns: "2025-12-16T10:30:00.000Z"
 * ```
 */
export function getCurrentISO8601(): string {
  return new Date().toISOString();
}

/**
 * Parse an ISO 8601 date string to a Date object.
 *
 * @param value - The ISO 8601 string to parse
 * @returns The parsed Date, or null if invalid
 *
 * @example
 * ```typescript
 * const date = parseISO8601('2025-12-16T10:30:00Z');
 * // Returns: Date object
 *
 * const invalid = parseISO8601('invalid');
 * // Returns: null
 * ```
 */
export function parseISO8601(value: string): Date | null {
  if (!isValidISO8601(value)) {
    return null;
  }
  return new Date(value);
}

/**
 * Format a Date object to ISO 8601 string.
 *
 * @param date - The Date to format
 * @returns ISO 8601 string
 */
export function formatISO8601(date: Date): string {
  return date.toISOString();
}

/**
 * Get Unix timestamp (seconds since epoch) from ISO 8601 string.
 *
 * @param value - The ISO 8601 string
 * @returns Unix timestamp in seconds, or null if invalid
 */
export function toUnixTimestamp(value: string): number | null {
  const date = parseISO8601(value);
  if (!date) {
    return null;
  }
  return Math.floor(date.getTime() / 1000);
}

/**
 * Convert Unix timestamp to ISO 8601 string.
 *
 * @param timestamp - Unix timestamp in seconds
 * @returns ISO 8601 string
 */
export function fromUnixTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}
