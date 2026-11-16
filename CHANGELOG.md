# Changelog

All notable changes to `@wemush/wols` are documented here. This project follows
[Semantic Versioning](https://semver.org/), except that its major and minor versions match the
WOLS specification version it implements. A spec minor release can require breaking changes, and
those are listed below.

## Unreleased

### WOLS 1.4.0-rc.1 signatures (release candidate)

Implements the signature scheme of WOLS `1.4.0-rc.1` (open-standard PR #24, commit `dead46a`).
The spec is a release candidate, so this must not be released until it is accepted, and the API
may still change. Nothing here changes how any label decodes.

- **New:** `signSpecimen(label, { privateKey, kid })`, `signEncryptedUrl(url, { privateKey, kid })`
  and `verifySpecimen(label, trustStore)`.
  - Ed25519 (RFC 8032, pure) through WebCrypto. No new dependencies.
  - Verification returns `unsigned`, `malformed`, `unknown-kid`, `invalid` or `valid`, checked in
    that order, and never throws for a bad signature. Signatures whose `S` is not less than the
    group order are rejected explicitly, whatever the WebCrypto backend does.
  - Keys come only from the caller's trust store, never from the label.
  - Embedded labels are verified over the RFC 8785 (JCS) form of the label as parsed. Encrypted
    URLs are verified over their exact bytes before `&sig=`.
  - Labels with duplicate member names are `malformed` (the spec's SHOULD).
- **New:** `getSigningPublicKey(seed)`, `canonicalizeJson(value)` (RFC 8785), `SIGNING_DOMAIN`,
  `WolsSignatureError`, the `WolsErrorCode.SIGNATURE_ERROR` code, and the types `SignatureStatus`,
  `TrustStore`, `TrustStoreEntry`, `VerificationResult` and `SigningOptions`.
- **Decoding is unchanged.** `signature` and `sig` are still kept as received and never verified.
- **Vectors.** Re-vendored from open-standard commit `dead46a`, which adds `signatures.json` (67
  `MUST` cases), `decrypt-with-sig` and `decrypt-signed-url` in `encrypted.json`, and
  `signed-label-valid` in `embedded.json`. The conformance runner now runs the `sign` and
  `verify` operations, and checks that decoding keeps `sig` without verifying it. Vector files may
  now target different spec versions (`signatures.json` is `1.4.0`), and `SOURCE.json` records
  each file's version.

| Vector file       | MUST  | SHOULD |
| ----------------- | ----- | ------ |
| `embedded.json`   | 13/13 | 1/1    |
| `primordia.json`  | 4/4   | 1/1    |
| `generation.json` | 9/9   | 1/1    |
| `encrypted.json`  | 21/21 | 2/2    |
| `field-encryption.json` | 6/6 | —    |
| `signatures.json` | 67/67 | —      |

## [1.3.0]

Brings the library in line with the [WOLS 1.3.0 specification](https://github.com/wemush/open-standard/blob/main/SPECIFICATION.md).
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
