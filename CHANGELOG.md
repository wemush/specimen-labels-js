# Changelog

All notable changes to `@wemush/wols` are documented here. This project follows
[Semantic Versioning](https://semver.org/), except that its major and minor versions match the
WOLS specification version it implements. A spec minor release can require breaking changes, and
those are listed below.

## [Unreleased]

## [1.5.0-rc.2] - 2026-11-28

Implements the WOLS 1.5.0 release candidate, `1.5.0-rc.2` (open-standard `main` at `0b119d5`,
PRs #40 and #41). `WOLS_VERSION` stays
`'1.4.0'` until 1.5.0 is final, so new labels still say `"version": "1.4.0"`. Every `MUST` and
`SHOULD` case in the 1.5 vector files passes.

### WOLS 1.5 label members

- **New members** on `Specimen` and `SpecimenInput`: `taxon` (`Taxon`), `form` (`SpecimenForm`),
  `derivedFrom` (`ParentLink[]`), `condition` (`Condition`), `container` (`Container`) and `lot`,
  plus `strain.accession`. `parseSpecimen` reads them, `serializeSpecimen` writes them, and
  `createSpecimen` passes them through. New constants: `SPECIMEN_FORMS`, `CONDITIONS`,
  `CONTAINER_FORMATS`, `PARENT_RELATIONS`, `TAXON_IDENTIFIER_SCHEMES`.
- **Validation**: `validateSpecimen` checks each new member against the normative 1.5 JSON
  Schema (compiled into the library), and that `strain.lineage` equals `derivedFrom[0].id` when
  both are present. Error paths are dot paths such as `derivedFrom.0.relation`.
- **`strain.name` is optional.** A present `strain.name` must still be a non-empty string.
- **Field-level encryption**: a member other than `@context`, `@type`, `id`, `version`, `type`,
  `species` and `signature` may hold an encryption object. `validateSpecimen` checks only its
  shape; check the plaintext after decryption.
- **Generation** letters are read in either case (`f2`), and `toCompactUrl` writes them
  uppercase.
- **`_meta`**: `parseSpecimen` reads snake_case keys (`source_id`, `source_system`,
  `imported_at`, `schema_version`) as camelCase. If both spellings are present, both are kept.

### Records Bundle

- **`validateBundle(bundle, options?)`** validates a 1.5 Records Bundle: the bundle schema, each
  specimen with the label rules, and references that must resolve within the bundle
  (`strainRef`, `recipeRef`, and each observation's and harvest's `specimen`). An unresolved
  reference is the new `WolsErrorCode.UNRESOLVED_REFERENCE`. New types: `Bundle`,
  `SpecimenRecord`, `StrainRecord`, `Recipe`, `Observation`, `Harvest` and the types they use.

### Compact URLs

- **Parsing** follows the 1.5.0 compact URL rules. `parseCompactUrl(url, { onWarning })`:
  - accepts `web+wemush://v1/` as well as `wemush://v1/`, and percent-decodes the ID;
  - reads the 27 species registry codes, and the 24 frozen two-letter legacy codes with a
    `LEGACY_SPECIES_CODE` warning;
  - reads `sg` without `sn`, and `td` (`strain.transferDepth`), dropping a malformed `td` with a
    `MALFORMED_TRANSFER_DEPTH` warning;
  - returns `created` (RFC 3339) from `t`, unregistered parameters in `unrecognized`, and `sig`
    unverified.
- **Refusals** are a new `WolsCompactUrlError` (a `WolsParseError`) whose `reason` is
  `invalid-url`, `unsupported-version`, `encrypted-url`, `invalid-encoding`, `missing-parameter`,
  `invalid-parameter` or `duplicate-parameter`.
- **Writing**: `toCompactUrl` percent-encodes the ID, writes `td`, and skips a `created` time
  before 1970 or one that isn't a valid date. The QR module's compact format now uses
  `toCompactUrl` instead of a copy of it.
- New exports: `STAGE_CODES`, `LEGACY_SPECIES_CODES`, `COMPACT_URL_PARAMETERS`,
  `LEGACY_SPECIES_CODE_WARNING`, `MALFORMED_TRANSFER_DEPTH_WARNING`.

### Compact URL signatures

- **`signCompactUrl(url, options)`** signs a compact URL's exact bytes under the `compact-url`
  form. It refuses a URL with no query, an empty query, an existing `sig`, or one that isn't a
  well-formed compact URL.
- **`verifySpecimen`** detects the `compact-url` form. Every result now has `form`
  (`SignatureForm`: `embedded`, `encrypted-url` or `compact-url`). A valid compact URL result
  also has `params` and `unrecognizedParams`.
- **`unwrapWolsUrl(text)`** returns the `wemush://v1/` URL inside a `web+wemush://` URL or a
  `https://{host}/wols/{url}` handler link (decoded once), or `null`.

### Breaking changes

These may affect callers, although WOLS 1.4.0 labels are unchanged on the wire:

- `VerificationResult` has a new `form` member, so code that compares a whole result with
  `toEqual` or `deepStrictEqual` must include it.
- A compact URL with a `sig` used to verify as `malformed`. It is now checked as a compact URL,
  so a valid signature gives `valid`, and a token copied from an encrypted URL gives `invalid`.
- `parseCompactUrl` now refuses URLs it used to accept: a version other than `v1` (it returned
  version `1.0.0` before), a bad `ty`, `st`, `t` or `sg`, a repeated parameter, bad
  percent-encoding, and a fragment. IDs are now percent-decoded.
- `Strain.name` and `SpecimenRef.strain.name` are optional in the TypeScript types, and
  `isStrain` accepts a strain without a name.
- A label with the 1.5 members is now validated against the 1.5 schema. Before, they were
  unknown members, kept with an `UNKNOWN_FIELD` warning whatever their value. A value the schema
  rejects (such as `derivedFrom[].relation: "inoculum"`) is now an error. These members no longer
  go into `Specimen.unknownMembers`.
- The QR module's compact format changes: it now writes `ty`, the full stage name, the species
  name for a species without a registry code, and the percent-encoded ID.
- `registerSpeciesCode` throws `WolsError` (`WOLS_INVALID_FORMAT`) when asked to reassign a
  registry or legacy code to another species.

### Tests

- **Conformance**: vectors vendored from open-standard `spec/1.5.0-rc.2` at `d40dc7b`, adding
  `data-model.json`, `bundle.json` (1.5.0-rc.1), `compact.json` and `compact-signatures.json`
  (1.5.0-rc.2). The runner supports the `roundtrip`, `validateBundle`, `parseCompact` and
  `unwrap` operations, and `compact-url` signing and verification.
- **Schema sync**: the 1.5 JSON Schemas are vendored in `tests/conformance/schema/1.5/`, and
  `schema-sync.test.ts` checks, with ajv, that every `validate` and `validateBundle` vector gets
  the same verdict and error field from the schema plus the label and bundle rules, and that
  every `roundtrip` output is a valid label. `schema-drift.test.ts` checks the compiled-in copy.

## [1.5.0-rc.1] - 2026-11-27

Pre-release, published to npm under the `next` dist-tag. It still implements WOLS 1.4.0
(`WOLS_VERSION` is unchanged) and adds tolerance for the 1.5 draft.

### WOLS 1.5 draft label tolerance

Follows the label changes in open-standard
[`proposals/wols-1.5-data-model.md`](https://github.com/wemush/open-standard/blob/main/proposals/wols-1.5-data-model.md)
section 2. Both are additive: every 1.4.0 label parses and serializes as before.

- **Pre-release versions**: `version` accepts a pre-release suffix such as `1.5.0-rc.1`, matching
  the 1.5 label schema pattern. Build metadata (`+build`) is still rejected.
- **Unknown top-level members are kept**: `parseSpecimen` still warns about each one, and now
  keeps them on the new `Specimen.unknownMembers`. `serializeSpecimen` writes them back at the
  top level after the known fields, so a parse and re-save no longer drops 1.5 members such as
  `taxon`, `lot` or `derivedFrom`. A kept member can never override a known field.
- **Field encryption**: `encryptFields` writes kept members at the top level in cleartext and
  refuses `unknownMembers` as a field to encrypt. `decryptFields` restores them.

### Tests

- **Conformance**: The runner supports the `verifyNested` operation (sign-then-encrypt): it
  verifies an encrypted URL's `sig`, decrypts the URL to its exact plaintext, and verifies the
  plaintext's own `signature`. `signatures.json` is vendored from open-standard
  `main` at `4b9235e` (open-standard PR #30), which adds six
  `verifyNested` cases and `sign-nested-encrypted-url`; all 119 `MUST` cases pass. No library code
  changed.

## [1.4.0] - 2026-11-17

Implements the final [WOLS 1.4.0 specification](https://github.com/wemush/open-standard/blob/1.4.0/SPECIFICATION.md)
(open-standard PR #29, commit `02079df`). Summary:

- **Signatures**: `signSpecimen`, `signEncryptedUrl` and `verifySpecimen` (Ed25519 over RFC 8785
  JCS for embedded labels, over the exact URL bytes for encrypted URLs), with five verification
  statuses and keys taken only from a caller-supplied trust store.
- **Key sets**: `trustStoreFromKeySet` loads `/.well-known/wols-keys.json` documents and skips
  entries for algorithms it doesn't support.
- **Numeric `strain.generation`**: decoders read a JSON integer as its decimal string, with a
  warning, and generators always write a string.
- **Legacy NFC fix**: 1.2.x labels made with a non-NFC passphrase decrypt again with
  `allowLegacy`.
- **Migration guide**: a "Migrating from 1.2" section in the README, with its code tested.
- **Interop**: CI round-trips encrypted labels with the Python `wols` library across the shared
  51-case matrix, in both directions.

WOLS 1.3.1 was not released separately. Its release candidate's clarifications (a reserved,
never-verified `sig`) ship as part of 1.4.0, and 1.3.0 already behaved that way, so there is no
`@wemush/wols` 1.3.1.

Every conformance vector passes, `MUST` and `SHOULD`:

| Vector file       | MUST  | SHOULD |
| ----------------- | ----- | ------ |
| `embedded.json`   | 13/13 | 1/1    |
| `primordia.json`  | 4/4   | 1/1    |
| `generation.json` | 9/9   | 2/2    |
| `encrypted.json`  | 21/21 | 3/3    |
| `field-encryption.json` | 6/6 | 1/1  |
| `signatures.json` | 112/112 | —    |

### Version

- `WOLS_VERSION` is now `'1.4.0'`, so `createSpecimen` writes `"version": "1.4.0"`. The wire
  format is unchanged: 1.3.0 labels decode the same way, and `@wemush/wols` 1.3.0 reads 1.4.0
  labels (it accepts any semver `version`).
- `isOutdated('1.3.0')` is now `true`. `migrate()` and `canMigrate()` on a 1.3.0 label need a
  registered `1.3.0` to `1.4.0` handler. Setting `version` is enough:
  `registerMigration('1.3.0', '1.4.0', s => ({ ...s, version: '1.4.0' }))`.
- Vectors re-vendored from the final spec commit `02079df`. The vector files are byte-identical
  to the `a44dd3a` copies; only `SOURCE.json` changed.

### Numeric `strain.generation` (WOLS 1.4.0)

`wols` for Python 1.3.0 wrote `strain.generation` as a JSON integer (`"generation": 1`), which
this library rejected as `invalid-plaintext` after decrypting. WOLS 1.4.0 (open-standard
PR #27) says generators MUST write a string, and decoders SHOULD read an integer as its decimal
string, with a warning.

- **Decoding accepts a numeric `generation`.** `validateSpecimen` reports a
  `NUMERIC_GENERATION` warning (path `strain.generation`) instead of an `INVALID_GENERATION`
  error. The decimal string is validated like any other value, so `-1` or `1.5` still fail.
  `parseSpecimen`, `decryptSpecimen` and `decryptFields` return the decimal string (`"1"`).
- **New:** `parseSpecimen(json, { onWarning })` and `DecryptionOptions.onWarning` receive the
  warning. Without a callback, it goes to `console.warn`, as `createSpecimen` warnings already do.
  New exports: `ParseOptions` and `NUMERIC_GENERATION_WARNING`.
- **Generators always write a string.** `createSpecimen` converts a number from an untyped caller,
  with the same warning. `serializeSpecimen`, `encryptSpecimen` and `encryptFields` write the
  decimal string for a hand-built object. The caller's object is never mutated.
- **Vectors.** The vendored vectors (open-standard `main` at `a44dd3a`) include the `SHOULD` cases
  `generation-numeric`, `decrypt-numeric-generation` and `decrypt-fields-numeric-generation`. All
  three now pass.

### Signatures (WOLS 1.4.0)

Implements the WOLS 1.4.0 signature scheme (open-standard PR #24 and PR #26, released unchanged in
1.4.0). Nothing here changes how any label decodes.

- **New:** `signSpecimen(label, { privateKey, kid })`, `signEncryptedUrl(url, { privateKey, kid })`
  and `verifySpecimen(label, trustStore)`.
  - Ed25519 (RFC 8032, pure) through WebCrypto. No new dependencies.
  - Verification never throws for a bad signature. Label text is first parsed as an I-JSON
    object, and any failure is `malformed`, signed or not. Then come `unsigned`, the token and URL
    rules (`malformed`), `unknown-kid`, and `invalid` or `valid`. Signatures whose `S` is not less than the
    group order are rejected explicitly, whatever the WebCrypto backend does.
  - Keys come only from the caller's trust store, never from the label.
  - Embedded labels are verified over the RFC 8785 (JCS) form of the label as parsed. Encrypted
    URLs are verified over their exact bytes before `&sig=`.
  - Duplicate member names (compared after unescaping, at any depth), lone surrogates and
    non-finite or overflowing numbers (`NaN`, `Infinity`, `1e400`) are `malformed`.
  - Signers refuse label text that isn't I-JSON, and URLs with no query, an empty query, or an
    existing `sig`.
  - An unusable trust store entry (not `Ed25519`, not 32 bytes, not a curve point) gives
    `invalid`, not `unknown-kid`. `createTrustStore` rejects such entries when the store is built.
- **New:** `createTrustStore(entries)`, `getSigningPublicKey(seed)`, `canonicalizeJson(value)` (RFC 8785), `SIGNING_DOMAIN`,
  `WolsSignatureError`, the `WolsErrorCode.SIGNATURE_ERROR` code, and the types `SignatureStatus`,
  `TrustStore`, `TrustStoreEntry`, `VerificationResult` and `SigningOptions`.
- **New:** `trustStoreFromKeySet(document, { onSkip })` and the types `KeySetEntry` and
  `KeySetOptions`, for the optional `/.well-known/wols-keys.json` key set document, following the
  rules from open-standard PR #26. An entry whose `alg` isn't `Ed25519` (compared exactly) is
  skipped without checking its other members, and `onSkip` is called with it, so an issuer can
  publish keys for a future algorithm without breaking this verifier. A damaged `Ed25519` entry
  (bad kid, or a key that isn't canonical base64url of 32 bytes on the curve), a duplicate kid
  among `Ed25519` entries, and a document that isn't an object with a `keys` array, or holds an
  entry without a string `alg`, throw `WolsSignatureError` for the whole document.
  `createTrustStore` still rejects other algorithms.
- **Decoding is unchanged.** `signature` and `sig` are still kept as received and never verified.
- **Vectors.** Re-vendored from open-standard `main` at `a44dd3a` (after PRs #26 and #27), which adds `signatures.json` (112
  `MUST` cases, including 28 `loadKeySet` cases), `decrypt-with-sig` and `decrypt-signed-url` in `encrypted.json`, and
  `signed-label-valid` in `embedded.json`. The conformance runner now runs the `sign` and
  `verify` operations (including signing refusals and per-case trust stores) and `loadKeySet`, and checks that decoding keeps `sig` without verifying it. Vector files may
  now target different spec versions (`signatures.json` is `1.4.0`), and `SOURCE.json` records
  each file's version.

### Fixed

- **Legacy labels made with a non-NFC passphrase decrypt again.** 1.3.0 normalized every
  passphrase to NFC, including on the `allowLegacy` path, but 1.2.x never normalized. A 1.2.x
  label made with a decomposed passphrase (for example `u` plus a combining diaeresis) therefore
  failed with `authentication-failed` even with `allowLegacy` and the same passphrase. The legacy
  path now derives the key as 1.2.x did: PBKDF2-HMAC-SHA256 over the passphrase's UTF-8 bytes as
  given, with the fixed salt `@wemush/wols/crypto/v1` and the label's iterations.
  - If that fails authentication and the passphrase isn't in NFC, the library tries the NFC form
    once. A legacy label made from the composed spelling, which 1.3.0 opened, still opens from the
    decomposed one. The retry costs one more PBKDF2 derivation. It happens only for a non-NFC
    passphrase on a legacy label, and is skipped if it would take the total above
    `maxIterations`. A label's other fields reuse the key that worked.
  - A wrong passphrase still fails with `authentication-failed` and the same message.
  - 1.3.0 labels are unchanged: their passphrase is always normalized to NFC, with one derivation.

### Documentation

- **"Migrating from 1.2" guide** in the README. It covers:
  - upgrading readers before writers, because 1.2.x can't decrypt 1.3.0 labels
  - the Node.js 20+ / WebCrypto requirement
  - how to recognize a legacy label (it has no `kdf`)
  - why legacy labels are weaker: the 1.2.0 fixed salt, no field binding, and no `id`
  - that `allowLegacy` reads only this library's 1.2.x format
  - decoding and re-encrypting whole-label and field-level legacy labels
  - how legacy labels made with a non-NFC passphrase are decrypted
  - restoring strict ID checks with `idMode`
  - moving to `encryptFields` and passing the `decryptField(value, { key }, { id, field })` binding.

  The README's migration functions are tested against labels made the 1.2.0 way in
  `tests/unit/readme-migration.test.ts`.
- The README's helper list now shows `decryptField`'s full signature, including the
  `{ id, field }` binding.

No change to the wire format or to decoding.

## [1.3.0]

Brings the library in line with the [WOLS 1.3.0 specification](https://github.com/wemush/open-standard/blob/1.3.0/SPECIFICATION.md).
Implements WOLS `1.3.0-rc.2` (open-standard tag `1.3.0-rc.2`, commit `9d200c9`). All `MUST` and `SHOULD` cases in the shared conformance vectors pass:

| Vector file       | MUST  | SHOULD |
| ----------------- | ----- | ------ |
| `embedded.json`   | 12/12 | 1/1    |
| `primordia.json`  | 4/4   | 1/1    |
| `generation.json` | 9/9   | 1/1    |
| `encrypted.json`  | 19/19 | 2/2    |
| `field-encryption.json` | 6/6 | —    |

### WOLS 1.3.0-rc.2 encryption rules

These rules were added on top of `rc.1` before 1.3.0 was published. Field-level ciphertexts made by
earlier unpublished 1.3.0 builds don't decrypt under them. Because nothing was released, no
migration is needed.

- **NFC passphrases.** The passphrase is normalized to Unicode NFC, then UTF-8 encoded, before
  PBKDF2. This applies to encryption, decryption and `derivePassphraseKey`.
- **Field-level AAD.** Each encrypted field is bound to its label and field name. The AES-GCM
  additional data is the UTF-8 of `"{id}\n{field}"`, and every field gets its own random IV.
  Values that are swapped between fields or copied from another label fail authentication.
  `decryptField` now takes a third argument, `{ id, field }`. The URL format has no AAD and keeps
  the decrypted-`id` check.
- **Identifying fields.** `@context`, `@type`, `id`, `version`, `type` and `species` are never
  encrypted. `decryptFields` refuses a label that has an encrypted identifying field, with reason
  `identifying-field`.
- **Iterations.**
  - Generation defaults to 600,000 iterations. Anything from 100,000 to 10,000,000 is allowed.
  - Decoding rejects fewer than 10,000 or more than 10,000,000, before deriving any key.
    `maxIterations` may be set lower, never higher.
  - For field-level decryption, the 10,000,000 limit applies to the label's total across distinct
    salt and iteration-count pairs.
- **ID path encoding.** Malformed percent-escapes and invalid UTF-8 in the URL path are rejected
  with reason `invalid-encoding`. `+` is a literal character.
- **New failure reasons:** `invalid-encoding` and `identifying-field`.
- **Vectors.** The vectors are re-vendored from `1.3.0-rc.2` and verified against upstream's
  `SHA256SUMS`, which is now vendored too. This adds `field-encryption.json` and its
  `decryptFields` operation, and 10 new `encrypted.json` cases.

### ⚠️ Breaking changes

**Encrypted generation.** The encrypted format follows the 1.3.0 wire format:

```
wemush://v1/encrypted/{id}?e=&iv=&kdf=pbkdf2|raw[&salt=&i=][&sig=]
```

- **Passphrase keys use a random per-label salt.** The fixed `@wemush/wols/crypto/v1` salt is no
  longer used when generating. Every passphrase-encrypted label gets a fresh 16-byte salt, and the
  label records `kdf=pbkdf2`, `salt` and `i`.
  - Labels created by 1.3.0 **cannot** be decrypted by 1.2.x, so upgrade readers before writers.
  - Labels created by 1.2.x have no `kdf`. They fail with reason `legacy-format` unless you pass
    `allowLegacy: true`. Legacy labels are never generated.
- **Generation iterations default to 600,000 and must be between 100,000 and 10,000,000**
  (previously 100,000 by default, with a minimum of 10,000). `encryptSpecimen` throws outside that
  range. Decoders reject `i` below 10,000 or above 10,000,000.
- **`EncryptedSpecimen` no longer includes `cryptoVersion`** in generated output. It now has `kdf`,
  `salt` (pbkdf2), `iterations` (pbkdf2), `id`, and `url`. The deprecated `tag` and
  `cryptoVersion` fields will be removed in 2.0.
- **Field-level encryption** values have the 1.3.0 shape
  `{ encrypted, algorithm, payload, iv, kdf, salt?, iterations? }` instead of
  `{ ..., cryptoVersion }`.
- **Field-level encryption is strict.** Naming a field the specimen doesn't have (for example a
  typo), naming the same field twice, or naming an inherited property such as `constructor` now
  throws. In 1.2.x such a field was skipped silently and left in cleartext. `@context`, `@type`,
  `id` and `version` can't be encrypted.
- **`encryptSpecimen(s, { fields: [...] })`** called with a literal `fields` array is now typed as
  returning `FieldEncryptedSpecimen`, which is what it returns at runtime.
- **`CryptoKey` keys** must be AES-GCM with a length of 256 and allow `encrypt` or `decrypt`. That
  applies to decrypting legacy labels too.
- **WebCrypto is required.** Node.js 18 has no global `crypto` by default. Use Node.js 20 or later,
  a browser, Deno or Bun. On a runtime without WebCrypto, encryption throws and decryption returns
  `unsupported-environment`.

**Validation and creation.**

- **The default `idMode` is now `'any'`** (previously `'strict'`): any non-empty suffix after
  `wemush:` is accepted, as the spec requires. This loosens validation. Pass `idMode: 'strict'`,
  `'ulid'` or `'uuid'` to opt into a format check.
- **`createSpecimen({ type: 'PRIMORDIA' })`** now resolves to `FRUITING`, sets
  `stage: 'PRIMORDIA'` when no stage was supplied, and warns through `console.warn` unless you pass
  `onWarning`.
- **`registerTypeAlias('PRIMORDIA', …)`** throws for any type other than `FRUITING`.
- **`isEncrypted`** now narrows to `EncryptedSpecimen | EncryptedField`. Use `isEncryptedSpecimen`
  or `isEncryptedField` to tell them apart.

### Added

- **Encrypted URLs.** `encryptSpecimen` returns `url`. `decryptSpecimen` accepts the URL or the
  object.
- **Raw keys (`kdf=raw`).** Pass 32 key bytes (`Uint8Array` or `ArrayBuffer`) or an AES-GCM 256
  `CryptoKey` as `key`. A passphrase string selects `kdf=pbkdf2`.
- **`encryptFields(specimen, { key, fields })`** returns a typed `FieldEncryptedSpecimen`.
  `decryptFields` returns a validated `Specimen`. `encryptSpecimen`'s `fields` option is
  deprecated.
- **Typed decryption errors.** A failed decryption carries a `WolsDecryptionError` whose `reason` is a
  `DecryptionFailureReason`, also copied into `details.reason`. The decryption functions return
  `DecryptResult<T>`, which is assignable to `ParseResult<T>`. They never throw.
- **Decryption hardening.**
  - Every parameter, encoding, the IV length and the key type are checked before PBKDF2 runs, so a
    hostile label costs no key derivation.
  - `maxIterations` (default 10,000,000) bounds the iteration count a label can demand.
    `decryptFields` validates every field first, derives once per distinct salt, and bounds the
    whole document's total.
  - The decrypted `id` must equal `wemush:{id}` from the URL path.
  - Unknown `kdf` values are rejected, as are `salt` or `i` with `kdf=raw`, a `salt` on a legacy
    label, ciphertext shorter than the GCM tag, and plaintext starting with a byte order mark.
  - Padded base64url is accepted.
- **`toEncryptedUrl` enforces the generator rules.** Every value must be canonical unpadded
  base64url, and the IV must be 12 bytes. It refuses an iteration count outside 100,000 to
  2^32-1, a salt shorter than 16 bytes or byte-equal to the legacy salt, and `salt` with
  `kdf=raw`.
- **New exports:**
  - Functions: `encryptFields`, `decryptPlaintext` (exact plaintext), `toEncryptedUrl`,
    `parseEncryptedUrl`, `decryptField`, `decryptFields`, `isEncryptedSpecimen`,
    `isEncryptedField`, `derivePassphraseKey`, `base64UrlEncode`, `base64UrlDecode`,
    `resolveTypeAndStage`.
  - Classes: `WolsDecryptionError`.
- **`strain.transferDepth`** counts every transfer from the original culture.
  - It must be a non-negative integer, and validation warns when it is less than
    `clonalGeneration`.
  - It round-trips through `serializeSpecimen` and `parseSpecimen`.
- **`createSpecimen` accepts `created`**, as an ISO 8601 string or a `Date`. Invalid values throw.
  When `created` is omitted the field is left out, as before.
- **`createSpecimen(input, { onWarning })`** receives non-fatal warnings. Without it, warnings go
  to `console.warn`.
- **`resolveTypeAndStage(type, stage?)`** is the single implementation of the reserved `PRIMORDIA`
  rule. `createSpecimen` and `serializeSpecimen` both use it. `resolveTypeAlias` and
  `mapToWolsType` still map the type only.
- **Conformance suite.**
  - The WOLS vectors are vendored in `tests/conformance/vectors`, pinned to upstream commit
    `3066545`. Run them with `npm run test:conformance`.
  - `SOURCE.json` records each file's SHA-256 and case count. The runner fails when the vendored
    files or their contents differ from it, when a file has no `MUST` cases, or when a case uses an
    operation it doesn't know.
  - `npm run conformance:update` refreshes the vectors. It discovers upstream files through the
    GitHub API, validates everything before writing anything, and removes stale files.
- `CHANGELOG.md`.

### Changed

- **`PRIMORDIA` supplied as a type** is never serialized as a `type`. `serializeSpecimen` resolves
  it on hand-built objects too.
- `isValidSpecimenId(id, strict?)` accepts any non-empty suffix by default, matching `idMode`.
- **`strain.clonalGeneration` accepts `0`** for the original culture. It previously required
  `>= 1`, which contradicted the spec.
- **`strain.generation` accepts `P<n>`** (for example `P1`).
- `WOLS_VERSION` is `1.3.0`, so new specimens are stamped with `version: "1.3.0"`.
- Growth-stage validation messages list all seven stages.

### Fixed

- **`require('@wemush/wols')` works** ([#9](https://github.com/wemush/specimen-labels-js/pull/9)).
  It was broken in 1.2.0 because `dist/cjs` was loaded as ESM. CommonJS consumers now also get
  CommonJS type declarations.

### Unchanged

- The compact URL format. Its parameter and species-code registries aren't settled yet.
- `sig` is preserved when parsing and generating encrypted URLs, but it isn't verified.
