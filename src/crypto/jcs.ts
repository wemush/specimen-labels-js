/**
 * JSON Canonicalization Scheme (RFC 8785, JCS), as WOLS 1.4.0 signatures use it.
 *
 * Works on parsed JSON values. Member names are sorted by UTF-16 code units,
 * strings are escaped exactly as `JSON.stringify` escapes them (which is what
 * RFC 8785 requires), and numbers use the ECMAScript Number-to-String rules.
 *
 * Input that isn't I-JSON is refused with {@link JcsError}: lone surrogates,
 * non-finite numbers, and anything that isn't a plain JSON value (`undefined`,
 * functions, bigints, symbols, class instances such as `Date`, sparse arrays,
 * and cycles).
 *
 * @module crypto/jcs
 */

/** Thrown when a value can't be canonicalized. */
export class JcsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JcsError';
  }
}

/** Matches a high surrogate not followed by a low one, or a low surrogate not preceded by a high one. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Whether a string contains a lone surrogate (so isn't valid Unicode, nor I-JSON). */
export function hasLoneSurrogate(value: string): boolean {
  return LONE_SURROGATE.test(value);
}

function serializeString(value: string): string {
  if (hasLoneSurrogate(value)) {
    throw new JcsError('A string contains a lone surrogate');
  }
  // With no lone surrogates, JSON.stringify escapes exactly `"`, `\` and
  // U+0000..U+001F, using \b \t \n \f \r where they exist and lowercase \u00xx
  // otherwise: the RFC 8785 rules.
  return JSON.stringify(value);
}

function serializeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new JcsError(`Non-finite number ${String(value)}`);
  }
  // Number::toString; String(-0) is "0" as RFC 8785 requires.
  return String(value);
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function serialize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return serializeNumber(value);
    case 'string':
      return serializeString(value);
    case 'object':
      break;
    default:
      throw new JcsError(`A ${typeof value} is not a JSON value`);
  }

  const obj = value as object;
  if (ancestors.has(obj)) throw new JcsError('The value contains a cycle');
  ancestors.add(obj);
  try {
    if (Array.isArray(obj)) {
      const parts: string[] = [];
      for (let i = 0; i < obj.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(obj, i)) {
          throw new JcsError('Sparse arrays are not JSON values');
        }
        parts.push(serialize(obj[i], ancestors));
      }
      return `[${parts.join(',')}]`;
    }
    if (!isPlainObject(obj)) {
      throw new JcsError(
        `A ${obj.constructor?.name ?? 'non-plain'} object is not a JSON value; pass parsed JSON`
      );
    }
    // Default sort compares UTF-16 code units, as RFC 8785 requires.
    const keys = Object.keys(obj).sort();
    const members = keys.map(key => `${serializeString(key)}:${serialize(obj[key], ancestors)}`);
    return `{${members.join(',')}}`;
  } finally {
    ancestors.delete(obj);
  }
}

/**
 * Canonicalize a parsed JSON value with RFC 8785 (JCS).
 *
 * Returns the canonical text; encode it as UTF-8 for the canonical bytes.
 *
 * @throws JcsError if the value isn't I-JSON (see the module description)
 * @since 1.4.0
 */
export function canonicalizeJson(value: unknown): string {
  try {
    return serialize(value, new Set());
  } catch (err) {
    if (err instanceof RangeError) {
      // Call stack exhausted by very deep nesting.
      throw new JcsError('The value is nested too deeply to canonicalize');
    }
    throw err;
  }
}

/**
 * Whether JSON text has an object with two members of the same name (after
 * unescaping). The text must already be valid JSON (it parsed with `JSON.parse`).
 *
 * `JSON.parse` silently keeps the last duplicate, and other parsers keep the
 * first, so a duplicated member could display one value and verify another.
 */
export function hasDuplicateMemberNames(text: string): boolean {
  // One frame per open container: a Set of member names for an object, null for an array.
  const frames: Array<Set<string> | null> = [];
  let expectName = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (text[j] !== '"') {
        if (text[j] === '\\') j++;
        j++;
      }
      if (expectName) {
        const names = frames[frames.length - 1];
        const name = JSON.parse(text.slice(i, j + 1)) as string;
        if (names) {
          if (names.has(name)) return true;
          names.add(name);
        }
        expectName = false;
      }
      i = j;
    } else if (c === '{') {
      frames.push(new Set());
      expectName = true;
    } else if (c === '[') {
      frames.push(null);
      expectName = false;
    } else if (c === '}' || c === ']') {
      frames.pop();
      expectName = false;
    } else if (c === ',') {
      expectName = frames.length > 0 && frames[frames.length - 1] !== null;
    }
  }
  return false;
}
