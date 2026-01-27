/**
 * Unit tests for Migration Utilities (v1.2.0)
 *
 * Tests for:
 * - compareVersions()
 * - isOutdated()
 * - isNewer()
 * - getCurrentVersion()
 * - registerMigration()
 * - canMigrate()
 * - migrate()
 * - getMigrations()
 * - clearMigrations()
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  compareVersions,
  isOutdated,
  isNewer,
  getCurrentVersion,
  registerMigration,
  canMigrate,
  migrate,
  getMigrations,
  clearMigrations,
  createSpecimen,
  WOLS_VERSION,
  WOLS_CONTEXT,
  asSpecimenId,
  type Specimen,
  type VersionComparison,
} from '../../src/index.js';

describe('Migration Utilities (v1.2.0)', () => {
  // Clean up migrations after each test
  afterEach(() => {
    clearMigrations();
  });

  describe('compareVersions()', () => {
    describe('equal versions', () => {
      it('should return 0 for identical versions', () => {
        expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
      });

      it('should return 0 for 1.1.0 === 1.1.0', () => {
        expect(compareVersions('1.1.0', '1.1.0')).toBe(0);
      });

      it('should return 0 for 2.3.4 === 2.3.4', () => {
        expect(compareVersions('2.3.4', '2.3.4')).toBe(0);
      });
    });

    describe('first version older', () => {
      it('should return -1 when major is less', () => {
        expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
      });

      it('should return -1 when minor is less', () => {
        expect(compareVersions('1.0.0', '1.1.0')).toBe(-1);
      });

      it('should return -1 when patch is less', () => {
        expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
      });

      it('should return -1 for 1.9.0 < 2.0.0', () => {
        expect(compareVersions('1.9.0', '2.0.0')).toBe(-1);
      });
    });

    describe('first version newer', () => {
      it('should return 1 when major is greater', () => {
        expect(compareVersions('2.0.0', '1.0.0')).toBe(1);
      });

      it('should return 1 when minor is greater', () => {
        expect(compareVersions('1.1.0', '1.0.0')).toBe(1);
      });

      it('should return 1 when patch is greater', () => {
        expect(compareVersions('1.0.1', '1.0.0')).toBe(1);
      });

      it('should return 1 for 10.0.0 > 9.0.0', () => {
        expect(compareVersions('10.0.0', '9.0.0')).toBe(1);
      });
    });

    describe('type checking', () => {
      it('should return VersionComparison type', () => {
        const result: VersionComparison = compareVersions('1.0.0', '1.0.0');
        expect([-1, 0, 1]).toContain(result);
      });
    });
  });

  describe('getCurrentVersion()', () => {
    it('should return the current WOLS version', () => {
      expect(getCurrentVersion()).toBe(WOLS_VERSION);
    });

    it('should return a valid semver string', () => {
      const version = getCurrentVersion();
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe('isOutdated()', () => {
    it('should return true for older version string', () => {
      expect(isOutdated('1.0.0')).toBe(true);
    });

    it('should return false for current version', () => {
      expect(isOutdated(WOLS_VERSION)).toBe(false);
    });

    it('should return false for newer version', () => {
      expect(isOutdated('99.0.0')).toBe(false);
    });

    it('should accept Specimen object', () => {
      const oldSpecimen: Specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: asSpecimenId('wemush:test123'),
        version: '1.0.0',
        type: 'CULTURE',
        species: 'Test species',
      };

      expect(isOutdated(oldSpecimen)).toBe(true);
    });

    it('should return false for current specimen', () => {
      const specimen = createSpecimen({
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      });

      expect(isOutdated(specimen)).toBe(false);
    });
  });

  describe('isNewer()', () => {
    it('should return true for newer version', () => {
      expect(isNewer('99.0.0')).toBe(true);
    });

    it('should return false for current version', () => {
      expect(isNewer(WOLS_VERSION)).toBe(false);
    });

    it('should return false for older version', () => {
      expect(isNewer('1.0.0')).toBe(false);
    });

    it('should accept Specimen object', () => {
      const futureSpecimen: Specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: asSpecimenId('wemush:future123'),
        version: '99.0.0',
        type: 'CULTURE',
        species: 'Future species',
      };

      expect(isNewer(futureSpecimen)).toBe(true);
    });
  });

  describe('registerMigration()', () => {
    it('should register a migration handler', () => {
      registerMigration('1.0.0', '1.1.0', specimen => ({
        ...specimen,
        version: '1.1.0',
      }));

      const migrations = getMigrations();
      expect(migrations.length).toBe(1);
    });

    it('should register multiple migrations', () => {
      registerMigration('1.0.0', '1.1.0', s => ({ ...s, version: '1.1.0' }));
      registerMigration('1.1.0', '1.2.0', s => ({ ...s, version: '1.2.0' }));

      const migrations = getMigrations();
      expect(migrations.length).toBe(2);
    });

    it('should sort migrations by source version', () => {
      // Register out of order
      registerMigration('1.1.0', '1.2.0', s => ({ ...s, version: '1.2.0' }));
      registerMigration('1.0.0', '1.1.0', s => ({ ...s, version: '1.1.0' }));

      const migrations = getMigrations();
      expect(migrations[0]?.from).toBe('1.0.0');
      expect(migrations[1]?.from).toBe('1.1.0');
    });
  });

  describe('getMigrations()', () => {
    it('should return empty array when no migrations registered', () => {
      const migrations = getMigrations();
      expect(migrations).toEqual([]);
    });

    it('should return readonly array', () => {
      registerMigration('1.0.0', '1.1.0', s => s);

      const migrations = getMigrations();
      expect(Array.isArray(migrations)).toBe(true);
    });
  });

  describe('clearMigrations()', () => {
    it('should remove all registered migrations', () => {
      registerMigration('1.0.0', '1.1.0', s => s);
      registerMigration('1.1.0', '1.2.0', s => s);

      clearMigrations();

      expect(getMigrations()).toEqual([]);
    });
  });

  describe('canMigrate()', () => {
    beforeEach(() => {
      // Set up a migration path to current version
      registerMigration('1.0.0', WOLS_VERSION, s => ({
        ...s,
        version: WOLS_VERSION,
      }));
    });

    it('should return true when migration path exists', () => {
      const oldSpecimen: Specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: asSpecimenId('wemush:old123'),
        version: '1.0.0',
        type: 'CULTURE',
        species: 'Old species',
      };

      expect(canMigrate(oldSpecimen)).toBe(true);
    });

    it('should return false when no migration path exists', () => {
      const unmigratableSpecimen: Specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: asSpecimenId('wemush:unmigratable'),
        version: '0.5.0', // No migration from this version
        type: 'CULTURE',
        species: 'Old species',
      };

      expect(canMigrate(unmigratableSpecimen)).toBe(false);
    });

    it('should return false for current version specimen', () => {
      const currentSpecimen = createSpecimen({
        type: 'CULTURE',
        species: 'Current species',
      });

      expect(canMigrate(currentSpecimen)).toBe(false);
    });

    it('should return false for newer version specimen', () => {
      const futureSpecimen: Specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: asSpecimenId('wemush:future'),
        version: '99.0.0',
        type: 'CULTURE',
        species: 'Future species',
      };

      expect(canMigrate(futureSpecimen)).toBe(false);
    });
  });

  describe('migrate()', () => {
    beforeEach(() => {
      // Set up migration chain: 1.0.0 -> 1.1.0 -> WOLS_VERSION
      registerMigration('1.0.0', '1.1.0', specimen => ({
        ...specimen,
        version: '1.1.0',
        _meta: {
          ...specimen._meta,
          migratedFrom: '1.0.0',
        },
      }));

      registerMigration('1.1.0', WOLS_VERSION, specimen => ({
        ...specimen,
        version: WOLS_VERSION,
        _meta: {
          ...specimen._meta,
          migratedFrom: specimen._meta?.migratedFrom || '1.1.0',
        },
      }));
    });

    it('should migrate specimen to current version', () => {
      const oldSpecimen: Specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: asSpecimenId('wemush:migrate123'),
        version: '1.0.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      };

      const migrated = migrate(oldSpecimen);

      expect(migrated.version).toBe(WOLS_VERSION);
    });

    it('should apply migration handlers in order', () => {
      const oldSpecimen: Specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: asSpecimenId('wemush:chain123'),
        version: '1.0.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      };

      const migrated = migrate(oldSpecimen);

      // Should have passed through 1.0.0 -> 1.1.0 migration
      expect(migrated._meta?.migratedFrom).toBe('1.0.0');
    });

    it('should return unchanged for current version', () => {
      const currentSpecimen = createSpecimen({
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      });

      const result = migrate(currentSpecimen);

      expect(result).toEqual(currentSpecimen);
    });

    it('should return unchanged for newer version', () => {
      const futureSpecimen: Specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: asSpecimenId('wemush:future'),
        version: '99.0.0',
        type: 'CULTURE',
        species: 'Future species',
      };

      const result = migrate(futureSpecimen);

      expect(result).toEqual(futureSpecimen);
    });

    it('should throw when no migration path exists', () => {
      clearMigrations(); // Remove all migrations

      const unmigratableSpecimen: Specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: asSpecimenId('wemush:unmigratable'),
        version: '0.1.0',
        type: 'CULTURE',
        species: 'Old species',
      };

      expect(() => {
        migrate(unmigratableSpecimen);
      }).toThrow(/No migration path/);
    });

    it('should preserve all specimen data through migration', () => {
      const oldSpecimen: Specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: asSpecimenId('wemush:preserve123'),
        version: '1.0.0',
        type: 'SUBSTRATE',
        species: 'Hericium erinaceus',
        strain: {
          name: 'Premium',
          generation: 'F2',
        },
        stage: 'COLONIZATION',
        batch: 'batch-001',
        organization: 'test-org',
      };

      const migrated = migrate(oldSpecimen);

      expect(migrated.id).toBe(oldSpecimen.id);
      expect(migrated.type).toBe(oldSpecimen.type);
      expect(migrated.species).toBe(oldSpecimen.species);
      expect(migrated.strain).toEqual(oldSpecimen.strain);
      expect(migrated.stage).toBe(oldSpecimen.stage);
      expect(migrated.batch).toBe(oldSpecimen.batch);
      expect(migrated.organization).toBe(oldSpecimen.organization);
    });
  });
});
