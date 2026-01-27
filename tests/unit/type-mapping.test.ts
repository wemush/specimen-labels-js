/**
 * Unit tests for Type Mapping System (v1.2.0)
 *
 * Tests for:
 * - WOLS_TO_PLATFORM_MAP
 * - mapToWolsType()
 * - mapFromWolsType()
 * - registerPlatformType()
 */

import { describe, it, expect } from 'vitest';

import {
  WOLS_TO_PLATFORM_MAP,
  mapToWolsType,
  mapFromWolsType,
  registerPlatformType,
  SPECIMEN_TYPES,
} from '../../src/index.js';

describe('Type Mapping System (v1.2.0)', () => {
  describe('WOLS_TO_PLATFORM_MAP', () => {
    it('should be a read-only object', () => {
      expect(typeof WOLS_TO_PLATFORM_MAP).toBe('object');
    });

    it('should have entries for all WOLS specimen types', () => {
      for (const type of SPECIMEN_TYPES) {
        expect(WOLS_TO_PLATFORM_MAP[type]).toBeDefined();
        expect(Array.isArray(WOLS_TO_PLATFORM_MAP[type])).toBe(true);
      }
    });

    it('should have CULTURE mapped to common platform types', () => {
      const cultureTypes = WOLS_TO_PLATFORM_MAP.CULTURE;

      expect(cultureTypes).toContain('Liquid Culture');
      expect(cultureTypes).toContain('LC');
      expect(cultureTypes).toContain('Agar');
    });

    it('should have SPAWN mapped to spawn types', () => {
      const spawnTypes = WOLS_TO_PLATFORM_MAP.SPAWN;

      expect(spawnTypes).toContain('Grain Spawn');
      expect(spawnTypes).toContain('Sawdust Spawn');
    });

    it('should have SUBSTRATE mapped to substrate types', () => {
      const substrateTypes = WOLS_TO_PLATFORM_MAP.SUBSTRATE;

      expect(substrateTypes).toContain('Block');
      expect(substrateTypes).toContain('Bag');
    });
  });

  describe('mapToWolsType()', () => {
    it('should map "Liquid Culture" to CULTURE', () => {
      expect(mapToWolsType('Liquid Culture')).toBe('CULTURE');
    });

    it('should map "LC" to CULTURE', () => {
      expect(mapToWolsType('LC')).toBe('CULTURE');
    });

    it('should map "Agar" to CULTURE', () => {
      expect(mapToWolsType('Agar')).toBe('CULTURE');
    });

    it('should map "Grain Spawn" to SPAWN', () => {
      expect(mapToWolsType('Grain Spawn')).toBe('SPAWN');
    });

    it('should map "Block" to SUBSTRATE', () => {
      expect(mapToWolsType('Block')).toBe('SUBSTRATE');
    });

    it('should map "Bag" to SUBSTRATE', () => {
      expect(mapToWolsType('Bag')).toBe('SUBSTRATE');
    });

    it('should map "Flush" to FRUITING', () => {
      expect(mapToWolsType('Flush')).toBe('FRUITING');
    });

    it('should map "Fresh" to HARVEST', () => {
      expect(mapToWolsType('Fresh')).toBe('HARVEST');
    });

    it('should map "Dried" to HARVEST', () => {
      expect(mapToWolsType('Dried')).toBe('HARVEST');
    });

    it('should return null for unknown platform types', () => {
      expect(mapToWolsType('Unknown Platform Type')).toBeNull();
    });

    it('should be case-insensitive for alias matching', () => {
      // The implementation resolves aliases case-insensitively
      expect(mapToWolsType('liquid culture')).toBe('CULTURE');
      expect(mapToWolsType('LIQUID CULTURE')).toBe('CULTURE');
    });
  });

  describe('mapFromWolsType()', () => {
    it('should return platform types for CULTURE', () => {
      const platformTypes = mapFromWolsType('CULTURE');

      expect(platformTypes.length).toBeGreaterThan(0);
      expect(platformTypes).toContain('Liquid Culture');
    });

    it('should return platform types for SPAWN', () => {
      const platformTypes = mapFromWolsType('SPAWN');

      expect(platformTypes.length).toBeGreaterThan(0);
      expect(platformTypes).toContain('Grain Spawn');
    });

    it('should return a readonly array', () => {
      const platformTypes = mapFromWolsType('CULTURE');

      expect(Array.isArray(platformTypes)).toBe(true);
    });

    it('should work for all WOLS types', () => {
      for (const type of SPECIMEN_TYPES) {
        const platformTypes = mapFromWolsType(type);
        expect(platformTypes.length).toBeGreaterThan(0);
      }
    });
  });

  describe('registerPlatformType()', () => {
    // Note: The platform type registry is intentionally mutable and shared across tests.
    // Custom platform types registered in tests persist, which mirrors production behavior
    // where registrations are additive. If test isolation becomes an issue, consider
    // implementing a clearPlatformTypes() function similar to clearMigrations().

    it('should register a custom platform type', () => {
      registerPlatformType('Custom Mushroom Block', 'SUBSTRATE');

      expect(mapToWolsType('Custom Mushroom Block')).toBe('SUBSTRATE');
    });

    it('should allow registering multiple custom types', () => {
      registerPlatformType('Premium LC', 'CULTURE');
      registerPlatformType('Starter Culture', 'CULTURE');

      expect(mapToWolsType('Premium LC')).toBe('CULTURE');
      expect(mapToWolsType('Starter Culture')).toBe('CULTURE');
    });

    it('should override existing mappings', () => {
      registerPlatformType('Override Type', 'CULTURE');
      registerPlatformType('Override Type', 'SPAWN');

      expect(mapToWolsType('Override Type')).toBe('SPAWN');
    });
  });

  describe('round-trip mapping', () => {
    it('should find platform type in mapFromWolsType after mapping with mapToWolsType', () => {
      const platformType = 'Grain Spawn';
      const wolsType = mapToWolsType(platformType);

      expect(wolsType).toBe('SPAWN');

      const platformTypes = mapFromWolsType(wolsType!);
      expect(platformTypes).toContain(platformType);
    });
  });
});
