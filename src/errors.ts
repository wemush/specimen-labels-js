/**
 * WOLS Error Types
 *
 * This module defines all error classes and error codes
 * used by the WOLS TypeScript library.
 *
 * @module errors
 */

import type { CompactUrlFailureReason, DecryptionFailureReason, ValidationError } from './types.js';

// =============================================================================
// ERROR CODES
// =============================================================================

/**
 * WOLS error codes (stable, for programmatic handling).
 */
export enum WolsErrorCode {
  /** General parse error */
  PARSE_ERROR = 'WOLS_PARSE_ERROR',
  /** Invalid JSON syntax */
  INVALID_JSON = 'WOLS_INVALID_JSON',
  /** Not a valid WOLS format */
  INVALID_FORMAT = 'WOLS_INVALID_FORMAT',
  /** Missing or invalid @context field */
  INVALID_CONTEXT = 'WOLS_INVALID_CONTEXT',
  /** Missing or invalid @type field */
  INVALID_TYPE = 'WOLS_INVALID_TYPE',
  /** ID doesn't match wemush:[a-z0-9]+ pattern */
  INVALID_ID_FORMAT = 'WOLS_INVALID_ID_FORMAT',
  /** Version not valid semver */
  INVALID_VERSION = 'WOLS_INVALID_VERSION',
  /** Type not in SpecimenType enum */
  INVALID_SPECIMEN_TYPE = 'WOLS_INVALID_SPECIMEN_TYPE',
  /** Required field is missing */
  REQUIRED_FIELD = 'WOLS_REQUIRED_FIELD',
  /** Date not in ISO 8601 format */
  INVALID_DATE_FORMAT = 'WOLS_INVALID_DATE_FORMAT',
  /** Strain generation format is invalid */
  INVALID_GENERATION = 'WOLS_INVALID_GENERATION',
  /** Invalid compact URL format */
  INVALID_URL = 'WOLS_INVALID_URL',
  /** A bundle reference (strainRef, recipeRef, specimen) doesn't resolve (WOLS 1.5.0) */
  UNRESOLVED_REFERENCE = 'WOLS_UNRESOLVED_REFERENCE',
  /** Encryption operation failed */
  ENCRYPTION_ERROR = 'WOLS_ENCRYPTION_ERROR',
  /** Decryption operation failed */
  DECRYPTION_ERROR = 'WOLS_DECRYPTION_ERROR',
  /** Invalid encryption key */
  INVALID_KEY = 'WOLS_INVALID_KEY',
  /** Signing failed or was refused (WOLS 1.4.0) */
  SIGNATURE_ERROR = 'WOLS_SIGNATURE_ERROR',
  /** Payload exceeds QR code capacity */
  SIZE_EXCEEDED = 'WOLS_SIZE_EXCEEDED',
  /** Unknown or unspecified error */
  UNKNOWN_ERROR = 'WOLS_UNKNOWN_ERROR',
}

// =============================================================================
// ERROR CLASSES
// =============================================================================

/**
 * Base WOLS error class.
 * All WOLS-specific errors extend this class.
 */
export class WolsError extends Error {
  /** Error code for programmatic handling */
  readonly code: WolsErrorCode;
  /** Additional error details */
  readonly details: Record<string, unknown> | undefined;

  constructor(code: WolsErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'WolsError';
    this.code = code;
    this.details = details ?? undefined;

    // Maintains proper stack trace for where error was thrown (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WolsError);
    }
  }

  /**
   * Convert error to JSON for serialization.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

/**
 * Parse error (JSON/format issues).
 * Thrown when parsing JSON or WOLS data fails.
 */
export class WolsParseError extends WolsError {
  /** Character position in the input where error occurred */
  readonly position: number | undefined;

  constructor(
    code: WolsErrorCode,
    message: string,
    details?: Record<string, unknown> & { position?: number }
  ) {
    super(code, message, details);
    this.name = 'WolsParseError';
    this.position = details?.position ?? undefined;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WolsParseError);
    }
  }
}

/**
 * A compact URL that {@link parseCompactUrl} refused (WOLS 1.5.0). `code` is
 * always `WolsErrorCode.INVALID_URL`; `reason` says which rule the URL broke,
 * using the reason names of the WOLS conformance vectors. `reason` is also
 * copied into `details.reason`.
 *
 * @example
 * ```typescript
 * const r = parseCompactUrl(text);
 * if (!r.success && r.error instanceof WolsCompactUrlError && r.error.reason === 'encrypted-url') {
 *   // hand the text to decryptSpecimen() instead
 * }
 * ```
 *
 * @since 1.5.0
 */
export class WolsCompactUrlError extends WolsParseError {
  /** Why the URL was refused */
  readonly reason: CompactUrlFailureReason;

  constructor(reason: CompactUrlFailureReason, message: string, details?: Record<string, unknown>) {
    super(WolsErrorCode.INVALID_URL, message, { ...details, reason });
    this.name = 'WolsCompactUrlError';
    this.reason = reason;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WolsCompactUrlError);
    }
  }
}

/**
 * Validation error (schema violations).
 * Thrown when specimen data fails validation.
 */
export class WolsValidationError extends WolsError {
  /** Array of validation errors */
  readonly errors: ValidationError[];

  constructor(message: string, errors: ValidationError[]) {
    super(WolsErrorCode.INVALID_FORMAT, message, { errors });
    this.name = 'WolsValidationError';
    this.errors = errors;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WolsValidationError);
    }
  }
}

/**
 * Encryption/decryption error.
 * Thrown when crypto operations fail.
 */
export class WolsEncryptionError extends WolsError {
  constructor(code: WolsErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, message, details);
    this.name = 'WolsEncryptionError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WolsEncryptionError);
    }
  }
}

/**
 * Decryption failure with a stable, typed {@link DecryptionFailureReason}.
 *
 * It extends `WolsEncryptionError` on purpose: 1.2.x returned a
 * `WolsEncryptionError` for decryption failures, so existing
 * `instanceof WolsEncryptionError` checks keep matching. Encryption misuse is
 * thrown as a plain `WolsEncryptionError`; decryption failures are returned as
 * this subclass, so check `instanceof WolsDecryptionError` to tell them apart.
 * Malformed encrypted URLs are reported here too (`invalid-url`), not as
 * `WolsParseError`, so every decryption input problem has one error type.
 *
 * Returned (never thrown) by `decryptSpecimen`, `decryptPlaintext`,
 * `decryptField` and `decryptFields`. `reason` is also copied into
 * `details.reason` for code that reads the generic error shape.
 *
 * @example
 * ```typescript
 * const r = await decryptSpecimen(url, { key });
 * if (!r.success && r.error.reason === 'legacy-format') {
 *   // a pre-1.3.0 label: retry with { allowLegacy: true } during migration
 * }
 * ```
 *
 * @since 1.3.0
 */
export class WolsDecryptionError extends WolsEncryptionError {
  /** Stable failure category */
  readonly reason: DecryptionFailureReason;

  constructor(reason: DecryptionFailureReason, message: string, details?: Record<string, unknown>) {
    super(
      reason === 'invalid-key' ? WolsErrorCode.INVALID_KEY : WolsErrorCode.DECRYPTION_ERROR,
      message,
      { ...details, reason }
    );
    this.name = 'WolsDecryptionError';
    this.reason = reason;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WolsDecryptionError);
    }
  }
}

/**
 * Thrown by `signSpecimen` and `signEncryptedUrl` when they refuse to sign
 * (a malformed label or URL, a URL that is already signed, a bad kid or key),
 * or when the runtime has no WebCrypto Ed25519 support.
 *
 * Never thrown for a bad signature: `verifySpecimen` reports those as a status.
 *
 * @since 1.4.0
 */
export class WolsSignatureError extends WolsError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(WolsErrorCode.SIGNATURE_ERROR, message, details);
    this.name = 'WolsSignatureError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WolsSignatureError);
    }
  }
}

// =============================================================================
// ERROR FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a required field error.
 */
export function requiredFieldError(field: string, path: string = field): WolsValidationError {
  return new WolsValidationError(`Required field '${field}' is missing`, [
    {
      path,
      code: WolsErrorCode.REQUIRED_FIELD,
      message: `Field '${field}' is required`,
    },
  ]);
}

/**
 * Create an invalid format error.
 */
export function invalidFormatError(
  field: string,
  expected: string,
  path: string = field
): WolsValidationError {
  return new WolsValidationError(`Invalid format for '${field}': expected ${expected}`, [
    {
      path,
      code: WolsErrorCode.INVALID_FORMAT,
      message: `Expected ${expected}`,
    },
  ]);
}

/**
 * Create a parse error from a caught exception.
 */
export function parseErrorFromException(error: unknown, _input?: string): WolsParseError {
  if (error instanceof SyntaxError) {
    // Extract position from JSON.parse error message
    const match = /position (\d+)/i.exec(error.message);
    const position = match?.[1] ? parseInt(match[1], 10) : undefined;

    const details: Record<string, unknown> = { originalError: error.message };
    if (position !== undefined) {
      details['position'] = position;
    }

    return new WolsParseError(WolsErrorCode.INVALID_JSON, error.message, details);
  }

  if (error instanceof WolsParseError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  return new WolsParseError(WolsErrorCode.PARSE_ERROR, message);
}
