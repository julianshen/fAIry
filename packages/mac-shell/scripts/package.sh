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

# The SPM panel resource bundle, so Bundle.module resolves the panel inside the .app.
shopt -s nullglob
for b in "$BIN"/*.bundle; do cp -R "$b" "$APP/Contents/Resources/"; done
shopt -u nullglob

sed "s/@VERSION@/$VERSION/g" "$SCRIPT_DIR/Info.plist" > "$APP/Contents/Info.plist"

echo "==> built $APP (unsigned)"
