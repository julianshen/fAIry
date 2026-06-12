#!/usr/bin/env bash
# Wiring test: appcast.sh forwards the env seams to generate_appcast (M6-3).
# Run: bash packages/mac-shell/scripts/appcast-wiring.test.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
touch "$TMP/Fairy-0.0.0.dmg"          # satisfies the "a .dmg exists" preflight
cat > "$TMP/gen-stub" <<'STUB'
#!/usr/bin/env bash
: "${RECORD:?}"
printf '%s\n' "$@" > "$RECORD"
STUB
chmod +x "$TMP/gen-stub"

FAILS=0
assert_eq() { # name expected actual
  if [ "$2" = "$3" ]; then echo "ok   $1"
  else echo "FAIL $1: expected [$2] got [$3]"; FAILS=$((FAILS + 1)); fi
}

# No seams → generate_appcast gets only the releases dir (local behavior intact).
RECORD="$TMP/argv1" FAIRY_GENERATE_APPCAST="$TMP/gen-stub" FAIRY_RELEASES_DIR="$TMP" \
  bash "$SCRIPT_DIR/appcast.sh" >/dev/null \
  || { echo "FAIL appcast.sh (no seams) exited $?" >&2; exit 1; }
expected="$(printf '%s\n' "$TMP")"
assert_eq "no seams → dir only" "$expected" "$(cat "$TMP/argv1")"

# Both seams → both flags precede the releases dir.
RECORD="$TMP/argv2" FAIRY_GENERATE_APPCAST="$TMP/gen-stub" FAIRY_RELEASES_DIR="$TMP" \
  FAIRY_SPARKLE_PRIVATE_KEY_FILE=/tmp/k FAIRY_DOWNLOAD_URL_PREFIX=https://x/dl/ \
  bash "$SCRIPT_DIR/appcast.sh" >/dev/null \
  || { echo "FAIL appcast.sh (both seams) exited $?" >&2; exit 1; }
expected="$(printf '%s\n' --ed-key-file /tmp/k --download-url-prefix https://x/dl/ "$TMP")"
assert_eq "both seams forwarded" "$expected" "$(cat "$TMP/argv2")"

if [ "$FAILS" -gt 0 ]; then echo "$FAILS failure(s)"; exit 1; fi
echo "all appcast wiring tests passed"
