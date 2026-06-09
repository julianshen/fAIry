#!/usr/bin/env bash
# Assemble an (unsigned) Fairy.app from the release shell, the compiled daemon, and
# the daemon's runtime assets + the panel. Signing/notarization/DMG are M5-5b.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHELL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"          # packages/mac-shell
ROOT="$(cd "$SHELL_DIR/../.." && pwd)"             # repo root
APP="$SHELL_DIR/dist/Fairy.app"
VERSION="${FAIRY_VERSION:-0.1.0}"

echo "==> building the panel (agent-panel)"
( cd "$ROOT/packages/agent-panel" && bun run build:shell )

echo "==> compiling the daemon (pi-daemon)"
( cd "$ROOT/packages/pi-daemon" && bun run build:compile )

echo "==> building the shell (release)"
( cd "$SHELL_DIR" && swift build -c release )
BIN="$(cd "$SHELL_DIR" && swift build -c release --show-bin-path)"

echo "==> assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cp "$BIN/fairy-shell" "$APP/Contents/MacOS/Fairy"
cp "$ROOT/packages/pi-daemon/dist/fairy-daemon" "$APP/Contents/Resources/fairy-daemon"
chmod +x "$APP/Contents/Resources/fairy-daemon"
cp "$ROOT/packages/pi-daemon/pi-extension/browser-bridge.ts" "$APP/Contents/Resources/browser-bridge.ts"
cp -R "$ROOT/packages/pi-daemon/skills" "$APP/Contents/Resources/skills"

# The SPM panel resource bundle. The generated Bundle.module accessor looks at
# Bundle.main.bundleURL — the .app ROOT — so the bundle must sit there, NOT in
# Contents/Resources (otherwise the shipped app falls back to a build-dir path
# that doesn't exist on other machines, and fatalErrors).
shopt -s nullglob
for b in "$BIN"/*.bundle; do cp -R "$b" "$APP/"; done
shopt -u nullglob

# Embed Sparkle.framework (its XPC services live inside) so the app can load it,
# and add the Frameworks rpath to the main binary. Signing the embedded framework
# is sign.sh (M5-5c).
SPARKLE_FW="$SHELL_DIR/.build/artifacts/sparkle/Sparkle/Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework"
[ -d "$SPARKLE_FW" ] || { echo "ERROR: Sparkle.framework not at $SPARKLE_FW — run 'swift build -c release' first." >&2; exit 1; }
mkdir -p "$APP/Contents/Frameworks"
# ditto (not cp -R) preserves the framework's symlinks/xattrs exactly — important
# before code-signing.
ditto "$SPARKLE_FW" "$APP/Contents/Frameworks/Sparkle.framework"
if ! otool -l "$APP/Contents/MacOS/Fairy" | grep -q "@executable_path/../Frameworks"; then
  install_name_tool -add_rpath "@executable_path/../Frameworks" "$APP/Contents/MacOS/Fairy"
fi

# Info.plist: version via sed (safe — dotted digits), then the Sparkle feed/key via
# PlistBuddy so a URL query string (`&`, `|`, …) can't corrupt a sed replacement.
FEED="${FAIRY_UPDATE_FEED_URL:-https://EXAMPLE-REPLACE-IN-5C.invalid/appcast.xml}"
PUBKEY="${FAIRY_SPARKLE_PUBLIC_KEY:-REPLACE-WITH-EDDSA-PUBLIC-KEY-IN-5C}"
sed "s/@VERSION@/$VERSION/g" "$SCRIPT_DIR/Info.plist" > "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :SUFeedURL $FEED" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :SUPublicEDKey $PUBKEY" "$APP/Contents/Info.plist"

echo "==> built $APP (unsigned — sign with scripts/sign.sh)"
