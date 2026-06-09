# macOS shell — release pipeline (M5-5c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A modular release pipeline — `package.sh` (embed Sparkle + rpath + bake feed/key), `sign.sh`, `notarize.sh`, `dmg.sh`, `appcast.sh`, `release.sh` (orchestrator), `RELEASE.md` (runbook) — that the user runs with their Apple Developer credentials to produce a signed, notarized, auto-updating `Fairy.app` + DMG + appcast.

**Architecture:** Stage scripts under `packages/mac-shell/scripts/`, secrets via env/keychain only. `package.sh` is extended to embed `Sparkle.framework` + add the Frameworks rpath (closing the 5b deferral). Nothing functional runs in this environment.

**Tech Stack:** Bash, `codesign`, `xcrun notarytool`/`stapler`, `hdiutil`, Sparkle's `generate_appcast` (from the resolved SPM artifact). Run `swift`/scripts from `packages/mac-shell/`.

**Spec:** `docs/superpowers/specs/2026-06-10-mac-shell-release-pipeline-design.md`.

**VERIFICATION BOUNDARY — read this:** No certificates, notarization credentials, or EdDSA key exist in this environment, and the GUI can't launch. So the per-task "verification" is **`bash -n` (syntax; `shellcheck` is NOT installed)** plus, for the two tasks that touch `package.sh`, a structural re-run (`Sparkle.framework` embedded, rpath present via `otool -l`, Info.plist lints). **Every functional step — `codesign`, `notarytool`, `stapler`, `generate_appcast`, the live update — is the user's manual run.** Do NOT attempt to run `sign.sh`/`notarize.sh`/`dmg.sh`/`appcast.sh` here; they will (correctly) fail-fast on the missing env vars. "Done" = authored + `bash -n`-clean + matches the script bodies below.

Confirmed paths (this repo): `Sparkle.framework` = `packages/mac-shell/.build/artifacts/sparkle/Sparkle/Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework`; its signables = `Versions/B/XPCServices/{Downloader,Installer}.xpc`, `Versions/B/Updater.app`, `Versions/B/Autoupdate`; `generate_appcast` = `packages/mac-shell/.build/artifacts/sparkle/Sparkle/bin/generate_appcast`.

Commit trailer MUST be EXACTLY (use `git commit -F -` heredoc):
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: `package.sh` embeds Sparkle + rpath; Info.plist tokenizes feed/key

**Files:**
- Modify: `packages/mac-shell/scripts/Info.plist` (tokenize `SUFeedURL`/`SUPublicEDKey`)
- Modify: `packages/mac-shell/scripts/package.sh` (embed Sparkle + rpath; multi-token Info.plist substitution; drop the 5b warning)

- [ ] **Step 1: Tokenize the Info.plist feed/key**

In `packages/mac-shell/scripts/Info.plist`, replace the two 5b placeholder value lines:

```xml
  <key>SUFeedURL</key><string>https://EXAMPLE-REPLACE-IN-5C.invalid/appcast.xml</string>
  <key>SUPublicEDKey</key><string>REPLACE-WITH-EDDSA-PUBLIC-KEY-IN-5C</string>
```

with tokens that `package.sh` substitutes:

```xml
  <key>SUFeedURL</key><string>@SUFeedURL@</string>
  <key>SUPublicEDKey</key><string>@SUPublicEDKey@</string>
```

(Leave the `SUEnableAutomaticChecks` line and the comment above them unchanged.)

- [ ] **Step 2: Embed Sparkle + rpath + multi-token substitution in `package.sh`**

In `packages/mac-shell/scripts/package.sh`, replace everything from the Info.plist `sed` line to the end of the file:

```bash
sed "s/@VERSION@/$VERSION/g" "$SCRIPT_DIR/Info.plist" > "$APP/Contents/Info.plist"

echo "==> built $APP (unsigned)"
echo "==> WARNING: Sparkle.framework is NOT embedded — this .app will NOT launch yet."
echo "             Embedding Sparkle (+ its XPC services) into Contents/Frameworks and"
echo "             code-signing are M5-5c. Until then this bundle is for structure only."
```

with:

```bash
# Embed Sparkle.framework (its XPC services live inside) so the app can load it,
# and add the Frameworks rpath to the main binary. Signing the embedded framework
# is sign.sh (M5-5c).
SPARKLE_FW="$SHELL_DIR/.build/artifacts/sparkle/Sparkle/Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework"
if [ -d "$SPARKLE_FW" ]; then
  mkdir -p "$APP/Contents/Frameworks"
  cp -R "$SPARKLE_FW" "$APP/Contents/Frameworks/"
  if ! otool -l "$APP/Contents/MacOS/Fairy" | grep -q "@executable_path/../Frameworks"; then
    install_name_tool -add_rpath "@executable_path/../Frameworks" "$APP/Contents/MacOS/Fairy"
  fi
else
  echo "WARNING: Sparkle.framework not at $SPARKLE_FW — run 'swift build -c release' first." >&2
fi

# Info.plist: version + the Sparkle feed/key (from env, else the placeholders).
FEED="${FAIRY_UPDATE_FEED_URL:-https://EXAMPLE-REPLACE-IN-5C.invalid/appcast.xml}"
PUBKEY="${FAIRY_SPARKLE_PUBLIC_KEY:-REPLACE-WITH-EDDSA-PUBLIC-KEY-IN-5C}"
sed -e "s/@VERSION@/$VERSION/g" \
    -e "s|@SUFeedURL@|$FEED|g" \
    -e "s|@SUPublicEDKey@|$PUBKEY|g" \
    "$SCRIPT_DIR/Info.plist" > "$APP/Contents/Info.plist"

echo "==> built $APP (unsigned — sign with scripts/sign.sh)"
```

- [ ] **Step 3: Re-run the pipeline + assert the new structure**

Run from the repo root:
```bash
bash packages/mac-shell/scripts/package.sh 2>&1 | tail -3
APP=packages/mac-shell/dist/Fairy.app
test -d "$APP/Contents/Frameworks/Sparkle.framework" && echo "ok: Sparkle embedded"
otool -l "$APP/Contents/MacOS/Fairy" | grep -q "@executable_path/../Frameworks" && echo "ok: rpath present"
plutil -lint "$APP/Contents/Info.plist" && echo "ok: Info.plist lints"
/usr/libexec/PlistBuddy -c 'Print :SUFeedURL' "$APP/Contents/Info.plist"   # placeholder when env unset
```
Expected: all `ok:` print; `SUFeedURL` shows the placeholder (env unset). (`bash -n packages/mac-shell/scripts/package.sh` should also pass.)

- [ ] **Step 4: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/scripts/package.sh packages/mac-shell/scripts/Info.plist
git commit -F - <<'MSG'
build(mac-shell): package.sh embeds Sparkle.framework + rpath; tokenize feed/key

Closes the 5b deferral: Sparkle.framework (with its XPC services) is copied into
Contents/Frameworks and the Frameworks rpath is added, so the .app can load it.
SUFeedURL/SUPublicEDKey are now baked from env (FAIRY_UPDATE_FEED_URL /
FAIRY_SPARKLE_PUBLIC_KEY), falling back to placeholders. Signing is sign.sh.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 2: `sign.sh` — inside-out code signing

**Files:**
- Create: `packages/mac-shell/scripts/sign.sh`

- [ ] **Step 1: Create `sign.sh`**

```bash
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
```

- [ ] **Step 2: Make it executable + syntax-check**

```bash
chmod +x packages/mac-shell/scripts/sign.sh
bash -n packages/mac-shell/scripts/sign.sh && echo "ok: sign.sh syntax"
```
(Do NOT run it — it fail-fasts on the missing `$DEVELOPER_ID_APP`, by design.)

- [ ] **Step 3: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/scripts/sign.sh
git commit -F - <<'MSG'
build(mac-shell): sign.sh — inside-out Developer ID code signing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 3: `notarize.sh` — notarize + staple the app

**Files:**
- Create: `packages/mac-shell/scripts/notarize.sh`

- [ ] **Step 1: Create `notarize.sh`**

```bash
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
```

- [ ] **Step 2: Make it executable + syntax-check**

```bash
chmod +x packages/mac-shell/scripts/notarize.sh
bash -n packages/mac-shell/scripts/notarize.sh && echo "ok: notarize.sh syntax"
```

- [ ] **Step 3: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/scripts/notarize.sh
git commit -F - <<'MSG'
build(mac-shell): notarize.sh — notarytool submit + staple

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 4: `dmg.sh` — build + sign + notarize the DMG

**Files:**
- Create: `packages/mac-shell/scripts/dmg.sh`

- [ ] **Step 1: Create `dmg.sh`**

```bash
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
```

- [ ] **Step 2: Make it executable + syntax-check**

```bash
chmod +x packages/mac-shell/scripts/dmg.sh
bash -n packages/mac-shell/scripts/dmg.sh && echo "ok: dmg.sh syntax"
```

- [ ] **Step 3: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/scripts/dmg.sh
git commit -F - <<'MSG'
build(mac-shell): dmg.sh — build, sign, notarize + staple the DMG

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 5: `appcast.sh` — generate the Sparkle appcast

**Files:**
- Create: `packages/mac-shell/scripts/appcast.sh`

- [ ] **Step 1: Create `appcast.sh`**

```bash
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
```

- [ ] **Step 2: Make it executable + syntax-check**

```bash
chmod +x packages/mac-shell/scripts/appcast.sh
bash -n packages/mac-shell/scripts/appcast.sh && echo "ok: appcast.sh syntax"
```

- [ ] **Step 3: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/scripts/appcast.sh
git commit -F - <<'MSG'
build(mac-shell): appcast.sh — EdDSA-signed Sparkle appcast via generate_appcast

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 6: `release.sh` — orchestrator with preflight

**Files:**
- Create: `packages/mac-shell/scripts/release.sh`

- [ ] **Step 1: Create `release.sh`**

```bash
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
```

- [ ] **Step 2: Make it executable + syntax-check**

```bash
chmod +x packages/mac-shell/scripts/release.sh
bash -n packages/mac-shell/scripts/release.sh && echo "ok: release.sh syntax"
```

- [ ] **Step 3: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/scripts/release.sh
git commit -F - <<'MSG'
build(mac-shell): release.sh — orchestrate package/sign/notarize/dmg/appcast

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 7: `RELEASE.md` — the runbook

**Files:**
- Create: `packages/mac-shell/scripts/RELEASE.md`

- [ ] **Step 1: Create `RELEASE.md`**

````markdown
# Releasing Fairy (macOS)

Produces a **signed, notarized, auto-updating** `Fairy.app` + a DMG + a Sparkle `appcast.xml`.
Everything here runs on **your** Mac with **your** Apple Developer account — no secret is stored in the repo.

> Heads-up: M5-5c does NOT bundle the Pi agent. The released app still expects `pi` on the user's `PATH`
> (bundling Pi is M6). The daemon is bundled (`fairy-daemon`); Pi is not.

## One-time prerequisites

1. **Apple Developer account** + a **Developer ID Application** certificate, imported into your login keychain.
   Find its identity string:
   ```bash
   security find-identity -v -p codesigning   # copy the "Developer ID Application: Name (TEAMID)" line
   ```
2. **A notarytool keychain profile** (stores your Apple ID + team + app-specific password):
   ```bash
   xcrun notarytool store-credentials "fairy-notary" \
     --apple-id "you@example.com" --team-id "TEAMID" --password "app-specific-password"
   ```
3. **A Sparkle EdDSA keypair** (private key goes into your keychain; copy the printed public key):
   ```bash
   ./packages/mac-shell/.build/artifacts/sparkle/Sparkle/bin/generate_keys
   # → prints an SUPublicEDKey value; keep it for FAIRY_SPARKLE_PUBLIC_KEY
   ```
   (Run `swift build -c release` once from `packages/mac-shell` first so Sparkle's tools are resolved.)
4. **A host** for the appcast + DMG (e.g. `https://downloads.example.com/fairy/`). The appcast URL becomes `FAIRY_UPDATE_FEED_URL`.

## Environment

```bash
export FAIRY_VERSION="0.1.0"
export DEVELOPER_ID_APP="Developer ID Application: Your Name (TEAMID)"
export NOTARY_PROFILE="fairy-notary"
export FAIRY_UPDATE_FEED_URL="https://downloads.example.com/fairy/appcast.xml"
export FAIRY_SPARKLE_PUBLIC_KEY="<the SUPublicEDKey from generate_keys>"
```

## Run it

End-to-end:
```bash
bash packages/mac-shell/scripts/release.sh
```

Or stage-by-stage (to retry a single failing stage):
```bash
bash packages/mac-shell/scripts/package.sh    # assemble Fairy.app: shell + daemon + assets + Sparkle embedded
bash packages/mac-shell/scripts/sign.sh       # inside-out Developer ID signing (hardened runtime)
bash packages/mac-shell/scripts/notarize.sh   # notarytool submit --wait + staple
bash packages/mac-shell/scripts/dmg.sh        # build + sign + notarize the DMG
bash packages/mac-shell/scripts/appcast.sh    # EdDSA-signed appcast.xml
```

Outputs land in `packages/mac-shell/dist/`: `Fairy.app`, `Fairy-$FAIRY_VERSION.dmg`, `appcast.xml`.

## Verify

```bash
codesign --verify --deep --strict --verbose=2 packages/mac-shell/dist/Fairy.app
spctl -a -t exec -vvv packages/mac-shell/dist/Fairy.app          # "accepted ... Notarized Developer ID"
xcrun stapler validate packages/mac-shell/dist/Fairy.app
xcrun stapler validate packages/mac-shell/dist/Fairy-$FAIRY_VERSION.dmg
```

## Publish

Upload `Fairy-$FAIRY_VERSION.dmg` **and** `appcast.xml` to the host that serves `FAIRY_UPDATE_FEED_URL`.
Installed copies (with the matching `SUPublicEDKey`) then see the update via Sparkle's background check or
**Check for Updates…**.

## Troubleshooting

- **Notarization invalid** — `xcrun notarytool log <submission-id> --keychain-profile "$NOTARY_PROFILE"`.
  Common causes: a nested binary left unsigned, a signature without `--options runtime`, or a missing
  `--timestamp`. Fix, re-run `sign.sh`, then `notarize.sh`.
- **`spctl` rejects before notarization** — expected; it passes only after `notarize.sh` staples the ticket.
- **App won't launch (dyld: Sparkle)** — confirm `package.sh` embedded `Contents/Frameworks/Sparkle.framework`
  and the binary has the `@executable_path/../Frameworks` rpath (`otool -l dist/Fairy.app/Contents/MacOS/Fairy`).
- **Update not offered** — `SUFeedURL` must match where `appcast.xml` is hosted, and the installed app's
  `SUPublicEDKey` must match the key that signed the appcast.
````

- [ ] **Step 2: Lint the markdown links/structure (sanity)**

```bash
test -f packages/mac-shell/scripts/RELEASE.md && grep -q "store-credentials" packages/mac-shell/scripts/RELEASE.md && echo "ok: RELEASE.md present"
```

- [ ] **Step 3: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/scripts/RELEASE.md
git commit -F - <<'MSG'
docs(mac-shell): RELEASE.md — the signed/notarized release runbook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 8: Final verification sweep

**Files:** none (verification only)

- [ ] **Step 1: `bash -n` every script**

```bash
cd /Users/julianshen/prj/fAIry/packages/mac-shell/scripts
for s in package.sh sign.sh notarize.sh dmg.sh appcast.sh release.sh; do
  bash -n "$s" && echo "ok: $s" || echo "FAIL: $s"
done
```
Expected: every script prints `ok:`.

- [ ] **Step 2: Re-assert the `package.sh` structural output**

```bash
cd /Users/julianshen/prj/fAIry
bash packages/mac-shell/scripts/package.sh >/dev/null 2>&1
APP=packages/mac-shell/dist/Fairy.app
test -d "$APP/Contents/Frameworks/Sparkle.framework" && echo "ok: Sparkle embedded"
otool -l "$APP/Contents/MacOS/Fairy" | grep -q "@executable_path/../Frameworks" && echo "ok: rpath"
plutil -lint "$APP/Contents/Info.plist" >/dev/null && echo "ok: plist"
```
Expected: all three `ok:`.

- [ ] **Step 3: Confirm the Swift suite is untouched**

```bash
cd /Users/julianshen/prj/fAIry/packages/mac-shell && swift test 2>&1 | grep -E "Executed [0-9]+ tests" | tail -1
```
Expected: the existing total (78), 0 failures — 5c changed only scripts + the Info.plist template.

---

## Self-Review

**1. Spec coverage.**
- `package.sh` embeds Sparkle + rpath + bakes feed/key from env → Task 1 (closes the 5b deferral).
- `sign.sh` inside-out signing (XPC → framework → daemon/bundle → app, hardened runtime) → Task 2.
- `notarize.sh` (zip → notarytool --wait → staple) → Task 3.
- `dmg.sh` (build → sign → notarize + staple the DMG) → Task 4.
- `appcast.sh` (generate_appcast, EdDSA) → Task 5.
- `release.sh` orchestrator + preflight → Task 6.
- `RELEASE.md` runbook (prerequisites, env, run, verify, publish, troubleshoot) → Task 7.
- Secrets via env/keychain only; fail-fast on missing prerequisites → every script's `: "${VAR:?…}"` guards.
- Verification = `bash -n` + `package.sh` structural re-run; functional steps are the user's → Task 8 + the header boundary.
  No spec requirement is left without a task.

**2. Placeholder scan.** Every script + the Info.plist edit + `RELEASE.md` are shown complete. The Info.plist `@SUFeedURL@`/`@SUPublicEDKey@` are *substitution tokens* (the design), and the example identities/URLs in `RELEASE.md` are illustrative runbook values, not plan gaps. No "TBD"/"add validation"/"similar to Task N".

**3. Consistency.** Env var names are identical across scripts and `RELEASE.md`: `FAIRY_VERSION`, `DEVELOPER_ID_APP`, `NOTARY_PROFILE`, `FAIRY_UPDATE_FEED_URL`, `FAIRY_SPARKLE_PUBLIC_KEY`, `FAIRY_RELEASES_DIR`. The Info.plist tokens `@SUFeedURL@`/`@SUPublicEDKey@` (Task 1 step 1) match `package.sh`'s `sed` (Task 1 step 2). The `Sparkle.framework` path + its nested signables in `sign.sh` (Task 2) match the embed source in `package.sh` (Task 1) and the confirmed repo layout. `dist/Fairy.app` / `dist/Fairy-$VERSION.dmg` / `dist/appcast.xml` paths are consistent across `sign.sh`/`notarize.sh`/`dmg.sh`/`appcast.sh`/`release.sh`/`RELEASE.md`. `generate_appcast` path in `appcast.sh` matches the confirmed artifact location.
