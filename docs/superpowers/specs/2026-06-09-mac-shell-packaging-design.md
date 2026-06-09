# macOS shell — app bundling pipeline (M5-5a) — design

**Status:** approved (design phase) · **Date:** 2026-06-09 · **Component:** `packages/mac-shell` + `packages/pi-daemon` · **Builds on:** the complete shell (M5-1..4) + the daemon · **Part of:** M5 (macOS shell), sub-project 5 (packaging), **part a of two**.

## Context

The shell currently launches the daemon in **dev mode**: `bun run src/main.ts` from a path resolved via `#filePath` (its own source location). `swift build` produces a bare executable — there is no `.app` bundle, no `Info.plist`, no bundled daemon. The daemon's `main.ts` also resolves two runtime assets relative to its own source (`import.meta.url`): the Pi `-e` script `../pi-extension/browser-bridge.ts` (`BROWSER_EXTENSION`) and `../skills` (`SKILLS_ROOT`). It spawns the **external `pi` agent** as a bare `spawn("pi", …)` (resolved on `PATH`).

This sub-project makes the shell into a runnable, self-contained **`Fairy.app`**: it compiles the daemon to a single binary, bundles it (plus its runtime assets and the panel) into the app, and teaches the shell to launch the bundled daemon — falling back to dev mode when not bundled.

## Goal & non-goals

**Goal:** a `scripts/package.sh` that assembles an (unsigned) `Fairy.app` containing the release shell binary, a `bun --compile`d daemon, and the daemon's runtime assets; plus the tested logic that makes the shell launch the bundled daemon (and the daemon find its bundled assets). Buildable and structurally verifiable in this environment.

**Non-goals (→ 5b / M6):** code signing, notarization, stapling, the DMG, the Sparkle appcast + EdDSA update signing, the login-item (launch-at-startup), and bundling the **Pi agent** itself (it stays a `PATH` dependency). Also out of scope: any change to the panel build (M5-4 already produces it) and CI wiring.

**Verification boundary:** the deliverable that's *verified here* is the **structure** of `Fairy.app` (the tree exists, `Info.plist` lints, the daemon binary is executable) plus the unit-tested resolution logic. The live `app → daemon → Pi` happy path is a **documented manual smoke** — `pi` is not installed in this environment — and is NOT a plan "done" criterion.

## Decisions (and why)

1. **A standalone packaging script assembles the `.app`** (`scripts/package.sh`). SPM cannot emit an `.app`; the script lays out `Fairy.app/Contents/{MacOS,Resources,Info.plist}` from the release build + compiled daemon + assets. It runs here (unsigned) and is reused verbatim by 5b/CI, which only *append* sign/notarize/staple steps. Rejected: wrapping the SPM package in an **Xcode project** (reintroduces the Xcode tooling M5 deliberately avoided — it's pure SPM); hand-assembly (not reproducible).
2. **Make the daemon relocatable via env overrides, not by changing its layout.** `main.ts` resolves `browser-bridge.ts` and `skills/` through a pure `resolveAssetPath(env, key, fallback)` — `process.env[key]` if set, else the existing source-relative path. Dev `bun run` is unchanged (no env → fallback); the bundled launcher sets the envs to the bundled copies. This keeps the daemon's source-tree behavior intact and puts "where the assets are" under the launcher's control (the shell), which is also what makes it testable. The compiled binary can't rely on `import.meta.url` offsets, so the override is required, not cosmetic.
3. **The shell owns daemon discovery via a tested `DaemonLocator`.** Rather than scatter "bundled vs dev" conditionals through `AppDelegate`, a pure `DaemonLocator` decides: bundled `fairy-daemon` present → launch it directly with the bundled-asset envs; absent → the dev `bun run` config. The `exists` probe and paths are injected, so it's unit-tested without a real bundle.
4. **Pi stays a `PATH` dependency.** The daemon already spawns bare `pi`; bundling/shipping the Pi agent (a large external tool with its own distribution/license story) is deferred to 5b/M6. The `.app` is self-contained *except* for Pi.

## Architecture & components

**`packages/pi-daemon/` (relocatable daemon; TESTED):**
- **`assetPath.ts`** (new) — `resolveAssetPath(env: Record<string,string|undefined>, key: string, fallback: string): string` → `env[key]?.trim() || fallback`. Pure; unit-tested.
- **`main.ts`** (modify) — `BROWSER_EXTENSION` and `SKILLS_ROOT` go through `resolveAssetPath(process.env, "FAIRY_BROWSER_BRIDGE", <source-relative>)` and `…("FAIRY_SKILLS_ROOT", <source-relative>)`. No behavior change without the envs.
- **`package.json`** (modify) — add `"build:compile": "bun build src/main.ts --compile --outfile dist/fairy-daemon"`.

**`packages/mac-shell/Sources/FairyShell/` (TESTED):**
- **`DaemonLocator.swift`** (new) —
  ```swift
  public enum DaemonLocator {
    /// Bundled if `resourcesURL/fairy-daemon` exists (launch it directly with the
    /// bundled asset envs); otherwise the dev `bun run src/main.ts` config.
    public static func resolve(resourcesURL: URL?, devPackagesDir: URL,
                               exists: (URL) -> Bool) -> DaemonLaunchConfig
  }
  ```
  Bundled config: `executable` = the `fairy-daemon` path, `arguments` = [], `workdir` = resources, `environment` = `["FAIRY_BROWSER_BRIDGE": …/browser-bridge.ts, "FAIRY_SKILLS_ROOT": …/skills]`. Dev config: today's `bun`/`["run","src/main.ts"]`/`pi-daemon` workdir.

**`packages/mac-shell/Sources/fairy-shell/` (glue):**
- **`AppDelegate.swift`** (modify) — replace the hardcoded `DaemonLaunchConfig(bun…)` with `DaemonLocator.resolve(resourcesURL: Bundle.main.resourceURL, devPackagesDir: <#filePath packagesDir>, exists: { FileManager.default.fileExists(atPath: $0.path) })`. (`Bundle.main.resourceURL` is the `.app`'s `Contents/Resources` when bundled; in dev it's the build dir, where `fairy-daemon` won't exist → dev config.)

**`packages/mac-shell/scripts/` (runnable here):**
- **`package.sh`** — orchestrates the build + assembles `Fairy.app` (see data flow). Idempotent; output under `packages/mac-shell/dist/Fairy.app`.
- **`Info.plist`** (template) — `LSUIElement=true` (menu-bar agent, no Dock icon), `CFBundleIdentifier` (`com.fairy.shell`), `CFBundleName=Fairy`, `CFBundleExecutable=Fairy`, `CFBundleShortVersionString`/`CFBundleVersion`, `LSMinimumSystemVersion=13.0`.

## Data flow (the build pipeline)

```text
scripts/package.sh
  agent-panel:  bun run build:shell        → packages/mac-shell/.../Resources/panel (built; M5-4)
  pi-daemon:    bun run build:compile      → packages/pi-daemon/dist/fairy-daemon (single binary)
  mac-shell:    swift build -c release     → .build/release/fairy-shell
  assemble dist/Fairy.app/Contents/
    MacOS/Fairy                            ← .build/release/fairy-shell
    Resources/fairy-daemon                 ← pi-daemon/dist/fairy-daemon  (chmod +x)
    Resources/browser-bridge.ts            ← pi-extension/browser-bridge.ts
    Resources/skills/                      ← packages/pi-daemon/skills
    Resources/<SPM panel resource bundle>  ← so Bundle.module resolves the panel
    Resources/panel/ …                     (carried by the SPM resource bundle)
    Info.plist                             ← from scripts/Info.plist (version substituted)

runtime (bundled):  AppDelegate → DaemonLocator.resolve(Bundle.main.resourceURL, …)
  Resources/fairy-daemon exists → launch it; env FAIRY_BROWSER_BRIDGE/FAIRY_SKILLS_ROOT → bundled copies
  daemon still spawns bare `pi` (PATH)
runtime (dev):  no fairy-daemon next to the exe → bun run src/main.ts (unchanged)
```

**SPM resource note:** the panel is bundled as an SPM resource (`fairy-shell_fairy-shell.bundle`); `package.sh` copies that generated bundle into `Contents/Resources/` so `Bundle.module` resolves at runtime from inside the `.app`. (Verified by the script asserting the bundle's presence; the runtime resolution is part of the manual smoke.)

## Error handling

- **Missing build inputs** — `package.sh` fails fast (set -euo pipefail) with a clear message if a prior build step didn't produce its artifact (no panel bundle / no `fairy-daemon` / no release binary).
- **Dev unaffected** — with no env overrides and no bundled `fairy-daemon`, the daemon and shell behave exactly as today; `DaemonLocator` returns the dev config and `resolveAssetPath` returns the fallbacks.
- **Pi absent at runtime** — unchanged from today: the daemon's `spawn("pi", …)` fails and surfaces as the existing daemon-failed state; bundling Pi is 5b/M6.

## Testing

- **`resolveAssetPath`** (pi-daemon, vitest): env key set (trimmed) → override; unset/blank → fallback.
- **`DaemonLocator`** (FairyShell, XCTest): `resourcesURL` with `fairy-daemon` present (injected `exists`) → executable = that binary, env carries both `FAIRY_*` paths, no `bun`; absent / `resourcesURL == nil` → dev `bun run src/main.ts` config. FairyShell ≥90% holds.
- **`package.sh` structural verification** (a plan task, not a unit test): run it, then assert `dist/Fairy.app/Contents/MacOS/Fairy` exists and is executable, `Resources/fairy-daemon` exists and is executable, `Resources/browser-bridge.ts` + `Resources/skills` present, `plutil -lint Info.plist` passes.
- **Glue / manual:** `AppDelegate`'s `DaemonLocator` call is glue (coverage-excluded). The live `app → daemon → Pi` run is a documented manual smoke (`open dist/Fairy.app` on a machine with `pi` installed + a paired token), not a plan gate.

## Sequencing

M5 sub-project 5, part a (this). Next — **5b (distribution, credential-gated):** `codesign` (Developer ID Application), `notarytool` submit + staple, the DMG, the Sparkle SPM dependency + `SUFeedURL`/`SUPublicEDKey` in `Info.plist` + an `Updater` + "Check for Updates" menu, the `generate_appcast` (EdDSA) step, and the `SMAppService` login-item + "Launch at login" toggle — authored as scripts + Swift wiring, run by the user with their Apple Developer account and release host. Then M6 (bundle Pi; end-to-end on a real site; release pipeline).
