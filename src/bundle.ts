/**
 * Records Bundle validation (WOLS 1.5.0).
 *
 * A Bundle carries specimen labels together with the records a label can't
 * hold (strains, recipes, observations, harvests), for exchange between
 * systems. It is never printed in a QR code.
 *
 * @module bundle
 */

import { WolsErrorCode } from './errors.js';
import { evaluateSchema, type JsonSchema, type SchemaError } from './schema/evaluate.js';
import { BUNDLE_SCHEMA_1_5, LABEL_SCHEMA_1_5 } from './schema/wols-1.5.js';
import type {
  ValidationError,
  ValidationOptions,
  ValidationResult,
  ValidationWarning,
} from './types.js';
import { validateSpecimen } from './validator.js';

const LABEL_DOCUMENT = { id: LABEL_SCHEMA_1_5['$id'] as string, schema: LABEL_SCHEMA_1_5 };
const BUNDLE_DOCUMENT = { id: BUNDLE_SCHEMA_1_5['$id'] as string, schema: BUNDLE_SCHEMA_1_5 };

/** The `$ref` a SpecimenRecord uses for "this is also a label". */
const LABEL_REF = 'label.schema.json';

/** Members a SpecimenRecord adds to a label; a label validator would call them unknown. */
const RECORD_MEMBERS: ReadonlySet<string> = new Set(
  Object.keys(
    (
      (
        (BUNDLE_SCHEMA_1_5['$defs'] as Record<string, JsonSchema>)['SpecimenRecord']?.[
          'allOf'
        ] as JsonSchema[]
      )[1] as JsonSchema
    )['properties'] as object
  )
);

const HEADER_CODES: Readonly<Record<string, WolsErrorCode>> = {
  '@context': WolsErrorCode.INVALID_CONTEXT,
  '@type': WolsErrorCode.INVALID_TYPE,
  version: WolsErrorCode.INVALID_VERSION,
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const prefixed = (prefix: string, path: string): string =>
  path === '' ? prefix : `${prefix}.${path}`;

function toValidationError(e: SchemaError): ValidationError {
  let code: WolsErrorCode = WolsErrorCode.INVALID_FORMAT;
  if (e.keyword === 'required') code = WolsErrorCode.REQUIRED_FIELD;
  else if (Object.prototype.hasOwnProperty.call(HEADER_CODES, e.path)) {
    code = HEADER_CODES[e.path] as WolsErrorCode;
  }
  return { path: e.path, code, message: `${e.path === '' ? 'bundle' : e.path} ${e.message}` };
}

/** The `id`s of the records in one bundle array. */
function idsOf(records: unknown): Set<unknown> {
  return new Set(
    Array.isArray(records) ? records.map(r => (isPlainObject(r) ? r['id'] : undefined)) : []
  );
}

/** References inside a bundle MUST resolve within it (WOLS 1.5.0). */
function checkReferences(bundle: Record<string, unknown>, errors: ValidationError[]): void {
  const specimens = idsOf(bundle['specimens']);
  const strains = idsOf(bundle['strains']);
  const recipes = idsOf(bundle['recipes']);
  const unresolved = (path: string, what: string, value: unknown): void => {
    errors.push({
      path,
      code: WolsErrorCode.UNRESOLVED_REFERENCE,
      message: `${path} '${String(value)}' is not the id of ${what} in this bundle`,
    });
  };

  if (Array.isArray(bundle['specimens'])) {
    bundle['specimens'].forEach((s: unknown, i) => {
      if (!isPlainObject(s)) return;
      if (typeof s['strainRef'] === 'string' && !strains.has(s['strainRef'])) {
        unresolved(`specimens.${i}.strainRef`, 'a strain', s['strainRef']);
      }
      if (typeof s['recipeRef'] === 'string' && !recipes.has(s['recipeRef'])) {
        unresolved(`specimens.${i}.recipeRef`, 'a recipe', s['recipeRef']);
      }
    });
  }
  for (const kind of ['observations', 'harvests'] as const) {
    const records = bundle[kind];
    if (!Array.isArray(records)) continue;
    records.forEach((r: unknown, i) => {
      if (isPlainObject(r) && typeof r['specimen'] === 'string' && !specimens.has(r['specimen'])) {
        unresolved(`${kind}.${i}.specimen`, 'a specimen', r['specimen']);
      }
    });
  }
}

/**
 * Validate a Records Bundle (WOLS 1.5.0).
 *
 * Checks the bundle against the 1.5 bundle schema; each entry of `specimens`
 * with the same rules as {@link validateSpecimen} (so it must be a valid
 * label), plus the record members a specimen record adds; and that every
 * reference resolves within the bundle: `observations[].specimen` and
 * `harvests[].specimen` name a specimen in `specimens`, `strainRef` a strain
 * in `strains`, and `recipeRef` a recipe in `recipes`.
 *
 * Error paths are dot paths from the bundle root, such as
 * `specimens.0.stage` or `harvests.0.freshWeight`. Members the bundle schema
 * doesn't define are errors (the bundle schema is closed), except on a
 * specimen record, which like any label may carry unknown members (with an
 * `UNKNOWN_FIELD` warning).
 *
 * @param bundle - The parsed bundle (a JSON object)
 * @param options - Passed to the label validation of each specimen
 * @returns ValidationResult with errors and warnings
 *
 * @example
 * ```typescript
 * const result = validateBundle(JSON.parse(text));
 * if (!result.valid) console.error(result.errors.map(e => e.path));
 * ```
 *
 * @since 1.5.0
 */
export function validateBundle(bundle: unknown, options: ValidationOptions = {}): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!isPlainObject(bundle)) {
    errors.push({
      path: '',
      code: WolsErrorCode.INVALID_FORMAT,
      message: 'Bundle must be an object',
    });
    return { valid: false, errors, warnings };
  }

  const schemaErrors = evaluateSchema(BUNDLE_SCHEMA_1_5, bundle, {
    documents: [BUNDLE_DOCUMENT, LABEL_DOCUMENT],
    hook: (ref, value, path) => {
      if (ref !== LABEL_REF) return undefined;
      // A specimen record must be a valid label: use the label validator itself.
      const label = validateSpecimen(value, options);
      for (const e of label.errors) errors.push({ ...e, path: prefixed(path, e.path) });
      for (const w of label.warnings) {
        if (w.code === 'UNKNOWN_FIELD' && RECORD_MEMBERS.has(w.path)) continue;
        warnings.push({ ...w, path: prefixed(path, w.path) });
      }
      return [];
    },
  });
  errors.push(...schemaErrors.map(toValidationError));

  checkReferences(bundle, errors);

  return { valid: errors.length === 0, errors, warnings };
}
