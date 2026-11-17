#!/usr/bin/env bash
# WOLS cross-library round trip: TypeScript <-> Python.
# Kept identical in wemush/specimen-labels-js and wemush/specimen-labels-py.
#
#   interop/roundtrip.sh <@wemush/wols package dir> <python with wols[crypto]> [out dir]
#
# Each library encrypts interop/matrix.json into a corpus; each library then
# verifies both corpora (its own, and the other library's). Any mismatch
# fails the script.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
js_lib="${1:?usage: roundtrip.sh <js package dir> <python> [out dir]}"
python="${2:?usage: roundtrip.sh <js package dir> <python> [out dir]}"
out="${3:-$(mktemp -d)}"
mkdir -p "$out"

node "$here/wols-interop.mjs" generate --lib "$js_lib" --matrix "$here/matrix.json" --out "$out/corpus-ts.json"
"$python" "$here/wols_interop.py" generate --matrix "$here/matrix.json" --out "$out/corpus-py.json"

status=0
echo "== TS -> Python"
"$python" "$here/wols_interop.py" verify "$out/corpus-ts.json" || status=1
echo "== Python -> TS"
node "$here/wols-interop.mjs" verify --lib "$js_lib" "$out/corpus-py.json" || status=1
echo "== Self round trips"
node "$here/wols-interop.mjs" verify --lib "$js_lib" "$out/corpus-ts.json" || status=1
"$python" "$here/wols_interop.py" verify "$out/corpus-py.json" || status=1

echo "corpora written to $out"
exit "$status"
