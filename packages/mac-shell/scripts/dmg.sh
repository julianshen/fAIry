#!/usr/bin/env bash
# Build, sign, notarize + staple a distribution DMG for Fairy.app (M5-5c).
# Run AFTER package.sh + sign.sh + notarize.sh (the app inside should be stapled).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHELL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP="$SHELL_DIR/dist/Fairy.app"
VERSION="${FAIRY_VERSION:-0.1.0}"
DMG="$SHELL_DIR/dist/Fairy-$VERSION.dmg"
STAGE="$SHELL_DIR/dist/dmg-stage"

: "${DEVELOPER_ID_APP:?set DEVELOPER_ID_APP}"
: "${NOTARY_PROFILE:?set NOTARY_PROFILE}"
[ -d "$APP" ] || { echo "no $APP — run scripts/package.sh + sign.sh + notarize.sh first" >&2; exit 1; }

echo "==> staging the DMG contents"
rm -rf "$STAGE" "$DMG"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

echo "==> creating $DMG"
hdiutil create -volname "Fairy" -srcfolder "$STAGE" -ov -format UDZO "$DMG"
rm -rf "$STAGE"

echo "==> signing the DMG"
codesign --force --timestamp --sign "$DEVELOPER_ID_APP" "$DMG"

echo "==> notarizing + stapling the DMG"
xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
xcrun stapler staple "$DMG"

echo "==> built $DMG"
