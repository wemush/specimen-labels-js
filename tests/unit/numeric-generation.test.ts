/**
 * Numeric strain.generation (WOLS 1.4.0).
 *
 * `wols` for Python 1.3.0 wrote strain.generation as a JSON integer. Decoders
 * read it as its decimal string with a NUMERIC_GENERATION warning; generators
 * always write a string.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NUMERIC_GENERATION_WARNING,
  WOLS_CONTEXT,
  WolsErrorCode,
  asSpecimenId,
  createSpecimen,
  decryptFields,
  decryptSpecimen,
  encryptFields,
  parseSpecimen,
  serializeSpecimen,
  validateSpecimen,
  type Specimen,
  type SpecimenInput,
  type ValidationWarning,
} from '../../src/index.js';

const VECTORS = join(dirname(fileURLToPath(import.meta.url)), '..', 'conformance', 'vectors');
type Case = { id: string; input: Record<string, unknown>; expected: Record<string, unknown> };
function vector(file: string, id: string): Case {
  const doc = JSON.parse(readFileSync(join(VECTORS, file), 'utf8')) as { cases: Case[] };
  const found = doc.cases.find(c => c.id === id);
  if (!found) throw new Error(`${file}: no case ${id}`);
  return found;
}

function label(generation: unknown): Record<string, unknown> {
  return {
    '@context': WOLS_CONTEXT,
    '@type': 'Specimen',
    id: 'wemush:numeric-gen',
    version: '1.3.0',
    type: 'CULTURE',
    species: 'Pleurotus ostreatus',
    strain: { name: 'Blue Oyster', generation, clonalGeneration: 0 },
    stage: 'INOCULATION',
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('validateSpecimen: numeric strain.generation', () => {
  it('accepts a JSON integer with a NUMERIC_GENERATION warning', () => {
    const result = validateSpecimen(label(1));
    expect(result.valid).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ path: 'strain.generation', code: NUMERIC_GENERATION_WARNING })
    );
  });

  it('does not warn for the string form', () => {
    const result = validateSpecimen(label('1'));
    expect(result.valid).toBe(true);
    expect(result.warnings.map(w => w.code)).not.toContain(NUMERIC_GENERATION_WARNING);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 2, true, null])(
    'rejects %s, whose decimal string is not a generation',
    generation => {
      const result = validateSpecimen(label(generation));
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: 'strain.generation',
          code: WolsErrorCode.INVALID_GENERATION,
        })
      );
    }
  );
});

describe('parseSpecimen: numeric strain.generation', () => {
  it('reads a JSON integer as its decimal string and reports one warning', () => {
    const warnings: ValidationWarning[] = [];
    const json = JSON.stringify(label(2));
    const result = parseSpecimen(json, { onWarning: w => warnings.push(w) });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.strain?.generation).toBe('2');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      path: 'strain.generation',
      code: NUMERIC_GENERATION_WARNING,
    });
  });

  it('warns on console.warn when no onWarning is given', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = parseSpecimen(JSON.stringify(label(1)));
    expect(result.success).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('strain.generation');
  });

  it('does not warn for a string generation', () => {
    const onWarning = vi.fn();
    const result = parseSpecimen(JSON.stringify(label('F1')), { onWarning });
    expect(result.success).toBe(true);
    expect(onWarning).not.toHaveBeenCalled();
  });
});

describe('decryption: numeric strain.generation', () => {
  it('decryptSpecimen decodes decrypt-numeric-generation to the decimal string', async () => {
    const c = vector('encrypted.json', 'decrypt-numeric-generation');
    const { url, secret } = c.input as { url: string; secret: { passphrase: string } };
    const warnings: ValidationWarning[] = [];
    const result = await decryptSpecimen(url, {
      key: secret.passphrase,
      onWarning: w => warnings.push(w),
    });
    expect(result.success, result.success ? '' : result.error.message).toBe(true);
    if (result.success) expect(result.data).toEqual(c.expected['specimen']);
    expect(warnings.map(w => w.code)).toEqual([NUMERIC_GENERATION_WARNING]);
  });

  it('decryptFields decodes decrypt-fields-numeric-generation to the decimal string', async () => {
    const c = vector('field-encryption.json', 'decrypt-fields-numeric-generation');
    const { specimen, secret } = c.input as {
      specimen: Record<string, unknown>;
      secret: { passphrase: string };
    };
    const warnings: ValidationWarning[] = [];
    const result = await decryptFields(specimen, {
      key: secret.passphrase,
      onWarning: w => warnings.push(w),
    });
    expect(result.success, result.success ? '' : result.error.message).toBe(true);
    if (result.success) expect(result.data).toEqual(c.expected['specimen']);
    expect(warnings.map(w => w.code)).toEqual([NUMERIC_GENERATION_WARNING]);
  });
});

describe('generators always write a string', () => {
  it('createSpecimen converts a number from an untyped caller, with a warning', () => {
    const warnings: ValidationWarning[] = [];
    const input = {
      type: 'CULTURE',
      species: 'Pleurotus ostreatus',
      strain: { name: 'Blue Oyster', generation: 1 },
    } as unknown as SpecimenInput;
    const specimen = createSpecimen(input, { onWarning: w => warnings.push(w) });
    expect(specimen.strain?.generation).toBe('1');
    expect(warnings.map(w => w.code)).toEqual([NUMERIC_GENERATION_WARNING]);
    expect(serializeSpecimen(specimen)).toContain('"generation":"1"');
  });

  it('serializeSpecimen writes a string for a hand-built numeric generation', () => {
    const specimen = {
      ...label(3),
      id: asSpecimenId('wemush:numeric-gen'),
    } as unknown as Specimen;
    const json = serializeSpecimen(specimen);
    expect(JSON.parse(json).strain.generation).toBe('3');
    // The caller's object is not mutated.
    expect((specimen.strain as unknown as { generation: unknown }).generation).toBe(3);
  });

  it('encryptFields encrypts a string generation', async () => {
    const specimen = {
      ...label(4),
      id: asSpecimenId('wemush:numeric-gen'),
    } as unknown as Specimen;
    const key = new Uint8Array(32).fill(7);
    const partial = await encryptFields(specimen, { key, fields: ['strain'] });
    const onWarning = vi.fn();
    const restored = await decryptFields(partial, { key, onWarning });
    expect(restored.success).toBe(true);
    if (restored.success) expect(restored.data.strain?.generation).toBe('4');
    // The stored value was already a string, so decoding has nothing to warn about.
    expect(onWarning).not.toHaveBeenCalled();
  });
});
