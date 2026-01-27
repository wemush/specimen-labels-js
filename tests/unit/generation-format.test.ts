/**
 * Unit tests for Generation Format Flexibility (v1.2.0)
 *
 * Tests for:
 * - normalizeGeneration()
 * - isValidGeneration()
 * - Expanded generation patterns (F{n}, G{n}, P, numeric)
 */

import { describe, it, expect } from 'vitest';

import {
  normalizeGeneration,
  isValidGeneration,
  validateSpecimen,
  WOLS_CONTEXT,
  asSpecimenId,
  type Specimen,
} from '../../src/index.js';

describe('Generation Format Flexibility (v1.2.0)', () => {
  describe('isValidGeneration()', () => {
    describe('filial notation (F{n})', () => {
      it('should accept F1', () => {
        expect(isValidGeneration('F1')).toBe(true);
      });

      it('should accept F2', () => {
        expect(isValidGeneration('F2')).toBe(true);
      });

      it('should accept F10', () => {
        expect(isValidGeneration('F10')).toBe(true);
      });

      it('should accept F99', () => {
        expect(isValidGeneration('F99')).toBe(true);
      });
    });

    describe('parental notation (P)', () => {
      it('should accept P', () => {
        expect(isValidGeneration('P')).toBe(true);
      });
    });

    describe('generational notation (G{n})', () => {
      it('should accept G1', () => {
        expect(isValidGeneration('G1')).toBe(true);
      });

      it('should accept G2', () => {
        expect(isValidGeneration('G2')).toBe(true);
      });

      it('should accept G10', () => {
        expect(isValidGeneration('G10')).toBe(true);
      });
    });

    describe('numeric notation', () => {
      it('should accept 1', () => {
        expect(isValidGeneration('1')).toBe(true);
      });

      it('should accept 2', () => {
        expect(isValidGeneration('2')).toBe(true);
      });

      it('should accept 10', () => {
        expect(isValidGeneration('10')).toBe(true);
      });
    });

    describe('case insensitivity', () => {
      it('should accept lowercase f1', () => {
        // Implementation converts to uppercase
        expect(isValidGeneration('f1')).toBe(true);
      });

      it('should accept lowercase g1', () => {
        expect(isValidGeneration('g1')).toBe(true);
      });

      it('should accept lowercase p', () => {
        expect(isValidGeneration('p')).toBe(true);
      });

      it('should accept mixed case', () => {
        expect(isValidGeneration('F1')).toBe(true);
        expect(isValidGeneration('f1')).toBe(true);
      });
    });

    describe('invalid formats', () => {
      it('should reject empty string', () => {
        expect(isValidGeneration('')).toBe(false);
      });

      it('should reject arbitrary text', () => {
        expect(isValidGeneration('first')).toBe(false);
        expect(isValidGeneration('generation1')).toBe(false);
      });

      it('should reject negative numbers', () => {
        expect(isValidGeneration('-1')).toBe(false);
      });

      it('should reject decimal numbers', () => {
        expect(isValidGeneration('1.5')).toBe(false);
      });
    });
  });

  describe('normalizeGeneration()', () => {
    describe('preserve format (default)', () => {
      it('should preserve F1 as F1', () => {
        expect(normalizeGeneration('F1')).toBe('F1');
      });

      it('should preserve G1 as G1', () => {
        expect(normalizeGeneration('G1')).toBe('G1');
      });

      it('should preserve P as P', () => {
        expect(normalizeGeneration('P')).toBe('P');
      });

      it('should preserve numeric as numeric', () => {
        expect(normalizeGeneration('5')).toBe('5');
      });
    });

    describe('filial format', () => {
      it('should convert G1 to F1', () => {
        expect(normalizeGeneration('G1', 'filial')).toBe('F1');
      });

      it('should convert G5 to F5', () => {
        expect(normalizeGeneration('G5', 'filial')).toBe('F5');
      });

      it('should convert numeric 3 to F3', () => {
        expect(normalizeGeneration('3', 'filial')).toBe('F3');
      });

      it('should preserve F2 as F2', () => {
        expect(normalizeGeneration('F2', 'filial')).toBe('F2');
      });

      it('should preserve P as P', () => {
        expect(normalizeGeneration('P', 'filial')).toBe('P');
      });
    });

    describe('numeric format', () => {
      it('should convert F1 to 1', () => {
        expect(normalizeGeneration('F1', 'numeric')).toBe('1');
      });

      it('should convert F5 to 5', () => {
        expect(normalizeGeneration('F5', 'numeric')).toBe('5');
      });

      it('should convert G3 to 3', () => {
        expect(normalizeGeneration('G3', 'numeric')).toBe('3');
      });

      it('should preserve numeric 7 as 7', () => {
        expect(normalizeGeneration('7', 'numeric')).toBe('7');
      });

      it('should convert P to 0', () => {
        expect(normalizeGeneration('P', 'numeric')).toBe('0');
      });
    });

    describe('invalid input handling', () => {
      it('should return invalid input unchanged', () => {
        expect(normalizeGeneration('invalid')).toBe('invalid');
      });

      it('should return empty string unchanged', () => {
        expect(normalizeGeneration('')).toBe('');
      });
    });
  });

  describe('validator integration', () => {
    it('should validate specimen with F1 generation', () => {
      const specimen: Specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: asSpecimenId('wemush:abc123def456'),
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        strain: {
          name: 'Blue Oyster',
          generation: 'F1',
        },
      };

      const result = validateSpecimen(specimen);
      expect(result.valid).toBe(true);
    });

    it('should validate specimen with G1 generation', () => {
      const specimen: Specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: asSpecimenId('wemush:abc123def456'),
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        strain: {
          name: 'Blue Oyster',
          generation: 'G1',
        },
      };

      const result = validateSpecimen(specimen);
      expect(result.valid).toBe(true);
    });

    it('should validate specimen with P generation', () => {
      const specimen: Specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: asSpecimenId('wemush:abc123def456'),
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        strain: {
          name: 'Blue Oyster',
          generation: 'P',
        },
      };

      const result = validateSpecimen(specimen);
      expect(result.valid).toBe(true);
    });

    it('should validate specimen with numeric generation', () => {
      const specimen: Specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: asSpecimenId('wemush:abc123def456'),
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        strain: {
          name: 'Blue Oyster',
          generation: '3',
        },
      };

      const result = validateSpecimen(specimen);
      expect(result.valid).toBe(true);
    });
  });
});
