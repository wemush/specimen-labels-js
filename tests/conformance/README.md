# WOLS conformance vectors

`vectors/*.json` are vendored, unmodified, from the language-neutral conformance suite in
[wemush/open-standard](https://github.com/wemush/open-standard/tree/main/conformance).
`vectors/SOURCE.json` records the exact upstream commit they came from.

Vendored from `main` at commit `3b265ef06fa8139716bb3376af7339bf6ad549ac` (WOLS `1.4.0-rc.1`, open-standard
PR #24, merged; a release candidate building on `1.3.1-rc.1`). The copies are verified against upstream's
`SHA256SUMS`, which is vendored alongside them.

The files target different spec versions: `signatures.json` is `1.4.0`, and the 1.3.0 wire-format
files are still `1.3.0`. `SOURCE.json` records each file's version and the highest one.

## Running

```bash
npm run test:conformance   # just the vectors
npm test                   # whole suite, vectors included
```

`conformance.test.ts` runs every case through the public API (`src/index.ts`):

| Operation  | API used                                                 |
| ---------- | -------------------------------------------------------- |
| `validate` | `validateSpecimen()`                                     |
| `create`   | `createSpecimen(input, { onWarning })`                   |
| `derive`   | `derivePassphraseKey()`                                  |
| `decrypt`  | `decryptPlaintext()` (exact bytes) and `decryptSpecimen()`; `parseEncryptedUrl()` for a preserved, unverified `sig` |
| `decryptFields` | `decryptFields()` |
| `sign`     | `signSpecimen()` / `signEncryptedUrl()`, then `verifySpecimen()` on the result; `refused` cases must throw `WolsSignatureError` |
| `verify`   | `verifySpecimen()` on the label text or URL (and on the parsed object, unless the text has duplicate names), with `input.trustStore` when given; `configError` cases must also be rejected by `createTrustStore()` |

For `sign` and `verify`, the runner also compares the vector's `signingInput` with the library's
internal `getSigningInput()` (`src/crypto/signature.ts`).

- The vendored files must match the file list, SHA-256 hashes and case counts in `SOURCE.json`,
  and the hashes must agree with the vendored upstream `SHA256SUMS`.
- `MUST` cases are ordinary tests and fail the build.
- `SHOULD` cases run and are reported, but never fail the build.
- A pass/fail summary per file is printed at the end of the run. For failed decryptions it
  also notes any case where the library's `error.details.reason` differs from the reason the
  vector suggests (informational only; the conformance README says reasons need not match).

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

The runner checks the vendored set against `SOURCE.json`, so a deleted, truncated or hand-edited
vector file fails the build. To change a vector deliberately, change it upstream and refresh.
