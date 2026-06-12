# Releasing Fairy (macOS)

Produces a **signed, notarized, auto-updating** `Fairy.app` + a DMG + a Sparkle `appcast.xml`.
Everything here runs on **your** Mac with **your** Apple Developer account — no secret is stored in the repo.

> Since M6-1 the app bundles the Pi agent (`fairy-pi`) alongside the daemon —
> no `pi` on the user's `PATH` is needed.

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

## Releasing via CI (M6-3)

Pushing a version tag builds, signs, notarizes, and publishes automatically:

```bash
git tag v0.1.0
git push origin v0.1.0
```

`.github/workflows/release.yml` then produces a GitHub Release for the tag with
two assets: `Fairy-0.1.0.dmg` and `appcast.xml`. Installed apps find updates via
the stable `releases/latest/download/appcast.xml` redirect — no external host.
(The trigger matches `v[0-9]*`, so tags like `v0.1.0` run it; `vNext` won't.)

### One-time setup: repository secrets

Settings → Secrets and variables → Actions → **Secrets**:

| Secret | What it is | How to produce it |
|---|---|---|
| `MACOS_CERTIFICATE_P12_BASE64` | Developer ID Application cert + key, base64 | Keychain Access → export the cert as `.p12`, then `base64 -i cert.p12 \| pbcopy` |
| `MACOS_CERTIFICATE_PASSWORD` | The `.p12` export password | chosen at export time |
| `MACOS_SIGN_IDENTITY` | The identity string | `security find-identity -v -p codesigning` → `Developer ID Application: Name (TEAMID)` |
| `NOTARY_API_KEY_P8_BASE64` | App Store Connect API key (`.p8`), base64 | App Store Connect → Users and Access → Integrations → create a key (Developer role), `base64 -i AuthKey_XXX.p8 \| pbcopy` |
| `NOTARY_API_KEY_ID` | The API key's ID | shown next to the key in App Store Connect |
| `NOTARY_API_ISSUER` | The issuer UUID | shown on the same Integrations page |
| `SPARKLE_PRIVATE_KEY` | Sparkle EdDSA **private** key (file contents) | `generate_keys -x sparkle_ed25519` exports it; paste the file contents |

…and one **Variable** on the same page:

| Variable | Value |
|---|---|
| `FAIRY_SPARKLE_PUBLIC_KEY` | the `SUPublicEDKey` printed by `generate_keys` |

The feed URL is derived in the workflow from the repo slug
(`https://github.com/<owner>/<repo>/releases/latest/download/appcast.xml`) —
no variable needed.

### Verifying the first CI release

1. Watch the run: `gh run watch` (or the Actions tab).
2. Download the DMG from the Release page and check:
   ```bash
   spctl -a -t open -vvv --context context:primary-signature Fairy-0.1.0.dmg
   xcrun stapler validate Fairy-0.1.0.dmg
   ```
3. Confirm `https://github.com/<owner>/<repo>/releases/latest/download/appcast.xml`
   serves the appcast and its `<enclosure url>` points at the Release's DMG.
4. Install, run, and use **Check for Updates…** against a later tag to confirm
   Sparkle sees it.
