#!/usr/bin/env bash
# Code-sign Fairy.app inside-out with the Developer ID Application identity (M5-5c).
# Requires $DEVELOPER_ID_APP (e.g. "Developer ID Application: Your Name (TEAMID)")
# present in the keychain. Run AFTER package.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHELL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP="$SHELL_DIR/dist/Fairy.app"

: "${DEVELOPER_ID_APP:?set DEVELOPER_ID_APP to your 'Developer ID Application: …' identity}"
[ -d "$APP" ] || { echo "no $APP — run scripts/package.sh first" >&2; exit 1; }

sign() { codesign --force --options runtime --timestamp --sign "$DEVELOPER_ID_APP" "$@"; }

FW="$APP/Contents/Frameworks/Sparkle.framework"
V="$FW/Versions/B"

echo "==> signing Sparkle's nested components (inside-out)"
sign "$V/XPCServices/Downloader.xpc"
sign "$V/XPCServices/Installer.xpc"
sign "$V/Updater.app"
sign "$V/Autoupdate"
sign "$FW"

echo "==> signing the daemon + the panel resource bundle"
sign "$APP/Contents/Resources/fairy-daemon"
for b in "$APP"/*.bundle; do [ -e "$b" ] && sign "$b"; done

echo "==> signing the app (last)"
sign "$APP"

echo "==> verifying the signature"
codesign --verify --deep --strict --verbose=2 "$APP"
echo "==> Gatekeeper assessment (only fully passes after notarization):"
spctl -a -t exec -vvv "$APP" || true
echo "==> signed $APP"
