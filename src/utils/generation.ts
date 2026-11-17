/**
 * Numeric `strain.generation` handling (WOLS 1.4.0).
 *
 * `strain.generation` is a string. The Python `wols` 1.3.0 library wrote it as
 * a JSON integer (for example `"generation": 1`), and printed labels can't be
 * recalled. Decoders therefore read a JSON integer as its decimal string, with
 * a warning, and generators always write a string.
 *
 * @module utils/generation
 */

import type { ValidationWarning } from '../types.js';

/**
 * Warning code for a `strain.generation` given as a JSON integer.
 *
 * @since 1.4.0
 */
export const NUMERIC_GENERATION_WARNING = 'NUMERIC_GENERATION';

/** A JSON integer that has an exact decimal string form. */
export function isIntegerGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** The warning reported when a numeric `strain.generation` is read as a string. */
export function numericGenerationWarning(value: number): ValidationWarning {
  return {
    path: 'strain.generation',
    code: NUMERIC_GENERATION_WARNING,
    message: `strain.generation is the JSON number ${String(value)}; read as the string '${String(value)}'`,
    suggestion: `Write strain.generation as a string: "${String(value)}"`,
  };
}

/**
 * Return `strain` with an integer `generation` replaced by its decimal string,
 * or `strain` itself when there is nothing to convert. Never mutates its input.
 */
export function withStringGeneration<T>(strain: T): T {
  if (typeof strain !== 'object' || strain === null) return strain;
  const generation = (strain as { generation?: unknown }).generation;
  if (!isIntegerGeneration(generation)) return strain;
  return { ...strain, generation: String(generation) };
}

/** Deliver a non-fatal warning to `onWarning`, or to console.warn by default. */
export function reportWarning(
  warning: ValidationWarning,
  onWarning: ((warning: ValidationWarning) => void) | undefined
): void {
  if (onWarning) {
    onWarning(warning);
  } else {
    // eslint-disable-next-line no-console
    console.warn(`[@wemush/wols] ${warning.message}. ${warning.suggestion ?? ''}`.trim());
  }
}
