# macOS shell — app bundling pipeline (M5-5a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `scripts/package.sh` assembles an unsigned `Fairy.app` containing the release shell, a `bun --compile`d daemon, and the daemon's runtime assets (browser-bridge.ts, skills, panel); the shell launches the bundled daemon (falling back to dev), and the daemon finds its bundled assets via env overrides.

**Architecture:** The daemon is made relocatable with two env overrides resolved by a tested `resolveAssetPath` helper. A tested Swift `DaemonLocator` decides bundled-vs-dev launch. A standalone `package.sh` orchestrates the per-package builds and lays out the `.app`. The verified deliverable is the `.app` *structure* + the unit-tested logic; the live `app → daemon → Pi` run is a documented manual smoke (Pi isn't installed here).

**Tech Stack:** Bun (daemon compile + vitest), Swift 6 / SPM (language mode 5, XCTest), Bash (packaging). Run `bun` from each package dir, `swift` from `packages/mac-shell/`.

**Spec:** `docs/superpowers/specs/2026-06-09-mac-shell-packaging-design.md` (M5-5a; 5b adds sign/notarize/Sparkle/login-item/Pi-bundling).

Commit trailer MUST be EXACTLY (use `git commit -F -` heredoc — backticks in double-quoted bash get command-substituted):
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

Confirmed in source: `packages/pi-daemon/src/main.ts:94-100` resolves `BROWSER_EXTENSION` (`../pi-extension/browser-bridge.ts`) and `SKILLS_ROOT` (`../skills`) relative to `import.meta.url`; both break under `bun --compile`. Daemon spawns bare `pi` (PATH). `skills/` lives at `packages/pi-daemon/skills`. The SPM panel resource bundle (`.copy("Resources/panel")`) is emitted next to the release binary and must be copied into `Contents/Resources/` so `Bundle.module` resolves in the `.app`.

---

### Task 1: `resolveAssetPath` — env-overridable asset resolution (pi-daemon, TESTED)

**Files:**
- Create: `packages/pi-daemon/src/assetPath.ts`
- Test: `packages/pi-daemon/src/assetPath.test.ts`
- Modify: `packages/pi-daemon/src/main.ts` (use it for the two asset paths)

- [ ] **Step 1: Write the failing test**

Create `packages/pi-daemon/src/assetPath.test.ts`:

```ts
import { resolveAssetPath } from "./assetPath";

describe("resolveAssetPath", () => {
  const fallback = "/repo/packages/pi-daemon/../pi-extension/browser-bridge.ts";

  it("uses the env override when set", () => {
    expect(resolveAssetPath({ FAIRY_X: "/bundled/x.ts" }, "FAIRY_X", fallback)).toBe("/bundled/x.ts");
  });
  it("trims surrounding whitespace from the override", () => {
    expect(resolveAssetPath({ FAIRY_X: "  /bundled/x.ts  " }, "FAIRY_X", fallback)).toBe("/bundled/x.ts");
  });
  it("falls back when the key is unset", () => {
    expect(resolveAssetPath({}, "FAIRY_X", fallback)).toBe(fallback);
  });
  it("falls back when the override is blank/whitespace", () => {
    expect(resolveAssetPath({ FAIRY_X: "   " }, "FAIRY_X", fallback)).toBe(fallback);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `cd packages/pi-daemon && bun run test -- assetPath`
Expected: FAIL — `./assetPath` doesn't exist.

- [ ] **Step 3: Implement `assetPath.ts`**

```ts
/**
 * Resolve a daemon runtime asset path: the `env[key]` override (trimmed) if set
 * and non-blank, else the source-relative `fallback`. The override lets a bundled
 * launcher (the macOS shell) point a `bun --compile`d daemon at bundled copies of
 * its assets, whose location `import.meta.url` can no longer derive.
 */
export function resolveAssetPath(
  env: Record<string, string | undefined>,
  key: string,
  fallback: string,
): string {
  const override = env[key]?.trim();
  return override ? override : fallback;
}
```

- [ ] **Step 4: Run it, expect PASS (4 tests)**

Run: `bun run test -- assetPath`

- [ ] **Step 5: Wire `main.ts`**

In `packages/pi-daemon/src/main.ts`, add the import near the other local imports (e.g. after `import { resolvePaths, … } from "./paths";`):

```ts
import { resolveAssetPath } from "./assetPath";
```

Replace the `BROWSER_EXTENSION` and `SKILLS_ROOT` declarations (lines ~93-100) with:

```ts
/** The Pi `browser` extension script, shipped alongside the daemon. */
const BROWSER_EXTENSION = resolveAssetPath(
  process.env,
  "FAIRY_BROWSER_BRIDGE",
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../pi-extension/browser-bridge.ts"),
);

/** Bundled skills the daemon's tool-router serves (SKILL.md + interaction-skills/). */
const SKILLS_ROOT = resolveAssetPath(
  process.env,
  "FAIRY_SKILLS_ROOT",
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../skills"),
);
```

- [ ] **Step 6: Verify the daemon suite + typecheck**

Run from `packages/pi-daemon/`: `bun run test 2>&1 | tail -5` (all pass, incl. the 4 new) and `bun run build` (the `tsc --noEmit` typecheck — clean).

- [ ] **Step 7: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/pi-daemon/src/assetPath.ts \
        packages/pi-daemon/src/assetPath.test.ts \
        packages/pi-daemon/src/main.ts
git commit -F - <<'MSG'
feat(pi-daemon): relocatable asset paths via FAIRY_BROWSER_BRIDGE/SKILLS_ROOT

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 2: `build:compile` — compile the daemon to a single binary (pi-daemon)

**Files:**
- Modify: `packages/pi-daemon/package.json` (add the script)
- Modify: `packages/pi-daemon/.gitignore` (ignore `dist/`) — create if absent

- [ ] **Step 1: Add the compile script**

In `packages/pi-daemon/package.json`, add to `"scripts"` (after `"build": "tsc --noEmit"` — add a trailing comma to that line):

```json
    "build:compile": "bun build src/main.ts --compile --outfile dist/fairy-daemon",
```

- [ ] **Step 2: Ignore the build output**

Ensure `packages/pi-daemon/.gitignore` contains `dist/` (append; create the file with that single line if it doesn't exist).

- [ ] **Step 3: Run the compile + verify the artifact**

Run from `packages/pi-daemon/`:
```bash
bun run build:compile
test -x dist/fairy-daemon && echo "fairy-daemon built + executable"
```
Expected: `bun build --compile` completes and `dist/fairy-daemon` exists and is executable. (The compiled binary's runtime behaviour — spawning Pi etc. — is part of the manual smoke; this task only confirms the binary is produced.)

- [ ] **Step 4: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/pi-daemon/package.json packages/pi-daemon/.gitignore
git commit -F - <<'MSG'
build(pi-daemon): build:compile — bun --compile to a single fairy-daemon binary

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 3: `DaemonLocator` — bundled-vs-dev launch config (mac-shell FairyShell, TESTED)

**Files:**
- Create: `packages/mac-shell/Sources/FairyShell/DaemonLocator.swift`
- Test: `packages/mac-shell/Tests/FairyShellTests/DaemonLocatorTests.swift`

- [ ] **Step 1: Write the failing test**

Create `packages/mac-shell/Tests/FairyShellTests/DaemonLocatorTests.swift`:

```swift
import XCTest
@testable import FairyShell

final class DaemonLocatorTests: XCTestCase {
  private let resources = URL(fileURLWithPath: "/App/Contents/Resources")
  private let dev = URL(fileURLWithPath: "/repo/packages")

  func testBundledWhenDaemonPresent() {
    let cfg = DaemonLocator.resolve(resourcesURL: resources, devPackagesDir: dev,
                                    exists: { $0.lastPathComponent == "fairy-daemon" })
    XCTAssertEqual(cfg.executable, "/App/Contents/Resources/fairy-daemon")
    XCTAssertTrue(cfg.arguments.isEmpty)
    XCTAssertEqual(cfg.workdir.path, "/App/Contents/Resources")
    XCTAssertEqual(cfg.environment["FAIRY_BROWSER_BRIDGE"], "/App/Contents/Resources/browser-bridge.ts")
    XCTAssertEqual(cfg.environment["FAIRY_SKILLS_ROOT"], "/App/Contents/Resources/skills")
  }

  func testDevWhenDaemonAbsent() {
    let cfg = DaemonLocator.resolve(resourcesURL: resources, devPackagesDir: dev, exists: { _ in false })
    XCTAssertEqual(cfg.executable, "bun")
    XCTAssertEqual(cfg.arguments, ["run", "src/main.ts"])
    XCTAssertEqual(cfg.workdir.path, "/repo/packages/pi-daemon")
    XCTAssertTrue(cfg.environment.isEmpty)
  }

  func testDevWhenNoResourcesURL() {
    let cfg = DaemonLocator.resolve(resourcesURL: nil, devPackagesDir: dev, exists: { _ in true })
    XCTAssertEqual(cfg.executable, "bun")
    XCTAssertEqual(cfg.workdir.path, "/repo/packages/pi-daemon")
  }
}
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `cd packages/mac-shell && swift test --filter DaemonLocatorTests`
Expected: FAIL — `DaemonLocator` doesn't exist.

- [ ] **Step 3: Implement `DaemonLocator.swift`**

```swift
import Foundation

/// Decides how to launch the daemon: the bundled `fairy-daemon` binary (in the
/// .app's `Contents/Resources`) when present — pointed at its bundled assets via
/// env — otherwise the dev `bun run src/main.ts` from the source tree. Pure: the
/// `exists` probe and paths are injected, so it's unit-tested without a real bundle.
public enum DaemonLocator {
  public static func resolve(resourcesURL: URL?, devPackagesDir: URL,
                             exists: (URL) -> Bool) -> DaemonLaunchConfig {
    if let resources = resourcesURL {
      let daemon = resources.appendingPathComponent("fairy-daemon")
      if exists(daemon) {
        return DaemonLaunchConfig(
          executable: daemon.path,
          arguments: [],
          workdir: resources,
          environment: [
            "FAIRY_BROWSER_BRIDGE": resources.appendingPathComponent("browser-bridge.ts").path,
            "FAIRY_SKILLS_ROOT": resources.appendingPathComponent("skills").path,
          ]
        )
      }
    }
    return DaemonLaunchConfig(
      executable: "bun",
      arguments: ["run", "src/main.ts"],
      workdir: devPackagesDir.appendingPathComponent("pi-daemon")
    )
  }
}
```

- [ ] **Step 4: Run it, expect PASS (3 tests)**

Run: `swift test --filter DaemonLocatorTests`. Then `swift build` (clean).

- [ ] **Step 5: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/Sources/FairyShell/DaemonLocator.swift \
        packages/mac-shell/Tests/FairyShellTests/DaemonLocatorTests.swift
git commit -F - <<'MSG'
feat(mac-shell): DaemonLocator — launch the bundled daemon, else the dev one

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 4: Wire `AppDelegate` to `DaemonLocator` (mac-shell glue)

**Files:**
- Modify: `packages/mac-shell/Sources/fairy-shell/AppDelegate.swift`

Glue — coverage-excluded; verified by `swift build` + the library suite.

- [ ] **Step 1: Replace the hardcoded daemon config**

In `applicationDidFinishLaunching`, find this block:

```swift
    let config = DaemonLaunchConfig(
      executable: "bun",
      arguments: ["run", "src/main.ts"],
      workdir: packagesDir.appendingPathComponent("pi-daemon")
    )
```

and replace it with (the `packagesDir` above it is unchanged — it's now the dev fallback root):

```swift
    // Bundled: launch the compiled daemon from the .app's Resources (with bundled
    // asset envs). Dev: Bundle.main.resourceURL is the build dir — no fairy-daemon
    // there — so this falls back to `bun run src/main.ts`.
    let config = DaemonLocator.resolve(
      resourcesURL: Bundle.main.resourceURL,
      devPackagesDir: packagesDir,
      exists: { FileManager.default.fileExists(atPath: $0.path) }
    )
```

- [ ] **Step 2: Build + library tests**

Run from `packages/mac-shell/`: `swift build` (PASS) and `swift test 2>&1 | grep -E "Executed [0-9]+ tests" | tail -1` (the full suite — the prior total + the 3 new `DaemonLocator` tests — 0 failures).

- [ ] **Step 3: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/Sources/fairy-shell/AppDelegate.swift
git commit -F - <<'MSG'
feat(mac-shell): AppDelegate launches the daemon via DaemonLocator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 5: `Info.plist` + `package.sh` — assemble the `.app`

**Files:**
- Create: `packages/mac-shell/scripts/Info.plist`
- Create: `packages/mac-shell/scripts/package.sh`
- Modify: `packages/mac-shell/.gitignore` (ignore `dist/`) — create if absent

- [ ] **Step 1: Create the Info.plist template**

`packages/mac-shell/scripts/Info.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Fairy</string>
  <key>CFBundleDisplayName</key><string>Fairy</string>
  <key>CFBundleIdentifier</key><string>com.fairy.shell</string>
  <key>CFBundleExecutable</key><string>Fairy</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>@VERSION@</string>
  <key>CFBundleVersion</key><string>@VERSION@</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
```

- [ ] **Step 2: Create the packaging script**

`packages/mac-shell/scripts/package.sh`:

```bash
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
cp "$ROOT/packages/pi-extension/browser-bridge.ts" "$APP/Contents/Resources/browser-bridge.ts"
cp -R "$ROOT/packages/pi-daemon/skills" "$APP/Contents/Resources/skills"

# The SPM panel resource bundle, so Bundle.module resolves the panel inside the .app.
shopt -s nullglob
for b in "$BIN"/*.bundle; do cp -R "$b" "$APP/Contents/Resources/"; done
shopt -u nullglob

sed "s/@VERSION@/$VERSION/g" "$SCRIPT_DIR/Info.plist" > "$APP/Contents/Info.plist"

echo "==> built $APP (unsigned)"
```

- [ ] **Step 3: Make it executable + ignore dist/**

```bash
chmod +x packages/mac-shell/scripts/package.sh
```
Ensure `packages/mac-shell/.gitignore` contains `dist/` (append; create with that line if absent).

- [ ] **Step 4: Commit (the script + plist; the built app is gitignored)**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/scripts/package.sh \
        packages/mac-shell/scripts/Info.plist \
        packages/mac-shell/.gitignore
git commit -F - <<'MSG'
build(mac-shell): package.sh assembles an unsigned Fairy.app

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 6: Run the pipeline + structural verification

**Files:** none (verification only)

- [ ] **Step 1: Run the packaging script end to end**

Run from the repo root:
```bash
bash packages/mac-shell/scripts/package.sh
```
Expected: the panel builds, the daemon compiles, the shell release builds, and `packages/mac-shell/dist/Fairy.app` is assembled — no `set -e` abort.

- [ ] **Step 2: Assert the bundle structure**

```bash
APP=packages/mac-shell/dist/Fairy.app
test -x "$APP/Contents/MacOS/Fairy"               && echo "ok: shell exe"
test -x "$APP/Contents/Resources/fairy-daemon"    && echo "ok: daemon"
test -f "$APP/Contents/Resources/browser-bridge.ts" && echo "ok: browser-bridge"
test -d "$APP/Contents/Resources/skills"          && echo "ok: skills"
ls -d "$APP/Contents/Resources/"*.bundle          && echo "ok: panel bundle"
plutil -lint "$APP/Contents/Info.plist"           && echo "ok: Info.plist lints"
/usr/libexec/PlistBuddy -c 'Print :LSUIElement' "$APP/Contents/Info.plist"  # → true
```
Expected: every `ok:` prints, `plutil -lint` says "OK", and `LSUIElement` is `true`.

- [ ] **Step 3: Note the manual smoke (no commit — verification only)**

Record (in the PR description, not a commit) that the live path is a manual check: on a machine with `pi` on `PATH` and a paired `token.json`, `open packages/mac-shell/dist/Fairy.app`, then menu → the daemon reaches **running**, Settings/Pairing/Panel work — confirming the bundled daemon launched with its bundled assets. This is not runnable here (`pi` absent) and is not a gate for this PR.

---

## Self-Review

**1. Spec coverage.**
- Relocatable daemon via `FAIRY_BROWSER_BRIDGE`/`FAIRY_SKILLS_ROOT` + tested `resolveAssetPath`; dev unchanged → Task 1.
- `bun --compile` daemon binary → Task 2 (`build:compile`).
- Tested `DaemonLocator` (bundled-vs-dev, env-carrying) → Task 3; `AppDelegate` uses it → Task 4.
- `package.sh` assembles `Fairy.app` (release exe, compiled daemon, browser-bridge.ts, skills, SPM panel bundle, Info.plist with `LSUIElement`) → Task 5.
- Structural verification (tree + executable bits + `plutil -lint` + `LSUIElement`) → Task 6; live app→daemon→Pi = documented manual smoke (Task 6 step 3).
- Pi stays a PATH dependency (daemon still spawns bare `pi`); signing/notarize/Sparkle/login-item/Pi-bundling explicitly deferred → not in any task (spec non-goals).
  No 5a spec requirement is left without a task.

**2. Placeholder scan.** Every code/script step is complete (full `assetPath.ts`/`DaemonLocator.swift`/`package.sh`/`Info.plist`; exact `main.ts`/`AppDelegate`/`package.json` edits). The one runtime-only item (Task 6 step 3) is explicitly a documented manual smoke, not a placeholder. No "TBD"/"add validation"/"similar to Task N".

**3. Type consistency.** `resolveAssetPath(env, key, fallback)` (Task 1) matches its test and both `main.ts` call sites. `DaemonLocator.resolve(resourcesURL:devPackagesDir:exists:)` (Task 3) matches its tests and the `AppDelegate` call (Task 4). The env keys `FAIRY_BROWSER_BRIDGE`/`FAIRY_SKILLS_ROOT` are identical across the daemon (Task 1), the locator's emitted env (Task 3), and the bundled asset filenames `browser-bridge.ts`/`skills` that `package.sh` copies into `Resources` (Task 5) — i.e. the locator points the daemon at exactly the files the script bundles. `DaemonLaunchConfig(executable:arguments:workdir:environment:)` is the existing M5-1 type (memberwise init with `environment` defaulting to `[:]`), used consistently.
