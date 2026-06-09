#!/usr/bin/env bash
# Full signed/notarized release of Fairy.app + DMG + appcast (M5-5c).
# Preflights the prerequisites, then runs the stages. See scripts/RELEASE.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${FAIRY_VERSION:?set FAIRY_VERSION (e.g. 0.1.0)}"
: "${DEVELOPER_ID_APP:?set DEVELOPER_ID_APP (your 'Developer ID Application: …' identity)}"
: "${NOTARY_PROFILE:?set NOTARY_PROFILE (your notarytool keychain profile)}"
: "${FAIRY_UPDATE_FEED_URL:?set FAIRY_UPDATE_FEED_URL (the URL your appcast.xml is served at)}"
: "${FAIRY_SPARKLE_PUBLIC_KEY:?set FAIRY_SPARKLE_PUBLIC_KEY (the public key from generate_keys)}"

echo "==> preflight: signing identity in the keychain?"
security find-identity -v -p codesigning | grep -q "$DEVELOPER_ID_APP" \
  || { echo "signing identity '$DEVELOPER_ID_APP' not found in the keychain" >&2; exit 1; }

echo "==> [1/5] package"; bash "$SCRIPT_DIR/package.sh"
echo "==> [2/5] sign";     bash "$SCRIPT_DIR/sign.sh"
echo "==> [3/5] notarize"; bash "$SCRIPT_DIR/notarize.sh"
echo "==> [4/5] dmg";      bash "$SCRIPT_DIR/dmg.sh"
echo "==> [5/5] appcast";  bash "$SCRIPT_DIR/appcast.sh"

echo "==> release complete."
echo "    Upload dist/Fairy-$FAIRY_VERSION.dmg + dist/appcast.xml to the host backing $FAIRY_UPDATE_FEED_URL"
