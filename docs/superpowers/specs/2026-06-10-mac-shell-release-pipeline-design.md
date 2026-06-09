# macOS shell — release pipeline (M5-5c) — design

**Status:** approved (design phase) · **Date:** 2026-06-10 · **Component:** `packages/mac-shell/scripts` · **Builds on:** the unsigned `Fairy.app` (M5-5a) + the Sparkle wiring (M5-5b) · **Part of:** M5 (macOS shell), sub-project 5 (packaging), **part c of (a, b, c)** — the final M5 piece.

## Context

M5-5a produced an unsigned `Fairy.app`; M5-5b wired Sparkle + launch-at-login but deliberately deferred *embedding* `Sparkle.framework` and all code-signing. This sub-project completes the release pipeline: embed Sparkle, code-sign (Developer ID), notarize + staple, build a DMG, and generate the EdDSA-signed Sparkle appcast — as modular scripts + a `release.sh` orchestrator + a `RELEASE.md` runbook the user runs with their Apple Developer credentials.

## Goal & non-goals

**Goal:** an authored, syntax-clean, doc-reviewed release pipeline — `package.sh` (embed Sparkle + rpath + bake feed/key), `sign.sh`, `notarize.sh`, `dmg.sh`, `appcast.sh`, `release.sh` (orchestrator), `RELEASE.md` (runbook) — that the user executes on a real Mac with their Apple account to produce a signed, notarized, auto-updating `Fairy.app` + DMG + appcast.

**Non-goals:** bundling the Pi agent (M6); a CI release workflow (later — the scripts are CI-ready but wiring GitHub Actions + secrets is out of scope); any change to the shell's Swift code or the FairyShell tests (5c touches only scripts + the Info.plist template).

**Verification boundary (the defining constraint):** I cannot run any of this here — there are no certificates, no notarization credentials, no EdDSA key, and the GUI can't be launched in this environment. So **"done" for 5c means authored + `bash -n`-clean + reviewed against Apple/Sparkle documentation, NOT executed.** The only things mechanically verified here are: each script parses (`bash -n`; `shellcheck` is not installed), and `package.sh`'s structural output (`Contents/Frameworks/Sparkle.framework` present, the main binary carries an `@executable_path/../Frameworks` rpath, the Info.plist lints). Every functional step — `codesign`, `notarytool`, `stapler`, `generate_appcast`, and the live auto-update — is the user's manual run, documented in `RELEASE.md`.

## Decisions (and why)

1. **Modular stage scripts + a `release.sh` orchestrator + a `RELEASE.md` runbook.** Each stage runs independently, so a mid-pipeline failure (notarization rejection, wrong signing identity) is retried at that stage, not from scratch. The orchestrator preflights prerequisites before any signing. Rejected: one mega-script (hard to retry a stage), runbook-only (no automation; the fiddly inside-out signing + rpath are error-prone by hand).
2. **Secrets only via env vars + the keychain — never the repo.** The Developer ID private key, notary credentials, and EdDSA private key live in the keychain; the signing-identity name, notary-profile name, host, and version come from env vars. No secret is committed. Scripts fail fast if a required env var or the keychain identity is absent.
3. **`package.sh` embeds Sparkle (closing the 5b deferral).** Embedding `Sparkle.framework` (its XPC services are inside it) into `Contents/Frameworks/` + adding the `@executable_path/../Frameworks` rpath is a packaging concern, so it lives in `package.sh` — which now produces a *complete* `.app` (launchable once signed). `sign.sh` then signs the embedded framework. The 5b "not embedded" warning is removed.
4. **Feed URL + public key baked at package time from env.** `package.sh`'s Info.plist generation substitutes `SUFeedURL`/`SUPublicEDKey` from `FAIRY_UPDATE_FEED_URL`/`FAIRY_SPARKLE_PUBLIC_KEY` (falling back to the 5b placeholders when unset), so a release build bakes in the real values without committing them.
5. **DMG as the distribution + update artifact.** Per the roadmap (DMG + update feed); `generate_appcast` consumes the signed/notarized DMG. (Sparkle could also update from a `.zip`; DMG is the chosen channel.)

## Architecture & components

All new/modified files live in `packages/mac-shell/scripts/`.

- **`package.sh`** (MODIFY) — after assembling the `.app`: copy `Sparkle.framework` (located from the release build's artifacts) into `Contents/Frameworks/`; `install_name_tool -add_rpath "@executable_path/../Frameworks" Contents/MacOS/Fairy` (idempotent — skip if already present); generate the Info.plist substituting `@VERSION@`, `SUFeedURL` (from `$FAIRY_UPDATE_FEED_URL`), `SUPublicEDKey` (from `$FAIRY_SPARKLE_PUBLIC_KEY`), each defaulting to the existing placeholder. Remove the "Sparkle not embedded" warning.
- **`sign.sh`** (NEW) — inside-out `codesign --force --options runtime --timestamp --sign "$DEVELOPER_ID_APP"`: Sparkle's nested helpers/XPC services (`Autoupdate`, `Updater.app`, `XPCServices/*`) → `Sparkle.framework` → `Contents/Resources/fairy-daemon` + the panel `.bundle` → the `.app` last. Then verify: `codesign --verify --deep --strict --verbose=2` and `spctl -a -t exec -vvv` (the latter only fully passes after notarization). Fails fast if `$DEVELOPER_ID_APP` is unset or not in the keychain.
- **`notarize.sh`** (NEW) — `ditto -c -k --keepParent Fairy.app Fairy.zip`; `xcrun notarytool submit Fairy.zip --keychain-profile "$NOTARY_PROFILE" --wait`; on success `xcrun stapler staple Fairy.app` + `stapler validate`. Fails fast if `$NOTARY_PROFILE` is unset.
- **`dmg.sh`** (NEW) — `hdiutil create` a DMG containing `Fairy.app` + an `/Applications` symlink (named `Fairy-$VERSION.dmg`); `codesign --sign "$DEVELOPER_ID_APP"` the DMG; `notarytool submit --wait` + `stapler staple` the DMG.
- **`appcast.sh`** (NEW) — run the SPM-resolved `generate_appcast` (`.build/artifacts/sparkle/Sparkle/bin/generate_appcast`) over a releases directory (containing the notarized `Fairy-$VERSION.dmg`), using the keychain EdDSA key, producing `appcast.xml` (+ delta updates). Print the upload reminder (DMG + `appcast.xml` → the host backing `SUFeedURL`).
- **`release.sh`** (NEW orchestrator) — preflight: assert `FAIRY_VERSION`, `DEVELOPER_ID_APP`, `NOTARY_PROFILE`, `FAIRY_UPDATE_FEED_URL`, `FAIRY_SPARKLE_PUBLIC_KEY` are set and the signing identity is in the keychain; then run `package.sh → sign.sh → notarize.sh → dmg.sh → appcast.sh`.
- **`RELEASE.md`** (NEW runbook) — prerequisites (Apple Developer account; Developer ID Application cert imported to the keychain; `xcrun notarytool store-credentials "<profile>"`; Sparkle `generate_keys` → private key in keychain, public key string for `SUPublicEDKey`; a host for `appcast.xml` + the DMG → `SUFeedURL`); the env vars; the `release.sh` invocation + the step-by-step alternative; per-stage verification commands (`codesign --verify`, `spctl`, `stapler validate`); and the upload step.

## Data flow

```text
one-time prerequisites:
  Developer ID Application cert → keychain
  xcrun notarytool store-credentials "$NOTARY_PROFILE"
  generate_keys → EdDSA keypair (private → keychain; public → $FAIRY_SPARKLE_PUBLIC_KEY)
  a host (https://…/appcast.xml) → $FAIRY_UPDATE_FEED_URL

release.sh (env: FAIRY_VERSION, DEVELOPER_ID_APP, NOTARY_PROFILE,
            FAIRY_UPDATE_FEED_URL, FAIRY_SPARKLE_PUBLIC_KEY):
  package.sh  → Fairy.app: Sparkle embedded (Contents/Frameworks), rpath set,
                 SUFeedURL/SUPublicEDKey baked from env
  sign.sh     → codesign inside-out (XPC → framework → daemon/bundle → .app), hardened runtime
  notarize.sh → zip → notarytool submit --wait → stapler staple Fairy.app
  dmg.sh      → Fairy-$VERSION.dmg → codesign → notarize + staple
  appcast.sh  → generate_appcast → appcast.xml (EdDSA-signed)
  [user] upload Fairy-$VERSION.dmg + appcast.xml → the host backing SUFeedURL
```

## Error handling

- **Missing prerequisite** — each script (and the orchestrator's preflight) fails fast with a clear message naming the missing env var / keychain identity / notary profile, before any irreversible step.
- **Notarization rejection** — `notarytool --wait` surfaces the status; `RELEASE.md` documents fetching the log (`notarytool log <id>`), the common causes (unsigned nested binary, missing hardened runtime, a non-timestamped signature), and re-running `sign.sh` then `notarize.sh`.
- **Signing identity ambiguity** — `sign.sh` requires an explicit `$DEVELOPER_ID_APP` (not auto-pick) so the wrong cert can't be silently used.
- **`set -euo pipefail`** in every script; the embed rpath step is idempotent (skip if the rpath already exists) so a re-run doesn't duplicate it.

## Testing / verification

- `bash -n` on every script (syntax; `shellcheck` unavailable in this env).
- Re-run `package.sh` and assert: `Contents/Frameworks/Sparkle.framework` exists; `otool -l Contents/MacOS/Fairy` shows the `@executable_path/../Frameworks` rpath; `plutil -lint` the generated Info.plist passes (with env unset, the placeholders remain — still lints).
- `RELEASE.md` reviewed for completeness against Apple's notarization + Sparkle's signing/appcast requirements.
- The FairyShell unit suite is unaffected (no Swift changes). **No functional step is executed here — that is the user's manual run, by design.**

## Sequencing

M5 sub-project 5, part c — the final M5 piece; completes the macOS shell milestone. After the user runs it once (producing a signed, notarized, auto-updating release), M5 is fully shippable. Next: **M6** — bundle the Pi agent (so the `.app` is fully self-contained), end-to-end on a real site, and a CI release workflow wiring these scripts + secrets.
