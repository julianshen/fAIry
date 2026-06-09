#!/usr/bin/env bash
# Generate the Sparkle appcast (EdDSA-signed) over the releases dir (M5-5c).
# The EdDSA private key must be in the keychain (Sparkle's generate_keys put it there).
# Run AFTER dmg.sh. Uses the generate_appcast from the resolved Sparkle SPM artifact.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHELL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GEN="$SHELL_DIR/.build/artifacts/sparkle/Sparkle/bin/generate_appcast"
RELEASES="${FAIRY_RELEASES_DIR:-$SHELL_DIR/dist}"   # dir holding Fairy-<version>.dmg

[ -x "$GEN" ] || { echo "generate_appcast not at $GEN — run 'swift build' to resolve Sparkle" >&2; exit 1; }
ls "$RELEASES"/*.dmg >/dev/null 2>&1 || { echo "no .dmg in $RELEASES — run scripts/dmg.sh first" >&2; exit 1; }

echo "==> generating the appcast over $RELEASES"
"$GEN" "$RELEASES"

echo "==> wrote $RELEASES/appcast.xml"
echo "==> upload $RELEASES/appcast.xml + the .dmg to the host that backs SUFeedURL."
