/**
 * Fuzz Tests for Malformed Input
 *
 * Tests for parseSpecimen() with malformed and edge-case inputs.
 * These tests verify the parser handles unexpected input gracefully.
 */
import { describe, it, expect } from 'vitest';
import { parseSpecimen, WOLS_CONTEXT } from '../../src/index.js';

describe('Malformed Input Fuzz Tests', () => {
  describe('malformed JSON strings', () => {
    const malformedInputs = [
      '',
      '   ',
      '\n\t',
      'undefined',
      'NaN',
      'Infinity',
      '{',
      '}',
      '[',
      ']',
      '{{}}',
      '[{}]',
      '{"key":}',
      '{:value}',
      '{"key": undefined}',
      '{"key": NaN}',
      '{null}',
      '{"unclosed": "string',
      '{"trailing": "comma",}',
      '{"key": [1, 2, 3,]}',
      '["no", "closing", "bracket"',
      '{/* comment */}',
      '{"key": 1 // comment\n}',
    ];

    for (const input of malformedInputs) {
      it(`should handle malformed input: ${JSON.stringify(input).slice(0, 50)}`, () => {
        const result = parseSpecimen(input);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBeDefined();
          expect(result.error.code).toBeDefined();
          expect(result.error.message).toBeDefined();
        }
      });
    }
  });

  describe('non-string primitives as JSON', () => {
    const primitives = ['123', '-456', '0.5', 'true', 'false', 'null'];

    for (const input of primitives) {
      it(`should reject primitive JSON value: ${input}`, () => {
        const result = parseSpecimen(input);
        expect(result.success).toBe(false);
      });
    }
  });

  describe('valid JSON but invalid WOLS', () => {
    const invalidWols = [
      {},
      { foo: 'bar' },
      { '@context': WOLS_CONTEXT },
      { '@context': WOLS_CONTEXT, '@type': 'Specimen' },
      {
        '@context': 'https://wrong.context',
        '@type': 'Specimen',
        id: 'wemush:test123',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Test',
      },
      {
        '@context': WOLS_CONTEXT,
        '@type': 'WrongType',
        id: 'wemush:test123',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Test',
      },
    ];

    for (const input of invalidWols) {
      it(`should reject invalid WOLS: ${JSON.stringify(input).slice(0, 60)}...`, () => {
        const result = parseSpecimen(JSON.stringify(input));
        expect(result.success).toBe(false);
      });
    }
  });

  describe('special characters and encoding', () => {
    it('should handle null bytes in JSON string', () => {
      const json = `{"@context": "${WOLS_CONTEXT}", "@type": "Specimen", "id": "wemush:test\\u0000123"}`;
      const result = parseSpecimen(json);
      // Should either parse or fail gracefully
      expect(typeof result.success).toBe('boolean');
    });

    it('should handle escaped characters', () => {
      const json = JSON.stringify({
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Test\n\t\r\\Species',
      });

      const result = parseSpecimen(json);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.species).toBe('Test\n\t\r\\Species');
      }
    });

    it('should handle surrogate pairs', () => {
      const json = JSON.stringify({
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Test 🍄 Mushroom',
      });

      const result = parseSpecimen(json);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.species).toBe('Test 🍄 Mushroom');
      }
    });
  });

  describe('deeply nested objects', () => {
    it('should handle deeply nested custom fields', () => {
      const createNested = (depth: number): Record<string, unknown> => {
        if (depth === 0) return { value: 'leaf' };
        return { nested: createNested(depth - 1) };
      };

      const json = JSON.stringify({
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Test',
        custom: createNested(50),
      });

      const result = parseSpecimen(json);
      expect(result.success).toBe(true);
    });
  });

  describe('large inputs', () => {
    it('should handle very long species name', () => {
      const json = JSON.stringify({
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'A'.repeat(10000),
      });

      const result = parseSpecimen(json);
      expect(result.success).toBe(true);
    });

    it('should handle large array in custom field', () => {
      const json = JSON.stringify({
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123def456',
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Test',
        custom: {
          largeArray: Array.from({ length: 1000 }, (_, i) => i),
        },
      });

      const result = parseSpecimen(json);
      expect(result.success).toBe(true);
    });
  });

  describe('type coercion attacks', () => {
    it('should not coerce string id to number', () => {
      const json = JSON.stringify({
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 123, // Wrong type - should be string
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Test',
      });

      const result = parseSpecimen(json);
      expect(result.success).toBe(false);
    });

    it('should not coerce version to number', () => {
      const json = JSON.stringify({
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: 'wemush:abc123',
        version: 1.1, // Wrong type - should be string
        type: 'CULTURE',
        species: 'Test',
      });

      const result = parseSpecimen(json);
      expect(result.success).toBe(false);
    });
  });

  describe('prototype pollution protection', () => {
    it('should safely handle __proto__ in JSON', () => {
      const json = '{"__proto__": {"polluted": true}, "@context": "' + WOLS_CONTEXT + '", "@type": "Specimen", "id": "wemush:abc123", "version": "1.1.0", "type": "CULTURE", "species": "Test"}';

      const result = parseSpecimen(json);
      // Should parse as unknown field warning, not cause prototype pollution
      const emptyObj: Record<string, unknown> = {};
      expect(emptyObj['polluted']).toBeUndefined();
    });

    it('should safely handle constructor in JSON', () => {
      const json = '{"constructor": {"polluted": true}, "@context": "' + WOLS_CONTEXT + '", "@type": "Specimen", "id": "wemush:abc123", "version": "1.1.0", "type": "CULTURE", "species": "Test"}';

      const result = parseSpecimen(json);
      // Should handle safely
      expect(typeof result.success).toBe('boolean');
    });
  });
});
