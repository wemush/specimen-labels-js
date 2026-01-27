/**
 * Environment Detection Utilities
 *
 * This module provides runtime environment detection for selecting
 * appropriate crypto implementations and other environment-specific behavior.
 *
 * @module utils/environment
 * @since 1.2.0
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Runtime environment type.
 *
 * @since 1.2.0
 */
export type RuntimeEnvironment = 'node' | 'browser' | 'webworker' | 'deno' | 'bun' | 'unknown';

// =============================================================================
// ENVIRONMENT DETECTION
// =============================================================================

/**
 * Check if running in a server-side Node.js environment.
 *
 * @returns True if running in Node.js, false otherwise
 *
 * @example
 * ```typescript
 * if (isServer()) {
 *   // Use Node.js crypto module
 * }
 * ```
 *
 * @since 1.2.0
 */
export function isServer(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as unknown as { process?: { versions?: { node?: string } } }).process
      ?.versions?.node === 'string'
  );
}

/**
 * Check if running in a browser environment.
 *
 * @returns True if running in a browser, false otherwise
 *
 * @example
 * ```typescript
 * if (isBrowser()) {
 *   // Use Web Crypto API
 * }
 * ```
 *
 * @since 1.2.0
 */
export function isBrowser(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as unknown as { window?: unknown }).window !== 'undefined' &&
    typeof (globalThis as unknown as { document?: unknown }).document !== 'undefined'
  );
}

/**
 * Check if running in a Web Worker environment.
 *
 * @returns True if running in a Web Worker, false otherwise
 *
 * @since 1.2.0
 */
export function isWebWorker(): boolean {
  // Check if WorkerGlobalScope exists and if self is an instance of it
  // In a Web Worker, self instanceof WorkerGlobalScope is true
  // In the main thread, WorkerGlobalScope doesn't exist or self is not an instance
  if (typeof globalThis === 'undefined') {
    return false;
  }

  const global = globalThis as unknown as {
    WorkerGlobalScope?: new () => object;
    self?: object;
  };

  return (
    typeof global.WorkerGlobalScope !== 'undefined' &&
    typeof global.self !== 'undefined' &&
    global.self instanceof global.WorkerGlobalScope
  );
}

/**
 * Check if running in Deno environment.
 *
 * @returns True if running in Deno, false otherwise
 *
 * @since 1.2.0
 */
export function isDeno(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as unknown as { Deno?: unknown }).Deno !== 'undefined'
  );
}

/**
 * Check if running in Bun environment.
 *
 * @returns True if running in Bun, false otherwise
 *
 * @since 1.2.0
 */
export function isBun(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as unknown as { Bun?: unknown }).Bun !== 'undefined'
  );
}

/**
 * Get the current runtime environment.
 *
 * @returns The detected runtime environment
 *
 * @example
 * ```typescript
 * const env = getRuntimeEnvironment();
 * console.log(`Running in: ${env}`);
 * ```
 *
 * @since 1.2.0
 */
export function getRuntimeEnvironment(): RuntimeEnvironment {
  if (isBun()) return 'bun';
  if (isDeno()) return 'deno';
  if (isServer()) return 'node';
  if (isWebWorker()) return 'webworker';
  if (isBrowser()) return 'browser';
  return 'unknown';
}

// =============================================================================
// CRYPTO SUPPORT DETECTION
// =============================================================================

/**
 * Check if Web Crypto API is available.
 *
 * @returns True if Web Crypto API is available, false otherwise
 *
 * @since 1.2.0
 */
export function supportsWebCrypto(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as unknown as { crypto?: { subtle?: unknown } }).crypto?.subtle !==
      'undefined'
  );
}

/**
 * Check if Node.js crypto module is available.
 *
 * Note: This performs a synchronous check and does not actually import the module.
 *
 * @returns True if likely running in Node.js with crypto support, false otherwise
 *
 * @since 1.2.0
 */
export function supportsNodeCrypto(): boolean {
  return isServer() || isBun();
}

/**
 * Check if any cryptographic support is available.
 *
 * This is useful for determining if encryption/decryption features can be used.
 *
 * @returns True if crypto is supported, false otherwise
 *
 * @example
 * ```typescript
 * if (isCryptoSupported()) {
 *   const encrypted = await encryptSpecimen(specimen, { key: password });
 * } else {
 *   console.warn('Crypto not supported in this environment');
 * }
 * ```
 *
 * @since 1.2.0
 */
export function isCryptoSupported(): boolean {
  return supportsWebCrypto() || supportsNodeCrypto();
}

// =============================================================================
// FEATURE DETECTION
// =============================================================================

/**
 * Check if TextEncoder/TextDecoder are available.
 *
 * @returns True if text encoding is supported, false otherwise
 *
 * @since 1.2.0
 */
export function supportsTextEncoding(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as unknown as { TextEncoder?: unknown }).TextEncoder !== 'undefined' &&
    typeof (globalThis as unknown as { TextDecoder?: unknown }).TextDecoder !== 'undefined'
  );
}

/**
 * Check if URL and URLSearchParams are available.
 *
 * @returns True if URL APIs are supported, false otherwise
 *
 * @since 1.2.0
 */
export function supportsURLAPIs(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as unknown as { URL?: unknown }).URL !== 'undefined' &&
    typeof (globalThis as unknown as { URLSearchParams?: unknown }).URLSearchParams !== 'undefined'
  );
}
