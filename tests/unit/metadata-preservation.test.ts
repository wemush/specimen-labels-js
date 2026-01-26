/**
 * Unit tests for Metadata Preservation (_meta) (v1.2.0)
 *
 * Tests for:
 * - _meta field in specimen creation
 * - _meta field in serialization
 * - _meta field in parsing
 * - Round-trip preservation
 */

import { describe, it, expect } from 'vitest';

import {
  createSpecimen,
  serializeSpecimen,
  parseSpecimen,
  validateSpecimen,
  WOLS_CONTEXT,
  asSpecimenId,
  type Specimen,
  type SpecimenMeta,
} from '../../src/index.js';

describe('Metadata Preservation (_meta) (v1.2.0)', () => {
  describe('createSpecimen with _meta', () => {
    it('should include _meta field when provided', () => {
      const meta: SpecimenMeta = {
        sourceId: 'external-123',
        sourceSystem: 'legacy-platform',
        importedAt: '2026-01-25T10:00:00Z',
      };

      const specimen = createSpecimen({
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        _meta: meta,
      });

      expect(specimen._meta).toBeDefined();
      expect(specimen._meta?.sourceId).toBe('external-123');
      expect(specimen._meta?.sourceSystem).toBe('legacy-platform');
      expect(specimen._meta?.importedAt).toBe('2026-01-25T10:00:00Z');
    });

    it('should omit _meta when not provided', () => {
      const specimen = createSpecimen({
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      });

      expect(specimen._meta).toBeUndefined();
    });

    it('should preserve custom _meta fields', () => {
      const meta: SpecimenMeta = {
        sourceId: 'ext-001',
        customField1: 'value1',
        customField2: 42,
        nestedData: { key: 'value' },
      };

      const specimen = createSpecimen({
        type: 'SPAWN',
        species: 'Hericium erinaceus',
        _meta: meta,
      });

      expect(specimen._meta?.customField1).toBe('value1');
      expect(specimen._meta?.customField2).toBe(42);
      expect(specimen._meta?.nestedData).toEqual({ key: 'value' });
    });
  });

  describe('serializeSpecimen with _meta', () => {
    it('should include _meta in serialized JSON', () => {
      const specimen = createSpecimen({
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        _meta: {
          sourceId: 'legacy-123',
          sourceSystem: 'old-platform',
        },
      });

      const json = serializeSpecimen(specimen);
      const parsed = JSON.parse(json) as Record<string, unknown>;

      expect(parsed['_meta']).toBeDefined();
      expect((parsed['_meta'] as Record<string, unknown>)['sourceId']).toBe('legacy-123');
    });

    it('should omit _meta from JSON when undefined', () => {
      const specimen = createSpecimen({
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      });

      const json = serializeSpecimen(specimen);
      const parsed = JSON.parse(json) as Record<string, unknown>;

      expect('_meta' in parsed).toBe(false);
    });

    it('should place _meta last in serialized output', () => {
      const specimen = createSpecimen({
        type: 'SUBSTRATE',
        species: 'Hericium erinaceus',
        strain: 'Premium',
        _meta: { sourceId: 'test' },
      });

      const json = serializeSpecimen(specimen);
      const keys = Object.keys(JSON.parse(json) as Record<string, unknown>);

      expect(keys[keys.length - 1]).toBe('_meta');
    });
  });

  describe('parseSpecimen with _meta', () => {
    it('should parse _meta from JSON', () => {
      const json = JSON.stringify({
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        _meta: {
          sourceId: 'imported-001',
          sourceSystem: 'external',
        },
      });

      const result = parseSpecimen(json);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data._meta).toBeDefined();
        expect(result.data._meta?.sourceId).toBe('imported-001');
        expect(result.data._meta?.sourceSystem).toBe('external');
      }
    });

    it('should handle missing _meta gracefully', () => {
      const json = JSON.stringify({
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      });

      const result = parseSpecimen(json);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data._meta).toBeUndefined();
      }
    });

    it('should preserve arbitrary _meta fields', () => {
      const json = JSON.stringify({
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        _meta: {
          sourceId: 'ext-001',
          platformVersion: '2.5.1',
          syncTimestamp: 1706180000000,
          tags: ['imported', 'verified'],
        },
      });

      const result = parseSpecimen(json);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data._meta?.platformVersion).toBe('2.5.1');
        expect(result.data._meta?.syncTimestamp).toBe(1706180000000);
        expect(result.data._meta?.tags).toEqual(['imported', 'verified']);
      }
    });
  });

  describe('round-trip preservation', () => {
    it('should preserve _meta through create -> serialize -> parse', () => {
      const originalMeta: SpecimenMeta = {
        sourceId: 'round-trip-test',
        sourceSystem: 'test-platform',
        importedAt: '2026-01-25T12:00:00Z',
        schemaVersion: '2.0',
        customData: { nested: { deep: 'value' } },
      };

      const original = createSpecimen({
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        strain: 'Blue Oyster',
        _meta: originalMeta,
      });

      const json = serializeSpecimen(original);
      const parsed = parseSpecimen(json);

      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data._meta).toEqual(originalMeta);
      }
    });

    it('should preserve _meta with all known fields', () => {
      const meta: SpecimenMeta = {
        sourceId: 'ext-123',
        sourceSystem: 'legacy',
        importedAt: '2026-01-01T00:00:00Z',
        schemaVersion: '1.0',
      };

      const specimen = createSpecimen({
        type: 'SPAWN',
        species: 'Ganoderma lucidum',
        _meta: meta,
      });

      const json = serializeSpecimen(specimen);
      const result = parseSpecimen(json);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data._meta?.sourceId).toBe('ext-123');
        expect(result.data._meta?.sourceSystem).toBe('legacy');
        expect(result.data._meta?.importedAt).toBe('2026-01-01T00:00:00Z');
        expect(result.data._meta?.schemaVersion).toBe('1.0');
      }
    });
  });

  describe('validateSpecimen with _meta', () => {
    it('should validate specimen with _meta as valid', () => {
      const specimen: Specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: asSpecimenId('wemush:abc123def456'),
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        _meta: {
          sourceId: 'test-123',
        },
      };

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should not warn about _meta as unknown field', () => {
      const specimen: Specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: asSpecimenId('wemush:abc123def456'),
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        _meta: {
          sourceId: 'no-warning-test',
        },
      };

      const result = validateSpecimen(specimen);

      expect(result.valid).toBe(true);
      // Should not have warnings about _meta being unknown
      const metaWarnings = result.warnings.filter(w => w.path === '_meta');
      expect(metaWarnings).toHaveLength(0);
    });
  });
});
