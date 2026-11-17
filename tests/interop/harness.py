"""WOLS cross-library round-trip harness (Python side).

Generates a corpus of encrypted labels from ``matrix.json`` with the installed
``wols`` package, and verifies a corpus produced by any implementation
(normally ``@wemush/wols``) by decrypting it with the installed ``wols``.

Usage::

    python harness.py generate matrix.json corpus.json
    python harness.py verify matrix.json corpus.json

``verify`` exits non-zero if any case fails, or if a case listed in the
matrix's ``expectedFailures`` unexpectedly passes.

This file is kept identical in wemush/specimen-labels-py and
wemush/specimen-labels-js (``tests/interop/``). It uses only the public
``wols`` API, so it also runs against a published release.
"""

from __future__ import annotations

import base64
import copy
import dataclasses
import hashlib
import json
import re
import sys
import traceback
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.parse import unquote_to_bytes

import wols
from wols import Specimen
from wols.crypto import (
    decrypt_specimen,
    decrypt_specimen_bytes,
    decrypt_specimen_fields,
    encrypt_specimen,
    encrypt_specimen_fields,
    parse_encrypted_url,
)
from wols.exceptions import WolsEncryptionError

DECODER = "python"
IDENTIFYING = ("@context", "@type", "id", "version", "type", "species")

# RFC 3986 pchar minus pct-encoded: unreserved / sub-delims / ":" / "@".
_PCHAR_RE = re.compile(r"(?:[A-Za-z0-9\-._~!$&'()*+,;=:@]|%[0-9A-Fa-f]{2})*")
# Characters a generator MUST percent-encode (SPECIFICATION.md 1.3.0).
_MUST_ENCODE_RE = re.compile(r"[%/?# +\x00-\x1f\x7f]|[^\x00-\x7f]")
_B64URL_RE = re.compile(r"[A-Za-z0-9_-]*")


class CheckError(AssertionError):
    """A case did not meet an interop or wire-format requirement."""


def _check(condition: bool, message: str) -> None:
    if not condition:
        raise CheckError(message)


def _canonical(value: Any) -> str:
    # Type-strict comparison: True != 1 and 1 != 1.0 once serialized.
    return json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(",", ":"))


def _same_doc(actual: Any, expected: dict[str, Any]) -> bool:
    return isinstance(actual, dict) and _canonical(actual) == _canonical(expected)


def _b64url(value: str) -> bytes:
    pad = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + pad)


def _canonical_b64url(name: str, value: object) -> bytes:
    _check(isinstance(value, str), f"{name} must be a string")
    assert isinstance(value, str)
    _check(
        bool(_B64URL_RE.fullmatch(value)), f"{name} must be base64url without padding"
    )
    raw = _b64url(value)
    _check(
        base64.urlsafe_b64encode(raw).rstrip(b"=").decode() == value,
        f"{name} is not canonical base64url (non-zero trailing bits)",
    )
    return raw


def load_json(path: str | Path) -> Any:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def matrix_sha256(path: str | Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def expected_document(matrix: dict[str, Any], case: dict[str, Any]) -> dict[str, Any]:
    template = matrix["specimens"][case["specimen"]]
    doc: dict[str, Any] = {}
    for key, value in template.items():
        doc[key] = copy.deepcopy(value)
        if key == "@type":
            doc["id"] = case["specimenId"]
    doc.setdefault("id", case["specimenId"])
    return doc


def _secret(case: dict[str, Any], passphrase: str | None = None) -> str | bytes:
    if case["kdf"] == "raw":
        return _b64url(case["key"])
    return passphrase if passphrase is not None else case["passphrase"]


def _iteration_kwargs(case: dict[str, Any]) -> dict[str, int]:
    return {"iterations": case["iterations"]} if "iterations" in case else {}


# =============================================================================
# GENERATE
# =============================================================================


def generate_case(matrix: dict[str, Any], case: dict[str, Any]) -> dict[str, Any]:
    doc = expected_document(matrix, case)
    secret = _secret(case)
    if case["form"] == "url":
        url = encrypt_specimen(
            Specimen.from_dict(doc), secret, **_iteration_kwargs(case)
        )
        if "sig" in case:
            label = parse_encrypted_url(url)
            url = dataclasses.replace(label, signature=case["sig"]).to_url()
        return {"url": url}
    if case["form"] == "fields":
        document = encrypt_specimen_fields(
            doc, secret, list(case["fields"]), **_iteration_kwargs(case)
        )
        return {"document": document}
    raise ValueError(f"unknown form {case['form']!r}")


def generate(matrix: dict[str, Any], matrix_hash: str) -> dict[str, Any]:
    return {
        "corpusVersion": 1,
        "matrixVersion": matrix["matrixVersion"],
        "matrixSha256": matrix_hash,
        "generator": {
            "implementation": "wols",
            "language": "python",
            "version": getattr(wols, "__version__", "unknown"),
        },
        "cases": {case["id"]: generate_case(matrix, case) for case in matrix["cases"]},
    }


# =============================================================================
# VERIFY
# =============================================================================


def _check_url_wire(case: dict[str, Any], url: str) -> None:
    """Generator-side wire rules, checked on the raw URL text."""
    prefix = "wemush://v1/encrypted/"
    _check(url.startswith(prefix), f"URL must start with {prefix}")
    rest = url[len(prefix) :]
    _check("#" not in rest, "URL must not contain a fragment")
    segment, sep, query = rest.partition("?")
    _check(sep == "?", "URL has no query")
    _check(
        bool(_PCHAR_RE.fullmatch(segment)),
        f"ID path segment {segment!r} is not a valid RFC 3986 segment",
    )
    unescaped = re.sub(r"%[0-9A-Fa-f]{2}", "", segment)
    _check(
        not _MUST_ENCODE_RE.search(unescaped),
        f"ID path segment {segment!r} leaves a character unencoded that MUST be encoded",
    )
    suffix = case["specimenId"][len("wemush:") :]
    _check(
        unquote_to_bytes(segment) == suffix.encode("utf-8"),
        f"ID path segment {segment!r} does not percent-decode to {suffix!r}",
    )
    if "expectPathSegment" in case:
        _check(
            segment == case["expectPathSegment"],
            f"ID path segment {segment!r} != expected {case['expectPathSegment']!r}",
        )

    params: dict[str, str] = {}
    for pair in query.split("&"):
        key, _, value = pair.partition("=")
        _check(key not in params, f"duplicate parameter {key!r}")
        params[key] = value
    _check(params.get("kdf") == case["kdf"], f"kdf must be {case['kdf']}")
    _check(
        len(_canonical_b64url("e", params.get("e"))) >= 16, "e is shorter than the tag"
    )
    _check(len(_canonical_b64url("iv", params.get("iv"))) == 12, "iv must be 12 bytes")
    _check_kdf_params(case, params.get("salt"), params.get("i"), "salt", "i")
    if "sig" in case:
        _check("sig" in params, "sig parameter missing")
    else:
        _check("sig" not in params, "unexpected sig parameter")


def _check_kdf_params(
    case: dict[str, Any], salt: object, iterations: object, salt_name: str, i_name: str
) -> None:
    if case["kdf"] == "pbkdf2":
        _check(len(_canonical_b64url(salt_name, salt)) >= 16, "salt under 16 bytes")
        if isinstance(iterations, str):
            _check(
                bool(re.fullmatch(r"[0-9]+", iterations)), f"{i_name} must be digits"
            )
            iterations = int(iterations)
        _check(
            type(iterations) is int and iterations == case["expectIterations"],
            f"{i_name} is {iterations!r}, expected {case['expectIterations']}",
        )
    else:
        _check(salt is None, f"{salt_name} must be omitted for kdf=raw")
        _check(iterations is None, f"{i_name} must be omitted for kdf=raw")


def _expect_auth_failure(fn: Callable[[], Any], what: str) -> None:
    try:
        fn()
    except WolsEncryptionError as e:
        _check(
            e.code == "AUTHENTICATION_FAILED",
            f"{what}: expected AUTHENTICATION_FAILED, got {e.code}",
        )
        return
    raise CheckError(f"{what}: decryption unexpectedly succeeded")


def verify_url(case: dict[str, Any], expected: dict[str, Any], url: object) -> None:
    _check(isinstance(url, str), "corpus entry has no url")
    assert isinstance(url, str)
    _check_url_wire(case, url)

    label = parse_encrypted_url(url)
    _check(label.specimen_id == case["specimenId"], f"parsed id {label.specimen_id!r}")
    _check(label.payload.kdf == case["kdf"], "parsed kdf differs")
    _check(
        label.signature == case.get("sig"),
        f"sig not preserved: got {label.signature!r}, expected {case.get('sig')!r}",
    )
    if case["kdf"] == "pbkdf2":
        _check(label.payload.iterations == case["expectIterations"], "iterations")

    passphrases = case.get("decryptPassphrases", [None])
    for passphrase in passphrases:
        secret = _secret(case, passphrase)
        plaintext = decrypt_specimen_bytes(url, secret)
        _check(
            _same_doc(json.loads(plaintext.decode("utf-8")), expected),
            f"decrypted document differs (passphrase={passphrase!r}): "
            f"{plaintext.decode('utf-8')}",
        )
    specimen = decrypt_specimen(url, _secret(case, passphrases[0]))
    _check(specimen.id == case["specimenId"], "decrypt_specimen id differs")
    _check(specimen.species == expected["species"], "decrypt_specimen species differs")

    for wrong in case.get("rejectPassphrases", []):
        _expect_auth_failure(
            lambda w=wrong: decrypt_specimen_bytes(url, w), f"passphrase {wrong!r}"
        )


def verify_fields(case: dict[str, Any], expected: dict[str, Any], doc: object) -> None:
    _check(isinstance(doc, dict), "corpus entry has no document")
    assert isinstance(doc, dict)
    fields = list(case["fields"])
    _check(set(doc) == set(expected), f"document keys differ: {sorted(doc)}")
    ivs: set[str] = set()
    salts: set[object] = set()
    for key in expected:
        if key not in fields:
            _check(
                _canonical(doc[key]) == _canonical(expected[key]),
                f"cleartext field {key!r} changed",
            )
            continue
        _check(key not in IDENTIFYING, f"identifying field {key!r} encrypted")
        obj = doc[key]
        _check(isinstance(obj, dict), f"field {key!r} is not an encryption object")
        _check(obj.get("encrypted") is True, f"{key}.encrypted must be true")
        _check(obj.get("algorithm") == "AES-256-GCM", f"{key}.algorithm")
        _check(obj.get("kdf") == case["kdf"], f"{key}.kdf must be {case['kdf']}")
        _check(
            len(_canonical_b64url(f"{key}.payload", obj.get("payload"))) >= 16, "tag"
        )
        _check(len(_canonical_b64url(f"{key}.iv", obj.get("iv"))) == 12, "iv length")
        _check(obj["iv"] not in ivs, f"{key}.iv reused across fields")
        ivs.add(obj["iv"])
        _check_kdf_params(
            case,
            obj.get("salt"),
            obj.get("iterations"),
            f"{key}.salt",
            f"{key}.iterations",
        )
        salts.add(obj.get("salt"))
        allowed = {
            "encrypted",
            "algorithm",
            "payload",
            "iv",
            "kdf",
            "salt",
            "iterations",
        }
        _check(
            set(obj) <= allowed, f"{key} has unexpected members {set(obj) - allowed}"
        )

    for passphrase in case.get("decryptPassphrases", [None]):
        restored = decrypt_specimen_fields(doc, _secret(case, passphrase))
        _check(
            _same_doc(restored, expected),
            f"restored document differs (passphrase={passphrase!r}): {restored}",
        )
    for wrong in case.get("rejectPassphrases", []):
        _expect_auth_failure(
            lambda w=wrong: decrypt_specimen_fields(doc, w), f"passphrase {wrong!r}"
        )


@dataclasses.dataclass
class CaseResult:
    case_id: str
    status: str  # "pass", "fail", "xfail", "xpass"
    detail: str = ""


def _expected_failure(
    matrix: dict[str, Any], case_id: str, generator: str
) -> dict[str, Any] | None:
    for entry in matrix.get("expectedFailures", []):
        if (
            entry["case"] == case_id
            and entry.get("generator", generator) == generator
            and entry.get("decoder", DECODER) == DECODER
        ):
            return dict(entry)
    return None


def verify(matrix: dict[str, Any], corpus: dict[str, Any]) -> list[CaseResult]:
    generator = corpus["generator"]["language"]
    results: list[CaseResult] = []
    for case in matrix["cases"]:
        entry = corpus["cases"].get(case["id"])
        try:
            _check(entry is not None, "case missing from corpus")
            assert entry is not None
            expected = expected_document(matrix, case)
            if case["form"] == "url":
                verify_url(case, expected, entry.get("url"))
            else:
                verify_fields(case, expected, entry.get("document"))
            ok, detail = True, ""
        except Exception as e:
            ok = False
            detail = (
                f"{type(e).__name__}: {e}"
                if isinstance(e, CheckError | WolsEncryptionError)
                else traceback.format_exc()
            )
        xfail = _expected_failure(matrix, case["id"], generator)
        if xfail is None:
            status = "pass" if ok else "fail"
        else:
            status = "xpass" if ok else "xfail"
            if ok:
                detail = f"listed in expectedFailures but passed: {xfail.get('reason')}"
            else:
                detail = f"{xfail.get('reason')} ({xfail.get('reference')}): {detail}"
        results.append(CaseResult(case["id"], status, detail))
    return results


def _summary(corpus: dict[str, Any], results: list[CaseResult]) -> int:
    gen = corpus["generator"]
    print(
        f"interop: {gen['implementation']} {gen['version']} ({gen['language']}) -> "
        f"wols {getattr(wols, '__version__', 'unknown')} (python)"
    )
    for r in results:
        line = f"  {r.status.upper():5} {r.case_id}"
        print(line + (f"\n        {r.detail}" if r.status != "pass" else ""))
    bad = [r for r in results if r.status in ("fail", "xpass")]
    counts = {
        s: sum(r.status == s for r in results)
        for s in ("pass", "fail", "xfail", "xpass")
    }
    print(
        f"interop: {len(results)} cases: "
        + ", ".join(f"{v} {k}" for k, v in counts.items())
    )
    return 1 if bad else 0


def main(argv: list[str]) -> int:
    if len(argv) != 4 or argv[1] not in ("generate", "verify"):
        print(__doc__, file=sys.stderr)
        return 2
    command, matrix_path, corpus_path = argv[1:]
    matrix = load_json(matrix_path)
    if command == "generate":
        corpus = generate(matrix, matrix_sha256(matrix_path))
        with open(corpus_path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(corpus, f, indent=2, ensure_ascii=True)
            f.write("\n")
        print(f"interop: wrote {len(corpus['cases'])} cases to {corpus_path}")
        return 0
    corpus = load_json(corpus_path)
    return _summary(corpus, verify(matrix, corpus))


if __name__ == "__main__":
    sys.exit(main(sys.argv))
