/**
 * Unit tests for decryption functionality
 * Tests decryptSpecimen() function
 */

import { describe, it, expect } from 'vitest';

import { createSpecimen } from '../../src/specimen.js';
import { encryptSpecimen } from '../../src/crypto/encrypt.js';
import { decryptSpecimen } from '../../src/crypto/decrypt.js';
import type { Specimen } from '../../src/types.js';

describe('Decryption', () => {
  const testSpecimen = createSpecimen({
    type: 'CULTURE',
    species: 'Pleurotus ostreatus',
    strain: { name: 'Blue Oyster', generation: 'F2' },
    stage: 'COLONIZATION',
    batch: 'BATCH-001',
  });

  describe('decryptSpecimen()', () => {
    it('should decrypt encrypted specimen with same password', async () => {
      const password = 'test-password-123';
      const encrypted = await encryptSpecimen(testSpecimen, { key: password });
      const result = await decryptSpecimen(encrypted, { key: password });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.species).toBe('Pleurotus ostreatus');
        expect(result.data.type).toBe('CULTURE');
        expect(result.data.stage).toBe('COLONIZATION');
        expect(result.data.strain?.name).toBe('Blue Oyster');
        expect(result.data.strain?.generation).toBe('F2');
        expect(result.data.batch).toBe('BATCH-001');
      }
    });

    it('should round-trip all specimen fields', async () => {
      const fullSpecimen = createSpecimen({
        type: 'SUBSTRATE',
        species: 'Hericium erinaceus',
        strain: { name: 'Lion\'s Mane', generation: 'F3', clonalGeneration: 2 },
        stage: 'FRUITING',
        batch: 'BATCH-LM-042',
        organization: 'org_123',
        custom: {
          substrate: 'hardwood',
          humidity: 85,
        },
      });

      const password = 'secure-key';
      const encrypted = await encryptSpecimen(fullSpecimen, { key: password });
      const result = await decryptSpecimen(encrypted, { key: password });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.species).toBe(fullSpecimen.species);
        expect(result.data.type).toBe(fullSpecimen.type);
        expect(result.data.stage).toBe(fullSpecimen.stage);
        expect(result.data.strain?.name).toBe('Lion\'s Mane');
        expect(result.data.batch).toBe(fullSpecimen.batch);
        expect(result.data.organization).toBe(fullSpecimen.organization);
        expect(result.data.custom?.substrate).toBe('hardwood');
        expect(result.data.custom?.humidity).toBe(85);
      }
    });

    it('should decrypt with CryptoKey', async () => {
      const cryptoKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );

      const encrypted = await encryptSpecimen(testSpecimen, { key: cryptoKey });
      const result = await decryptSpecimen(encrypted, { key: cryptoKey });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.species).toBe('Pleurotus ostreatus');
      }
    });

    it('should return error for wrong password', async () => {
      const encrypted = await encryptSpecimen(testSpecimen, {
        key: 'correct-password',
      });

      const result = await decryptSpecimen(encrypted, {
        key: 'wrong-password',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('WOLS_DECRYPTION_ERROR');
      }
    });

    it('should return error for tampered payload', async () => {
      const encrypted = await encryptSpecimen(testSpecimen, {
        key: 'password',
      });

      // Tamper with the payload
      const tamperedEncrypted = {
        ...encrypted,
        payload: encrypted.payload.replace(/./g, (c) => (c === 'A' ? 'B' : 'A')),
      };

      const result = await decryptSpecimen(tamperedEncrypted, {
        key: 'password',
      });

      expect(result.success).toBe(false);
    });

    it('should return error for invalid encrypted specimen', async () => {
      const invalid = {
        encrypted: true,
        payload: 'not-valid-base64!@#$',
        iv: 'also-not-valid!',
        algorithm: 'AES-256-GCM' as const,
      };

      const result = await decryptSpecimen(invalid, { key: 'password' });

      expect(result.success).toBe(false);
    });

    it('should return error for missing payload', async () => {
      const invalid = {
        encrypted: true,
        iv: 'someiv',
        algorithm: 'AES-256-GCM' as const,
      } as any;

      const result = await decryptSpecimen(invalid, { key: 'password' });

      expect(result.success).toBe(false);
    });

    it('should return error for missing iv', async () => {
      const invalid = {
        encrypted: true,
        payload: 'somepayload',
        algorithm: 'AES-256-GCM' as const,
      } as any;

      const result = await decryptSpecimen(invalid, { key: 'password' });

      expect(result.success).toBe(false);
    });
  });

  describe('round-trip with different password lengths', () => {
    it('should handle short password', async () => {
      const encrypted = await encryptSpecimen(testSpecimen, { key: 'ab' });
      const result = await decryptSpecimen(encrypted, { key: 'ab' });
      expect(result.success).toBe(true);
    });

    it('should handle long password', async () => {
      const longPassword = 'a'.repeat(256);
      const encrypted = await encryptSpecimen(testSpecimen, { key: longPassword });
      const result = await decryptSpecimen(encrypted, { key: longPassword });
      expect(result.success).toBe(true);
    });

    it('should handle unicode password', async () => {
      const unicodePassword = '密码 🔐 пароль';
      const encrypted = await encryptSpecimen(testSpecimen, { key: unicodePassword });
      const result = await decryptSpecimen(encrypted, { key: unicodePassword });
      expect(result.success).toBe(true);
    });

    it('should handle empty password', async () => {
      const encrypted = await encryptSpecimen(testSpecimen, { key: '' });
      const result = await decryptSpecimen(encrypted, { key: '' });
      expect(result.success).toBe(true);
    });
  });
});
