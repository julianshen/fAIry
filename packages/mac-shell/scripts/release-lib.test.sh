#!/usr/bin/env bash
# Unit tests for release-lib.sh (M6-3).
# Run: bash packages/mac-shell/scripts/release-lib.test.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/release-lib.sh"

FAILS=0
assert_eq() { # name expected actual
  if [ "$2" = "$3" ]; then echo "ok   $1"
  else echo "FAIL $1: expected [$2] got [$3]"; FAILS=$((FAILS + 1)); fi
}

# ── version_from_tag ─────────────────────────────────────────────────────────
assert_eq "strips the leading v"        "0.1.0"        "$(version_from_tag v0.1.0)"
assert_eq "non-v ref passes through"    "0.2.0"        "$(version_from_tag 0.2.0)"
assert_eq "only the prefix is stripped" "1.0.0-rc.v2"  "$(version_from_tag v1.0.0-rc.v2)"

# ── appcast_extra_args ───────────────────────────────────────────────────────
unset FAIRY_SPARKLE_PRIVATE_KEY_FILE FAIRY_DOWNLOAD_URL_PREFIX 2>/dev/null || true

appcast_extra_args
assert_eq "no seams → no args" "0" "${#APPCAST_EXTRA_ARGS[@]}"

export FAIRY_SPARKLE_PRIVATE_KEY_FILE=/tmp/sparkle.key
appcast_extra_args
assert_eq "key file → --ed-key-file" \
  "--ed-key-file /tmp/sparkle.key" "${APPCAST_EXTRA_ARGS[*]}"
unset FAIRY_SPARKLE_PRIVATE_KEY_FILE

export FAIRY_DOWNLOAD_URL_PREFIX=https://example.com/dl/
appcast_extra_args
assert_eq "prefix → --download-url-prefix" \
  "--download-url-prefix https://example.com/dl/" "${APPCAST_EXTRA_ARGS[*]}"

export FAIRY_SPARKLE_PRIVATE_KEY_FILE=/tmp/sparkle.key
appcast_extra_args
assert_eq "both seams, stable order" \
  "--ed-key-file /tmp/sparkle.key --download-url-prefix https://example.com/dl/" \
  "${APPCAST_EXTRA_ARGS[*]}"
unset FAIRY_SPARKLE_PRIVATE_KEY_FILE FAIRY_DOWNLOAD_URL_PREFIX

if [ "$FAILS" -gt 0 ]; then echo "$FAILS failure(s)"; exit 1; fi
echo "all release-lib tests passed"
