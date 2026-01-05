/**
 * QR Code Round-Trip Integration Tests
 *
 * Tests that verify QR codes can be generated and decoded back.
 */
import { describe, it, expect } from 'vitest';
import { createSpecimen, parseSpecimen, serializeSpecimen, WOLS_CONTEXT, asSpecimenId, type Specimen } from '../../src/index.js';
import { toQRCode, toQRCodeDataURL } from '../../src/qr/index.js';

// Note: Decoding QR codes requires a decoder library (e.g., jsqr)
// For now, we test that the generation works and produces valid output

describe('QR Code Round-Trip', () => {
  describe('specimen to QR code generation', () => {
    it('should generate QR code for minimal specimen', async () => {
      const specimen = createSpecimen({
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      });

      const buffer = await toQRCode(specimen);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(100);
    });

    it('should generate QR code for full specimen', async () => {
      const specimen = createSpecimen({
        type: 'SUBSTRATE',
        species: 'Hericium erinaceus',
        strain: {
          name: "Lion's Mane Premium",
          generation: 'F2',
          clonalGeneration: 3,
        },
        stage: 'COLONIZATION',
        batch: 'batch_2025',
        organization: 'org_test',
      });

      const buffer = await toQRCode(specimen);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(100);
    });

    it('should generate identical QR codes for same specimen', async () => {
      const specimen: Specimen = {
        '@context': WOLS_CONTEXT,
        '@type': 'Specimen',
        id: asSpecimenId('wemush:deterministic123'),
        version: '1.1.0',
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      };

      const buffer1 = await toQRCode(specimen);
      const buffer2 = await toQRCode(specimen);

      expect(buffer1.equals(buffer2)).toBe(true);
    });

    it('should generate different QR codes for different specimens', async () => {
      const specimen1 = createSpecimen({
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      });

      const specimen2 = createSpecimen({
        type: 'SPAWN',
        species: 'Hericium erinaceus',
      });

      const buffer1 = await toQRCode(specimen1);
      const buffer2 = await toQRCode(specimen2);

      // Different specimens = different QR codes
      expect(buffer1.equals(buffer2)).toBe(false);
    });
  });

  describe('content verification', () => {
    it('should embed serialized specimen in embedded format', async () => {
      const specimen = createSpecimen({
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      });

      // Generate with embedded format (full JSON-LD)
      const dataUrl = await toQRCodeDataURL(specimen, { format: 'embedded' });

      // The content should be large enough to contain the full JSON
      const serialized = serializeSpecimen(specimen);

      // Data URL should be reasonably sized for the content
      expect(dataUrl.length).toBeGreaterThan(serialized.length);
    });

    it('should generate compact QR codes for compact format', async () => {
      const specimen = createSpecimen({
        type: 'CULTURE',
        species: 'Pleurotus ostreatus',
      });

      const embedded = await toQRCodeDataURL(specimen, { format: 'embedded' });
      const compact = await toQRCodeDataURL(specimen, { format: 'compact' });

      // Compact should be significantly smaller
      expect(compact.length).toBeLessThan(embedded.length);
    });
  });

  describe('all specimen types', () => {
    const specimenTypes = ['CULTURE', 'SPAWN', 'SUBSTRATE', 'FRUITING', 'HARVEST'] as const;

    for (const type of specimenTypes) {
      it(`should generate QR code for ${type} specimen`, async () => {
        const specimen = createSpecimen({
          type,
          species: 'Pleurotus ostreatus',
        });

        const buffer = await toQRCode(specimen);

        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.length).toBeGreaterThan(0);
      });
    }
  });

  describe('all growth stages', () => {
    const stages = ['INOCULATION', 'COLONIZATION', 'FRUITING', 'HARVEST'] as const;

    for (const stage of stages) {
      it(`should generate QR code for ${stage} stage`, async () => {
        const specimen = createSpecimen({
          type: 'CULTURE',
          species: 'Pleurotus ostreatus',
          stage,
        });

        const buffer = await toQRCode(specimen);

        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.length).toBeGreaterThan(0);
      });
    }
  });
});
