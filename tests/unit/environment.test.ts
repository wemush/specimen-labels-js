/**
 * Unit tests for Environment Detection (v1.2.0)
 *
 * Tests for:
 * - isServer()
 * - isBrowser()
 * - isWebWorker()
 * - isDeno()
 * - isBun()
 * - getRuntimeEnvironment()
 * - supportsWebCrypto()
 * - supportsNodeCrypto()
 * - isCryptoSupported()
 * - supportsTextEncoding()
 * - supportsURLAPIs()
 */

import { describe, it, expect } from 'vitest';

import {
  isServer,
  isBrowser,
  isWebWorker,
  isDeno,
  isBun,
  getRuntimeEnvironment,
  supportsWebCrypto,
  supportsNodeCrypto,
  isCryptoSupported,
  supportsTextEncoding,
  supportsURLAPIs,
  type RuntimeEnvironment,
} from '../../src/index.js';

describe('Environment Detection (v1.2.0)', () => {
  describe('runtime detection functions', () => {
    describe('isServer()', () => {
      it('should return a boolean', () => {
        expect(typeof isServer()).toBe('boolean');
      });

      it('should return true when running in Node.js', () => {
        // In Vitest, we're running in Node.js
        expect(isServer()).toBe(true);
      });
    });

    describe('isBrowser()', () => {
      it('should return a boolean', () => {
        expect(typeof isBrowser()).toBe('boolean');
      });

      it('should return false when running in Node.js', () => {
        expect(isBrowser()).toBe(false);
      });
    });

    describe('isWebWorker()', () => {
      it('should return a boolean', () => {
        expect(typeof isWebWorker()).toBe('boolean');
      });

      it('should return false when running in Node.js', () => {
        expect(isWebWorker()).toBe(false);
      });
    });

    describe('isDeno()', () => {
      it('should return a boolean', () => {
        expect(typeof isDeno()).toBe('boolean');
      });

      it('should return false when running in Node.js', () => {
        expect(isDeno()).toBe(false);
      });
    });

    describe('isBun()', () => {
      it('should return a boolean', () => {
        expect(typeof isBun()).toBe('boolean');
      });

      // Note: This test may return true or false depending on test runner
      it('should return a consistent value', () => {
        const first = isBun();
        const second = isBun();
        expect(first).toBe(second);
      });
    });

    describe('getRuntimeEnvironment()', () => {
      it('should return a valid RuntimeEnvironment', () => {
        const env = getRuntimeEnvironment();
        const validEnvironments: RuntimeEnvironment[] = [
          'node',
          'browser',
          'webworker',
          'deno',
          'bun',
          'unknown',
        ];

        expect(validEnvironments).toContain(env);
      });

      it('should return node or bun when running tests', () => {
        const env = getRuntimeEnvironment();
        // Tests run in either Node.js or Bun
        expect(['node', 'bun']).toContain(env);
      });

      it('should be consistent with individual detection functions', () => {
        const env = getRuntimeEnvironment();

        if (env === 'node') {
          expect(isServer()).toBe(true);
          expect(isBrowser()).toBe(false);
        }

        if (env === 'bun') {
          expect(isBun()).toBe(true);
        }
      });
    });
  });

  describe('crypto detection functions', () => {
    describe('supportsWebCrypto()', () => {
      it('should return a boolean', () => {
        expect(typeof supportsWebCrypto()).toBe('boolean');
      });

      it('should return consistent results', () => {
        expect(supportsWebCrypto()).toBe(supportsWebCrypto());
      });
    });

    describe('supportsNodeCrypto()', () => {
      it('should return a boolean', () => {
        expect(typeof supportsNodeCrypto()).toBe('boolean');
      });

      it('should return true in Node.js environment', () => {
        // Node.js has crypto module
        if (isServer() && !isBun()) {
          expect(supportsNodeCrypto()).toBe(true);
        }
      });
    });

    describe('isCryptoSupported()', () => {
      it('should return a boolean', () => {
        expect(typeof isCryptoSupported()).toBe('boolean');
      });

      it('should return true when either Web Crypto or Node Crypto is available', () => {
        const hasCrypto = isCryptoSupported();
        const hasWebCrypto = supportsWebCrypto();
        const hasNodeCrypto = supportsNodeCrypto();

        expect(hasCrypto).toBe(hasWebCrypto || hasNodeCrypto);
      });

      it('should return true in standard Node.js environment', () => {
        // Node.js always has crypto
        expect(isCryptoSupported()).toBe(true);
      });
    });
  });

  describe('API detection functions', () => {
    describe('supportsTextEncoding()', () => {
      it('should return a boolean', () => {
        expect(typeof supportsTextEncoding()).toBe('boolean');
      });

      it('should return true in modern Node.js', () => {
        // Node.js 11+ has TextEncoder/TextDecoder
        expect(supportsTextEncoding()).toBe(true);
      });
    });

    describe('supportsURLAPIs()', () => {
      it('should return a boolean', () => {
        expect(typeof supportsURLAPIs()).toBe('boolean');
      });

      it('should return true in Node.js', () => {
        // Node.js has URL and URLSearchParams
        expect(supportsURLAPIs()).toBe(true);
      });
    });
  });

  describe('environment consistency', () => {
    it('should have mutually exclusive primary environments', () => {
      const environments = [isBrowser(), isServer() && !isBun() && !isDeno(), isWebWorker()];

      // At most one should be true (Bun and Deno are server-like)
      const trueCount = environments.filter(Boolean).length;
      expect(trueCount).toBeLessThanOrEqual(1);
    });

    it('should detect at least one known environment in test context', () => {
      const isKnownEnvironment =
        isServer() || isBrowser() || isWebWorker() || isDeno() || isBun();

      expect(isKnownEnvironment).toBe(true);
    });

    it('getRuntimeEnvironment should not return unknown in test context', () => {
      const env = getRuntimeEnvironment();

      expect(env).not.toBe('unknown');
    });
  });

  describe('type exports', () => {
    it('should export RuntimeEnvironment type', () => {
      // This is a compile-time check, but we verify the type exists
      const env: RuntimeEnvironment = getRuntimeEnvironment();
      expect(typeof env).toBe('string');
    });
  });
});
