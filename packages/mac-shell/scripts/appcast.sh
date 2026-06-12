#!/usr/bin/env bash
# Generate the Sparkle appcast (EdDSA-signed) over the releases dir (M5-5c).
# Locally the EdDSA key lives in the keychain (generate_keys put it there). In CI
# set FAIRY_SPARKLE_PRIVATE_KEY_FILE (an EdDSA key file) and
# FAIRY_DOWNLOAD_URL_PREFIX (the URL the .dmg is served from) — see RELEASE.md.
# Run AFTER dmg.sh. Uses the generate_appcast from the resolved Sparkle SPM artifact.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHELL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=release-lib.sh
source "$SCRIPT_DIR/release-lib.sh"
GEN="${FAIRY_GENERATE_APPCAST:-$SHELL_DIR/.build/artifacts/sparkle/Sparkle/bin/generate_appcast}"
RELEASES="${FAIRY_RELEASES_DIR:-$SHELL_DIR/dist}"   # dir holding Fairy-<version>.dmg

[ -x "$GEN" ] || { echo "generate_appcast not at $GEN — run 'swift build' to resolve Sparkle" >&2; exit 1; }
ls "$RELEASES"/*.dmg >/dev/null 2>&1 || { echo "no .dmg in $RELEASES — run scripts/dmg.sh first" >&2; exit 1; }

appcast_extra_args
echo "==> generating the appcast over $RELEASES"
# bash 3.2: guard the empty-array expansion under set -u.
"$GEN" ${APPCAST_EXTRA_ARGS[@]+"${APPCAST_EXTRA_ARGS[@]}"} "$RELEASES"

echo "==> wrote $RELEASES/appcast.xml"
echo "==> upload $RELEASES/appcast.xml + the .dmg to the host that backs SUFeedURL."
