/**
 * Version Migration Utilities
 *
 * This module provides utilities for comparing WOLS versions and
 * migrating specimens between versions.
 *
 * @module utils/migration
 * @since 1.2.0
 */

import type { Specimen } from '../types.js';
import { WOLS_VERSION } from '../types.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Version comparison result.
 *
 * - `-1`: First version is older than second
 * - `0`: Versions are equal
 * - `1`: First version is newer than second
 *
 * @since 1.2.0
 */
export type VersionComparison = -1 | 0 | 1;

/**
 * Migration handler function signature.
 *
 * @since 1.2.0
 */
export type MigrationHandler = (specimen: Specimen) => Specimen;

/**
 * Migration definition.
 *
 * @since 1.2.0
 */
interface MigrationDefinition {
  from: string;
  to: string;
  handler: MigrationHandler;
}

// =============================================================================
// INTERNAL STATE
// =============================================================================

/**
 * Registered migration handlers.
 */
const MIGRATION_REGISTRY: MigrationDefinition[] = [];

// =============================================================================
// VERSION UTILITIES
// =============================================================================

/**
 * Parse a semantic version string into components.
 *
 * @param version - Semantic version string (e.g., "1.2.0")
 * @returns Array of [major, minor, patch] or null if invalid
 */
function parseVersion(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return null;

  const major = parseInt(match[1]!, 10);
  const minor = parseInt(match[2]!, 10);
  const patch = parseInt(match[3]!, 10);

  return [major, minor, patch];
}

/**
 * Compare two semantic versions.
 *
 * @param a - First version string
 * @param b - Second version string
 * @returns -1 if a < b, 0 if a === b, 1 if a > b
 *
 * @example
 * ```typescript
 * compareVersions('1.0.0', '1.1.0') // Returns -1
 * compareVersions('1.1.0', '1.1.0') // Returns 0
 * compareVersions('2.0.0', '1.9.0') // Returns 1
 * ```
 *
 * @since 1.2.0
 */
export function compareVersions(a: string, b: string): VersionComparison {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);

  if (!parsedA || !parsedB) {
    // Fallback to string comparison for invalid versions
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  const [majorA, minorA, patchA] = parsedA;
  const [majorB, minorB, patchB] = parsedB;

  if (majorA !== majorB) return majorA < majorB ? -1 : 1;
  if (minorA !== minorB) return minorA < minorB ? -1 : 1;
  if (patchA !== patchB) return patchA < patchB ? -1 : 1;

  return 0;
}

/**
 * Check if a specimen is using an outdated WOLS version.
 *
 * @param specimen - Specimen object or version string
 * @returns True if the specimen version is older than current library version
 *
 * @example
 * ```typescript
 * isOutdated(specimen) // True if specimen.version < WOLS_VERSION
 * isOutdated('1.0.0')  // True (older than current)
 * ```
 *
 * @since 1.2.0
 */
export function isOutdated(specimen: Specimen | string): boolean {
  const version = typeof specimen === 'string' ? specimen : specimen.version;
  return compareVersions(version, WOLS_VERSION) < 0;
}

/**
 * Check if a specimen is using a newer WOLS version than this library.
 *
 * This can happen when specimens are created by a newer library version.
 *
 * @param specimen - Specimen object or version string
 * @returns True if the specimen version is newer than current library version
 *
 * @example
 * ```typescript
 * isNewer(specimen)  // True if specimen.version > WOLS_VERSION
 * isNewer('2.0.0')   // True if library is 1.x
 * ```
 *
 * @since 1.2.0
 */
export function isNewer(specimen: Specimen | string): boolean {
  const version = typeof specimen === 'string' ? specimen : specimen.version;
  return compareVersions(version, WOLS_VERSION) > 0;
}

/**
 * Get the current library WOLS version.
 *
 * @returns The WOLS version this library implements
 *
 * @since 1.2.0
 */
export function getCurrentVersion(): string {
  return WOLS_VERSION;
}

// =============================================================================
// MIGRATION REGISTRATION
// =============================================================================

/**
 * Register a migration handler for upgrading specimens between versions.
 *
 * Migrations are applied in order from oldest to newest when calling `migrate()`.
 *
 * @param from - Source version (e.g., "1.0.0")
 * @param to - Target version (e.g., "1.1.0")
 * @param handler - Function to transform the specimen
 *
 * @example
 * ```typescript
 * registerMigration('1.0.0', '1.1.0', (specimen) => {
 *   // Add new required field with default value
 *   return { ...specimen, newField: 'default' };
 * });
 * ```
 *
 * @since 1.2.0
 */
export function registerMigration(from: string, to: string, handler: MigrationHandler): void {
  MIGRATION_REGISTRY.push({ from, to, handler });

  // Keep migrations sorted by source version
  MIGRATION_REGISTRY.sort((a, b) => compareVersions(a.from, b.from));
}

/**
 * Check if a specimen can be migrated to the current version.
 *
 * @param specimen - Specimen to check
 * @returns True if migration path exists, false otherwise
 *
 * @since 1.2.0
 */
export function canMigrate(specimen: Specimen): boolean {
  if (!isOutdated(specimen)) {
    return false; // Already current or newer
  }

  // Check if we have a migration path
  let currentVersion = specimen.version;

  while (compareVersions(currentVersion, WOLS_VERSION) < 0) {
    const migration = MIGRATION_REGISTRY.find(m => m.from === currentVersion);
    if (!migration) {
      return false; // No migration from this version
    }
    currentVersion = migration.to;
  }

  return true;
}

/**
 * Migrate a specimen to the current WOLS version.
 *
 * Applies all registered migrations in order from the specimen's version
 * to the current library version.
 *
 * @param specimen - Specimen to migrate
 * @returns Migrated specimen with updated version
 * @throws Error if no migration path exists
 *
 * @example
 * ```typescript
 * const oldSpecimen = parseSpecimen(oldJson);
 * if (isOutdated(oldSpecimen)) {
 *   const updated = migrate(oldSpecimen);
 *   console.log('Migrated to:', updated.version);
 * }
 * ```
 *
 * @since 1.2.0
 */
export function migrate(specimen: Specimen): Specimen {
  if (!isOutdated(specimen)) {
    return specimen; // Already current or newer
  }

  let current = specimen;
  let currentVersion = specimen.version;

  while (compareVersions(currentVersion, WOLS_VERSION) < 0) {
    const migration = MIGRATION_REGISTRY.find(m => m.from === currentVersion);
    if (!migration) {
      throw new Error(
        `No migration path from version ${currentVersion} to ${WOLS_VERSION}. ` +
          `Register a migration using registerMigration().`
      );
    }

    current = migration.handler(current);
    currentVersion = migration.to;
  }

  // Ensure version is updated
  return {
    ...current,
    version: WOLS_VERSION,
  };
}

/**
 * Get all registered migrations.
 *
 * @returns Array of migration definitions
 *
 * @since 1.2.0
 */
export function getMigrations(): readonly MigrationDefinition[] {
  return MIGRATION_REGISTRY;
}

/**
 * Clear all registered migrations.
 *
 * Primarily useful for testing.
 *
 * @since 1.2.0
 */
export function clearMigrations(): void {
  MIGRATION_REGISTRY.length = 0;
}
