#!/usr/bin/env node
/**
 * Refresh the vendored WOLS conformance vectors.
 *
 * Downloads conformance/vectors/*.json from wemush/open-standard at a given
 * ref (branch, tag, or commit; default "main"), pins the resolved commit SHA,
 * and writes tests/conformance/vectors/SOURCE.json.
 *
 * Usage:
 *   node scripts/update-conformance-vectors.mjs            # latest main
 *   node scripts/update-conformance-vectors.mjs v1.3.0     # a tag
 *   node scripts/update-conformance-vectors.mjs <sha>      # a commit
 *
 * Requires Node.js 18+ (global fetch). Set GITHUB_TOKEN to avoid API rate limits.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'wemush/open-standard';
const VECTOR_PATH = 'conformance/vectors';
const FILES = ['embedded.json', 'encrypted.json', 'generation.json', 'primordia.json'];
const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'tests',
  'conformance',
  'vectors'
);

const ref = process.argv[2] ?? 'main';
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'wols-vector-refresh' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function getJson(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  return res.text();
}

const commit = (
  await getJson(`https://api.github.com/repos/${REPO}/commits/${encodeURIComponent(ref)}`)
).sha;
console.log(`Resolved ${REPO}@${ref} -> ${commit}`);

let specVersion;
for (const file of FILES) {
  const text = await getText(
    `https://raw.githubusercontent.com/${REPO}/${commit}/${VECTOR_PATH}/${file}`
  );
  const doc = JSON.parse(text); // fail fast on malformed JSON
  if (!Array.isArray(doc.cases)) throw new Error(`${file}: missing "cases" array`);
  specVersion ??= doc.wolsVersion;
  writeFileSync(join(OUT_DIR, file), text.endsWith('\n') ? text : `${text}\n`);
  console.log(`  ${file}: ${doc.cases.length} cases`);
}

const source = {
  repository: `https://github.com/${REPO}`,
  path: VECTOR_PATH,
  ref,
  commit,
  specVersion,
  files: FILES,
};
writeFileSync(join(OUT_DIR, 'SOURCE.json'), `${JSON.stringify(source, null, 2)}\n`);
console.log('Wrote SOURCE.json. Run `npm run test:conformance` to check the new vectors.');
