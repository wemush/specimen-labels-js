/**
 * WOLS 1.5 draft label tolerance (open-standard proposals/wols-1.5-data-model.md, section 2):
 * - `version` allows a pre-release suffix (1.5.0-rc.1)
 * - unknown top-level members are valid (a warning) and survive parse and re-serialize
 */

import { describe, it, expect } from 'vitest';

import {
  decryptFields,
  encryptFields,
  parseSpecimen,
  serializeSpecimen,
  validateSpecimen,
  WOLS_CONTEXT,
  WolsErrorCode,
  type Specimen,
} from '../../src/index.js';

const base = {
  '@context': WOLS_CONTEXT,
  '@type': 'Specimen',
  id: 'wemush:clx1a2b3c4',
  version: '1.4.0',
  type: 'SUBSTRATE',
  species: 'Pleurotus ostreatus',
};

describe('WOLS 1.5 draft: version pre-release suffix', () => {
  it.each(['1.5.0', '1.5.0-rc.1', '1.5.0-alpha', '2.0.0-beta.2.x-y'])('accepts %s', version => {
    const result = validateSpecimen({ ...base, version } as unknown as Specimen);
    expect(result.valid).toBe(true);
  });

  it.each(['1.5', '1.5.0-', '1.5.0+build.1', 'v1.5.0', '1.5.0-rc 1'])('rejects %s', version => {
    const result = validateSpecimen({ ...base, version } as unknown as Specimen);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ path: 'version', code: WolsErrorCode.INVALID_VERSION })
    );
  });

  it('parses a pre-release label', () => {
    const result = parseSpecimen(JSON.stringify({ ...base, version: '1.5.0-rc.1' }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.version).toBe('1.5.0-rc.1');
  });
});

describe('WOLS 1.5 draft: unknown top-level members are preserved', () => {
  const label = {
    ...base,
    version: '1.5.0-rc.1',
    taxon: { scientificName: 'Pleurotus ostreatus', rank: 'species' },
    lot: 'TLC-2026-0042',
    derivedFrom: [{ id: 'wemush:parent1', relation: 'inoculum' }],
  };

  it('still warns about each unknown member', () => {
    const result = validateSpecimen(label as unknown as Specimen);
    expect(result.valid).toBe(true);
    const fields = result.warnings.filter(w => w.code === 'UNKNOWN_FIELD').map(w => w.path);
    expect(fields.sort()).toEqual(['derivedFrom', 'lot', 'taxon']);
  });

  it('keeps unknown members on the parsed specimen', () => {
    const result = parseSpecimen(JSON.stringify(label));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.unknownMembers).toEqual({
      taxon: label.taxon,
      lot: label.lot,
      derivedFrom: label.derivedFrom,
    });
  });

  it('writes them back on re-serialization', () => {
    const result = parseSpecimen(JSON.stringify(label));
    if (!result.success) throw result.error;
    const reparsed = JSON.parse(serializeSpecimen(result.data));
    expect(reparsed).toEqual(label);
  });

  it('round-trips twice without change', () => {
    const first = parseSpecimen(JSON.stringify(label));
    if (!first.success) throw first.error;
    const once = serializeSpecimen(first.data);
    const second = parseSpecimen(once);
    if (!second.success) throw second.error;
    expect(serializeSpecimen(second.data)).toBe(once);
  });

  it('leaves unknownMembers off a label that has none', () => {
    const result = parseSpecimen(JSON.stringify(base));
    if (!result.success) throw result.error;
    expect(result.data.unknownMembers).toBeUndefined();
    expect(serializeSpecimen(result.data)).not.toContain('unknownMembers');
  });

  it('never lets a kept member override a known field', () => {
    const result = parseSpecimen(JSON.stringify(label));
    if (!result.success) throw result.error;
    const tampered: Specimen = {
      ...result.data,
      unknownMembers: { id: 'wemush:other', species: 'Other', lot: 'x' },
    };
    const out = JSON.parse(serializeSpecimen(tampered));
    expect(out.id).toBe(base.id);
    expect(out.species).toBe(base.species);
    expect(out.lot).toBe('x');
  });

  it('does not warn about unknownMembers when validating a parsed specimen', () => {
    const result = parseSpecimen(JSON.stringify(label));
    if (!result.success) throw result.error;
    const again = validateSpecimen(result.data);
    expect(again.warnings.map(w => w.path)).not.toContain('unknownMembers');
  });
});

describe('WOLS 1.5 draft: kept members and field encryption', () => {
  const key = 'correct horse battery staple, long enough';
  const label = { ...base, strain: { name: 'Blue Oyster' }, lot: 'TLC-2026-0042' };

  it('writes kept members at the top level and restores them on decrypt', async () => {
    const parsed = parseSpecimen(JSON.stringify(label));
    if (!parsed.success) throw parsed.error;
    const encrypted = await encryptFields(parsed.data, { key, fields: ['strain'] });
    const wire = encrypted as unknown as Record<string, unknown>;
    expect(wire['lot']).toBe('TLC-2026-0042');
    expect(wire['unknownMembers']).toBeUndefined();

    const decrypted = await decryptFields(encrypted, { key });
    expect(decrypted.success).toBe(true);
    if (decrypted.success) {
      expect(decrypted.data.strain).toEqual({ name: 'Blue Oyster' });
      expect(decrypted.data.unknownMembers).toEqual({ lot: 'TLC-2026-0042' });
    }
  });

  it('refuses to encrypt unknownMembers itself', async () => {
    const parsed = parseSpecimen(JSON.stringify(label));
    if (!parsed.success) throw parsed.error;
    await expect(
      encryptFields(parsed.data, { key, fields: ['unknownMembers'] })
    ).rejects.toThrow(/unknownMembers/);
  });
});
