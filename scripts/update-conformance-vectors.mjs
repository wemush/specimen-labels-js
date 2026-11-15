#!/usr/bin/env node
/**
 * Refresh the vendored WOLS conformance vectors.
 *
 * Downloads every conformance/vectors/*.json from wemush/open-standard at a
 * given ref (branch, tag, or commit; default "main"), pins the resolved commit
 * SHA, removes local vector files that no longer exist upstream, and writes
 * tests/conformance/vectors/SOURCE.json. The file list comes from the GitHub
 * contents API, so new upstream files are picked up automatically.
 *
 * Usage:
 *   node scripts/update-conformance-vectors.mjs            # latest main
 *   node scripts/update-conformance-vectors.mjs v1.3.0     # a tag
 *   node scripts/update-conformance-vectors.mjs <sha>      # a commit
 *
 * Requires Node.js 18+ (global fetch). Set GITHUB_TOKEN to avoid API rate limits.
 */
import { readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'wemush/open-standard';
const VECTOR_PATH = 'conformance/vectors';
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

const listing = await getJson(
  `https://api.github.com/repos/${REPO}/contents/${VECTOR_PATH}?ref=${commit}`
);
const FILES = listing
  .filter(entry => entry.type === 'file' && entry.name.endsWith('.json'))
  .map(entry => entry.name)
  .sort();
if (FILES.length === 0) throw new Error(`No vector files found at ${VECTOR_PATH}@${commit}`);

for (const stale of readdirSync(OUT_DIR)) {
  if (stale.endsWith('.json') && stale !== 'SOURCE.json' && !FILES.includes(stale)) {
    unlinkSync(join(OUT_DIR, stale));
    console.log(`  removed ${stale} (no longer upstream)`);
  }
}

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
