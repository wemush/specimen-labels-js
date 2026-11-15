# WOLS conformance vectors

`vectors/*.json` are vendored, unmodified, from the language-neutral conformance suite in
[wemush/open-standard](https://github.com/wemush/open-standard/tree/main/conformance).
`vectors/SOURCE.json` records the exact upstream commit they came from.

Vendored from commit `3066545feb79c902080fb8920dfc1a3d108525d3`, when the specification was at
`1.3.0-rc.1`.

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
| `decrypt`  | `decryptPlaintext()` (exact bytes) and `decryptSpecimen()` |

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

The script (`scripts/update-conformance-vectors.mjs`, Node 18+, no dependencies) resolves the
ref to a commit SHA, downloads the four vector files from that commit, and rewrites
`SOURCE.json`. Set `GITHUB_TOKEN` if you hit GitHub API rate limits. Review the diff, run
`npm run test:conformance`, and commit the vectors together with `SOURCE.json`.

If upstream adds a new vector file, add its name to `FILES` in the script.
