#!/usr/bin/env node
/**
 * Regenerate src/schema/wols-1.5.ts from the vendored WOLS 1.5 JSON Schemas in
 * tests/conformance/schema/1.5/, dropping the annotation keywords
 * (description, title, examples, $comment, deprecated), then format it with
 * prettier. tests/unit/schema-drift.test.ts fails when the two disagree.
 *
 * Usage: node scripts/generate-schema-module.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_DIR = join(ROOT, 'tests', 'conformance', 'schema', '1.5');
const OUT = join(ROOT, 'src', 'schema', 'wols-1.5.ts');
const ANNOTATIONS = new Set(['description', 'examples', 'title', '$comment', 'deprecated']);

/** Remove annotation keywords. Member names under `properties` and `$defs` are kept. */
function strip(node, isNameMap = false) {
  if (Array.isArray(node)) return node.map(n => strip(n));
  if (node === null || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (!isNameMap && ANNOTATIONS.has(key)) continue;
    out[key] = strip(value, !isNameMap && (key === 'properties' || key === '$defs'));
  }
  return out;
}

const load = name => strip(JSON.parse(readFileSync(join(SCHEMA_DIR, name), 'utf8')));

const text = `/**
 * WOLS 1.5 JSON Schemas (draft 2020-12), transcribed from the normative
 * schema/1.5/label.schema.json and schema/1.5/bundle.schema.json in
 * wemush/open-standard with the annotation keywords (description, title,
 * examples, $comment, deprecated) removed.
 *
 * Do not edit by hand. tests/unit/schema-drift.test.ts checks these against
 * the vendored copies in tests/conformance/schema/1.5/.
 *
 * @module schema/wols-1.5
 * @internal
 */

import type { JsonSchema } from './evaluate.js';

/** schema/1.5/label.schema.json */
export const LABEL_SCHEMA_1_5: JsonSchema = ${JSON.stringify(load('label.schema.json'))};

/** schema/1.5/bundle.schema.json */
export const BUNDLE_SCHEMA_1_5: JsonSchema = ${JSON.stringify(load('bundle.schema.json'))};
`;

writeFileSync(OUT, text);
execFileSync(join(ROOT, 'node_modules', '.bin', 'prettier'), ['--write', OUT], {
  stdio: 'inherit',
});
