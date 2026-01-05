/**
 * Contract tests for JSON-LD schema compliance
 *
 * These tests verify that specimens created by the library
 * conform to the WOLS v1.1.0 JSON-LD specification.
 */

import { describe, it, expect } from 'vitest';

import { createSpecimen, serializeSpecimen } from '../../src/specimen.js';
import { WOLS_CONTEXT, WOLS_VERSION } from '../../src/types.js';

describe('JSON-LD Schema Compliance', () => {
  describe('required JSON-LD fields', () => {
    it('should always include @context with correct URL', () => {
      const specimen = createSpecimen({
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      });

      expect(specimen['@context']).toBe('https://wemush.com/wols/v1');
      expect(specimen['@context']).toBe(WOLS_CONTEXT);
    });

    it('should always include @type as "Specimen"', () => {
      const specimen = createSpecimen({
        type: 'SPAWN',
        species: 'Hericium erinaceus',
      });

      expect(specimen['@type']).toBe('Specimen');
    });

    it('should always include version matching WOLS spec', () => {
      const specimen = createSpecimen({
        type: 'SUBSTRATE',
        species: 'Ganoderma lucidum',
      });

      expect(specimen.version).toBe('1.1.0');
      expect(specimen.version).toBe(WOLS_VERSION);
    });
  });

  describe('specimen ID format', () => {
    it('should follow wemush:{cuid} format', () => {
      const specimen = createSpecimen({
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      });

      // Format: wemush: prefix followed by lowercase alphanumeric
      expect(specimen.id).toMatch(/^wemush:[a-z0-9]+$/);
    });

    it('should generate IDs of reasonable length', () => {
      const specimen = createSpecimen({
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      });

      // ID should be wemush: (7 chars) + cuid (typically 24 chars) = ~31 chars
      const idWithoutPrefix = specimen.id.replace('wemush:', '');
      expect(idWithoutPrefix.length).toBeGreaterThanOrEqual(8);
      expect(idWithoutPrefix.length).toBeLessThanOrEqual(32);
    });

    it('should not contain uppercase characters in ID', () => {
      const specimen = createSpecimen({
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      });

      expect(specimen.id).not.toMatch(/[A-Z]/);
    });
  });

  describe('serialization format', () => {
    it('should produce valid JSON', () => {
      const specimen = createSpecimen({
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        strain: 'Blue Oyster',
      });

      const json = serializeSpecimen(specimen);

      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should round-trip through JSON parse', () => {
      const specimen = createSpecimen({
        type: 'SUBSTRATE',
        species: 'Hericium erinaceus',
        strain: {
          name: "Lion's Mane",
          generation: 'F2',
          clonalGeneration: 3,
        },
        stage: 'COLONIZATION',
        batch: 'batch_001',
      });

      const json = serializeSpecimen(specimen);
      const parsed = JSON.parse(json) as Record<string, unknown>;

      expect(parsed['@context']).toBe(specimen['@context']);
      expect(parsed['@type']).toBe(specimen['@type']);
      expect(parsed['id']).toBe(specimen.id);
      expect(parsed['version']).toBe(specimen.version);
      expect(parsed['type']).toBe(specimen.type);
      expect(parsed['species']).toBe(specimen.species);
      expect(parsed['strain']).toEqual(specimen.strain);
      expect(parsed['stage']).toBe(specimen.stage);
      expect(parsed['batch']).toBe(specimen.batch);
    });

    it('should preserve custom fields in round-trip', () => {
      const specimen = createSpecimen({
        type: 'FRUITING',
        species: 'Pleurotus citrinopileatus',
        custom: {
          vendorCode: 'GOLDEN001',
          temperature: 22,
          notes: 'First flush expected',
        },
      });

      const json = serializeSpecimen(specimen);
      const parsed = JSON.parse(json) as Record<string, unknown>;

      expect(parsed['custom']).toEqual({
        vendorCode: 'GOLDEN001',
        temperature: 22,
        notes: 'First flush expected',
      });
    });
  });

  describe('SpecimenType enum values', () => {
    const validTypes = ['CULTURE', 'SPAWN', 'SUBSTRATE', 'FRUITING', 'HARVEST'] as const;

    it.each(validTypes)('should accept %s as valid specimen type', type => {
      const specimen = createSpecimen({
        type,
        species: 'Pleurotus ostreatus',
      });

      expect(specimen.type).toBe(type);
    });
  });

  describe('GrowthStage enum values', () => {
    const validStages = ['INOCULATION', 'COLONIZATION', 'FRUITING', 'HARVEST'] as const;

    it.each(validStages)('should accept %s as valid growth stage', stage => {
      const specimen = createSpecimen({
        type: 'SUBSTRATE',
        species: 'Pleurotus ostreatus',
        stage,
      });

      expect(specimen.stage).toBe(stage);
    });
  });

  describe('Strain object structure', () => {
    it('should preserve all strain fields', () => {
      const specimen = createSpecimen({
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        strain: {
          name: 'Blue Oyster PoHu',
          generation: 'F2',
          clonalGeneration: 3,
          lineage: 'wemush:parent123',
          source: 'tissue',
        },
      });

      expect(specimen.strain).toEqual({
        name: 'Blue Oyster PoHu',
        generation: 'F2',
        clonalGeneration: 3,
        lineage: 'wemush:parent123',
        source: 'tissue',
      });
    });

    it('should expand string strain to name-only object', () => {
      const specimen = createSpecimen({
        type: 'SPAWN',
        species: 'Ganoderma lucidum',
        strain: 'Reishi Red',
      });

      expect(specimen.strain).toEqual({ name: 'Reishi Red' });
    });
  });

  describe('QR code size constraints', () => {
    it('should produce JSON under 2KB for basic specimen', () => {
      const specimen = createSpecimen({
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        strain: 'Blue Oyster',
      });

      const json = serializeSpecimen(specimen);

      // QR codes can hold ~2KB of data
      expect(json.length).toBeLessThan(2000);
    });

    it('should produce JSON under 2KB for full specimen', () => {
      const specimen = createSpecimen({
        type: 'SUBSTRATE',
        species: 'Hericium erinaceus',
        strain: {
          name: "Lion's Mane Premium",
          generation: 'F2',
          clonalGeneration: 3,
          lineage: 'wemush:parent123456789012345',
          source: 'tissue',
        },
        stage: 'COLONIZATION',
        batch: 'batch_2025_12_001',
        organization: 'org_mushoh',
        creator: 'user_markbeacom',
        custom: {
          vendorCode: 'PREMIUM_LM_001',
          notes: 'High-quality specimen for commercial production',
        },
      });

      const json = serializeSpecimen(specimen);

      expect(json.length).toBeLessThan(2000);
    });
  });
});
