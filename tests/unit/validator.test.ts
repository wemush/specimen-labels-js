/**
 * Validator Unit Tests
 *
 * Tests for the validateSpecimen() function.
 * TDD: Write these tests FIRST before implementation.
 */
import { describe, it, expect } from 'vitest';
import {
  validateSpecimen,
  WolsErrorCode,
  WOLS_CONTEXT,
  asSpecimenId,
  type Specimen,
  type ValidationError,
} from '../../src/index.js';

// Load test fixtures
import fixtures from '../fixtures/specimens.json';

describe('validateSpecimen()', () => {
  describe('valid specimens', () => {
    it('should validate minimal valid specimen', () => {
      const specimen: Specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: asSpecimenId('wemush:abc123def456'),
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      };

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should validate specimen with all optional fields', () => {
      const specimen: Specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: asSpecimenId('wemush:abc123def456'),
        version: '1.1.0',
        type: 'SUBSTRATE',
        species: 'Hericium erinaceus',
        strain: {
          name: "Lion's Mane Premium",
          generation: 'F2',
          clonalGeneration: 3,
        },
        stage: 'COLONIZATION',
        created: '2025-12-16T10:30:00Z',
        batch: 'batch_2025_12_001',
        organization: 'org_mushoh',
      };

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate all specimen types from fixtures', () => {
      for (const validSpecimen of fixtures.valid) {
        const result = validateSpecimen(validSpecimen as unknown as Specimen);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }
    });

    it('should validate specimen with custom fields', () => {
      const specimen: Specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: asSpecimenId('wemush:abc123def456'),
        version: '1.1.0',
        type: 'FRUITING',
        species: 'Pleurotus citrinopileatus',
        custom: {
          vendorCode: 'GOLDENOYSTER001',
          notes: 'First flush expected',
        },
      };

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(true);
    });
  });

  describe('required field validation', () => {
    it('should fail when @context is missing', () => {
      const specimen = {
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      } as unknown as Specimen;

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: '@context',
          code: expect.stringMatching(/INVALID_CONTEXT|REQUIRED_FIELD/),
        })
      );
    });

    it('should fail when @type is missing', () => {
      const specimen = {
        '@context': WOLS_CONTEXT,
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      } as unknown as Specimen;

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: '@type',
          code: expect.stringMatching(/INVALID_TYPE|REQUIRED_FIELD/),
        })
      );
    });

    it('should fail when id is missing', () => {
      const specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      } as unknown as Specimen;

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: 'id',
          code: WolsErrorCode.REQUIRED_FIELD,
        })
      );
    });

    it('should fail when version is missing', () => {
      const specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      } as unknown as Specimen;

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: 'version',
          code: WolsErrorCode.REQUIRED_FIELD,
        })
      );
    });

    it('should fail when type is missing', () => {
      const specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        species: 'Pleurotus ostreatus',
      } as unknown as Specimen;

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: 'type',
          code: WolsErrorCode.REQUIRED_FIELD,
        })
      );
    });

    it('should fail when species is missing', () => {
      const specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
      } as unknown as Specimen;

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: 'species',
          code: WolsErrorCode.REQUIRED_FIELD,
        })
      );
    });
  });

  describe('format validation', () => {
    it('should fail when @context has wrong URL', () => {
      const specimen = {
        '@context': 'https://example.com/wrong',
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      } as unknown as Specimen;

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: '@context',
          code: WolsErrorCode.INVALID_CONTEXT,
        })
      );
    });

    it('should fail when @type is not Specimen', () => {
      const specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'NotASpecimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      } as unknown as Specimen;

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: '@type',
          code: WolsErrorCode.INVALID_TYPE,
        })
      );
    });

    it('should fail when id is missing wemush: prefix', () => {
      const specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      } as unknown as Specimen;

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: 'id',
          code: WolsErrorCode.INVALID_ID_FORMAT,
        })
      );
    });

    it('should fail when id has uppercase characters', () => {
      const specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:ABC123DEF456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      } as unknown as Specimen;

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: 'id',
          code: WolsErrorCode.INVALID_ID_FORMAT,
        })
      );
    });

    it('should fail when version is not valid semver', () => {
      const specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: 'invalid',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      } as unknown as Specimen;

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: 'version',
          code: WolsErrorCode.INVALID_VERSION,
        })
      );
    });

    it('should fail when created has invalid ISO 8601 format', () => {
      const specimen: Specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: asSpecimenId('wemush:abc123def456'),
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        created: '2025-12-16', // Date only, missing time
      };

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: 'created',
          code: WolsErrorCode.INVALID_DATE_FORMAT,
        })
      );
    });
  });

  describe('enum validation', () => {
    it('should fail for invalid specimen type', () => {
      const specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'INVALID_TYPE',
        species: 'Pleurotus ostreatus',
      } as unknown as Specimen;

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: 'type',
          code: WolsErrorCode.INVALID_SPECIMEN_TYPE,
        })
      );
    });

    it('should validate all SpecimenType enum values', () => {
      const types = ['CULTURE', 'SPAWN', 'SUBSTRATE', 'FRUITING', 'HARVEST'];

      for (const type of types) {
        const specimen: Specimen = {
          '@context': WOLS_CONTEXT,
          '@type': 'Specimen',
          id: asSpecimenId('wemush:abc123def456'),
          version: '1.1.0',
          type: type as Specimen['type'],
          species: 'Pleurotus ostreatus',
        };

        const result = validateSpecimen(specimen);
        expect(result.valid).toBe(true);
      }
    });

    it('should validate all GrowthStage enum values', () => {
      const stages = ['INOCULATION', 'COLONIZATION', 'FRUITING', 'HARVEST'];

      for (const stage of stages) {
        const specimen: Specimen = {
          '@context': WOLS_CONTEXT,
          '@type': 'Specimen',
          id: asSpecimenId('wemush:abc123def456'),
          version: '1.1.0',
          type: 'CULTURE',
          species: 'Pleurotus ostreatus',
          stage: stage as Specimen['stage'],
        };

        const result = validateSpecimen(specimen);
        expect(result.valid).toBe(true);
      }
    });

    it('should fail for invalid growth stage', () => {
      const specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        stage: 'INVALID_STAGE',
      } as unknown as Specimen;

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: 'stage',
        })
      );
    });
  });

  describe('nested strain validation', () => {
    it('should validate strain with only name', () => {
      const specimen: Specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: asSpecimenId('wemush:abc123def456'),
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        strain: { name: 'Blue Oyster' },
      };

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(true);
    });

    it('should fail when strain is missing name', () => {
      const specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        strain: { generation: 'F2' },
      } as unknown as Specimen;

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: 'strain.name',
          code: WolsErrorCode.REQUIRED_FIELD,
        })
      );
    });

    it('should validate strain with all optional fields', () => {
      const specimen: Specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: asSpecimenId('wemush:abc123def456'),
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        strain: {
          name: 'Blue Oyster',
          generation: 'F2',
          clonalGeneration: 3,
          lineage: 'wemush:parent123',
          source: 'tissue',
        },
      };

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(true);
    });

    it('should fail for invalid generation format', () => {
      const specimen: Specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: asSpecimenId('wemush:abc123def456'),
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        strain: {
          name: 'Blue Oyster',
          generation: 'invalid', // Should be F1, F2, P, etc.
        },
      };

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: 'strain.generation',
          code: WolsErrorCode.INVALID_GENERATION,
        })
      );
    });

    it('should fail when clonalGeneration is not a positive integer', () => {
      const specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        strain: {
          name: 'Blue Oyster',
          clonalGeneration: -1,
        },
      } as unknown as Specimen;

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: 'strain.clonalGeneration',
        })
      );
    });
  });

  describe('validation options', () => {
    it('should allow unknown fields with allowUnknownFields option', () => {
      const specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        unknownField: 'some value',
      } as unknown as Specimen;

      const result = validateSpecimen(specimen, { allowUnknownFields: true });

      expect(result.valid).toBe(true);
    });

    it('should warn about unknown fields by default', () => {
      const specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        unknownField: 'some value',
      } as unknown as Specimen;

      const result = validateSpecimen(specimen);

      // Should still be valid but with warning
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          path: 'unknownField',
        })
      );
    });

    it('should support lenient mode', () => {
      const specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        created: '2025-12-16', // Invalid format
      } as unknown as Specimen;

      const result = validateSpecimen(specimen, { level: 'lenient' });

      // Lenient mode should pass but warn
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('multiple errors', () => {
    it('should collect multiple validation errors', () => {
      const specimen = {
        '@context': 'https://wrong.com',
        '@type': 'WrongType',
        id: 'invalid-id',
        version: 'bad',
        type: 'INVALID',
        // Missing species
      } as unknown as Specimen;

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(3);
    });

    it('should report all validation errors from fixtures', () => {
      for (const invalidCase of fixtures.invalid) {
        const result = validateSpecimen(invalidCase.specimen as unknown as Specimen);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e: ValidationError) => e.code === invalidCase.expectedError)).toBe(true);
      }
    });
  });

  describe('edge cases', () => {
    it('should handle null input', () => {
      const result = validateSpecimen(null as unknown as Specimen);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle undefined input', () => {
      const result = validateSpecimen(undefined as unknown as Specimen);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle non-object input', () => {
      const result = validateSpecimen('not an object' as unknown as Specimen);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle empty object input', () => {
      const result = validateSpecimen({} as unknown as Specimen);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle empty species string', () => {
      const specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: '',
      } as unknown as Specimen;

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: 'species',
        })
      );
    });
  });
});
