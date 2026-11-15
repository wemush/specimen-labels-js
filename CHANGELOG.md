# Changelog

All notable changes to `@wemush/wols` are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [1.3.0]

Brings the library in line with the [WOLS 1.3.0 specification](https://github.com/wemush/open-standard/blob/main/SPECIFICATION.md).
All `MUST` cases in the shared conformance vectors pass:

| Vector file       | MUST  | SHOULD |
| ----------------- | ----- | ------ |
| `embedded.json`   | 12/12 | 1/1    |
| `primordia.json`  | 4/4   | 1/1    |
| `generation.json` | 9/9   | 1/1    |
| `encrypted.json`  | 10/10 | 1/1    |

### ⚠️ Breaking: encrypted generation

The encrypted format now follows the 1.3.0 wire format:

```
wemush://v1/encrypted/{id}?e=&iv=&kdf=pbkdf2|raw[&salt=&i=][&sig=]
```

- **Passphrase keys use a random per-label salt.** The fixed `@wemush/wols/crypto/v1` salt is no
  longer used when generating. Every passphrase-encrypted label gets a fresh 16-byte salt, and the
  label records `kdf=pbkdf2`, `salt` and `i`.
  - Labels created by 1.3.0 **cannot** be decrypted by 1.2.x.
  - Labels created by 1.2.x have no `kdf` and are treated as legacy. They decrypt only with
    `decryptSpecimen(input, { key, allowLegacy: true })`. Legacy labels are never generated.
- **Minimum generation iterations is now 100,000** (previously 10,000). `encryptSpecimen` throws
  for lower `iterations`. Decoders reject `i` below 10,000.
- **`EncryptedSpecimen` no longer includes `cryptoVersion`** in generated output. It now has `kdf`,
  `salt` (pbkdf2), `iterations` (pbkdf2), `id`, and `url`.
- **Field-level encryption** values have the 1.3.0 shape
  `{ encrypted, algorithm, payload, iv, kdf, salt?, iterations? }` instead of
  `{ ..., cryptoVersion }`.

### Added

- **Encrypted URLs.** `encryptSpecimen` returns `url`. `decryptSpecimen` accepts the URL or the
  object.
  - New exports: `decryptPlaintext` (exact plaintext), `toEncryptedUrl`, `parseEncryptedUrl`,
    `decryptField`, `decryptFields`, `derivePassphraseKey`, `base64UrlEncode`, `base64UrlDecode`.
- **Raw keys (`kdf=raw`).** Pass 32 key bytes (`Uint8Array` or `ArrayBuffer`) or an AES-GCM 256
  `CryptoKey` as `key`. A passphrase string selects `kdf=pbkdf2`.
- **Decryption checks.**
  - The decrypted specimen's `id` must equal `wemush:{id}` from the URL path.
  - Unknown `kdf` values are rejected, as is `salt` or `i` with `kdf=raw`.
  - The IV must be 12 bytes. Padded base64url is accepted.
  - Failures carry a stable `error.details.reason`, for example `authentication-failed`,
    `id-mismatch`, or `insufficient-iterations`.
- **`strain.transferDepth`** counts every transfer from the original culture.
  - It must be a non-negative integer, and validation warns when it is less than
    `clonalGeneration`.
  - It round-trips through `serializeSpecimen` and `parseSpecimen`.
- **`createSpecimen` accepts `created`**, as an ISO 8601 string or a `Date`. Invalid values throw.
  When `created` is omitted the field is left out, as before.
- **`createSpecimen(input, { onWarning })`** receives non-fatal warnings. Without it, warnings go
  to `console.warn`.
- **Conformance suite.** The WOLS vectors are vendored in `tests/conformance/vectors`, pinned to
  upstream commit `3066545`. Run them with `npm run test:conformance`, and refresh them with
  `npm run conformance:update`.
- `CHANGELOG.md`.

### Changed

- **`PRIMORDIA` supplied as a type** resolves to `FRUITING`.
  - It sets `stage: 'PRIMORDIA'` when no stage is supplied, and never overrides a supplied stage.
  - It emits a `PRIMORDIA_AS_TYPE` warning.
  - It is never serialized as a `type`. `serializeSpecimen` also resolves it on hand-built
    objects.
  - It can't be remapped with `registerTypeAlias`. Other aliases are unchanged and still
    case-insensitive.
- **IDs:** any non-empty suffix after `wemush:` is accepted by default, including ULIDs, UUIDs
  and human-readable IDs, as the spec requires. The default `idMode` changed from `'strict'` to
  `'any'`. Pass `idMode: 'strict'`, `'ulid'` or `'uuid'` to opt into a format check.
  `isValidSpecimenId(id, strict?)` follows the same rule.
- **`strain.clonalGeneration` accepts `0`** for the original culture. It previously required
  `>= 1`, which contradicted the spec.
- **`strain.generation` accepts `P<n>`** (for example `P1`).
- `WOLS_VERSION` is `1.3.0`, so new specimens are stamped with `version: "1.3.0"`.
- Growth-stage validation messages list all seven stages.

### Unchanged

- The compact URL format. Its parameter and species-code registries aren't settled yet.
- `sig` is preserved when parsing and generating encrypted URLs, but it isn't verified.
