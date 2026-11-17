#!/usr/bin/env python3
"""WOLS cross-implementation round-trip harness (Python side).

This file is kept identical in wemush/specimen-labels-js and
wemush/specimen-labels-py. Its TypeScript twin is wols-interop.mjs.

    python interop/wols_interop.py generate [--matrix interop/matrix.json] --out corpus.json
    python interop/wols_interop.py verify corpus.json [corpus2.json ...]

The library under test is whichever ``wols`` package (with the ``crypto``
extra) the interpreter imports: PyPI ``wols`` or a checkout of
specimen-labels-py.

``generate`` encrypts every matrix case and writes a corpus of ``decrypt`` /
``decryptFields`` cases in the conformance-vector shape. ``verify`` checks a
corpus, typically one written by another implementation: the generator-side
wire rules of WOLS 1.3.0 (checked independently of any library), then that
the library decrypts every case back to the input exactly. Exits non-zero
on any failure.
"""

from __future__ import annotations

import argparse
import base64
import dataclasses
import hashlib
import json
import platform
import re
import sys
from importlib import metadata
from pathlib import Path
from typing import Any
from urllib.parse import unquote_plus

import wols
from wols.crypto import (
    decrypt_specimen,
    decrypt_specimen_bytes,
    decrypt_specimen_fields,
    encrypt_specimen,
    encrypt_specimen_fields,
    parse_encrypted_url,
)

HERE = Path(__file__).resolve().parent
PREFIX = "wemush://v1/encrypted/"
MIN_GENERATE_ITERATIONS = 100_000
MAX_ITERATIONS = 10_000_000
FIELD_KEYS = {"encrypted", "algorithm", "payload", "iv", "kdf", "salt", "iterations"}
URL_PARAMS = {"e", "iv", "kdf", "salt", "i", "sig"}
# RFC 3986 pchar, minus '+' which WOLS 1.3.0 requires generators to encode.
_SEGMENT_RE = re.compile(r"(?:[A-Za-z0-9\-._~!$&'()*,;=:@]|%[0-9A-Fa-f]{2})+")
_B64URL_RE = re.compile(r"[A-Za-z0-9_-]*")


# ---------------------------------------------------------------------------
# helpers


def json_equal(a: Any, b: Any) -> bool:
    """Strict JSON equality: same types (True is not 1), same keys."""
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    if isinstance(a, int | float) and isinstance(b, int | float):
        return a == b
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(json_equal(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(
            json_equal(x, y) for x, y in zip(a, b, strict=True)
        )
    return type(a) is type(b) and a == b


def b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def canonical_b64(name: str, value: Any) -> bytes:
    """Canonical unpadded base64url (WOLS 1.3.0 generator rule)."""
    if (
        not isinstance(value, str)
        or not _B64URL_RE.fullmatch(value)
        or len(value) % 4 == 1
    ):
        raise AssertionError(f"{name} is not unpadded base64url: {value!r}")
    data = b64url_decode(value)
    if b64url_encode(data) != value:
        raise AssertionError(
            f"{name} is not canonical base64url (non-zero trailing bits): {value}"
        )
    return data


def percent_decode(segment: str) -> str:
    """Strict UTF-8 percent-decoding of a path segment; '+' is literal."""
    if re.search(r"%(?![0-9A-Fa-f]{2})", segment):
        raise AssertionError(f"malformed percent-escape in {segment}")
    out = bytearray()
    i = 0
    while i < len(segment):
        if segment[i] == "%":
            out.append(int(segment[i + 1 : i + 3], 16))
            i += 3
        else:
            out += segment[i].encode("utf-8")
            i += 1
    return out.decode("utf-8")


def iterations_in_range(n: Any) -> bool:
    return (
        isinstance(n, int)
        and not isinstance(n, bool)
        and MIN_GENERATE_ITERATIONS <= n <= MAX_ITERATIONS
    )


def decrypt_secret_of(secret: dict[str, Any]) -> dict[str, Any]:
    if secret["kdf"] == "raw":
        return {"kdf": "raw", "keyBase64url": secret["keyBase64url"]}
    return {
        "kdf": "pbkdf2",
        "passphrase": secret.get("decryptPassphrase", secret["passphrase"]),
    }


def lib_key(secret: dict[str, Any]) -> str | bytes:
    if secret["kdf"] == "raw":
        return b64url_decode(secret["keyBase64url"])
    return str(secret["passphrase"])


def lib_version() -> str:
    try:
        return metadata.version("wols")
    except metadata.PackageNotFoundError:
        return str(getattr(wols, "__version__", "unknown"))


# ---------------------------------------------------------------------------
# generate


def generate_case(c: dict[str, Any]) -> dict[str, Any]:
    inp = c["input"]
    encrypt_key = lib_key(inp["secret"])
    decrypt_secret = decrypt_secret_of(inp["secret"])
    decrypt_key = lib_key(decrypt_secret)
    kwargs: dict[str, Any] = {}
    if "iterations" in inp:
        kwargs["iterations"] = inp["iterations"]
    base = {
        "id": c["id"],
        "category": c["category"],
        "requirement": "MUST",
        "description": c["description"],
    }

    if c["operation"] == "encrypt":
        url = encrypt_specimen(
            wols.Specimen.from_dict(inp["specimen"]), encrypt_key, **kwargs
        )
        label = parse_encrypted_url(url)
        if "sig" in inp:
            url = dataclasses.replace(label, signature=inp["sig"]).to_url()

        # Self-check with the generator's own decoder; record its exact plaintext.
        plaintext = decrypt_specimen_bytes(url, decrypt_key).decode("utf-8")
        if not json_equal(json.loads(plaintext), inp["specimen"]):
            raise AssertionError(
                f"generator did not preserve the specimen: {plaintext}"
            )
        return {
            **base,
            "operation": "decrypt",
            "input": {"url": url, "secret": decrypt_secret},
            "expected": {
                "success": True,
                "id": inp["specimen"]["id"],
                "signature": inp.get("sig"),
                "kdf": label.payload.kdf,
                "iterations": label.payload.iterations,
                "plaintext": plaintext,
                "specimen": inp["specimen"],
            },
            "generatorInput": inp,
        }

    if c["operation"] == "encryptFields":
        data = encrypt_specimen_fields(
            inp["specimen"], encrypt_key, inp["fields"], **kwargs
        )
        first = data[inp["fields"][0]]
        restored = decrypt_specimen_fields(data, decrypt_key)
        if not json_equal(restored, inp["specimen"]):
            raise AssertionError(
                "generator self-check: restored label differs from input"
            )
        return {
            **base,
            "operation": "decryptFields",
            "input": {"specimen": data, "secret": decrypt_secret},
            "expected": {
                "success": True,
                "encryptedFields": inp["fields"],
                "kdf": first["kdf"],
                "iterations": first.get("iterations"),
                "specimen": inp["specimen"],
            },
            "generatorInput": inp,
        }

    raise AssertionError(f"unknown matrix operation {c['operation']!r}")


def generate(args: argparse.Namespace) -> int:
    matrix_text = Path(args.matrix).read_text(encoding="utf-8")
    matrix = json.loads(matrix_text)
    cases = []
    for c in matrix["cases"]:
        try:
            cases.append(generate_case(c))
        except Exception as e:
            raise SystemExit(f"[{c['id']}] {type(e).__name__}: {e}") from e
    corpus = {
        "format": "wols-interop-corpus",
        "formatVersion": 1,
        "wolsVersion": matrix["wolsVersion"],
        "description": (
            "Labels generated by one WOLS implementation from interop/matrix.json. "
            "Every implementation must decrypt each case and recover "
            "expected.plaintext (decrypt) or expected.specimen (decryptFields) "
            "exactly, and return expected.id and expected.signature from the URL."
        ),
        "specSection": matrix["specSection"],
        "generator": {
            "implementation": "wols",
            "version": lib_version(),
            "language": "python",
            "runtime": f"{platform.python_implementation()} {platform.python_version()}",
        },
        "matrixSha256": hashlib.sha256(matrix_text.encode("utf-8")).hexdigest(),
        "cases": cases,
    }
    Path(args.out).write_text(
        json.dumps(corpus, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"generated {len(cases)} cases with wols {lib_version()} -> {args.out}")
    return 0


# ---------------------------------------------------------------------------
# verify: generator-side wire rules (independent of the library under test)


def check_url_wire(c: dict[str, Any]) -> None:
    url: str = c["input"]["url"]
    expected = c["expected"]
    if not url.startswith(PREFIX):
        raise AssertionError(f"URL must start with {PREFIX}")
    rest = url[len(PREFIX) :]
    if "?" not in rest:
        raise AssertionError("URL has no query")
    segment, query = rest.split("?", 1)
    if not _SEGMENT_RE.fullmatch(segment):
        raise AssertionError(
            f"ID segment is not a single, fully percent-encoded path segment: {segment}"
        )
    if f"wemush:{percent_decode(segment)}" != expected["id"]:
        raise AssertionError(
            f"ID segment {segment} does not decode to {expected['id']!r}"
        )
    params: dict[str, str] = {}
    for pair in query.split("&"):
        key, _, value = pair.partition("=")
        if key not in URL_PARAMS:
            raise AssertionError(f"unexpected URL parameter {key!r}")
        if key in params:
            raise AssertionError(f"duplicate URL parameter {key!r}")
        params[key] = value
    kdf = params.get("kdf")
    if kdf != c["input"]["secret"]["kdf"] or kdf != expected["kdf"]:
        raise AssertionError(f"kdf={kdf}, expected {c['input']['secret']['kdf']}")
    if len(canonical_b64("e", params.get("e"))) < 16:
        raise AssertionError("e is shorter than the GCM tag")
    if len(canonical_b64("iv", params.get("iv"))) != 12:
        raise AssertionError("iv is not 12 bytes")
    if kdf == "pbkdf2":
        if len(canonical_b64("salt", params.get("salt"))) < 16:
            raise AssertionError("salt is shorter than 16 bytes")
        i = params.get("i", "")
        if not re.fullmatch(r"[1-9][0-9]*", i):
            raise AssertionError(f"i is not plain decimal digits: {i!r}")
        if int(i) != expected["iterations"] or not iterations_in_range(int(i)):
            raise AssertionError(
                f"i={i}, expected {expected['iterations']} within 100,000..10,000,000"
            )
        requested = c.get("generatorInput", {}).get("iterations")
        if requested is not None and int(i) != requested:
            raise AssertionError(f"i={i}, but the matrix requested {requested}")
    elif "salt" in params or "i" in params:
        raise AssertionError("kdf=raw URL carries salt or i")
    sig = params.get("sig")
    sig_decoded = None if sig is None else unquote_plus(sig, errors="strict")
    if sig_decoded != expected["signature"]:
        raise AssertionError(
            f"sig decodes to {sig_decoded!r}, expected {expected['signature']!r}"
        )


def check_fields_wire(c: dict[str, Any]) -> None:
    label: dict[str, Any] = c["input"]["specimen"]
    original: dict[str, Any] = c["expected"]["specimen"]
    encrypted = set(c["expected"]["encryptedFields"])
    for name, value in original.items():
        if name not in encrypted and not json_equal(label.get(name), value):
            raise AssertionError(f"cleartext field {name!r} was changed")
    if sorted(label) != sorted(original):
        raise AssertionError(
            "field-encrypted label does not have the same fields as the input"
        )
    requested = c.get("generatorInput", {}).get("iterations")
    for name in encrypted:
        f = label[name]
        if not isinstance(f, dict) or f.get("encrypted") is not True:
            raise AssertionError(f"field {name!r} is not an encryption object")
        extra = set(f) - FIELD_KEYS
        if extra:
            raise AssertionError(
                f"field {name!r} has unexpected members {sorted(extra)}"
            )
        if f.get("algorithm") != "AES-256-GCM":
            raise AssertionError(f"field {name!r} algorithm {f.get('algorithm')!r}")
        if f.get("kdf") != c["input"]["secret"]["kdf"]:
            raise AssertionError(f"field {name!r} kdf {f.get('kdf')!r}")
        if len(canonical_b64(f"{name}.payload", f.get("payload"))) < 16:
            raise AssertionError(f"{name}.payload too short")
        if len(canonical_b64(f"{name}.iv", f.get("iv"))) != 12:
            raise AssertionError(f"{name}.iv is not 12 bytes")
        if f["kdf"] == "pbkdf2":
            if len(canonical_b64(f"{name}.salt", f.get("salt"))) < 16:
                raise AssertionError(f"{name}.salt too short")
            n = f.get("iterations")
            if not iterations_in_range(n) or n != c["expected"]["iterations"]:
                raise AssertionError(
                    f"{name}.iterations={n!r}, expected {c['expected']['iterations']}"
                )
            if requested is not None and n != requested:
                raise AssertionError(
                    f"{name}.iterations={n}, but the matrix requested {requested}"
                )
        elif "salt" in f or "iterations" in f:
            raise AssertionError(f"kdf=raw field {name!r} carries salt or iterations")


# ---------------------------------------------------------------------------
# verify: decryption with the library under test


def verify_case(c: dict[str, Any]) -> None:
    key = lib_key(c["input"]["secret"])
    expected = c["expected"]
    if c["operation"] == "decrypt":
        check_url_wire(c)
        url = c["input"]["url"]
        label = parse_encrypted_url(url)
        if label.specimen_id != expected["id"]:
            raise AssertionError(
                f"parsed id {label.specimen_id!r}, expected {expected['id']!r}"
            )
        if label.signature != expected["signature"]:
            raise AssertionError(
                f"parsed sig {label.signature!r}, expected {expected['signature']!r}"
            )
        plaintext = decrypt_specimen_bytes(url, key)
        if plaintext != expected["plaintext"].encode("utf-8"):
            raise AssertionError("decrypted plaintext differs from expected.plaintext")
        if not json_equal(json.loads(plaintext), expected["specimen"]):
            raise AssertionError("decrypted specimen differs from expected.specimen")
        specimen = decrypt_specimen(url, key)
        if specimen.id != expected["id"]:
            raise AssertionError(f"decrypt_specimen id {specimen.id!r}")
        return
    if c["operation"] == "decryptFields":
        check_fields_wire(c)
        restored = decrypt_specimen_fields(c["input"]["specimen"], key)
        if not json_equal(restored, expected["specimen"]):
            raise AssertionError(
                "restored label differs from expected.specimen:\n"
                f"  got      {json.dumps(restored, ensure_ascii=False)}\n"
                f"  expected {json.dumps(expected['specimen'], ensure_ascii=False)}"
            )
        # The restored label must also load as a Specimen.
        wols.Specimen.from_dict(restored)
        return
    raise AssertionError(f"unknown corpus operation {c['operation']!r}")


def verify(args: argparse.Namespace) -> int:
    failures = 0
    for file in args.corpus:
        corpus = json.loads(Path(file).read_text(encoding="utf-8"))
        if (
            corpus.get("format") != "wols-interop-corpus"
            or corpus.get("formatVersion") != 1
        ):
            raise SystemExit(f"{file} is not a wols-interop-corpus v1 file")
        gen = corpus.get("generator", {})
        print(
            f"verify {file}: {len(corpus['cases'])} cases from "
            f"{gen.get('implementation')} {gen.get('version')} ({gen.get('language')}) "
            f"with wols {lib_version()}"
        )
        tallies: dict[str, list[int]] = {}
        for c in corpus["cases"]:
            tally = tallies.setdefault(c["category"], [0, 0])
            try:
                verify_case(c)
                tally[0] += 1
            except Exception as e:
                tally[1] += 1
                failures += 1
                print(f"  FAIL {c['id']}: {type(e).__name__}: {e}")
        for category, (ok, bad) in tallies.items():
            print(f"  {'ok  ' if bad == 0 else 'FAIL'} {category}: {ok}/{ok + bad}")
    if failures:
        print(f"{failures} case(s) failed")
        return 1
    print("all cases passed")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    g = sub.add_parser("generate")
    g.add_argument("--matrix", default=str(HERE / "matrix.json"))
    g.add_argument("--out", required=True)
    v = sub.add_parser("verify")
    v.add_argument("corpus", nargs="+")
    args = parser.parse_args()
    return generate(args) if args.command == "generate" else verify(args)


if __name__ == "__main__":
    sys.exit(main())
