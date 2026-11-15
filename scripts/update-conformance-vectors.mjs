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
 * Every file is downloaded and validated before anything on disk changes, and
 * SOURCE.json records each file's SHA-256 and case count, which the
 * conformance runner verifies.
 *
 * Usage:
 *   node scripts/update-conformance-vectors.mjs            # latest main
 *   node scripts/update-conformance-vectors.mjs v1.3.0     # a tag
 *   node scripts/update-conformance-vectors.mjs <sha>      # a commit
 *
 * Requires Node.js 18+ (global fetch). Set GITHUB_TOKEN to avoid API rate limits.
 */
import { createHash } from 'node:crypto';
import { readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
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
if (!Array.isArray(listing)) throw new Error(`${VECTOR_PATH}@${commit} is not a directory`);
const unexpected = listing.filter(entry => entry.type !== 'file');
if (unexpected.length > 0) {
  throw new Error(
    `${VECTOR_PATH} contains non-file entries (${unexpected.map(e => e.name).join(', ')}); ` +
      'update this script before vendoring'
  );
}
const FILES = listing
  .map(entry => entry.name)
  .filter(name => name.endsWith('.json'))
  .sort();
if (FILES.length === 0) throw new Error(`No vector files found at ${VECTOR_PATH}@${commit}`);

// 1. Download and validate everything in memory; nothing on disk changes yet.
const staged = [];
let specVersion;
for (const file of FILES) {
  const raw = await getText(
    `https://raw.githubusercontent.com/${REPO}/${commit}/${VECTOR_PATH}/${file}`
  );
  // Keep the bytes exactly as published so upstream SHA256SUMS still match.
  const text = raw;
  const doc = JSON.parse(text);
  if (!Array.isArray(doc.cases) || doc.cases.length === 0) {
    throw new Error(`${file}: missing or empty "cases" array`);
  }
  if (specVersion !== undefined && doc.wolsVersion !== specVersion) {
    throw new Error(`${file}: wolsVersion ${doc.wolsVersion} differs from ${specVersion}`);
  }
  specVersion = doc.wolsVersion;
  staged.push({
    file,
    text,
    sha256: createHash('sha256').update(text).digest('hex'),
    cases: doc.cases.length,
  });
}

// Verify against upstream SHA256SUMS when the release publishes one.
let checksums;
if (listing.some(entry => entry.name === 'SHA256SUMS')) {
  checksums = await getText(
    `https://raw.githubusercontent.com/${REPO}/${commit}/${VECTOR_PATH}/SHA256SUMS`
  );
  const listed = new Map(
    checksums
      .trim()
      .split('\n')
      .map(line => line.trim().split(/\s+/))
      .map(([hash, name]) => [name?.replace(/^\*/, ''), hash])
  );
  for (const { file, sha256 } of staged) {
    if (listed.get(file) !== sha256) {
      throw new Error(`${file}: SHA-256 ${sha256} does not match upstream SHA256SUMS`);
    }
  }
  const missing = [...listed.keys()].filter(name => !FILES.includes(name));
  if (missing.length > 0) throw new Error(`SHA256SUMS lists unknown files: ${missing.join(', ')}`);
  console.log(`  verified ${staged.length} files against upstream SHA256SUMS`);
}

// 2. Write each file to a temp name, then rename into place, then SOURCE.json last.
if (checksums !== undefined) writeFileSync(join(OUT_DIR, 'SHA256SUMS'), checksums);
for (const { file, text } of staged) {
  writeFileSync(join(OUT_DIR, `.${file}.tmp`), text);
}
for (const { file, cases } of staged) {
  renameSync(join(OUT_DIR, `.${file}.tmp`), join(OUT_DIR, file));
  console.log(`  ${file}: ${cases} cases`);
}
for (const stale of readdirSync(OUT_DIR)) {
  if (stale.endsWith('.json') && stale !== 'SOURCE.json' && !FILES.includes(stale)) {
    unlinkSync(join(OUT_DIR, stale));
    console.log(`  removed ${stale} (no longer upstream)`);
  }
}

const source = {
  repository: `https://github.com/${REPO}`,
  path: VECTOR_PATH,
  ref,
  commit,
  specVersion,
  files: FILES,
  integrity: Object.fromEntries(staged.map(({ file, sha256, cases }) => [file, { sha256, cases }])),
};
writeFileSync(join(OUT_DIR, 'SOURCE.json'), `${JSON.stringify(source, null, 2)}\n`);
console.log('Wrote SOURCE.json. Run `npm run test:conformance` to check the new vectors.');
