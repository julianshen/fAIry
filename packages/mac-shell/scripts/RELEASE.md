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
