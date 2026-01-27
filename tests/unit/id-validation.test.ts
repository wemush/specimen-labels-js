/**
 * Unit tests for Flexible ID Format Validation (v1.2.0)
 *
 * Tests for:
 * - idMode validation option (strict, ulid, uuid, any)
 * - customIdValidator option
 * - Various ID format patterns
 */

import { describe, it, expect } from 'vitest';

import {
  validateSpecimen,
  WOLS_CONTEXT,
  WolsErrorCode,
  type Specimen,
  type IdValidationMode,
} from '../../src/index.js';

describe('Flexible ID Format Validation (v1.2.0)', () => {
  // Helper to create a specimen with a specific ID
  const createTestSpecimen = (id: string): Specimen =>
    ({
      '@context': WOLS_CONTEXT,
      '@type': 'Specimen',
      id,
      version: '1.1.0',
      type: 'CULTURE',
      species: 'Pleurotus ostreatus',
    }) as Specimen;

  describe('default (strict) mode', () => {
    it('should accept valid CUID format', () => {
      const specimen = createTestSpecimen('wemush:clx1a2b3c4d5e6f7g8');

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(true);
    });

    it('should reject ID without wemush: prefix', () => {
      const specimen = createTestSpecimen('abc123def456');

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: 'id',
          code: WolsErrorCode.INVALID_ID_FORMAT,
        })
      );
    });

    it('should reject ID with uppercase characters', () => {
      const specimen = createTestSpecimen('wemush:ABC123DEF');

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(false);
    });

    it('should reject empty ID suffix', () => {
      const specimen = createTestSpecimen('wemush:');

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(false);
    });
  });

  describe('ulid mode', () => {
    const ulidOptions = { idMode: 'ulid' as IdValidationMode };

    it('should accept valid ULID format', () => {
      // Valid ULID: 26 characters using Crockford Base32
      const specimen = createTestSpecimen('wemush:01ARZ3NDEKTSV4RRFFQ69G5FAV');

      const result = validateSpecimen(specimen, ulidOptions);

      expect(result.valid).toBe(true);
    });

    it('should accept lowercase ULID', () => {
      const specimen = createTestSpecimen('wemush:01arz3ndektsv4rrffq69g5fav');

      const result = validateSpecimen(specimen, ulidOptions);

      expect(result.valid).toBe(true);
    });

    it('should reject invalid ULID (too short)', () => {
      const specimen = createTestSpecimen('wemush:01ARZ3NDEK');

      const result = validateSpecimen(specimen, ulidOptions);

      expect(result.valid).toBe(false);
    });

    it('should reject invalid ULID (invalid characters)', () => {
      // ULID doesn't use I, L, O, U
      const specimen = createTestSpecimen('wemush:01ARZ3NDEKTSV4RRFFQI9G5FAL');

      const result = validateSpecimen(specimen, ulidOptions);

      expect(result.valid).toBe(false);
    });
  });

  describe('uuid mode', () => {
    const uuidOptions = { idMode: 'uuid' as IdValidationMode };

    it('should accept valid UUID v4 format', () => {
      const specimen = createTestSpecimen('wemush:550e8400-e29b-41d4-a716-446655440000');

      const result = validateSpecimen(specimen, uuidOptions);

      expect(result.valid).toBe(true);
    });

    it('should accept valid UUID v1 format', () => {
      const specimen = createTestSpecimen('wemush:6ba7b810-9dad-11d1-80b4-00c04fd430c8');

      const result = validateSpecimen(specimen, uuidOptions);

      expect(result.valid).toBe(true);
    });

    it('should accept lowercase UUID', () => {
      const specimen = createTestSpecimen('wemush:550e8400-e29b-41d4-a716-446655440000');

      const result = validateSpecimen(specimen, uuidOptions);

      expect(result.valid).toBe(true);
    });

    it('should reject invalid UUID format', () => {
      const specimen = createTestSpecimen('wemush:not-a-valid-uuid');

      const result = validateSpecimen(specimen, uuidOptions);

      expect(result.valid).toBe(false);
    });

    it('should reject UUID without hyphens', () => {
      const specimen = createTestSpecimen('wemush:550e8400e29b41d4a716446655440000');

      const result = validateSpecimen(specimen, uuidOptions);

      expect(result.valid).toBe(false);
    });
  });

  describe('any mode', () => {
    const anyOptions = { idMode: 'any' as IdValidationMode };

    it('should accept any non-empty suffix', () => {
      const specimen = createTestSpecimen('wemush:any-format-works-here-123');

      const result = validateSpecimen(specimen, anyOptions);

      expect(result.valid).toBe(true);
    });

    it('should accept CUID format', () => {
      const specimen = createTestSpecimen('wemush:clx1a2b3c4d5e6f7g8');

      const result = validateSpecimen(specimen, anyOptions);

      expect(result.valid).toBe(true);
    });

    it('should accept ULID format', () => {
      const specimen = createTestSpecimen('wemush:01ARZ3NDEKTSV4RRFFQ69G5FAV');

      const result = validateSpecimen(specimen, anyOptions);

      expect(result.valid).toBe(true);
    });

    it('should accept UUID format', () => {
      const specimen = createTestSpecimen('wemush:550e8400-e29b-41d4-a716-446655440000');

      const result = validateSpecimen(specimen, anyOptions);

      expect(result.valid).toBe(true);
    });

    it('should accept custom ID format', () => {
      const specimen = createTestSpecimen('wemush:CUSTOM_PLATFORM_ID_12345');

      const result = validateSpecimen(specimen, anyOptions);

      expect(result.valid).toBe(true);
    });

    it('should still require wemush: prefix', () => {
      const specimen = createTestSpecimen('custom:123');

      const result = validateSpecimen(specimen, anyOptions);

      expect(result.valid).toBe(false);
    });

    it('should still reject empty suffix', () => {
      const specimen = createTestSpecimen('wemush:');

      const result = validateSpecimen(specimen, anyOptions);

      expect(result.valid).toBe(false);
    });
  });

  describe('customIdValidator', () => {
    it('should use custom validator when provided', () => {
      const specimen = createTestSpecimen('wemush:CUSTOM123');

      // Custom validator that requires IDs to start with CUSTOM
      const result = validateSpecimen(specimen, {
        customIdValidator: id => id.startsWith('wemush:CUSTOM'),
      });

      expect(result.valid).toBe(true);
    });

    it('should reject IDs that fail custom validation', () => {
      const specimen = createTestSpecimen('wemush:OTHER123');

      const result = validateSpecimen(specimen, {
        customIdValidator: id => id.startsWith('wemush:CUSTOM'),
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: 'id',
          code: WolsErrorCode.INVALID_ID_FORMAT,
        })
      );
    });

    it('should allow complex validation logic', () => {
      const specimen = createTestSpecimen('wemush:ORG001-BATCH123-SPEC456');

      // Validate compound ID format
      const result = validateSpecimen(specimen, {
        customIdValidator: id => {
          const suffix = id.replace('wemush:', '');
          const parts = suffix.split('-');
          return parts.length === 3 && parts[0]!.startsWith('ORG');
        },
      });

      expect(result.valid).toBe(true);
    });

    it('should override idMode when customIdValidator is provided', () => {
      const specimen = createTestSpecimen('wemush:CUSTOM_FORMAT');

      // This would fail strict mode, but custom validator allows it
      const result = validateSpecimen(specimen, {
        idMode: 'strict',
        customIdValidator: () => true, // Accept all
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle very long IDs', () => {
      const longId = 'wemush:' + 'a'.repeat(1000);
      const specimen = createTestSpecimen(longId);

      const result = validateSpecimen(specimen, { idMode: 'any' });

      expect(result.valid).toBe(true);
    });

    it('should handle IDs with special characters in any mode', () => {
      const specimen = createTestSpecimen('wemush:id-with_special.chars');

      const result = validateSpecimen(specimen, { idMode: 'any' });

      expect(result.valid).toBe(true);
    });

    it('should handle numeric-only suffix', () => {
      const specimen = createTestSpecimen('wemush:12345678901234567890');

      const result = validateSpecimen(specimen, { idMode: 'any' });

      expect(result.valid).toBe(true);
    });
  });
});
