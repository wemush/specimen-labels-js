/**
 * Unit tests for Compact URL functionality
 * Tests toCompactUrl() and parseCompactUrl() functions
 */

import { describe, it, expect } from 'vitest';

import {
  toCompactUrl,
  parseCompactUrl,
  getSpeciesFromCode,
  getCodeFromSpecies,
  registerSpeciesCode,
  SPECIES_CODES,
} from '../../src/compact-url.js';
import { createSpecimen } from '../../src/specimen.js';
import type { Specimen, SpecimenId } from '../../src/types.js';

describe('Compact URL', () => {
  // Sample specimen for testing
  const sampleSpecimen: Specimen = {
    '@context': 'https://wemush.com/wols/v1',
    '@type': 'Specimen',
    id: 'wemush:clx1a2b3c4d5e6f7g8h9i0j1' as SpecimenId,
    version: '1.1.0',
    type: 'CULTURE',
    species: 'Pleurotus ostreatus',
    stage: 'COLONIZATION',
    created: '2025-12-16T10:30:00Z',
  };

  describe('SPECIES_CODES constant', () => {
    it('should include common species codes', () => {
      expect(SPECIES_CODES.POSTR).toBe('Pleurotus ostreatus');
      expect(SPECIES_CODES.HERIN).toBe('Hericium erinaceus');
      expect(SPECIES_CODES.GLUCI).toBe('Ganoderma lucidum');
      expect(SPECIES_CODES.LLENC).toBe('Lentinula edodes');
    });

    it('should include all standard species from specification', () => {
      expect(Object.keys(SPECIES_CODES).length).toBeGreaterThanOrEqual(10);
    });
  });

  describe('getSpeciesFromCode()', () => {
    it('should return species name for known code', () => {
      expect(getSpeciesFromCode('POSTR')).toBe('Pleurotus ostreatus');
      expect(getSpeciesFromCode('HERIN')).toBe('Hericium erinaceus');
      expect(getSpeciesFromCode('GLUCI')).toBe('Ganoderma lucidum');
    });

    it('should return undefined for unknown code', () => {
      expect(getSpeciesFromCode('XXXXX')).toBeUndefined();
    });

    it('should be case-sensitive', () => {
      expect(getSpeciesFromCode('postr')).toBeUndefined();
      expect(getSpeciesFromCode('Postr')).toBeUndefined();
    });
  });

  describe('getCodeFromSpecies()', () => {
    it('should return code for known species', () => {
      expect(getCodeFromSpecies('Pleurotus ostreatus')).toBe('POSTR');
      expect(getCodeFromSpecies('Hericium erinaceus')).toBe('HERIN');
      expect(getCodeFromSpecies('Ganoderma lucidum')).toBe('GLUCI');
    });

    it('should return undefined for unknown species', () => {
      expect(getCodeFromSpecies('Unknown species')).toBeUndefined();
    });

    it('should be case-sensitive for species names', () => {
      expect(getCodeFromSpecies('pleurotus ostreatus')).toBeUndefined();
    });
  });

  describe('registerSpeciesCode()', () => {
    it('should register a new species code', () => {
      registerSpeciesCode('TSPEC', 'Test species');
      expect(getSpeciesFromCode('TSPEC')).toBe('Test species');
      expect(getCodeFromSpecies('Test species')).toBe('TSPEC');
    });

    it('should allow overwriting existing code', () => {
      registerSpeciesCode('OVER1', 'Original species');
      registerSpeciesCode('OVER1', 'New species');
      expect(getSpeciesFromCode('OVER1')).toBe('New species');
    });

    it('should update reverse lookup when overwriting', () => {
      registerSpeciesCode('OVER2', 'First species');
      registerSpeciesCode('OVER2', 'Second species');
      expect(getCodeFromSpecies('Second species')).toBe('OVER2');
    });
  });

  describe('toCompactUrl()', () => {
    it('should generate correct URL format', () => {
      const url = toCompactUrl(sampleSpecimen);
      expect(url).toMatch(/^wemush:\/\/v1\//);
    });

    it('should include specimen ID without prefix', () => {
      const url = toCompactUrl(sampleSpecimen);
      expect(url).toContain('clx1a2b3c4d5e6f7g8h9i0j1');
    });

    it('should include species code for known species', () => {
      const url = toCompactUrl(sampleSpecimen);
      expect(url).toContain('s=POSTR');
    });

    it('should include stage parameter', () => {
      const url = toCompactUrl(sampleSpecimen);
      expect(url).toContain('st=COLONIZATION');
    });

    it('should include timestamp parameter', () => {
      const url = toCompactUrl(sampleSpecimen);
      expect(url).toContain('t=');
    });

    it('should include specimen type parameter', () => {
      const url = toCompactUrl(sampleSpecimen);
      expect(url).toContain('ty=CULTURE');
    });

    it('should use full species name for unknown species', () => {
      const unknownSpecimen: Specimen = {
        ...sampleSpecimen,
        species: 'Coprinus comatus',
      };
      const url = toCompactUrl(unknownSpecimen);
      // URLSearchParams encodes spaces as + (or %20)
      expect(url).toMatch(/s=Coprinus[+%20]comatus/);
    });

    it('should work with specimen created by createSpecimen()', () => {
      const specimen = createSpecimen({
        type: 'SPAWN',
        species: 'Hericium erinaceus',
        stage: 'INOCULATION',
      });
      const url = toCompactUrl(specimen);
      expect(url).toMatch(/^wemush:\/\/v1\//);
      expect(url).toContain('s=HERIN');
      expect(url).toContain('st=INOCULATION');
      expect(url).toContain('ty=SPAWN');
    });

    it('should handle specimens without optional fields', () => {
      const minimalSpecimen: Specimen = {
        '@context': 'https://wemush.com/wols/v1',
        '@type': 'Specimen',
        id: 'wemush:minimalid123456789012' as SpecimenId,
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        created: '2025-01-01T00:00:00Z',
      };
      const url = toCompactUrl(minimalSpecimen);
      expect(url).toMatch(/^wemush:\/\/v1\//);
      expect(url).toContain('s=POSTR');
    });

    it('should include batch parameter when present', () => {
      const specimenWithBatch: Specimen = {
        ...sampleSpecimen,
        batch: 'BATCH-001',
      };
      const url = toCompactUrl(specimenWithBatch);
      expect(url).toContain('b=BATCH-001');
    });

    it('should include strain parameter when present', () => {
      const specimenWithStrain: Specimen = {
        ...sampleSpecimen,
        strain: { name: 'Blue Oyster' },
      };
      const url = toCompactUrl(specimenWithStrain);
      // URLSearchParams encodes spaces as + (or %20)
      expect(url).toMatch(/sn=Blue[+%20]Oyster/);
    });

    it('should include strain generation when present', () => {
      const specimenWithGeneration: Specimen = {
        ...sampleSpecimen,
        strain: { name: 'Blue Oyster', generation: 'F2' },
      };
      const url = toCompactUrl(specimenWithGeneration);
      expect(url).toContain('sg=F2');
    });
  });

  describe('parseCompactUrl()', () => {
    it('should parse a valid compact URL', () => {
      const url = 'wemush://v1/clx1a2b3c4?s=POSTR&st=COLONIZATION&ty=CULTURE&t=1734307200';
      const result = parseCompactUrl(url);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('wemush:clx1a2b3c4');
        expect(result.data.species).toBe('Pleurotus ostreatus');
        expect(result.data.stage).toBe('COLONIZATION');
        expect(result.data.type).toBe('CULTURE');
      }
    });

    it('should return error for non-wemush URL', () => {
      const result = parseCompactUrl('https://example.com/test');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('WOLS_INVALID_URL');
      }
    });

    it('should return error for malformed URL', () => {
      const result = parseCompactUrl('wemush://v1/');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('WOLS_INVALID_URL');
      }
    });

    it('should handle URL with full species name', () => {
      const url = 'wemush://v1/testid12345?s=Coprinus%20comatus&st=FRUITING&ty=HARVEST';
      const result = parseCompactUrl(url);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.species).toBe('Coprinus comatus');
      }
    });

    it('should resolve species code to full name', () => {
      const url = 'wemush://v1/testid12345?s=HERIN&st=INOCULATION&ty=SPAWN';
      const result = parseCompactUrl(url);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.species).toBe('Hericium erinaceus');
      }
    });

    it('should pass through unknown species codes', () => {
      const url = 'wemush://v1/testid12345?s=XXXXX&st=FRUITING&ty=CULTURE';
      const result = parseCompactUrl(url);

      expect(result.success).toBe(true);
      if (result.success) {
        // Unknown code passed through as-is
        expect(result.data.species).toBe('XXXXX');
      }
    });

    it('should round-trip with toCompactUrl()', () => {
      const specimen = createSpecimen({
        type: 'SUBSTRATE',
        species: 'Lentinula edodes',
        stage: 'FRUITING',
        batch: 'BATCH-123',
      });

      const url = toCompactUrl(specimen);
      const result = parseCompactUrl(url);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.species).toBe('Lentinula edodes');
        expect(result.data.stage).toBe('FRUITING');
        expect(result.data.type).toBe('SUBSTRATE');
        expect(result.data.batch).toBe('BATCH-123');
      }
    });

    it('should extract timestamp as number', () => {
      const url = 'wemush://v1/testid12345?s=POSTR&t=1734307200&ty=CULTURE';
      const result = parseCompactUrl(url);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.timestamp).toBe(1734307200);
      }
    });

    it('should handle batch parameter', () => {
      const url = 'wemush://v1/testid12345?s=POSTR&st=COLONIZATION&ty=CULTURE&b=BATCH-001';
      const result = parseCompactUrl(url);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.batch).toBe('BATCH-001');
      }
    });

    it('should handle strain name parameter', () => {
      const url = 'wemush://v1/testid12345?s=POSTR&st=COLONIZATION&ty=CULTURE&sn=Blue%20Oyster';
      const result = parseCompactUrl(url);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.strain?.name).toBe('Blue Oyster');
      }
    });

    it('should handle strain generation parameter', () => {
      const url = 'wemush://v1/testid12345?s=POSTR&st=COLONIZATION&ty=CULTURE&sn=Test&sg=F2';
      const result = parseCompactUrl(url);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.strain?.generation).toBe('F2');
      }
    });

    it('should handle version in URL path', () => {
      // v1 is the default version
      const url = 'wemush://v1/testid12345?s=POSTR&ty=CULTURE';
      const result = parseCompactUrl(url);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBe('1.1.0');
      }
    });
  });
});
