/**
 * WOLS v1.3.0 behavior: PRIMORDIA as a type, strain.transferDepth,
 * clonalGeneration 0, and the createSpecimen `created` input.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PRIMORDIA_AS_TYPE_WARNING,
  WOLS_VERSION,
  createSpecimen,
  parseSpecimen,
  registerTypeAlias,
  resolveTypeAlias,
  serializeSpecimen,
  validateSpecimen,
  type Specimen,
  type ValidationWarning,
} from '../../src/index.js';

const SPECIES = 'Pleurotus ostreatus';

function collect(): { warnings: ValidationWarning[]; onWarning: (w: ValidationWarning) => void } {
  const warnings: ValidationWarning[] = [];
  return { warnings, onWarning: w => warnings.push(w) };
}

describe('WOLS_VERSION', () => {
  it('is 1.3.0 and is stamped on new specimens', () => {
    expect(WOLS_VERSION).toBe('1.3.0');
    expect(createSpecimen({ type: 'CULTURE', species: SPECIES }).version).toBe('1.3.0');
  });
});

describe('PRIMORDIA supplied as a type', () => {
  afterEach(() => vi.restoreAllMocks());

  it('resolves to FRUITING, sets stage PRIMORDIA, and warns', () => {
    const { warnings, onWarning } = collect();
    const s = createSpecimen({ type: 'PRIMORDIA', species: SPECIES }, { onWarning });
    expect(s.type).toBe('FRUITING');
    expect(s.stage).toBe('PRIMORDIA');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ path: 'type', code: PRIMORDIA_AS_TYPE_WARNING });
    expect(warnings[0]?.suggestion).toContain("stage: 'PRIMORDIA'");
  });

  it('never overrides a supplied stage', () => {
    const { warnings, onWarning } = collect();
    const s = createSpecimen(
      { type: 'PRIMORDIA', species: SPECIES, stage: 'SENESCENCE' },
      { onWarning }
    );
    expect(s.type).toBe('FRUITING');
    expect(s.stage).toBe('SENESCENCE');
    expect(warnings).toHaveLength(1);
  });

  it.each(['primordia', 'Primordia', 'pRiMoRdIa'])('is case-insensitive: %s', type => {
    const { warnings, onWarning } = collect();
    const s = createSpecimen({ type, species: SPECIES }, { onWarning });
    expect(s).toMatchObject({ type: 'FRUITING', stage: 'PRIMORDIA' });
    expect(warnings).toHaveLength(1);
  });

  it('falls back to console.warn when no onWarning is given', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    createSpecimen({ type: 'PRIMORDIA', species: SPECIES });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toContain('PRIMORDIA');
  });

  it('is never serialized as a type', () => {
    const s = createSpecimen({ type: 'PRIMORDIA', species: SPECIES }, { onWarning: () => {} });
    const json = JSON.parse(serializeSpecimen(s)) as Record<string, unknown>;
    expect(json['type']).toBe('FRUITING');
    expect(json['stage']).toBe('PRIMORDIA');
  });

  it('is resolved by serializeSpecimen even on hand-built objects', () => {
    const handBuilt = {
      ...createSpecimen({ type: 'FRUITING', species: SPECIES }),
      type: 'PRIMORDIA',
    } as unknown as Specimen;
    const json = JSON.parse(serializeSpecimen(handBuilt)) as Record<string, unknown>;
    expect(json['type']).toBe('FRUITING');
    expect(json['stage']).toBe('PRIMORDIA');
    expect(validateSpecimen(json).valid).toBe(true);
  });

  it('is still invalid as a type when validating a serialized label', () => {
    const label = {
      ...JSON.parse(serializeSpecimen(createSpecimen({ type: 'FRUITING', species: SPECIES }))),
      type: 'PRIMORDIA',
    };
    const result = validateSpecimen(label);
    expect(result.valid).toBe(false);
    expect(result.errors.map(e => e.path)).toContain('type');
  });

  it('canonical FRUITING + PRIMORDIA stage produces no warning', () => {
    const { warnings, onWarning } = collect();
    const s = createSpecimen(
      { type: 'FRUITING', stage: 'PRIMORDIA', species: SPECIES },
      { onWarning }
    );
    expect(s).toMatchObject({ type: 'FRUITING', stage: 'PRIMORDIA' });
    expect(warnings).toHaveLength(0);
  });

  it('cannot be remapped with registerTypeAlias', () => {
    expect(() => registerTypeAlias('PRIMORDIA', 'CULTURE')).toThrow(/reserved/);
    expect(resolveTypeAlias('primordia')).toBe('FRUITING');
  });

  it.each([
    ['PINNING', 'FRUITING'],
    ['flush', 'FRUITING'],
    ['lc', 'CULTURE'],
    ['Grain_Spawn', 'SPAWN'],
    ['bag', 'SUBSTRATE'],
    ['dried', 'HARVEST'],
  ])('other aliases still resolve type only: %s -> %s', (alias, expected) => {
    const { warnings, onWarning } = collect();
    const s = createSpecimen({ type: alias, species: SPECIES }, { onWarning });
    expect(s.type).toBe(expected);
    expect(s.stage).toBeUndefined();
    expect(warnings).toHaveLength(0);
  });
});

describe('strain.transferDepth', () => {
  const base = (strain: Record<string, unknown>): Record<string, unknown> => ({
    '@context': 'https://wemush.com/wols/v1',
    '@type': 'Specimen',
    id: 'wemush:clx1a2b3c4',
    version: '1.3.0',
    type: 'SPAWN',
    species: SPECIES,
    strain: { name: 'Blue Oyster', ...strain },
  });

  it.each([0, 1, 5, 120])('accepts non-negative integer %d', n => {
    const r = validateSpecimen(base({ transferDepth: n }));
    expect(r.valid).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });

  it.each([-1, 1.5, '3', null, Number.NaN, Number.POSITIVE_INFINITY, true])('rejects %p', value => {
    const r = validateSpecimen(base({ transferDepth: value }));
    expect(r.valid).toBe(false);
    expect(r.errors.map(e => e.path)).toContain('strain.transferDepth');
  });

  it('warns (but stays valid) when below clonalGeneration', () => {
    const r = validateSpecimen(base({ clonalGeneration: 3, transferDepth: 1 }));
    expect(r.valid).toBe(true);
    expect(r.warnings).toContainEqual(
      expect.objectContaining({
        path: 'strain.transferDepth',
        code: 'TRANSFER_DEPTH_BELOW_CLONAL_GENERATION',
      })
    );
  });

  it('does not warn when equal to or above clonalGeneration', () => {
    expect(validateSpecimen(base({ clonalGeneration: 3, transferDepth: 3 })).warnings).toHaveLength(
      0
    );
    expect(validateSpecimen(base({ clonalGeneration: 3, transferDepth: 5 })).warnings).toHaveLength(
      0
    );
  });

  it('round-trips through createSpecimen, serializeSpecimen and parseSpecimen', () => {
    const s = createSpecimen({
      type: 'SPAWN',
      species: SPECIES,
      strain: { name: 'Blue Oyster', generation: 'F1', clonalGeneration: 3, transferDepth: 5 },
    });
    const json = serializeSpecimen(s);
    expect(JSON.parse(json).strain).toEqual({
      name: 'Blue Oyster',
      generation: 'F1',
      clonalGeneration: 3,
      transferDepth: 5,
    });
    const parsed = parseSpecimen(json);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.strain?.transferDepth).toBe(5);
      expect(parsed.data.strain?.clonalGeneration).toBe(3);
      expect(parsed.data.strain?.generation).toBe('F1');
    }
  });

  it('parseSpecimen rejects an invalid transferDepth', () => {
    const parsed = parseSpecimen(JSON.stringify(base({ transferDepth: -2 })));
    expect(parsed.success).toBe(false);
  });
});

describe('strain.clonalGeneration', () => {
  it('accepts 0 for the original culture', () => {
    const s = createSpecimen({
      type: 'CULTURE',
      species: SPECIES,
      strain: { name: 'Blue Oyster', generation: 'P', clonalGeneration: 0, transferDepth: 0 },
    });
    expect(validateSpecimen(s).valid).toBe(true);
  });

  it('still rejects negative and fractional values', () => {
    for (const clonalGeneration of [-1, 2.5]) {
      const s = createSpecimen({
        type: 'CULTURE',
        species: SPECIES,
        strain: { name: 'x', clonalGeneration },
      });
      expect(validateSpecimen(s).errors.map(e => e.path)).toContain('strain.clonalGeneration');
    }
  });
});

describe('createSpecimen created input', () => {
  it('uses a supplied ISO 8601 string as-is', () => {
    const s = createSpecimen({
      type: 'CULTURE',
      species: SPECIES,
      created: '2025-12-16T10:30:00Z',
    });
    expect(s.created).toBe('2025-12-16T10:30:00Z');
    expect(JSON.parse(serializeSpecimen(s)).created).toBe('2025-12-16T10:30:00Z');
  });

  it('accepts an offset timestamp', () => {
    const s = createSpecimen({
      type: 'CULTURE',
      species: SPECIES,
      created: '2025-12-16T10:30:00+02:00',
    });
    expect(s.created).toBe('2025-12-16T10:30:00+02:00');
  });

  it('converts a Date with toISOString()', () => {
    const date = new Date(Date.UTC(2025, 11, 16, 10, 30, 0));
    const s = createSpecimen({ type: 'CULTURE', species: SPECIES, created: date });
    expect(s.created).toBe('2025-12-16T10:30:00.000Z');
    expect(validateSpecimen(s).valid).toBe(true);
  });

  it('throws on a non-ISO 8601 value', () => {
    expect(() =>
      createSpecimen({ type: 'CULTURE', species: SPECIES, created: 'December 16, 2025' })
    ).toThrow(/ISO 8601/);
    expect(() =>
      createSpecimen({ type: 'CULTURE', species: SPECIES, created: new Date('nope') })
    ).toThrow();
  });

  it('omits created when not supplied (unchanged from 1.2.0)', () => {
    expect(createSpecimen({ type: 'CULTURE', species: SPECIES }).created).toBeUndefined();
  });
});
