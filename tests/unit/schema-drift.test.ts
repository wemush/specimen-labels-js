/**
 * The schemas compiled into the library (src/schema/wols-1.5.ts) must be the
 * vendored WOLS 1.5 schemas with only the annotation keywords removed.
 * Regenerate with `node scripts/generate-schema-module.mjs`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { evaluateSchema } from '../../src/schema/evaluate.js';
import { BUNDLE_SCHEMA_1_5, LABEL_SCHEMA_1_5 } from '../../src/schema/wols-1.5.js';

const SCHEMA_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'conformance',
  'schema',
  '1.5'
);
const ANNOTATIONS = new Set(['description', 'examples', 'title', '$comment', 'deprecated']);
/** Every keyword src/schema/evaluate.ts implements, plus the ones it may ignore. */
const SUPPORTED_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$defs',
  '$ref',
  'type',
  'enum',
  'const',
  'pattern',
  'minLength',
  'minimum',
  'maximum',
  'minItems',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'anyOf',
  'oneOf',
  'allOf',
  'format',
]);

function strip(node: unknown, isNameMap = false): unknown {
  if (Array.isArray(node)) return node.map(n => strip(n));
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (!isNameMap && ANNOTATIONS.has(key)) continue;
    out[key] = strip(value, !isNameMap && (key === 'properties' || key === '$defs'));
  }
  return out;
}

function keywords(node: unknown, found: Set<string>, isNameMap = false): Set<string> {
  if (Array.isArray(node)) node.forEach(n => keywords(n, found));
  else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (!isNameMap) found.add(key);
      keywords(value, found, !isNameMap && (key === 'properties' || key === '$defs'));
    }
  }
  return found;
}

const vendored = (name: string): unknown =>
  strip(JSON.parse(readFileSync(join(SCHEMA_DIR, name), 'utf8')));

describe('WOLS 1.5 schema module', () => {
  it('matches the vendored label schema', () => {
    expect(LABEL_SCHEMA_1_5).toEqual(vendored('label.schema.json'));
  });

  it('matches the vendored bundle schema', () => {
    expect(BUNDLE_SCHEMA_1_5).toEqual(vendored('bundle.schema.json'));
  });

  it('uses only keywords the evaluator implements', () => {
    const used = keywords(BUNDLE_SCHEMA_1_5, keywords(LABEL_SCHEMA_1_5, new Set()));
    expect([...used].filter(k => !SUPPORTED_KEYWORDS.has(k))).toEqual([]);
  });
});

describe('evaluateSchema', () => {
  const documents = [{ id: 'https://example.com/s.json', schema: {} }];
  const run = (schema: Record<string, unknown>, value: unknown) =>
    evaluateSchema(schema, value, { documents: [{ ...documents[0]!, schema }] });

  it('names the missing member of a required failure', () => {
    expect(run({ type: 'object', required: ['format'] }, {})).toEqual([
      { path: 'format', keyword: 'required', message: 'is required' },
    ]);
  });

  it('names an extra member when additionalProperties is false', () => {
    const errors = run({ type: 'object', properties: {}, additionalProperties: false }, { x: 1 });
    expect(errors.map(e => e.path)).toEqual(['x']);
  });

  it('reports anyOf and oneOf once, at the value', () => {
    expect(run({ anyOf: [{ type: 'string' }, { type: 'number' }] }, true)).toHaveLength(1);
    expect(run({ oneOf: [{ minimum: 0 }, { maximum: 10 }] }, 5)).toHaveLength(1);
  });

  it('checks RFC 3339 date-time and date formats', () => {
    const dt = { type: 'string', format: 'date-time' };
    expect(run(dt, '2026-11-10T09:00:00Z')).toEqual([]);
    expect(run(dt, '2026-11-10T09:00:00+05:30')).toEqual([]);
    expect(run(dt, '2026-11-10T09:00:00')).toHaveLength(1); // no offset
    expect(run(dt, '2026-02-30T09:00:00Z')).toHaveLength(1);
    const d = { type: 'string', format: 'date' };
    expect(run(d, '2024-02-29')).toEqual([]);
    expect(run(d, '2023-02-29')).toHaveLength(1);
  });

  it('counts minLength in code points', () => {
    expect(run({ type: 'string', minLength: 2 }, '\u{1F344}')).toHaveLength(1);
  });

  it('refuses an unresolvable $ref', () => {
    expect(() => run({ $ref: 'other.json' }, 1)).toThrow(/Unresolvable/);
  });
});
