/**
 * Unit tests for encryption functionality
 * Tests encryptSpecimen() function
 */

import { describe, it, expect } from 'vitest';

import { createSpecimen } from '../../src/specimen.js';
import { encryptSpecimen, isEncrypted } from '../../src/crypto/encrypt.js';
import type { EncryptedSpecimen } from '../../src/types.js';

describe('Encryption', () => {
  const testSpecimen = createSpecimen({
    type: 'CULTURE',
    species: 'Pleurotus ostreatus',
    strain: { name: 'Blue Oyster', generation: 'F2' },
    stage: 'COLONIZATION',
  });

  describe('encryptSpecimen()', () => {
    it('should encrypt specimen with password string', async () => {
      const encrypted = await encryptSpecimen(testSpecimen, {
        key: 'test-password-123',
      });

      expect(encrypted).toBeDefined();
      expect(encrypted.encrypted).toBe(true);
      expect(encrypted.algorithm).toBe('AES-256-GCM');
      expect(typeof encrypted.payload).toBe('string');
      expect(typeof encrypted.iv).toBe('string');
    });

    it('should produce different ciphertexts for same specimen', async () => {
      const encrypted1 = await encryptSpecimen(testSpecimen, {
        key: 'test-password-123',
      });
      const encrypted2 = await encryptSpecimen(testSpecimen, {
        key: 'test-password-123',
      });

      // Due to random IV, payloads should differ
      expect(encrypted1.payload).not.toBe(encrypted2.payload);
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
    });

    it('should produce base64url encoded payload', async () => {
      const encrypted = await encryptSpecimen(testSpecimen, {
        key: 'test-password',
      });

      // Base64url: A-Z, a-z, 0-9, -, _ (no + or /)
      expect(encrypted.payload).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(encrypted.iv).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should encrypt with CryptoKey', async () => {
      // Generate a CryptoKey
      const cryptoKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );

      const encrypted = await encryptSpecimen(testSpecimen, {
        key: cryptoKey,
      });

      expect(encrypted.encrypted).toBe(true);
      expect(encrypted.algorithm).toBe('AES-256-GCM');
    });

    it('should handle specimen with minimal fields', async () => {
      const minimalSpecimen = createSpecimen({
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      });

      const encrypted = await encryptSpecimen(minimalSpecimen, {
        key: 'password',
      });

      expect(encrypted.encrypted).toBe(true);
    });

    it('should handle specimen with custom fields', async () => {
      const customSpecimen = createSpecimen({
        type: 'SUBSTRATE',
        species: 'Pleurotus ostreatus',
        custom: {
          substrate_recipe: 'Hardwood sawdust 80%, wheat bran 20%',
          water_content: 65,
        },
      });

      const encrypted = await encryptSpecimen(customSpecimen, {
        key: 'password',
      });

      expect(encrypted.encrypted).toBe(true);
    });
  });

  describe('isEncrypted()', () => {
    it('should return true for encrypted specimen', async () => {
      const encrypted = await encryptSpecimen(testSpecimen, {
        key: 'password',
      });

      expect(isEncrypted(encrypted)).toBe(true);
    });

    it('should return false for plain specimen', () => {
      expect(isEncrypted(testSpecimen)).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(isEncrypted(null)).toBe(false);
      expect(isEncrypted(undefined)).toBe(false);
    });

    it('should return false for non-object values', () => {
      expect(isEncrypted('string')).toBe(false);
      expect(isEncrypted(123)).toBe(false);
      expect(isEncrypted(true)).toBe(false);
    });

    it('should return false for object without encrypted flag', () => {
      expect(isEncrypted({ payload: 'test', iv: 'test' })).toBe(false);
    });

    it('should return false for object with encrypted=false', () => {
      expect(isEncrypted({ encrypted: false, payload: 'test' })).toBe(false);
    });
  });

  describe('partial encryption', () => {
    it('should only encrypt specified fields', async () => {
      const specimen = createSpecimen({
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        strain: { name: 'Secret Strain', generation: 'F5' },
        stage: 'COLONIZATION',
      });

      const encrypted = await encryptSpecimen(specimen, {
        key: 'password',
        fields: ['strain'],
      }) as unknown as Record<string, unknown>;

      // Result should be partially encrypted
      // The strain field should be encrypted, others should remain
      expect(encrypted.species).toBe('Pleurotus ostreatus');
      expect(encrypted.type).toBe('CULTURE');
      // Strain should be encrypted payload
      expect(typeof (encrypted.strain as { payload?: unknown })?.payload).toBe('string');
    });
  });
});
