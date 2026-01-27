/**
 * Unit tests for Convenience Methods (v1.2.0)
 *
 * Tests for:
 * - parseCompactUrlOrThrow()
 * - parseCompactUrlOrNull()
 */

import { describe, it, expect } from 'vitest';

import {
  parseCompactUrl,
  parseCompactUrlOrThrow,
  parseCompactUrlOrNull,
  WolsParseError,
} from '../../src/index.js';

describe('Convenience Methods (v1.2.0)', () => {
  // Valid compact URL for testing
  const validUrl = 'wemush://v1/abc123?s=POSTR&st=INOCULATION';

  // Invalid URLs for testing
  const invalidUrls = [
    '',
    'not-a-url',
    'http://example.com',
    'wemush://', // Missing version
    'wemush://v1/', // Missing ID
    'wemush://v2/abc123', // Invalid version
  ];

  describe('parseCompactUrlOrThrow()', () => {
    it('should return SpecimenRef for valid URL', () => {
      const result = parseCompactUrlOrThrow(validUrl);

      expect(result).toBeDefined();
      expect(result.id).toBe('wemush:abc123');
      expect(result.species).toBe('Pleurotus ostreatus');
      expect(result.stage).toBe('INOCULATION');
    });

    it('should throw WolsParseError for invalid URL', () => {
      expect(() => {
        parseCompactUrlOrThrow('invalid-url');
      }).toThrow(WolsParseError);
    });

    it('should throw for empty string', () => {
      expect(() => {
        parseCompactUrlOrThrow('');
      }).toThrow();
    });

    it.each(invalidUrls)('should throw for invalid URL: %s', url => {
      expect(() => {
        parseCompactUrlOrThrow(url);
      }).toThrow();
    });

    it('should provide meaningful error message', () => {
      try {
        parseCompactUrlOrThrow('bad-url');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBeTruthy();
      }
    });

    it('should behave consistently with parseCompactUrl success case', () => {
      const throwResult = parseCompactUrlOrThrow(validUrl);
      const parseResult = parseCompactUrl(validUrl);

      expect(parseResult.success).toBe(true);
      if (parseResult.success) {
        expect(throwResult).toEqual(parseResult.data);
      }
    });
  });

  describe('parseCompactUrlOrNull()', () => {
    it('should return SpecimenRef for valid URL', () => {
      const result = parseCompactUrlOrNull(validUrl);

      expect(result).not.toBeNull();
      expect(result?.id).toBe('wemush:abc123');
      expect(result?.species).toBe('Pleurotus ostreatus');
    });

    it('should return null for invalid URL', () => {
      const result = parseCompactUrlOrNull('invalid-url');

      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = parseCompactUrlOrNull('');

      expect(result).toBeNull();
    });

    it.each(invalidUrls)('should return null for invalid URL: %s', url => {
      const result = parseCompactUrlOrNull(url);

      expect(result).toBeNull();
    });

    it('should not throw for any input', () => {
      const testInputs = [
        '',
        null,
        undefined,
        123,
        {},
        [],
        'random garbage !@#$%',
        'wemush://invalid',
      ];

      for (const input of testInputs) {
        expect(() => {
          parseCompactUrlOrNull(input as unknown as string);
        }).not.toThrow();
      }
    });

    it('should behave consistently with parseCompactUrl success case', () => {
      const nullResult = parseCompactUrlOrNull(validUrl);
      const parseResult = parseCompactUrl(validUrl);

      expect(parseResult.success).toBe(true);
      if (parseResult.success) {
        expect(nullResult).toEqual(parseResult.data);
      }
    });

    it('should behave consistently with parseCompactUrl failure case', () => {
      const nullResult = parseCompactUrlOrNull('bad-url');
      const parseResult = parseCompactUrl('bad-url');

      expect(parseResult.success).toBe(false);
      expect(nullResult).toBeNull();
    });
  });

  describe('comparison between methods', () => {
    it('should return equivalent results for valid input', () => {
      const throwResult = parseCompactUrlOrThrow(validUrl);
      const nullResult = parseCompactUrlOrNull(validUrl);

      expect(throwResult).toEqual(nullResult);
    });

    it('should handle the same valid inputs identically', () => {
      const urls = [
        'wemush://v1/spec123?s=POSTR',
        'wemush://v1/test456?s=HERIN&st=COLONIZATION',
        'wemush://v1/abc',
      ];

      for (const url of urls) {
        let throwResult;
        let nullResult;

        try {
          throwResult = parseCompactUrlOrThrow(url);
        } catch {
          throwResult = null;
        }

        nullResult = parseCompactUrlOrNull(url);

        expect(throwResult).toEqual(nullResult);
      }
    });
  });

  describe('type safety', () => {
    it('parseCompactUrlOrThrow should return typed SpecimenRef', () => {
      const result = parseCompactUrlOrThrow(validUrl);

      // TypeScript compile-time check
      const id: string = result.id;
      const species: string = result.species;

      expect(id).toBeTruthy();
      expect(species).toBeTruthy();
    });

    it('parseCompactUrlOrNull should return nullable SpecimenRef', () => {
      const result = parseCompactUrlOrNull(validUrl);

      // Must check for null before accessing properties
      if (result !== null) {
        const id: string = result.id;
        expect(id).toBeTruthy();
      }
    });
  });
});
