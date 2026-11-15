# Changelog

All notable changes to `@wemush/wols` are documented here. This project follows
[Semantic Versioning](https://semver.org/), except that its major and minor versions match the
WOLS specification version it implements. A spec minor release can require breaking changes, and
those are listed below.

## [1.3.0]

Brings the library in line with the [WOLS 1.3.0 specification](https://github.com/wemush/open-standard/blob/main/SPECIFICATION.md).
All `MUST` cases in the shared conformance vectors pass:

| Vector file       | MUST  | SHOULD |
| ----------------- | ----- | ------ |
| `embedded.json`   | 12/12 | 1/1    |
| `primordia.json`  | 4/4   | 1/1    |
| `generation.json` | 9/9   | 1/1    |
| `encrypted.json`  | 10/10 | 1/1    |

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
- **Minimum generation iterations is now 100,000** (previously 10,000). `encryptSpecimen` throws
  for lower `iterations`. Decoders reject `i` below 10,000 and, by default, above 10,000,000
  (`maxIterations`).
- **`EncryptedSpecimen` no longer includes `cryptoVersion`** in generated output. It now has `kdf`,
  `salt` (pbkdf2), `iterations` (pbkdf2), `id`, and `url`. The deprecated `tag` and
  `cryptoVersion` fields will be removed in 2.0.
- **Field-level encryption** values have the 1.3.0 shape
  `{ encrypted, algorithm, payload, iv, kdf, salt?, iterations? }` instead of
  `{ ..., cryptoVersion }`.
- **Field-level encryption is strict.** Naming a field the specimen doesn't have (for example a
  typo), naming the same field twice, or naming an inherited property such as `constructor` now
  throws. In 1.2.x such a field was skipped silently and left in cleartext.
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
  - The decrypted `id` must equal `wemush:{id}` from the URL path.
  - Unknown `kdf` values are rejected, as are `salt` or `i` with `kdf=raw`, a `salt` on a legacy
    label, ciphertext shorter than the GCM tag, and plaintext starting with a byte order mark.
  - Padded base64url is accepted.
- **`toEncryptedUrl` enforces the generator rules.** It refuses fewer than 100,000 iterations, a salt
  shorter than 16 bytes or equal to the legacy salt, and `salt` with `kdf=raw`.
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
  - The runner fails when the vendored files differ from `SOURCE.json`, when a file has no `MUST`
    cases, or when a case uses an operation it doesn't know.
  - `npm run conformance:update` refreshes the vectors. It discovers upstream files through the
    GitHub API and removes stale ones.
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

### Unchanged

- The compact URL format. Its parameter and species-code registries aren't settled yet.
- `sig` is preserved when parsing and generating encrypted URLs, but it isn't verified.

### Known limitations

These need decisions in the WOLS specification:

- **Field binding.** Encrypted fields aren't bound to their field name or label. Doing that would
  need associated data in the wire format.
- **ID encoding.** Percent-encoding of the ID in the encrypted URL path isn't specified. This
  library percent-encodes when generating and decodes when parsing. Plain alphanumeric IDs are
  unaffected.
- **Iteration ceiling.** The spec doesn't recommend an iteration ceiling, so this library uses a
  configurable default of 10,000,000.
