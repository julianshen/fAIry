# M6-3 — CI + Release workflows (design)

**Status:** approved
**Date:** 2026-06-10
**Milestone:** M6-3 (packaging & integration — automation)

## Goal

Add GitHub Actions automation in two parts:

1. **CI gate** — on every PR and push to `main`, run lint + typecheck + unit tests
   for the three TypeScript packages, `swift test` for the macOS shell, and the
   deterministic end-to-end test (`tools.spec`).
2. **Release** — on a pushed version tag (`v[0-9]*`), build a signed + notarized
   `Fairy.app`, package a DMG and an EdDSA-signed Sparkle `appcast.xml`, and
   publish both as assets on the corresponding GitHub Release.

The released DMG + appcast are hosted on **GitHub Releases** — no external web
host is required. `SUFeedURL` is baked into the app as the stable
`…/releases/latest/download/appcast.xml` redirect, so installed copies always
find the newest appcast.

## Non-goals

- Standing up an external download host (GitHub Releases is the host).
- Auto-bumping the version (the tag is the single source of the version).
- Code-signing of the Chrome extension or any web-store publishing (out of M6).
- Running the credentialed release end-to-end in CI as part of this work — the
  release job requires Apple + Sparkle secrets that only the repo owner can add.

## Architecture

Two workflow files, separated by trigger and secret surface:

| File | Trigger | Runner(s) | Purpose |
|---|---|---|---|
| `.github/workflows/ci.yml` | `pull_request`, `push` to `main` | ubuntu + macOS | Lint, typecheck, unit tests, Swift tests, e2e |
| `.github/workflows/release.yml` | `push` tag matching `v[0-9]*` | macOS | Sign → notarize → DMG → appcast → publish to the GitHub Release |

A single combined file (jobs gated by `if:` on event type) was considered and
rejected: the triggers and secret surfaces are disjoint, and keeping the release
secrets out of every PR run is cleaner.

### `ci.yml` — four parallel jobs

- **`scripts` (ubuntu-latest)** — the two bash unit tests
  (`release-lib.test.sh`, `appcast-wiring.test.sh`) plus a pinned `actionlint`
  run over both workflow files.

- **`ts` (ubuntu-latest)**
  - `oven-sh/setup-bun` (pin to `bun-version: 1.3.x` to match `engines.bun`).
  - `bun install` at the repo root (workspaces).
  - Matrix over `package: [extension, pi-daemon, agent-panel]`; each runs
    `lint`, `typecheck`, and `test` (`vitest run`) via
    `bun run --filter <package> <script>` (or `cd packages/<package> && bun run <script>`).

- **`swift` (macos-latest)**
  - `swift test` in `packages/mac-shell` (the `FairyShellTests` target).
  - No bun needed; Sparkle resolves via SwiftPM on first build.

- **`e2e` (macos-latest)**
  - `setup-bun` + `bun install`.
  - `bunx playwright install chromium`.
  - Build the extension (`bun run --filter extension build`), then run the
    deterministic e2e: `cd packages/extension && bunx playwright test tools.spec.ts`.
  - The macOS runner provides a native GUI session, so the headed Chromium
    (`headless:false`) launches without xvfb.
  - The spec **self-skips** (does not fail) when the runner's Chromium cannot
    side-load the MV3 extension — it already guards on `extensionLoaded`
    (`test.skip(!extensionLoaded, …)`). A skipped test is a green job.

All four jobs run in parallel. `ts` and `scripts` are cheap (ubuntu); the two
macOS jobs are metered but bounded (each job carries a `timeout-minutes`).

### `release.yml` — one macOS job, tag-driven

Steps in order:

1. **Derive the version.** Strip the leading `v` from the tag ref:
   `v0.1.0` → `FAIRY_VERSION=0.1.0`. Export to `$GITHUB_ENV`.
2. **Import the signing certificate.** Decode `MACOS_CERTIFICATE_P12_BASE64`,
   `security create-keychain` an ephemeral keychain, import the `.p12` with
   `MACOS_CERTIFICATE_PASSWORD`, `set-key-partition-list`, and add it to the
   search list so `codesign` finds the identity.
3. **Create the notarytool profile.** Decode `NOTARY_API_KEY_P8_BASE64` to a
   file and run `xcrun notarytool store-credentials "$NOTARY_PROFILE"
   --key <p8> --key-id "$NOTARY_API_KEY_ID" --issuer "$NOTARY_API_ISSUER"`.
   (App Store Connect API key — no Apple-ID password, revocable.)
4. **Write the Sparkle EdDSA private key** from `SPARKLE_PRIVATE_KEY` to a temp
   file (referenced by `FAIRY_SPARKLE_PRIVATE_KEY_FILE`).
5. **Run `release.sh`** with the environment:
   - `FAIRY_VERSION` (from the tag)
   - `DEVELOPER_ID_APP` = `MACOS_SIGN_IDENTITY`
   - `NOTARY_PROFILE` (the profile name created in step 3)
   - `FAIRY_SPARKLE_PUBLIC_KEY` (repo variable)
   - `FAIRY_UPDATE_FEED_URL` = `https://github.com/<owner>/<repo>/releases/latest/download/appcast.xml`
   - `FAIRY_SPARKLE_PRIVATE_KEY_FILE` (step 4)
   - `FAIRY_DOWNLOAD_URL_PREFIX` = `https://github.com/<owner>/<repo>/releases/download/<tag>/`
6. **Publish.** Use the pre-installed `gh` CLI (no third-party action):
   `gh release create "$TAG" --title … --notes …` (idempotent: fall back to
   `gh release upload "$TAG" --clobber`) attaching
   `packages/mac-shell/dist/Fairy-$FAIRY_VERSION.dmg` and
   `packages/mac-shell/dist/appcast.xml`.

### Two seams added to `appcast.sh`

The script currently relies on the EdDSA key living in the local keychain and on
`generate_appcast` producing local file paths. CI has neither. Two optional,
env-driven seams (the same relocatable-asset pattern used in `assetPath.ts`):

- `FAIRY_SPARKLE_PRIVATE_KEY_FILE` — when set and non-empty, pass
  `--ed-key-file "$FAIRY_SPARKLE_PRIVATE_KEY_FILE"` to `generate_appcast`.
- `FAIRY_DOWNLOAD_URL_PREFIX` — when set and non-empty, pass
  `--download-url-prefix "$FAIRY_DOWNLOAD_URL_PREFIX"` so the appcast's
  `<enclosure url>` points at the GitHub Release asset, not a local path.
- `FAIRY_GENERATE_APPCAST` — test-only override of the `generate_appcast`
  binary path (same relocatable pattern as `FAIRY_PI_BIN`), letting the wiring
  test inject a stub that records its argv. Defaults to the Sparkle SPM
  artifact path.

Both default to empty → the existing local-runbook behavior (keychain key,
local-relative enclosure) is unchanged. The conditional argument assembly is
unit-tested with a small extraction (see Testing).

## Components & files

- **Create:** `.github/workflows/ci.yml`
- **Create:** `.github/workflows/release.yml`
- **Modify:** `packages/mac-shell/scripts/appcast.sh` — add the two seams.
- **Create:** `packages/mac-shell/scripts/appcast-args.test.*` (or a tiny shell
  test) — verify the seam → flag mapping.
- **Modify:** `packages/mac-shell/scripts/RELEASE.md` — add a "Releasing via CI"
  section documenting the secret/variable list and the tag-push flow.

## Testing

- **`ci.yml` is self-validating:** it runs on the M6-3 PR itself; a green run is
  the proof the gate works.
- **`actionlint`** is run locally against both YAML files before committing
  (and can be added as a CI step).
- **Seam unit test:** extract the appcast argument assembly so the
  env → flag mapping is testable without invoking the real `generate_appcast`.
  Cases: (a) neither seam set → no extra flags; (b) key file set →
  `--ed-key-file <path>`; (c) prefix set → `--download-url-prefix <url>`;
  (d) both set → both flags, in a stable order.
- **Version-from-tag** logic is a one-liner; assert `v0.1.0 → 0.1.0` and that a
  non-`v` ref is handled.

## Error handling

- **Missing secrets on a fork PR:** `release.yml` only triggers on tags pushed to
  this repo; fork PRs never run it. The `ci.yml` gate needs no secrets.
- **Notarization failure:** `notarize.sh` already `--wait`s and surfaces the
  submission log path; the job fails loudly. Documented in `RELEASE.md`.
- **e2e cannot side-load the extension:** self-skip → green job, with a logged
  skip reason. No silent pass is claimed — the skip is visible in the run.
- **`gh release` when the release already exists:** create-or-upload with
  `--clobber` so a re-run of the same tag re-uploads assets idempotently.

## Verified-here vs. credential-gated boundary

- **Verified in this PR:** `ci.yml` running green on the PR; `actionlint` clean;
  the `appcast.sh` seam unit tests; the version-from-tag assertion.
- **Author-only (owner verifies on the first real tag):** the `release.yml`
  sign/notarize/appcast path, which requires the Apple + Sparkle secrets only the
  repo owner can add. `RELEASE.md` documents the exact secret list and the
  one-time setup.

## Secrets & variables (added by the owner in repo settings — never committed)

Secrets:
`MACOS_CERTIFICATE_P12_BASE64`, `MACOS_CERTIFICATE_PASSWORD`,
`MACOS_SIGN_IDENTITY`, `NOTARY_API_KEY_P8_BASE64`, `NOTARY_API_KEY_ID`,
`NOTARY_API_ISSUER`, `SPARKLE_PRIVATE_KEY`.

Variables (non-secret):
`FAIRY_SPARKLE_PUBLIC_KEY`, `FAIRY_UPDATE_FEED_URL`
(`FAIRY_UPDATE_FEED_URL` may also be derived from `github.repository` rather than
stored — decided during implementation).
