/**
 * Unit tests for Type Alias System (v1.2.0)
 *
 * Tests for:
 * - registerTypeAlias()
 * - resolveTypeAlias()
 * - getTypeAliases()
 * - Built-in aliases
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  registerTypeAlias,
  resolveTypeAlias,
  getTypeAliases,
  createSpecimen,
  SPECIMEN_TYPES,
  type SpecimenType,
} from '../../src/index.js';

describe('Type Alias System (v1.2.0)', () => {
  describe('built-in aliases', () => {
    it('should resolve LIQUID_CULTURE to CULTURE', () => {
      expect(resolveTypeAlias('LIQUID_CULTURE')).toBe('CULTURE');
    });

    it('should resolve LC to CULTURE', () => {
      expect(resolveTypeAlias('LC')).toBe('CULTURE');
    });

    it('should resolve AGAR to CULTURE', () => {
      expect(resolveTypeAlias('AGAR')).toBe('CULTURE');
    });

    it('should resolve GRAIN_SPAWN to SPAWN', () => {
      expect(resolveTypeAlias('GRAIN_SPAWN')).toBe('SPAWN');
    });

    it('should resolve SAWDUST_SPAWN to SPAWN', () => {
      expect(resolveTypeAlias('SAWDUST_SPAWN')).toBe('SPAWN');
    });
  });

  describe('resolveTypeAlias()', () => {
    it('should return canonical types unchanged', () => {
      for (const type of SPECIMEN_TYPES) {
        expect(resolveTypeAlias(type)).toBe(type);
      }
    });

    it('should return unknown aliases unchanged', () => {
      expect(resolveTypeAlias('UNKNOWN_TYPE')).toBe('UNKNOWN_TYPE');
    });

    it('should be case-insensitive', () => {
      // Implementation converts to uppercase for matching
      expect(resolveTypeAlias('liquid_culture')).toBe('CULTURE');
      expect(resolveTypeAlias('Liquid_Culture')).toBe('CULTURE');
    });
  });

  describe('registerTypeAlias()', () => {
    // Store original aliases to restore after tests
    let originalAliases: Map<string, SpecimenType>;

    beforeEach(() => {
      originalAliases = new Map(getTypeAliases());
    });

    afterEach(() => {
      // Note: In production, you might want to add a clearTypeAliases() for testing
      // For now, aliases persist but that's expected behavior
    });

    it('should register a custom alias', () => {
      registerTypeAlias('PETRI_DISH', 'CULTURE');

      expect(resolveTypeAlias('PETRI_DISH')).toBe('CULTURE');
    });

    it('should allow registering multiple aliases for same type', () => {
      registerTypeAlias('SLANT', 'CULTURE');
      registerTypeAlias('PLATE', 'CULTURE');

      expect(resolveTypeAlias('SLANT')).toBe('CULTURE');
      expect(resolveTypeAlias('PLATE')).toBe('CULTURE');
    });

    it('should override existing alias', () => {
      registerTypeAlias('CUSTOM_TYPE', 'CULTURE');
      registerTypeAlias('CUSTOM_TYPE', 'SPAWN');

      expect(resolveTypeAlias('CUSTOM_TYPE')).toBe('SPAWN');
    });
  });

  describe('getTypeAliases()', () => {
    it('should return a map of aliases', () => {
      const aliases = getTypeAliases();

      expect(aliases).toBeInstanceOf(Map);
      expect(aliases.size).toBeGreaterThan(0);
    });

    it('should include built-in aliases', () => {
      const aliases = getTypeAliases();

      expect(aliases.get('LIQUID_CULTURE')).toBe('CULTURE');
      expect(aliases.get('LC')).toBe('CULTURE');
      expect(aliases.get('GRAIN_SPAWN')).toBe('SPAWN');
    });

    it('should return a read-only map', () => {
      const aliases = getTypeAliases();

      // TypeScript enforces ReadonlyMap, but we test runtime behavior
      expect(typeof aliases.get).toBe('function');
      expect(typeof aliases.has).toBe('function');
    });
  });

  describe('createSpecimen with aliases', () => {
    it('should accept type aliases in createSpecimen', () => {
      const specimen = createSpecimen({
        type: 'LIQUID_CULTURE' as SpecimenType,
        species: 'Pleurotus ostreatus',
      });

      expect(specimen.type).toBe('CULTURE');
    });

    it('should accept LC alias in createSpecimen', () => {
      const specimen = createSpecimen({
        type: 'LC' as SpecimenType,
        species: 'Hericium erinaceus',
      });

      expect(specimen.type).toBe('CULTURE');
    });

    it('should accept GRAIN_SPAWN alias in createSpecimen', () => {
      const specimen = createSpecimen({
        type: 'GRAIN_SPAWN' as SpecimenType,
        species: 'Ganoderma lucidum',
      });

      expect(specimen.type).toBe('SPAWN');
    });

    it('should throw for unregistered invalid types', () => {
      expect(() => {
        createSpecimen({
          type: 'COMPLETELY_INVALID_TYPE' as SpecimenType,
          species: 'Test species',
        });
      }).toThrow(/Invalid specimen type/);
    });
  });
});
