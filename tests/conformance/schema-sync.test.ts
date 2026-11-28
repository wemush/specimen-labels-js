/**
 * WOLS 1.5 schema sync check.
 *
 * From 1.5.0-rc.1 the JSON Schemas in tests/conformance/schema/1.5/ are
 * normative. The specification requires reference libraries to run the same
 * check as the upstream tool (conformance/tools/validate_schema.py):
 *
 * - every `validate` and `validateBundle` input gets the vector's verdict from
 *   the schema plus the rules JSON Schema can't express (`strain.lineage` equal
 *   to `derivedFrom[0].id`, and bundle references that resolve), and when it is
 *   invalid, the shallowest error is on the vector's `errorField`;
 * - every `roundtrip` output is a valid label, and so is what this library
 *   writes for that case.
 *
 * The schemas are checked with an independent validator, ajv. ajv is not a
 * direct dependency: this uses the copy the lockfile already has (ajv 6, a
 * dependency of eslint), which implements draft-07. The 1.5 schemas use only
 * keywords whose meaning draft-07 shares with 2020-12 (`$defs` is reached by
 * JSON pointer, and no `$ref` has sibling keywords), so the result is the
 * same; the `$schema` member is dropped so ajv 6 accepts the documents.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseSpecimen, serializeSpecimen } from '../../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = join(HERE, 'schema', '1.5');
const VECTOR_DIR = join(HERE, 'vectors');
/** The files the upstream tool checks. */
const VECTOR_FILES = ['embedded.json', 'generation.json', 'data-model.json', 'bundle.json'];

type Json = Record<string, unknown>;

interface AjvError {
  keyword: string;
  dataPath: string;
  params: Record<string, unknown>;
  message?: string;
}
type AjvValidate = ((data: unknown) => boolean) & { errors?: AjvError[] | null };
interface Ajv {
  addSchema(schema: object): Ajv;
  addFormat(name: string, format: (value: string) => boolean): Ajv;
  getSchema(id: string): AjvValidate | undefined;
}

const load = (path: string): Json => JSON.parse(readFileSync(path, 'utf8')) as Json;

// RFC 3339 date-time, which needs a time zone, and full-date: the same formats
// the upstream tool registers.
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-](\d{2}):(\d{2}))$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
function isDate(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
function isDateTime(value: string): boolean {
  const m = DATE_TIME.exec(value);
  if (!m) return false;
  const n = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  return (
    isDate(n[0], n[1], n[2]) &&
    n[3] <= 23 &&
    n[4] <= 59 &&
    n[5] <= 59 &&
    (m[9] === undefined || (Number(m[9]) <= 23 && Number(m[10]) <= 59))
  );
}
function isFullDate(value: string): boolean {
  const m = DATE.exec(value);
  return m !== null && isDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

function validators(): { label: AjvValidate; bundle: AjvValidate } {
  const AjvClass = createRequire(import.meta.url)('ajv') as new (options: object) => Ajv;
  const ajv = new AjvClass({ allErrors: true, jsonPointers: true, format: 'full' });
  ajv.addFormat('date-time', isDateTime);
  ajv.addFormat('date', isFullDate);
  const ids: string[] = [];
  for (const name of ['label.schema.json', 'bundle.schema.json']) {
    const { $schema, ...schema } = load(join(SCHEMA_DIR, name));
    expect($schema).toBe('https://json-schema.org/draft/2020-12/schema');
    ajv.addSchema(schema);
    ids.push(schema['$id'] as string);
  }
  const [label, bundle] = ids.map(id => ajv.getSchema(id));
  if (!label || !bundle) throw new Error('schemas did not compile');
  return { label, bundle };
}

/** Dot path of an error, naming the missing member for `required` (as the upstream tool does). */
function errorPath(e: AjvError): string {
  const parts = e.dataPath
    .split('/')
    .slice(1)
    .map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (e.keyword === 'required') {
    parts.push(String(e.params['missingProperty']).replace(/^\//, ''));
  }
  return parts.join('.');
}

function schemaErrors(validate: AjvValidate, value: unknown): string[] {
  return validate(value) ? [] : (validate.errors ?? []).map(errorPath);
}

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Label rules JSON Schema can't express, as error fields. */
function labelRules(label: unknown, prefix = ''): string[] {
  if (!isObject(label)) return [];
  const strain = label['strain'];
  const parent = list(label['derivedFrom'])[0];
  if (isObject(strain) && 'lineage' in strain && isObject(parent)) {
    if (strain['lineage'] !== parent['id']) return [`${prefix}strain.lineage`];
  }
  return [];
}

/**
 * Bundle rules JSON Schema can't express: the label rules for each specimen,
 * and references that resolve (`strainRef`, `recipeRef`, and the `specimen` of
 * observations and harvests), as in SPECIFICATION.md. `derivedFrom` ids are
 * not required to resolve.
 */
function bundleRules(bundle: Json): string[] {
  const ids = (key: string): Set<unknown> =>
    new Set(list(bundle[key]).map(r => (isObject(r) ? r['id'] : undefined)));
  const specimens = ids('specimens');
  const strains = ids('strains');
  const recipes = ids('recipes');
  const problems: string[] = [];
  list(bundle['specimens']).forEach((s, i) => {
    problems.push(...labelRules(s, `specimens.${i}.`));
    if (!isObject(s)) return;
    if (s['strainRef'] !== undefined && !strains.has(s['strainRef'])) {
      problems.push(`specimens.${i}.strainRef`);
    }
    if (s['recipeRef'] !== undefined && !recipes.has(s['recipeRef'])) {
      problems.push(`specimens.${i}.recipeRef`);
    }
  });
  for (const kind of ['observations', 'harvests']) {
    list(bundle[kind]).forEach((r, i) => {
      if (isObject(r) && !specimens.has(r['specimen'])) problems.push(`${kind}.${i}.specimen`);
    });
  }
  return problems;
}

interface VectorCase {
  id: string;
  operation: string;
  input: Json;
  expected: Json;
}

const { label: labelSchema, bundle: bundleSchema } = validators();
const depth = (path: string): number => (path === '' ? 0 : path.split('.').length);

// The vendored schemas must be the ones SOURCE.json records (the vector refresh
// script doesn't fetch them; copy schema/1.5/ from the same commit by hand).
describe('schema sync: vendored schemas', () => {
  const source = load(join(VECTOR_DIR, 'SOURCE.json'));
  const schemas = source['schemas'] as Record<string, { sha256?: string }> | undefined;

  it.each(['label.schema.json', 'bundle.schema.json'])('%s matches SOURCE.json', name => {
    expect(schemas, 'SOURCE.json has no schemas record').toBeDefined();
    const digest = createHash('sha256')
      .update(readFileSync(join(SCHEMA_DIR, name)))
      .digest('hex');
    expect(digest).toBe(schemas?.[name]?.sha256);
  });
});

describe('schema sync: the 1.5 JSON Schemas agree with the vectors', () => {
  for (const file of VECTOR_FILES) {
    const cases = (load(join(VECTOR_DIR, file))['cases'] as VectorCase[]).filter(c =>
      ['validate', 'validateBundle', 'roundtrip'].includes(c.operation)
    );

    describe(file, () => {
      it('has cases to check', () => {
        expect(cases.length).toBeGreaterThan(0);
      });

      for (const c of cases) {
        if (c.operation === 'roundtrip') {
          it(`${c.id}: the expected output and this library's output are valid labels`, () => {
            const output = c.expected['output'];
            expect(schemaErrors(labelSchema, output)).toEqual([]);
            expect(labelRules(output)).toEqual([]);
            const parsed = parseSpecimen(c.input['text'] as string);
            expect(parsed.success).toBe(true);
            if (!parsed.success) return;
            const written: unknown = JSON.parse(serializeSpecimen(parsed.data));
            expect(schemaErrors(labelSchema, written)).toEqual([]);
          });
          continue;
        }

        it(`${c.id}: same verdict and error field as the vector`, () => {
          let errors: string[];
          let rules: string[];
          if (c.operation === 'validate') {
            errors = schemaErrors(labelSchema, c.input);
            rules = labelRules(c.input);
          } else {
            errors = schemaErrors(bundleSchema, c.input);
            rules = errors.length === 0 ? bundleRules(c.input) : [];
          }
          const fields = [...errors, ...rules];
          expect(fields.length === 0, JSON.stringify(fields)).toBe(c.expected['valid']);
          if (c.expected['valid'] === false) {
            // The shallowest schema error, else the first rule.
            const shallowest =
              errors.length > 0 ? Math.min(...errors.map(depth)) : depth(fields[0] as string);
            const candidates = (errors.length > 0 ? errors : fields).filter(
              f => depth(f) === shallowest
            );
            expect(candidates, JSON.stringify(fields)).toContain(c.expected['errorField']);
          }
        });
      }
    });
  }
});
