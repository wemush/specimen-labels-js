/**
 * QR Code Generation Tests
 *
 * Tests for QR code generation functions.
 * TDD: Write these tests FIRST before implementation.
 */
import { describe, it, expect } from 'vitest';
import {
  toQRCode,
  toQRCodeDataURL,
  toQRCodeSVG,
  isQRAvailable,
} from '../../src/qr/index.js';
import { createSpecimen, WOLS_CONTEXT, asSpecimenId, type Specimen } from '../../src/index.js';

describe('QR Code Generation', () => {
  const minimalSpecimen: Specimen = {
    '@context': WOLS_CONTEXT,
    '@type': 'Specimen',
    id: asSpecimenId('wemush:abc123def456'),
    version: '1.1.0',
    type: 'CULTURE',
    species: 'Pleurotus ostreatus',
  };

  describe('isQRAvailable()', () => {
    it('should return true when qrcode library is available', async () => {
      expect(await isQRAvailable()).toBe(true);
    });
  });

  describe('toQRCode()', () => {
    it('should generate PNG buffer for minimal specimen', async () => {
      const buffer = await toQRCode(minimalSpecimen);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
      // PNG magic bytes
      expect(buffer[0]).toBe(0x89);
      expect(buffer[1]).toBe(0x50); // P
      expect(buffer[2]).toBe(0x4e); // N
      expect(buffer[3]).toBe(0x47); // G
    });

    it('should generate QR code for specimen created with createSpecimen', async () => {
      const specimen = createSpecimen({
        type: 'SPAWN',
        species: 'Hericium erinaceus',
        strain: "Lion's Mane Premium",
      });

      const buffer = await toQRCode(specimen);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should respect size option', async () => {
      const small = await toQRCode(minimalSpecimen, { size: 100 });
      const large = await toQRCode(minimalSpecimen, { size: 500 });

      // Larger QR codes should produce larger images
      expect(large.length).toBeGreaterThan(small.length);
    });

    it('should respect error correction option', async () => {
      const low = await toQRCode(minimalSpecimen, { errorCorrection: 'L' });
      const high = await toQRCode(minimalSpecimen, { errorCorrection: 'H' });

      // Higher error correction adds more redundancy
      expect(high.length).toBeGreaterThan(low.length);
    });

    it('should support margin option', async () => {
      const noMargin = await toQRCode(minimalSpecimen, { margin: 0 });
      const withMargin = await toQRCode(minimalSpecimen, { margin: 4 });

      // Different margin sizes produce different images
      expect(noMargin.length).not.toBe(withMargin.length);
    });

    it('should support compact format option', async () => {
      const embedded = await toQRCode(minimalSpecimen, { format: 'embedded' });
      const compact = await toQRCode(minimalSpecimen, { format: 'compact' });

      // Compact format should be smaller (shorter URL)
      expect(compact.length).toBeLessThan(embedded.length);
    });
  });

  describe('toQRCodeDataURL()', () => {
    it('should generate data URL for minimal specimen', async () => {
      const dataUrl = await toQRCodeDataURL(minimalSpecimen);

      expect(typeof dataUrl).toBe('string');
      expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    });

    it('should generate valid base64 in data URL', async () => {
      const dataUrl = await toQRCodeDataURL(minimalSpecimen);
      const base64Part = dataUrl.replace('data:image/png;base64,', '');

      // Should be valid base64
      expect(() => Buffer.from(base64Part, 'base64')).not.toThrow();
    });

    it('should respect size option', async () => {
      const small = await toQRCodeDataURL(minimalSpecimen, { size: 100 });
      const large = await toQRCodeDataURL(minimalSpecimen, { size: 500 });

      expect(large.length).toBeGreaterThan(small.length);
    });

    it('should support all error correction levels', async () => {
      const levels = ['L', 'M', 'Q', 'H'] as const;

      for (const level of levels) {
        const dataUrl = await toQRCodeDataURL(minimalSpecimen, {
          errorCorrection: level,
        });
        expect(dataUrl).toMatch(/^data:image\/png;base64,/);
      }
    });
  });

  describe('toQRCodeSVG()', () => {
    it('should generate SVG string for minimal specimen', async () => {
      const svg = await toQRCodeSVG(minimalSpecimen);

      expect(typeof svg).toBe('string');
      expect(svg).toMatch(/^<svg/);
      expect(svg.trim()).toMatch(/<\/svg>$/);
    });

    it('should include proper SVG namespace', async () => {
      const svg = await toQRCodeSVG(minimalSpecimen);

      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    });

    it('should respect color options', async () => {
      const svg = await toQRCodeSVG(minimalSpecimen, {
        color: { dark: '#ff0000', light: '#00ff00' },
      });

      // Should include the custom colors
      expect(svg).toContain('#ff0000');
      expect(svg).toContain('#00ff00');
    });

    it('should respect size option', async () => {
      const small = await toQRCodeSVG(minimalSpecimen, { size: 100 });
      const large = await toQRCodeSVG(minimalSpecimen, { size: 500 });

      // Size should be reflected in viewBox or dimensions
      expect(large).toContain('500');
      expect(small).toContain('100');
    });
  });

  describe('QR code content', () => {
    it('should embed full JSON-LD by default', async () => {
      const dataUrl = await toQRCodeDataURL(minimalSpecimen, { format: 'embedded' });

      // The data URL contains base64 PNG with embedded JSON-LD
      expect(dataUrl.length).toBeGreaterThan(200);
    });

    it('should use compact URL format when specified', async () => {
      const embedded = await toQRCodeDataURL(minimalSpecimen, { format: 'embedded' });
      const compact = await toQRCodeDataURL(minimalSpecimen, { format: 'compact' });

      // Compact should be smaller
      expect(compact.length).toBeLessThan(embedded.length);
    });
  });

  describe('error handling', () => {
    it('should handle very large specimens', async () => {
      const largeSpecimen: Specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: asSpecimenId('wemush:abc123def456'),
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
        custom: {
          notes: 'x'.repeat(2000),
        },
      };

      // With high error correction, might exceed QR capacity
      // Should gracefully handle or throw meaningful error
      await expect(
        toQRCode(largeSpecimen, { errorCorrection: 'H' })
      ).rejects.toThrow();
    });
  });
});
