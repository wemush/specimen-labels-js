/**
 * Unit tests for specimen creation and serialization
 *
 * Tests for:
 * - createSpecimen() function
 * - serializeSpecimen() function
 * - Strain expansion logic
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { createSpecimen, serializeSpecimen } from '../../src/specimen.js';
import { WOLS_CONTEXT, WOLS_VERSION } from '../../src/types.js';

describe('createSpecimen', () => {
  describe('minimal specimen', () => {
    it('should create a specimen with required fields only', () => {
      const specimen = createSpecimen({
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      });

      expect(specimen['@context']).toBe(WOLS_CONTEXT);
      expect(specimen['@type']).toBe('Specimen');
      expect(specimen.version).toBe(WOLS_VERSION);
      expect(specimen.type).toBe('CULTURE');
      expect(specimen.species).toBe('Pleurotus ostreatus');
    });

    it('should auto-generate a valid ID with wemush: prefix', () => {
      const specimen = createSpecimen({
        type: 'SPAWN',
        species: 'Hericium erinaceus',
      });

      expect(specimen.id).toMatch(/^wemush:[a-z0-9]+$/);
      expect(specimen.id.length).toBeGreaterThan(10);
    });

    it('should generate unique IDs for each specimen', () => {
      const specimen1 = createSpecimen({ type: 'CULTURE', species: 'Species A' });
      const specimen2 = createSpecimen({ type: 'CULTURE', species: 'Species B' });

      expect(specimen1.id).not.toBe(specimen2.id);
    });
  });

  describe('full specimen with all fields', () => {
    it('should preserve all optional fields', () => {
      const specimen = createSpecimen({
        type: 'SUBSTRATE',
        species: 'Hericium erinaceus',
        strain: {
          name: "Lion's Mane Premium",
          generation: 'F2',
          clonalGeneration: 3,
        },
        stage: 'COLONIZATION',
        batch: 'batch_2025_12_001',
        organization: 'org_mushoh',
        creator: 'user_123',
        custom: { vendorCode: 'CUSTOM001' },
      });

      expect(specimen.type).toBe('SUBSTRATE');
      expect(specimen.species).toBe('Hericium erinaceus');
      expect(specimen.strain?.name).toBe("Lion's Mane Premium");
      expect(specimen.strain?.generation).toBe('F2');
      expect(specimen.strain?.clonalGeneration).toBe(3);
      expect(specimen.stage).toBe('COLONIZATION');
      expect(specimen.batch).toBe('batch_2025_12_001');
      expect(specimen.organization).toBe('org_mushoh');
      expect(specimen.creator).toBe('user_123');
      expect(specimen.custom?.['vendorCode']).toBe('CUSTOM001');
    });
  });

  describe('strain expansion', () => {
    it('should expand string strain to object', () => {
      const specimen = createSpecimen({
        type: 'SPAWN',
        species: 'Ganoderma lucidum',
        strain: 'Reishi Red',
      });

      expect(specimen.strain).toEqual({ name: 'Reishi Red' });
    });

    it('should preserve full strain object', () => {
      const specimen = createSpecimen({
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        strain: {
          name: 'Blue Oyster',
          generation: 'F1',
          source: 'tissue',
          lineage: 'wemush:parent123',
        },
      });

      expect(specimen.strain?.name).toBe('Blue Oyster');
      expect(specimen.strain?.generation).toBe('F1');
      expect(specimen.strain?.source).toBe('tissue');
      expect(specimen.strain?.lineage).toBe('wemush:parent123');
    });
  });

  describe('all specimen types', () => {
    const specimenTypes = ['CULTURE', 'SPAWN', 'SUBSTRATE', 'FRUITING', 'HARVEST'] as const;

    it.each(specimenTypes)('should create specimen with type %s', type => {
      const specimen = createSpecimen({
        type,
        species: 'Pleurotus ostreatus',
      });

      expect(specimen.type).toBe(type);
    });
  });

  describe('all growth stages', () => {
    const stages = ['INOCULATION', 'COLONIZATION', 'FRUITING', 'HARVEST'] as const;

    it.each(stages)('should create specimen with stage %s', stage => {
      const specimen = createSpecimen({
        type: 'SUBSTRATE',
        species: 'Pleurotus ostreatus',
        stage,
      });

      expect(specimen.stage).toBe(stage);
    });
  });
});

describe('serializeSpecimen', () => {
  let specimen: ReturnType<typeof createSpecimen>;

  beforeEach(() => {
    specimen = createSpecimen({
      type: 'CULTURE',
      species: 'Pleurotus ostreatus',
      strain: 'Blue Oyster',
    });
  });

  it('should return valid JSON string', () => {
    const json = serializeSpecimen(specimen);

    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('should serialize all required fields', () => {
    const json = serializeSpecimen(specimen);
    const parsed = JSON.parse(json) as Record<string, unknown>;

    expect(parsed['@context']).toBe(WOLS_CONTEXT);
    expect(parsed['@type']).toBe('Specimen');
    expect(parsed['id']).toBe(specimen.id);
    expect(parsed['version']).toBe(WOLS_VERSION);
    expect(parsed['type']).toBe('CULTURE');
    expect(parsed['species']).toBe('Pleurotus ostreatus');
  });

  it('should include strain in serialization', () => {
    const json = serializeSpecimen(specimen);
    const parsed = JSON.parse(json) as Record<string, unknown>;

    expect(parsed['strain']).toEqual({ name: 'Blue Oyster' });
  });

  it('should omit undefined optional fields', () => {
    const minimalSpecimen = createSpecimen({
      type: 'CULTURE',
      species: 'Pleurotus ostreatus',
    });

    const json = serializeSpecimen(minimalSpecimen);
    const parsed = JSON.parse(json) as Record<string, unknown>;

    expect('strain' in parsed).toBe(false);
    expect('stage' in parsed).toBe(false);
    expect('batch' in parsed).toBe(false);
    expect('organization' in parsed).toBe(false);
    expect('creator' in parsed).toBe(false);
    expect('custom' in parsed).toBe(false);
    expect('signature' in parsed).toBe(false);
  });

  it('should order JSON-LD fields first', () => {
    const fullSpecimen = createSpecimen({
      type: 'SUBSTRATE',
      species: 'Hericium erinaceus',
      strain: 'Premium',
      stage: 'COLONIZATION',
      batch: 'batch001',
    });

    const json = serializeSpecimen(fullSpecimen);
    const keys = Object.keys(JSON.parse(json) as Record<string, unknown>);

    // First keys should be JSON-LD fields
    expect(keys[0]).toBe('@context');
    expect(keys[1]).toBe('@type');
  });

  it('should produce valid JSON for QR encoding', () => {
    const json = serializeSpecimen(specimen);

    // Should be under 2000 bytes for QR capacity
    expect(json.length).toBeLessThan(2000);

    // Should not have escaped characters that break QR
    expect(json).not.toContain('\n');
    expect(json).not.toContain('\t');
  });
});
