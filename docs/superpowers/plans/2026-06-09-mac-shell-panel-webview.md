# macOS shell — conversation panel WebView host (M5-4b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An "Open Panel" status-menu item opens a window hosting the real `agent-panel` in a WKWebView, driven by a daemon conversation over the native transport from PR-4a — beats pushed native→JS, commands sent JS→native.

**Architecture:** The native process owns the WS (PR-4a's `ConversationClient`/`URLSessionConversationSocket`); a `PanelBridge` (`WKScriptMessageHandler`) forwards JS commands and the `PanelWindowController` pushes beats into the WebView via `evaluateJavaScript`. The panel is the `agent-panel` React app, built standalone (`build:shell`) and bundled into the shell's `Resources/panel/`. The only tested unit is `agent-panel`'s `nativeBridge` (command encoding); the rest is coverage-excluded glue.

**Tech Stack:** Swift 6 / SPM (language mode 5), AppKit + WebKit (executable only); Vite + React (agent-panel shell build); Vitest. Run `swift` from `packages/mac-shell/`, `bun`/`vite` from `packages/agent-panel/`.

**Spec:** `docs/superpowers/specs/2026-06-09-mac-shell-panel-design.md` (this is PR-4b of two; PR-4a — the tested transport `InfoClient`/`ConversationClient`/`URLSessionConversationSocket` — is merged).

Reuse from PR-4a (`FairyShell`, public): `InfoClient(baseURL:tokenURL:transport:)` → `Result<DaemonInfo, SettingsError>`; `ConversationClient(socket:token:onBeat:)` with `connect()`/`start(_:)`/`stop()`/`resolveProposal(_ json:)`/`close()`; `URLSessionConversationSocket(url:)`; `TokenReader.read(from:)`; `DaemonInfo.conversationPort`. From M5-3 glue: `URLSessionTransport` (HTTP `get`). `AppDelegate` already centralizes `appData`/`baseURL`/`tokenURL`.

The bridge message contract (JS → native, via the `"fairy"` handler): `{type:"start",task}` / `{type:"stop"}` / `{type:"resolveProposal",proposal}`. Native → JS (per beat): `window.__fairyBridge.onBeat(<beatJSON>)`.

Commit trailer MUST be EXACTLY (use `git commit -F -` heredoc):
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: `nativeBridge` — the panel's command encoder (agent-panel, TESTED)

**Files:**
- Create: `packages/agent-panel/src/shell/nativeBridge.ts`
- Test: `packages/agent-panel/src/shell/nativeBridge.test.ts`
- Modify: `packages/agent-panel/vite.config.ts` (exclude the glue entry from coverage)

- [ ] **Step 1: Write the failing test**

Create `packages/agent-panel/src/shell/nativeBridge.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createNativeBridge } from "./nativeBridge";

describe("createNativeBridge", () => {
  it("start posts a start command with the task", () => {
    const post = vi.fn();
    createNativeBridge(post).start("do it");
    expect(post).toHaveBeenCalledWith({ type: "start", task: "do it" });
  });
  it("stop posts a stop command", () => {
    const post = vi.fn();
    createNativeBridge(post).stop();
    expect(post).toHaveBeenCalledWith({ type: "stop" });
  });
  it("resolveProposal posts the proposal verbatim", () => {
    const post = vi.fn();
    const proposal = { kind: "skill", name: "x" };
    createNativeBridge(post).resolveProposal(proposal);
    expect(post).toHaveBeenCalledWith({ type: "resolveProposal", proposal });
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `cd packages/agent-panel && bun run test -- nativeBridge`
Expected: FAIL — `./nativeBridge` doesn't exist.

- [ ] **Step 3: Implement `nativeBridge.ts`**

```ts
/** Commands the native shell understands (posted to the "fairy" message handler). */
export interface NativeBridge {
  /** Start a conversation task. */
  start(task: string): void;
  /** Stop the in-flight turn. */
  stop(): void;
  /** Resolve a save proposal (the opaque proposal object is forwarded verbatim). */
  resolveProposal(proposal: unknown): void;
}

/**
 * Adapts the panel's actions to the native shell's WS bridge: each call `post`s a
 * typed command that the Swift `PanelBridge` maps onto `ConversationClient`. Pure —
 * `post` is injected (the host wires it to `window.webkit.messageHandlers.fairy`).
 */
export function createNativeBridge(post: (msg: unknown) => void): NativeBridge {
  return {
    start: (task) => post({ type: "start", task }),
    stop: () => post({ type: "stop" }),
    resolveProposal: (proposal) => post({ type: "resolveProposal", proposal }),
  };
}
```

- [ ] **Step 4: Run it, expect PASS (3 tests)**

Run: `bun run test -- nativeBridge`

- [ ] **Step 5: Exclude the glue entry from coverage**

In `packages/agent-panel/vite.config.ts`, add `"src/shell/main.tsx"` to the `coverage.exclude` array (right after `"src/main.tsx",`), so the upcoming host entry doesn't drag coverage down (it's DOM/bridge glue; `nativeBridge.ts` stays covered):

```ts
      exclude: [
        "src/main.tsx",
        "src/shell/main.tsx",
        "src/harness/**",
```

- [ ] **Step 6: Run the full agent-panel suite (coverage holds)**

Run: `bun run test:coverage 2>&1 | tail -15`
Expected: all pass; `src/shell/nativeBridge.ts` at 100%; thresholds (≥90%) still met.

- [ ] **Step 7: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/agent-panel/src/shell/nativeBridge.ts \
        packages/agent-panel/src/shell/nativeBridge.test.ts \
        packages/agent-panel/vite.config.ts
git commit -F - <<'MSG'
feat(agent-panel): nativeBridge — encode panel commands for the macOS shell

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 2: The shell host entry + build (agent-panel, GLUE)

**Files:**
- Create: `packages/agent-panel/src/shell/index.html`
- Create: `packages/agent-panel/src/shell/main.tsx`
- Create: `packages/agent-panel/vite.shell.config.ts`
- Modify: `packages/agent-panel/package.json` (add `build:shell`)
- Modify: `packages/agent-panel/.gitignore` (ignore `dist-shell/`) — create it if absent

- [ ] **Step 1: Create `src/shell/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Fairy</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `src/shell/main.tsx`** (mirrors the extension's panel host, but driven by the native bridge — no `chrome.*`)

```tsx
import { Panel, usePanelController, type Beat, type SavedActionView } from "../index";
import "../styles/index.css";
import { StrictMode, useEffect, useRef, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { createNativeBridge, type NativeBridge } from "./nativeBridge";

declare global {
  interface Window {
    __fairyBridge?: { onBeat: (beat: unknown) => void };
    webkit?: { messageHandlers: { fairy: { postMessage: (msg: unknown) => void } } };
  }
}

function App(): ReactElement {
  const controller = usePanelController();
  const bridgeRef = useRef<NativeBridge | null>(null);

  useEffect(() => {
    // native → JS: the Swift side calls window.__fairyBridge.onBeat(beat) per beat.
    window.__fairyBridge = { onBeat: (beat) => controller.apply(beat as Beat) };
    // JS → native: commands post to the "fairy" handler the shell registered.
    bridgeRef.current = createNativeBridge((msg) => window.webkit?.messageHandlers.fairy.postMessage(msg));
    return () => { window.__fairyBridge = undefined; };
  }, [controller.apply]);

  // No chrome tab-binding here (the native shell has no tabs); a browser tool with
  // no extension-bound tab returns the daemon's "no tab bound" as an error beat.
  const send = (task: string): void => { controller.reset(); bridgeRef.current?.start(task); };
  const runAction = (action: SavedActionView): void => { controller.reset(); bridgeRef.current?.start(action.content); };
  const stop = (): void => bridgeRef.current?.stop();

  return (
    <Panel
      state={controller.state}
      elapsed={controller.elapsed}
      onSend={send}
      onRunAction={runAction}
      onReset={controller.reset}
      onPause={stop}
      onTakeover={stop}
      onStop={stop}
      onAnswer={controller.answer}
      onToggleActions={controller.toggleActions}
      onTake={controller.take}
      onResolveProposal={(item, accept) => {
        controller.resolveProposal(item.key, accept);
        if (accept) bridgeRef.current?.resolveProposal(item.proposal);
      }}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>,
);
```

- [ ] **Step 3: Create `vite.shell.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone build of the shell host (src/shell/index.html) into dist-shell/.
// `base: "./"` makes asset URLs relative so the bundle loads from a file:// URL
// inside the macOS shell's WKWebView.
export default defineConfig({
  plugins: [react()],
  root: "src/shell",
  base: "./",
  build: {
    outDir: "../../dist-shell",
    emptyOutDir: true,
  },
});
```

- [ ] **Step 4: Add the `build:shell` script**

In `packages/agent-panel/package.json`, add to `"scripts"` (after `"build"`):

```json
    "build:shell": "vite build --config vite.shell.config.ts && rm -rf ../mac-shell/Sources/fairy-shell/Resources/panel && mkdir -p ../mac-shell/Sources/fairy-shell/Resources/panel && cp -R dist-shell/. ../mac-shell/Sources/fairy-shell/Resources/panel/",
```

- [ ] **Step 5: Ignore the intermediate build dir**

Append `dist-shell/` to `packages/agent-panel/.gitignore` (create the file with that line if it doesn't exist). The committed artifact is the copied `mac-shell/.../Resources/panel/` (Task 3), not `dist-shell/`.

- [ ] **Step 6: Typecheck + build the bundle**

Run from `packages/agent-panel/`:
```bash
bun run typecheck        # tsc --noEmit must pass (incl. src/shell/*.tsx)
bun run build:shell      # produces dist-shell/ and copies it into mac-shell Resources/panel
ls ../mac-shell/Sources/fairy-shell/Resources/panel/index.html   # exists
```
Expected: typecheck clean; `Resources/panel/index.html` + an `assets/` dir present.

- [ ] **Step 7: Commit** (the host source + build config; the bundled assets are committed in Task 3)

```bash
cd /Users/julianshen/prj/fAIry
git add packages/agent-panel/src/shell/index.html \
        packages/agent-panel/src/shell/main.tsx \
        packages/agent-panel/vite.shell.config.ts \
        packages/agent-panel/package.json \
        packages/agent-panel/.gitignore
git commit -F - <<'MSG'
feat(agent-panel): standalone shell host entry + build:shell

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 3: Bundle the panel into the shell + SPM resources

**Files:**
- Modify: `packages/mac-shell/Package.swift` (add `resources:` to the `fairy-shell` target)
- Create (generated, committed): `packages/mac-shell/Sources/fairy-shell/Resources/panel/**` (from `build:shell`)

- [ ] **Step 1: Add the resource to `Package.swift`**

In `packages/mac-shell/Package.swift`, give the `fairy-shell` executable target a `resources` argument:

```swift
    .executableTarget(
      name: "fairy-shell",
      dependencies: ["FairyShell"],
      resources: [.copy("Resources/panel")],
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
```

(Leave the `FairyShell` and `FairyShellTests` targets unchanged.)

- [ ] **Step 2: Ensure the bundle is present**

If Task 2 step 6 already populated `packages/mac-shell/Sources/fairy-shell/Resources/panel/`, skip. Otherwise run from `packages/agent-panel/`: `bun run build:shell`. Confirm `packages/mac-shell/Sources/fairy-shell/Resources/panel/index.html` exists.

- [ ] **Step 3: Build (SPM picks up the resource)**

Run from `packages/mac-shell/`: `swift build`.
Expected: PASS — SPM copies `Resources/panel` into the bundle; no "unhandled resource" warning.

- [ ] **Step 4: Commit the bundled assets + manifest change**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/Package.swift \
        packages/mac-shell/Sources/fairy-shell/Resources/panel
git commit -F - <<'MSG'
build(mac-shell): bundle the built agent-panel into Resources/panel

The web bundle is committed so `swift build` stays hermetic (no node in the
Swift build); regenerate with `bun run build:shell` from packages/agent-panel.
M6 will formalize the build pipeline.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 4: Swift glue — `PanelBridge`, `PanelWindowController`, menu wiring

**Files:**
- Create: `packages/mac-shell/Sources/fairy-shell/PanelBridge.swift`
- Create: `packages/mac-shell/Sources/fairy-shell/PanelWindowController.swift`
- Modify: `packages/mac-shell/Sources/fairy-shell/AppDelegate.swift`

AppKit/WebKit glue — coverage-excluded, runtime-verified by launching. The library tests must still pass.

- [ ] **Step 1: Create `PanelBridge.swift`** (thin JS→native forwarder)

```swift
import WebKit

/// Forwards panel command messages from the WebView's JS (`window.webkit
/// .messageHandlers.fairy.postMessage(...)`) to a handler the window controller
/// owns. Registered before the page loads so the handler exists when the panel posts.
@MainActor
final class PanelBridge: NSObject, WKScriptMessageHandler {
  private let onCommand: ([String: Any]) -> Void
  init(onCommand: @escaping ([String: Any]) -> Void) { self.onCommand = onCommand }

  func userContentController(_ controller: WKUserContentController,
                             didReceive message: WKScriptMessage) {
    if let body = message.body as? [String: Any] { onCommand(body) }
  }
}
```

- [ ] **Step 2: Create `PanelWindowController.swift`**

```swift
import AppKit
import WebKit
import FairyShell

/// Owns the conversation panel window: a WKWebView hosting the bundled agent-panel,
/// connected to the daemon's conversation WS via PR-4a's ConversationClient. Beats
/// are pushed into JS via evaluateJavaScript; panel commands arrive via PanelBridge.
@MainActor
final class PanelWindowController: NSObject, WKNavigationDelegate {
  private var window: NSWindow?
  private var webView: WKWebView?
  private var overlay: NSView?
  private var client: ConversationClient?

  private let baseURL: URL
  private let tokenURL: URL
  init(baseURL: URL, tokenURL: URL) { self.baseURL = baseURL; self.tokenURL = tokenURL }

  func show() {
    if let w = window { w.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); return }

    let config = WKWebViewConfiguration()
    let bridge = PanelBridge(onCommand: { [weak self] in self?.handleCommand($0) })
    config.userContentController.add(bridge, name: "fairy")

    let frame = NSRect(x: 0, y: 0, width: 420, height: 640)
    let wv = WKWebView(frame: frame, configuration: config)
    wv.navigationDelegate = self
    webView = wv

    let w = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .resizable],
                     backing: .buffered, defer: false)
    w.title = "Fairy"
    w.contentView = wv
    w.isReleasedWhenClosed = false
    w.center()
    window = w
    w.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)

    showOverlay("Connecting…", retry: false)
    if let indexURL = Bundle.module.url(forResource: "index", withExtension: "html", subdirectory: "panel") {
      wv.loadFileURL(indexURL, allowingReadAccessTo: indexURL.deletingLastPathComponent())
    }
  }

  // Connect once the page has loaded, so window.__fairyBridge.onBeat is registered
  // before any beat arrives.
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    Task { await connect() }
  }

  private func connect() async {
    let info = await InfoClient(baseURL: baseURL, tokenURL: tokenURL, transport: URLSessionTransport()).fetch()
    guard case .success(let daemonInfo) = info,
          let token = TokenReader.read(from: tokenURL),
          let wsURL = URL(string: "ws://127.0.0.1:\(daemonInfo.conversationPort)") else {
      showOverlay("Couldn't reach the daemon — is it running?", retry: true)
      return
    }
    let c = ConversationClient(
      socket: URLSessionConversationSocket(url: wsURL),
      token: token,
      onBeat: { [weak self] json in self?.deliverBeat(json) }
    )
    client = c
    c.connect()
    hideOverlay()
  }

  private func handleCommand(_ body: [String: Any]) {
    switch body["type"] as? String {
    case "start": if let task = body["task"] as? String { client?.start(task) }
    case "stop": client?.stop()
    case "resolveProposal":
      if let proposal = body["proposal"],
         let data = try? JSONSerialization.data(withJSONObject: proposal),
         let json = String(data: data, encoding: .utf8) { client?.resolveProposal(json) }
    default: break
    }
  }

  private func deliverBeat(_ beatJSON: String) {
    // beatJSON is well-formed JSON (a valid JS object literal) — embed directly.
    webView?.evaluateJavaScript("window.__fairyBridge && window.__fairyBridge.onBeat(\(beatJSON))")
  }

  // MARK: - Connection overlay (native, over the WebView)

  private func showOverlay(_ text: String, retry: Bool) {
    guard let content = window?.contentView else { return }
    overlay?.removeFromSuperview()
    let box = NSView(frame: content.bounds)
    box.autoresizingMask = [.width, .height]
    box.wantsLayer = true
    box.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor

    let label = NSTextField(labelWithString: text)
    label.alignment = .center
    label.frame = NSRect(x: 20, y: content.bounds.midY, width: content.bounds.width - 40, height: 24)
    label.autoresizingMask = [.width, .minYMargin, .maxYMargin]
    box.addSubview(label)

    if retry {
      let button = NSButton(title: "Retry", target: self, action: #selector(retryTapped))
      button.frame = NSRect(x: content.bounds.midX - 40, y: content.bounds.midY - 40, width: 80, height: 28)
      button.autoresizingMask = [.minXMargin, .maxXMargin, .minYMargin, .maxYMargin]
      box.addSubview(button)
    }
    content.addSubview(box, positioned: .above, relativeTo: webView)
    overlay = box
  }

  private func hideOverlay() {
    overlay?.removeFromSuperview()
    overlay = nil
  }

  @objc private func retryTapped() {
    hideOverlay()
    showOverlay("Connecting…", retry: false)
    Task { await connect() }
  }
}
```

- [ ] **Step 3: Wire `AppDelegate`** — own the controller + add the menu item

In `applicationDidFinishLaunching`, after the `settingsWindow = SettingsWindowController { … }` block (which already has `baseURL`/`tokenURL` in scope), add:

```swift
    panelWindow = PanelWindowController(baseURL: baseURL, tokenURL: tokenURL)
```

Add the stored property near the other `private var` declarations:

```swift
  private var panelWindow: PanelWindowController!
```

In `buildMenu()`, insert an "Open Panel" item directly BEFORE the existing `let settings = NSMenuItem(title: "Settings…"…` line:

```swift
    let panel = NSMenuItem(title: "Open Panel", action: #selector(openPanel), keyEquivalent: "o")
    panel.target = self
    menu.addItem(panel)
```

Add the action next to `openSettings`:

```swift
  @objc private func openPanel() { panelWindow.show() }
```

- [ ] **Step 4: Build + library tests + manual smoke**

Run from `packages/mac-shell/`: `swift build` (PASS — compiles with WebKit + the bundled resource). `swift test` (the library suite — 66 tests — still PASS; this task only adds executable-target glue).

Manual smoke (human; needs a running daemon + a paired `token.json` + the bundled panel): `swift run fairy-shell`, menu → **Open Panel**; confirm the panel loads (the agent-panel feed UI), typing a task + send streams beats into the feed, and stopping the daemon then Retry shows the "Couldn't reach the daemon" overlay.

- [ ] **Step 5: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/Sources/fairy-shell/PanelBridge.swift \
        packages/mac-shell/Sources/fairy-shell/PanelWindowController.swift \
        packages/mac-shell/Sources/fairy-shell/AppDelegate.swift
git commit -F - <<'MSG'
feat(mac-shell): conversation panel window — WKWebView hosts agent-panel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 5: Final verification

**Files:** none (verification only)

- [ ] **Step 1: agent-panel suite + coverage**

Run from `packages/agent-panel/`: `bun run test:coverage 2>&1 | tail -15`
Expected: all pass; `src/shell/nativeBridge.ts` 100%; thresholds (≥90%) met; `src/shell/main.tsx` excluded.

- [ ] **Step 2: mac-shell build + tests**

Run from `packages/mac-shell/`: `swift build` (clean) and `swift test` (66 tests, 0 failures — PR-4b adds only glue + a committed resource, no new library units).

- [ ] **Step 3: Confirm the bundle is wired**

```bash
ls packages/mac-shell/Sources/fairy-shell/Resources/panel/index.html
grep -q 'Resources/panel' packages/mac-shell/Package.swift && echo "resource wired"
```
Expected: the index.html exists and `Package.swift` references the resource.

---

## Self-Review

**1. Spec coverage (PR-4b scope).**
- Native-owns-WS bridge; beats native→JS via `evaluateJavaScript`, commands JS→native via `WKScriptMessageHandler` → Task 4 (`PanelBridge` + `PanelWindowController.deliverBeat`/`handleCommand`).
- Reuse `agent-panel` via a thin shell host (`nativeBridge` tested unit + `shell/main.tsx` glue) → Tasks 1–2.
- Bundle a built panel into `Resources/panel` (committed, hermetic `swift build`) via `build:shell` + SPM `resources` → Tasks 2–3.
- Menu-opened singleton window (re-focus if open) → Task 4 (`show()`); "Open Panel" menu item → Task 4 step 3.
- Connect flow `InfoClient.fetch → ConversationClient.connect`; "no tab bound" surfaces as an error beat (native host sends `start` with no `chrome.*`) → Tasks 2 + 4.
- Error overlay with Retry on connect failure; token never enters the WebView (native reads it, owns the socket); beat injected as a JSON literal → Task 4.
- `nativeBridge` tested; glue runtime-verified → Tasks 1, 4–5.
  No PR-4b spec requirement is left without a task.

**2. Placeholder scan.** Every code step shows complete code (full file bodies for new files; exact insertions for `Package.swift`/`AppDelegate`/`vite.config.ts`/`package.json`). The two runtime-only checks (Task 4 step 4 smoke) are explicitly human glue checks. No "TBD"/"add validation"/"similar to Task N".

**3. Type consistency.** The bridge contract is consistent end to end: `nativeBridge` posts `{type:"start",task}` / `{type:"stop"}` / `{type:"resolveProposal",proposal}` (Task 1), `shell/main.tsx` wires those onto the `Panel` props (Task 2), and `PanelWindowController.handleCommand` switches on exactly those `type`s and calls `ConversationClient.start/stop/resolveProposal` (Task 4) — whose signatures come from PR-4a. `window.__fairyBridge.onBeat` (set in Task 2) is the exact expression `deliverBeat` calls (Task 4). `InfoClient(baseURL:tokenURL:transport:)`, `ConversationClient(socket:token:onBeat:)`, `URLSessionConversationSocket(url:)`, `TokenReader.read(from:)`, `DaemonInfo.conversationPort` (all PR-4a) match their uses in Task 4. `Bundle.module` resource `subdirectory: "panel"` matches `.copy("Resources/panel")` (Task 3). The `"fairy"` handler name matches between `config.userContentController.add(_, name: "fairy")` (Task 4) and `window.webkit.messageHandlers.fairy` (Task 2). `Panel` prop names (`onSend`/`onStop`/`onPause`/`onTakeover`/`onReset`/`onAnswer`/`onToggleActions`/`onTake`/`onRunAction`/`onResolveProposal`) and controller methods match the verified extension host.
