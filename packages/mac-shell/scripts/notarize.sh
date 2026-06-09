#!/usr/bin/env bash
# Notarize + staple Fairy.app (M5-5c). Requires a stored notary profile:
#   xcrun notarytool store-credentials "<profile>" --apple-id <id> --team-id <team> --password <app-specific-pw>
# then export NOTARY_PROFILE=<profile>. Run AFTER package.sh + sign.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHELL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP="$SHELL_DIR/dist/Fairy.app"
ZIP="$SHELL_DIR/dist/Fairy.zip"

: "${NOTARY_PROFILE:?set NOTARY_PROFILE to your notarytool keychain profile name}"
[ -d "$APP" ] || { echo "no $APP — run scripts/package.sh + sign.sh first" >&2; exit 1; }

echo "==> zipping for submission"
ditto -c -k --keepParent "$APP" "$ZIP"

echo "==> submitting to the Apple notary service (waits for the result)"
xcrun notarytool submit "$ZIP" --keychain-profile "$NOTARY_PROFILE" --wait

echo "==> stapling the ticket"
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"

rm -f "$ZIP"
echo "==> notarized + stapled $APP"
