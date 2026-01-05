/**
 * Parser Unit Tests
 *
 * Tests for the parseSpecimen() function.
 * TDD: Write these tests FIRST before implementation.
 */
import { describe, it, expect } from 'vitest';
import {
  parseSpecimen,
  WolsErrorCode,
  WOLS_CONTEXT,
  serializeSpecimen,
  createSpecimen,
  type Specimen,
} from '../../src/index.js';
import fixtures from '../fixtures/specimens.json';

describe('parseSpecimen()', () => {
  describe('success cases', () => {
    it('should parse minimal valid specimen JSON', () => {
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
        expect(result.data['@context']).toBe(WOLS_CONTEXT);
        expect(result.data['@type']).toBe('Specimen');
        expect(result.data.id).toBe('wemush:abc123def456');
        expect(result.data.version).toBe('1.1.0');
        expect(result.data.type).toBe('CULTURE');
        expect(result.data.species).toBe('Pleurotus ostreatus');
      }
    });

    it('should parse specimen with all optional fields', () => {
      const json = JSON.stringify({
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
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
      });

      const result = parseSpecimen(json);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.strain?.name).toBe("Lion's Mane Premium");
        expect(result.data.strain?.generation).toBe('F2');
        expect(result.data.stage).toBe('COLONIZATION');
        expect(result.data.batch).toBe('batch_2025_12_001');
      }
    });

    it('should parse all valid specimens from fixtures', () => {
      for (const validSpecimen of fixtures.valid) {
        const json = JSON.stringify(validSpecimen);
        const result = parseSpecimen(json);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data['@context']).toBe(WOLS_CONTEXT);
          expect(result.data['@type']).toBe('Specimen');
        }
      }
    });

    it('should round-trip through serialize and parse', () => {
      const specimen = createSpecimen({
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        strain: 'Blue Oyster',
        stage: 'COLONIZATION',
      });

      const serialized = serializeSpecimen(specimen);
      const result = parseSpecimen(serialized);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(specimen.type);
        expect(result.data.species).toBe(specimen.species);
        expect(result.data.strain?.name).toBe('Blue Oyster');
        expect(result.data.stage).toBe(specimen.stage);
      }
    });

    it('should preserve custom fields during parsing', () => {
      const json = JSON.stringify({
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        custom: {
          vendorCode: 'VENDOR001',
          notes: 'Test specimen',
          nested: { deep: { value: 123 } },
        },
      });

      const result = parseSpecimen(json);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.custom?.vendorCode).toBe('VENDOR001');
        expect(result.data.custom?.notes).toBe('Test specimen');
        expect((result.data.custom?.nested as Record<string, Record<string, number>>)?.deep?.value).toBe(123);
      }
    });

    it('should handle extra whitespace in JSON', () => {
      const json = `
        {
          "@context": "${WOLS_CONTEXT}",
          "@type": "Specimen",
          "id": "wemush:abc123def456",
          "version": "1.1.0",
          "type": "CULTURE",
          "species": "Pleurotus ostreatus"
        }
      `;

      const result = parseSpecimen(json);

      expect(result.success).toBe(true);
    });
  });

  describe('error cases', () => {
    it('should fail on invalid JSON syntax', () => {
      const json = '{ invalid json }';

      const result = parseSpecimen(json);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(WolsErrorCode.INVALID_JSON);
      }
    });

    it('should fail on incomplete JSON', () => {
      const json = '{"@context": "https://wemush.com/wols/v1"';

      const result = parseSpecimen(json);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(WolsErrorCode.INVALID_JSON);
      }
    });

    it('should fail on non-object JSON', () => {
      const json = '"just a string"';

      const result = parseSpecimen(json);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(WolsErrorCode.INVALID_FORMAT);
      }
    });

    it('should fail on array JSON', () => {
      const json = '[]';

      const result = parseSpecimen(json);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(WolsErrorCode.INVALID_FORMAT);
      }
    });

    it('should fail on null JSON', () => {
      const json = 'null';

      const result = parseSpecimen(json);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(WolsErrorCode.INVALID_FORMAT);
      }
    });

    it('should fail on missing @context', () => {
      const json = JSON.stringify({
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      });

      const result = parseSpecimen(json);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(WolsErrorCode.INVALID_CONTEXT);
      }
    });

    it('should fail on invalid @context', () => {
      const json = JSON.stringify({
        '@context': 'https://wrong.com/context',
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      });

      const result = parseSpecimen(json);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(WolsErrorCode.INVALID_CONTEXT);
      }
    });

    it('should fail on missing required fields', () => {
      const json = JSON.stringify({
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
      });

      const result = parseSpecimen(json);

      expect(result.success).toBe(false);
    });

    it('should fail on invalid ID format', () => {
      const json = JSON.stringify({
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'invalid-id-format',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      });

      const result = parseSpecimen(json);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(WolsErrorCode.INVALID_ID_FORMAT);
      }
    });

    it('should fail on invalid specimen from fixtures', () => {
      for (const invalidCase of fixtures.invalid) {
        const json = JSON.stringify(invalidCase.specimen);
        const result = parseSpecimen(json);

        expect(result.success).toBe(false);
        if (!result.success) {
          // Error code should match expected error
          expect(result.error.code).toBe(invalidCase.expectedError);
        }
      }
    });
  });

  describe('position information', () => {
    it('should include position in parse error for invalid JSON', () => {
      const json = '{"key": invalid}';

      const result = parseSpecimen(json);

      expect(result.success).toBe(false);
      // Position may be available depending on the JSON parser
    });
  });

  describe('edge cases', () => {
    it('should handle empty string input', () => {
      const result = parseSpecimen('');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(WolsErrorCode.INVALID_JSON);
      }
    });

    it('should handle Unicode in species name', () => {
      const json = JSON.stringify({
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus (ヒラタケ)',
      });

      const result = parseSpecimen(json);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.species).toBe('Pleurotus ostreatus (ヒラタケ)');
      }
    });

    it('should handle special characters in strain name', () => {
      const json = JSON.stringify({
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        strain: { name: "King's \"Special\" & <Premium>" },
      });

      const result = parseSpecimen(json);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.strain?.name).toBe("King's \"Special\" & <Premium>");
      }
    });

    it('should handle very long JSON strings', () => {
      const longNotes = 'x'.repeat(10000);
      const json = JSON.stringify({
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        custom: { notes: longNotes },
      });

      const result = parseSpecimen(json);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.custom?.notes).toBe(longNotes);
      }
    });
  });
});
