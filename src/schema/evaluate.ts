/**
 * A small JSON Schema evaluator for the keywords the WOLS 1.5 schemas use.
 *
 * Supported: `type`, `enum`, `const`, `pattern`, `minLength`, `minimum`,
 * `maximum`, `minItems`, `required`, `properties`, `additionalProperties`,
 * `items`, `anyOf`, `oneOf`, `allOf`, `$ref` and `format` (`date-time`,
 * `date`, `uri`, asserted). Anything else in a schema is ignored, so a schema
 * that starts using another keyword needs this module updated (the schema
 * drift test fails first).
 *
 * Errors carry a dot path. A `required` failure names the missing member
 * (`container.format`), and an `additionalProperties: false` failure names the
 * extra member. `anyOf` and `oneOf` failures are reported once, at the value.
 * Messages are written to follow the path (`container.format is required`).
 *
 * @module schema/evaluate
 * @internal
 */

/** A JSON Schema, as a parsed JSON object. */
export type JsonSchema = { readonly [keyword: string]: unknown };

/** One schema violation. */
export interface SchemaError {
  /** Dot path of the offending value (or of the missing or extra member) */
  path: string;
  /** The keyword that failed */
  keyword: string;
  message: string;
}

/** A schema document that `$ref` can point into, by its `$id`. */
export interface SchemaDocument {
  id: string;
  schema: JsonSchema;
}

/**
 * Lets a caller take over a `$ref` (for example, to check a whole label with
 * the library's own validator). Return `undefined` to evaluate it normally.
 */
export type RefHook = (ref: string, value: unknown, path: string) => SchemaError[] | undefined;

interface Context {
  documents: readonly SchemaDocument[];
  document: SchemaDocument;
  hook: RefHook | undefined;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const join = (path: string, key: string | number): string =>
  path === '' ? String(key) : `${path}.${key}`;

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function hasType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return isObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return false;
  }
}

/** JSON equality, for `enum` and `const` (only scalars occur in WOLS schemas). */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

const RFC3339_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-](\d{2}):(\d{2}))$/;
const RFC3339_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const URI = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]*$/;

function isCalendarDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30];
  const all = [...days, 31, 31, 30, 31, 30, 31];
  return d <= (all[m - 1] as number);
}

/** RFC 3339 formats. Values of another type pass, as in JSON Schema. */
function checkFormat(format: string, value: unknown): boolean {
  if (typeof value !== 'string') return true;
  if (format === 'date-time') {
    const m = RFC3339_DATE_TIME.exec(value);
    if (!m) return false;
    const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as number[];
    const oh = m[9] === undefined ? 0 : Number(m[9]);
    const om = m[10] === undefined ? 0 : Number(m[10]);
    return (
      isCalendarDate(y as number, mo as number, d as number) &&
      (h as number) <= 23 &&
      (mi as number) <= 59 &&
      (s as number) <= 60 &&
      oh <= 23 &&
      om <= 59
    );
  }
  if (format === 'date') {
    const m = RFC3339_DATE.exec(value);
    return m !== null && isCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  if (format === 'uri') return URI.test(value);
  return true; // unknown formats are annotations
}

/** Resolve `#/$defs/X`, `other.json` or `other.json#/$defs/X` against the current document. */
function resolve(ref: string, ctx: Context): { schema: JsonSchema; document: SchemaDocument } {
  const hash = ref.indexOf('#');
  const base = hash === -1 ? ref : ref.slice(0, hash);
  const pointer = hash === -1 ? '' : ref.slice(hash + 1);
  let document = ctx.document;
  if (base !== '') {
    const target = new URL(base, ctx.document.id).href;
    const found = ctx.documents.find(d => d.id === target);
    if (!found) throw new Error(`Unresolvable $ref '${ref}'`);
    document = found;
  }
  let node: unknown = document.schema;
  if (pointer !== '') {
    for (const raw of pointer.split('/').slice(1)) {
      const key = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
      node = isObject(node) ? node[key] : undefined;
    }
  }
  if (!isObject(node)) throw new Error(`Unresolvable $ref '${ref}'`);
  return { schema: node, document };
}

function evaluateIn(schema: JsonSchema, value: unknown, path: string, ctx: Context): SchemaError[] {
  const errors: SchemaError[] = [];
  const fail = (keyword: string, message: string, at: string = path): void => {
    errors.push({ path: at, keyword, message });
  };

  const ref = schema['$ref'];
  if (typeof ref === 'string') {
    const hooked = ctx.hook?.(ref, value, path);
    if (hooked !== undefined) {
      errors.push(...hooked);
    } else {
      const target = resolve(ref, ctx);
      errors.push(...evaluateIn(target.schema, value, path, { ...ctx, document: target.document }));
    }
  }

  const type = schema['type'];
  if (type !== undefined) {
    const types = Array.isArray(type) ? (type as string[]) : [type as string];
    if (!types.some(t => hasType(value, t))) {
      fail('type', `must be ${types.join(' or ')}, got ${typeOf(value)}`);
      return errors; // the other keywords would only repeat this
    }
  }

  if ('const' in schema && !jsonEqual(value, schema['const'])) {
    fail('const', `must be ${JSON.stringify(schema['const'])}`);
  }
  const enumValues = schema['enum'];
  if (Array.isArray(enumValues) && !enumValues.some(v => jsonEqual(value, v))) {
    fail('enum', `must be one of ${enumValues.map(v => JSON.stringify(v)).join(', ')}`);
  }

  if (typeof value === 'string') {
    const pattern = schema['pattern'];
    if (typeof pattern === 'string' && !new RegExp(pattern, 'u').test(value)) {
      fail('pattern', `must match ${pattern}`);
    }
    const minLength = schema['minLength'];
    if (typeof minLength === 'number' && [...value].length < minLength) {
      fail(
        'minLength',
        minLength === 1 ? 'must not be empty' : `must be at least ${minLength} characters`
      );
    }
    const format = schema['format'];
    if (typeof format === 'string' && !checkFormat(format, value)) {
      fail('format', `must be a valid ${format}`);
    }
  }

  if (typeof value === 'number') {
    const minimum = schema['minimum'];
    if (typeof minimum === 'number' && value < minimum) fail('minimum', `must be >= ${minimum}`);
    const maximum = schema['maximum'];
    if (typeof maximum === 'number' && value > maximum) fail('maximum', `must be <= ${maximum}`);
  }

  if (Array.isArray(value)) {
    const minItems = schema['minItems'];
    if (typeof minItems === 'number' && value.length < minItems) {
      fail('minItems', `must have at least ${minItems} item${minItems === 1 ? '' : 's'}`);
    }
    const items = schema['items'];
    if (isObject(items)) {
      value.forEach((item, i) => errors.push(...evaluateIn(items, item, join(path, i), ctx)));
    }
  }

  if (isObject(value)) {
    const required = schema['required'];
    if (Array.isArray(required)) {
      for (const name of required as string[]) {
        if (!Object.prototype.hasOwnProperty.call(value, name)) {
          fail('required', 'is required', join(path, name));
        }
      }
    }
    const properties = isObject(schema['properties']) ? schema['properties'] : {};
    for (const [name, sub] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, name) && isObject(sub)) {
        errors.push(...evaluateIn(sub, value[name], join(path, name), ctx));
      }
    }
    const additional = schema['additionalProperties'];
    if (additional !== undefined && additional !== true) {
      for (const name of Object.keys(value)) {
        if (Object.prototype.hasOwnProperty.call(properties, name)) continue;
        if (additional === false) {
          fail('additionalProperties', 'is not allowed here', join(path, name));
        } else if (isObject(additional)) {
          errors.push(...evaluateIn(additional, value[name], join(path, name), ctx));
        }
      }
    }
  }

  const allOf = schema['allOf'];
  if (Array.isArray(allOf)) {
    for (const sub of allOf as JsonSchema[]) errors.push(...evaluateIn(sub, value, path, ctx));
  }
  const anyOf = schema['anyOf'];
  if (Array.isArray(anyOf)) {
    const ok = (anyOf as JsonSchema[]).some(sub => evaluateIn(sub, value, path, ctx).length === 0);
    if (!ok) fail('anyOf', 'does not match any allowed form');
  }
  const oneOf = schema['oneOf'];
  if (Array.isArray(oneOf)) {
    const matches = (oneOf as JsonSchema[]).filter(
      sub => evaluateIn(sub, value, path, ctx).length === 0
    ).length;
    if (matches !== 1) fail('oneOf', 'does not match exactly one allowed form');
  }

  return errors;
}

/**
 * Evaluate `value` against `schema`, which lives in `documents[0]` unless
 * `document` is given. Errors are in document order, shallowest first per
 * keyword.
 */
export function evaluateSchema(
  schema: JsonSchema,
  value: unknown,
  options: {
    documents: readonly SchemaDocument[];
    document?: SchemaDocument;
    path?: string;
    hook?: RefHook;
  }
): SchemaError[] {
  const document = options.document ?? (options.documents[0] as SchemaDocument);
  return evaluateIn(schema, value, options.path ?? '', {
    documents: options.documents,
    document,
    hook: options.hook,
  });
}
