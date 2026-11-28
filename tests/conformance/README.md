# WOLS conformance vectors

`vectors/*.json` are vendored, unmodified, from the language-neutral conformance suite in
[wemush/open-standard](https://github.com/wemush/open-standard/tree/main/conformance).
`vectors/SOURCE.json` records the exact upstream commit they came from.

Vendored from open-standard branch `spec/1.5.0-rc.2` at commit
`d40dc7b674a4078241b8d2819d2871d42be0fbbc`, the WOLS 1.5.0 release candidate in open-standard
draft PRs #40 and #41, which are **not yet merged**. Refresh from `main` once they are. It adds four
files: `data-model.json` and `bundle.json` (`1.5.0-rc.1`), and `compact.json` and
`compact-signatures.json` (`1.5.0-rc.2`). The other six files are byte-identical to the previous
copies (`main` at `4b9235e`, open-standard PR #30). The copies are verified against upstream's
`SHA256SUMS`, which is vendored alongside them.

The files target different spec versions: the 1.3.0 wire-format files are still `1.3.0`,
`signatures.json` is `1.4.0`, and the four new files are `1.5.0-rc.1` or `1.5.0-rc.2`.
`SOURCE.json` records each file's version and the highest one.

`schema/1.5/label.schema.json` and `schema/1.5/bundle.schema.json` are the normative 1.5 JSON
Schemas, vendored unmodified from `schema/1.5/` at the same commit. `SOURCE.json` records their
SHA-256 under `schemas`.

## Running

```bash
npm run test:conformance   # just the vectors
npm test                   # whole suite, vectors included
```

`conformance.test.ts` runs every case through the public API (`src/index.ts`):

| Operation  | API used                                                 |
| ---------- | -------------------------------------------------------- |
| `validate` | `validateSpecimen()`                                     |
| `roundtrip` | `parseSpecimen()`, then `serializeSpecimen()`; the re-parsed output must equal `output` as a JSON value |
| `validateBundle` | `validateBundle()`; `errorField` must be among the reported paths |
| `parseCompact` | `parseCompactUrl(url, { onWarning })`. The result's `id`, `species`, `type`, `stage`, `created`, `batch`, `strain`, `unrecognized` and `sig` must equal `label`, and the warnings must be on exactly `warningField` (none when absent). Refusals must fail with a `WolsCompactUrlError`; a `reason` other than the suggested one is a note |
| `unwrap` | `unwrapWolsUrl()`; a non-null result must also verify as `valid` with the file's trust store |
| `create`   | `createSpecimen(input, { onWarning })`                   |
| `derive`   | `derivePassphraseKey()`                                  |
| `decrypt`  | `decryptPlaintext()` (exact bytes) and `decryptSpecimen()`; `parseEncryptedUrl()` for a preserved, unverified `sig` |
| `decryptFields` | `decryptFields()` |
| `sign`     | `signSpecimen()` / `signEncryptedUrl()` / `signCompactUrl()` by `form`, then `verifySpecimen()` on the result, which must be `valid` with that `form` and kid; `refused` cases must throw `WolsSignatureError` |
| `verify`   | `verifySpecimen()` on the label text or URL (and on the parsed object, unless the text has duplicate names), with `input.trustStore` when given, else the file's own; the result's `form` must equal `input.form`. `configError` cases must also be rejected by `createTrustStore()` |
| `loadKeySet` | `trustStoreFromKeySet()` on the document as a parsed value and as JSON text; `configError` cases must throw `WolsSignatureError`, otherwise the kids and the `onSkip` count must match, and `verifySpecimen()` on `input.label` must give the expected status |
| `verifyNested` | Sign-then-encrypt: `verifySpecimen()` on the URL (outer), then `decryptPlaintext()` (exact bytes) and `decryptSpecimen()`, then `verifySpecimen()` on the decrypted text as received (inner). Each layer's status, and for `valid` its kid and `signingInput`, must match; a failed decryption has no inner layer |

For `sign` and `verify`, the runner also compares the vector's `signingInput` with the library's
internal `getSigningInput()` (`src/crypto/signature.ts`). `signatures.json` and
`compact-signatures.json` each use their own `testKeys` and `trustStore`.

## Schema sync (WOLS 1.5.0)

The specification makes the 1.5 JSON Schemas normative and requires reference libraries to run the
same check as upstream's `conformance/tools/validate_schema.py`. `schema-sync.test.ts` does, with
ajv as an independent validator:

- Every `validate` and `validateBundle` case in `embedded.json`, `generation.json`,
  `data-model.json` and `bundle.json` gets the vector's verdict from the schema plus the rules JSON
  Schema can't express (`strain.lineage` equal to `derivedFrom[0].id`; bundle references that
  resolve, checked only when the schema passes). For an invalid case, the shallowest schema error
  (else the first rule) is on `errorField`.
- Every `roundtrip` output is a valid label, and so is what this library writes for that case.
- The vendored schemas match the SHA-256 recorded in `SOURCE.json`.

ajv isn't a direct dependency. The test uses the copy already in the lockfile (ajv 6.12.6, via
eslint), which implements draft-07. The 1.5 schemas use only keywords that mean the same in
draft-07 and 2020-12, and no `$ref` has sibling keywords, so the verdicts match; the test drops
`$schema` before compiling and registers RFC 3339 `date-time` and `date` formats, as the upstream
tool does. A direct `ajv@8` dev dependency (with `ajv/dist/2020`) would remove the reliance on
eslint's copy.

The library itself checks the schemas with a small built-in evaluator (`src/schema/evaluate.ts`)
over a copy compiled into `src/schema/wols-1.5.ts`. `tests/unit/schema-drift.test.ts` fails when
that copy differs from the vendored schemas; regenerate it with
`node scripts/generate-schema-module.mjs`.

- The vendored files must match the file list, SHA-256 hashes and case counts in `SOURCE.json`,
  and the hashes must agree with the vendored upstream `SHA256SUMS`.
- `MUST` cases are ordinary tests and fail the build.
- `SHOULD` cases run and are reported, but never fail the build.
- A pass/fail summary per file is printed at the end of the run. For failed decryptions and
  refused compact URLs it also notes any case where the library's reason differs from the reason
  the vector suggests (informational only; the conformance README says reasons need not match).

## Refreshing the vectors

```bash
npm run conformance:update            # latest main
npm run conformance:update -- v1.3.0  # a tag
npm run conformance:update -- <sha>   # a specific commit
```

The script (`scripts/update-conformance-vectors.mjs`, Node 18+, no dependencies) works like this:

1. It resolves the ref to a commit SHA.
2. It lists `conformance/vectors/` at that commit through the GitHub contents API. New upstream
   files are picked up automatically, and a subdirectory there fails the run.
3. It downloads and validates every file before changing anything on disk.
4. When upstream publishes `SHA256SUMS`, it checks every downloaded file against it, and vendors it.
5. It writes the files, removes local files that are no longer upstream, and rewrites
   `SOURCE.json`, which records each file's SHA-256 and case count.

Set `GITHUB_TOKEN` if you hit GitHub API rate limits. Review the diff, run
`npm run test:conformance`, and commit the vectors together with `SOURCE.json`.

The script fetches only `conformance/vectors/`, and its `SOURCE.json` has no `schemas` record, so
`schema-sync.test.ts` fails after a refresh until you also copy `schema/1.5/*.json` from the same
commit into `schema/1.5/`, add their SHA-256 back under `schemas`, and run
`node scripts/generate-schema-module.mjs`. That failure is deliberate: it keeps the vectors and the
schemas from the same commit.

The runner checks the vendored set against `SOURCE.json`, so a deleted, truncated or hand-edited
vector file fails the build. To change a vector deliberately, change it upstream and refresh.
