# actions runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Saved actions appear as run-chips in the panel's empty state; clicking one re-feeds the action's prompt as a task, binding the active tab (for `attach:"activeTab"`/`"allTabs"`) or running unbound (for `attach:"none"`).

**Architecture:** The daemon pushes the saved-actions list to the panel as a state-updating `{kind:"actions"}` beat (on auth + after any save). The panel stores it in a non-feed `savedActions` slice and renders chips; a chip click runs the action via the existing start flow, with an `attach`-aware tab bind in the SW.

**Tech Stack:** Bun + TypeScript (strict, `noUncheckedIndexedAccess`), Vitest (≥90% per package), React (agent-panel).

**Spec:** `docs/superpowers/specs/2026-06-07-actions-runner-design.md`.

---

## File structure

- **extension** (`packages/extension/src/`):
  - `tabs/agentTabs.ts` — **modify**; add `clear()`.
  - `background.ts` — **modify** (SW glue, coverage-excluded); `agent:taskStart` honors `{bind:false}`.
  - `panel/main.tsx` — **modify** (glue); `onRunAction`.
- **pi-daemon** (`packages/pi-daemon/src/`):
  - `beatMapper.ts` — **modify**; `SavedActionView` type + the `{kind:"actions"}` `PanelBeat` variant.
  - `conversation.ts` — **modify**; `listActions` option + `pushActions()` + re-push in `resolveProposal`.
  - `conversationSession.ts` — **modify**; `ConversationDriver.pushActions` + push on auth.
  - `conversationServer.ts` — **modify**; thread `listActions`.
  - `daemon.ts` — **modify**; inject `listActions` (project `actionsStore.list()`).
- **agent-panel** (`packages/agent-panel/src/`):
  - `types.ts` — **modify**; `SavedActionView`, the `actions` Beat, `PanelState.savedActions`.
  - `engine.ts` — **modify**; reduce the `actions` beat; `initialState`.
  - `usePanelController.ts` — **modify**; expose `savedActions` + `onRunAction` passthrough (state only).
  - `components/EmptyState.tsx` — **modify**; render run-chips.
  - `components/Panel.tsx` — **modify**; thread `savedActions` + `onRunAction`.

Run per-package from its dir. Single test: `bunx vitest run src/<file>.test.ts`. Commit trailer MUST be exactly:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

Shared wire shape (defined in daemon `beatMapper.ts` and, identically, panel `types.ts` — they meet as JSON, like `PanelBeat`/`Beat`):
```ts
interface SavedActionView { name: string; content: string; attach: "activeTab" | "allTabs" | "none"; host?: string }
```

---

### Task 1: `agentTabs.clear()` (extension)

**Files:**
- Modify: `packages/extension/src/tabs/agentTabs.ts`
- Test: `packages/extension/src/tabs/agentTabs.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/extension/src/tabs/agentTabs.test.ts` (match its idiom — `createAgentTabs()`, the vitest-import convention), add:

```ts
it("clear() drops all owned tabs and the current one (for an unbound run)", () => {
  const tabs = createAgentTabs();
  tabs.bindSession(1);
  tabs.add(2);
  tabs.clear();
  expect(tabs.ids()).toEqual([]);
  expect(tabs.current()).toBeNull();
  expect(tabs.isOwned(1)).toBe(false);
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `cd packages/extension && bunx vitest run src/tabs/agentTabs.test.ts -t "clear"`
Expected: FAIL — `clear` is not a function.

- [ ] **Step 3: Implement**

In `packages/extension/src/tabs/agentTabs.ts`, add to the `AgentTabs` interface (near `bindSession`):
```ts
  /** Drop all ownership (unbound run): nothing is owned and `current()` is null. */
  clear(): void;
```
and to the returned object in `createAgentTabs` (next to `bindSession`):
```ts
    clear() {
      owned = new Set();
      current = null;
    },
```

- [ ] **Step 4: Run it, expect PASS**

Run: `bunx vitest run src/tabs/agentTabs.test.ts`
Expected: PASS (all, incl. the new test).

- [ ] **Step 5: Typecheck + lint + commit**

Run: `bun run typecheck && bun run lint`. Then:
```bash
cd /Users/julianshen/prj/fAIry
git add packages/extension/src/tabs/agentTabs.ts packages/extension/src/tabs/agentTabs.test.ts
git commit -F - <<'MSG'
feat(extension): agentTabs.clear() — drop ownership for an unbound run

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 2: `SavedActionView` beat + controller `pushActions` (daemon)

**Files:**
- Modify: `packages/pi-daemon/src/beatMapper.ts`
- Modify: `packages/pi-daemon/src/conversation.ts`
- Test: `packages/pi-daemon/src/conversation.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/pi-daemon/src/conversation.test.ts` (match its `ConversationController` construction idiom from the PR-A `resolveProposal` tests — `spawn: silentSpawn`, `onBeat`), add:

```ts
it("pushActions emits an actions beat from the injected listActions", () => {
  const beats: PanelBeat[] = [];
  const actions = [{ name: "reorder", content: "re-buy", attach: "none" as const }];
  const c = new ConversationController({ spawn: silentSpawn, onBeat: (b) => beats.push(b), listActions: () => actions });
  c.pushActions();
  expect(beats).toContainEqual({ kind: "actions", actions });
});

it("pushActions is a no-op when listActions is not wired", () => {
  const beats: PanelBeat[] = [];
  const c = new ConversationController({ spawn: silentSpawn, onBeat: (b) => beats.push(b) });
  c.pushActions();
  expect(beats).toEqual([]);
});

it("resolveProposal re-pushes the actions list after a successful save", async () => {
  const beats: PanelBeat[] = [];
  const c = new ConversationController({
    spawn: silentSpawn,
    onBeat: (b) => beats.push(b),
    saveProposal: async () => {},
    listActions: () => [{ name: "reorder", content: "x", attach: "none" as const }],
  });
  c.resolveProposal({ kind: "action", name: "reorder", content: "x", attach: "none" });
  await new Promise((r) => setTimeout(r, 0));
  expect(beats.some((b) => b.kind === "actions")).toBe(true);
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `cd packages/pi-daemon && bunx vitest run src/conversation.test.ts -t "pushActions|re-pushes"`
Expected: FAIL — `listActions` option / `pushActions` method don't exist (and a TS error until the `PanelBeat` variant is added).

- [ ] **Step 3: Implement**

(a) `beatMapper.ts` — add the type + the `PanelBeat` variant (next to the `proposal` variant):
```ts
/** A saved, re-runnable action projected for the panel (no on-disk metadata). */
export interface SavedActionView {
  name: string;
  content: string;
  attach: "activeTab" | "allTabs" | "none";
  host?: string;
}
```
```ts
  // The saved-actions list, pushed to the panel as a state update (not a feed
  // item) — emitted by the session/controller, not derived from a Pi event.
  | { kind: "actions"; actions: SavedActionView[] }
```

(b) `conversation.ts` — import the type and add the option + method:
- import: `import { BeatMapper, type PanelBeat, type SavedActionView } from "./beatMapper";` (extend the existing import).
- add to `ConversationControllerOptions`:
```ts
  /** The current saved-actions list, pushed to the panel on auth + after a save.
   *  Optional until createDaemon wires it. */
  listActions?: () => SavedActionView[];
```
- add the method (after `resolveProposal`):
```ts
  /** Push the current saved-actions list to the panel (a state-updating beat). */
  pushActions(): void {
    const list = this.opts.listActions;
    if (!list) return;
    this.opts.onBeat({ kind: "actions", actions: list() });
  }
```
- in `resolveProposal`'s `.then()` success branch, after emitting the "Saved …" say beat, add `this.pushActions();` (re-push after any successful save — re-emitting an unchanged list for a skill save is harmless).

- [ ] **Step 4: Run it, expect PASS**

Run: `bunx vitest run src/conversation.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint + commit**

Run: `bun run typecheck && bun run lint`. (`listActions` is optional, so `ConversationServer`/`createDaemon` still typecheck until Task 3.) Then:
```bash
cd /Users/julianshen/prj/fAIry
git add packages/pi-daemon/src/beatMapper.ts packages/pi-daemon/src/conversation.ts packages/pi-daemon/src/conversation.test.ts
git commit -F - <<'MSG'
feat(daemon): actions beat + ConversationController.pushActions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 3: Push on auth + `createDaemon` wiring (daemon)

**Files:**
- Modify: `packages/pi-daemon/src/conversationSession.ts`
- Modify: `packages/pi-daemon/src/conversationServer.ts`
- Modify: `packages/pi-daemon/src/daemon.ts`
- Test: `packages/pi-daemon/src/conversationSession.test.ts`, `packages/pi-daemon/src/daemon.test.ts`

- [ ] **Step 1: Write the failing tests**

(a) `conversationSession.test.ts` — every fake driver in this file must gain `pushActions` (the interface adds it; update them like `resolveProposal` was added). Add a test that the session pushes on auth (match the file's auth-handshake idiom):

```ts
it("calls driver.pushActions once the session authenticates", async () => {
  let pushed = 0;
  const driver = { start() {}, stop() {}, compact() {}, dispose() {}, resolveProposal() {}, pushActions: () => { pushed++; } };
  // build the session with createDriver: () => driver, then complete the auth handshake (copy an existing test); after auth:
  expect(pushed).toBe(1);
});
```

(b) `daemon.test.ts` — an integration test (model the PR-A conversation-WS tests; add a small `readUntil` poll if the file lacks one):

```ts
it("pushes an actions beat to the panel on auth", async () => {
  const daemon = await createDaemon({
    token: TOKEN, settings: fakeStore(), skills: fakeSkills(), helpers: fakeHelpers(),
    domainSkills: fakeDomainSkills(),
    actionsStore: fakeActionsStore({ list: () => [{ name: "reorder", content: "re-buy", attach: "none", createdAt: 0 }] }),
    recorder: fakeRecorder(), spawnPi: silentSpawn,
  });
  try {
    const panel = new WebSocket(`ws://127.0.0.1:${daemon.ports.conversation}`);
    await once(panel, "open");
    panel.send(JSON.stringify({ type: "auth", token: TOKEN }));
    // read frames until the actions beat arrives (auth_ok comes first)
    let beat: { kind?: string; actions?: unknown } | undefined;
    while (beat?.kind !== "actions") {
      const [raw] = (await once(panel, "message")) as [Buffer];
      const f = JSON.parse(raw.toString()) as { type?: string; beat?: { kind?: string; actions?: unknown } };
      if (f.type === "beat") beat = f.beat;
    }
    expect(beat).toEqual({ kind: "actions", actions: [{ name: "reorder", content: "re-buy", attach: "none" }] });
    panel.close();
  } finally { await daemon.close(); }
});
```

(Adapt the connect/auth/port accessor + the message-read loop to the file's exact helpers, as in PR-A. Note the projected beat drops `createdAt`.)

- [ ] **Step 2: Run them, expect FAIL**

Run: `bunx vitest run src/conversationSession.test.ts src/daemon.test.ts -t "pushActions|actions beat"`
Expected: FAIL — driver has no `pushActions`; no actions beat pushed.

- [ ] **Step 3: Implement**

(a) `conversationSession.ts` — add to `ConversationDriver`:
```ts
  pushActions(): void;
```
and in the `onAuthenticated` method, after `this.driver = this.opts.createDriver(...)`, add:
```ts
    this.driver.pushActions();
```
(before or after `this.opts.onAuthenticated?.()` — either works; the connection is authenticated so `sendBeat` will send).

(b) `conversationServer.ts` — add to `ConversationServerOptions`:
```ts
  /** The current saved-actions list, threaded into each conversation. */
  listActions?: () => import("./beatMapper").SavedActionView[];
```
and pass it in `createDriver`:
```ts
          createDriver: (onBeat) =>
            new ConversationController({ spawn: opts.spawn, onBeat, saveProposal: opts.saveProposal, listActions: opts.listActions }),
```

(c) `daemon.ts` — where the `ConversationServer` is constructed (next to `saveProposal`), add:
```ts
    listActions: () =>
      opts.actionsStore.list().map((a) => ({ name: a.name, content: a.content, attach: a.attach, host: a.host })),
```

- [ ] **Step 4: Run them, expect PASS**

Run: `bunx vitest run src/conversationSession.test.ts src/daemon.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + coverage + typecheck + lint + commit**

Run: `bun run test && bun run typecheck && bun run lint && bun run test:coverage` (all PASS, ≥90%). Then:
```bash
cd /Users/julianshen/prj/fAIry
git add packages/pi-daemon/src/conversationSession.ts packages/pi-daemon/src/conversationServer.ts packages/pi-daemon/src/daemon.ts packages/pi-daemon/src/conversationSession.test.ts packages/pi-daemon/src/daemon.test.ts
git commit -F - <<'MSG'
feat(daemon): push saved-actions list to the panel on auth + after save

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 4: Panel types + reducer (agent-panel)

**Files:**
- Modify: `packages/agent-panel/src/types.ts`
- Modify: `packages/agent-panel/src/engine.ts`
- Test: `packages/agent-panel/src/engine.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/agent-panel/src/engine.test.ts`:

```ts
const ACTIONS = [{ name: "reorder", content: "re-buy", attach: "none" as const }];

it("an actions beat replaces savedActions (non-feed state)", () => {
  const s = reduce(initialState(), { kind: "actions", actions: ACTIONS });
  expect(s.savedActions).toEqual(ACTIONS);
  expect(s.items).toEqual([]); // not a feed item
});

it("a second actions beat replaces (not appends)", () => {
  let s = reduce(initialState(), { kind: "actions", actions: ACTIONS });
  s = reduce(s, { kind: "actions", actions: [] });
  expect(s.savedActions).toEqual([]);
});

it("drops malformed actions entries (defensive)", () => {
  const s = reduce(initialState(), {
    kind: "actions",
    actions: [{ name: "ok", content: "c", attach: "none" }, { name: 1 }, null, "x"] as never,
  });
  expect(s.savedActions).toEqual([{ name: "ok", content: "c", attach: "none" }]);
});

it("ignores a non-array actions payload", () => {
  const s = reduce(initialState(), { kind: "actions", actions: "nope" as never });
  expect(s.savedActions).toEqual([]);
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `cd packages/agent-panel && bunx vitest run src/engine.test.ts -t "actions beat|savedActions|malformed actions"`
Expected: FAIL — unknown beat kind; `savedActions` not on state.

- [ ] **Step 3: Implement**

(a) `types.ts`:
```ts
export interface SavedActionView {
  name: string;
  content: string;
  attach: "activeTab" | "allTabs" | "none";
  host?: string;
}
```
- add to `Beat`: `| { kind: "actions"; actions: SavedActionView[] }`
- add to `PanelState`: `savedActions: SavedActionView[];`

(b) `engine.ts`:
- in `initialState()`, add `savedActions: []` to the returned object.
- add a `reduce` case (near the other state-only beats like `status`):
```ts
    case "actions": {
      const raw: unknown = action.actions;
      const savedActions = Array.isArray(raw)
        ? (raw.filter(
            (a): a is SavedActionView =>
              typeof a === "object" &&
              a !== null &&
              typeof (a as { name?: unknown }).name === "string" &&
              typeof (a as { content?: unknown }).content === "string" &&
              typeof (a as { attach?: unknown }).attach === "string",
          ) as SavedActionView[])
        : [];
      return { ...state, savedActions };
    }
```
(import `SavedActionView` from `./types`.)

- [ ] **Step 4: Run it, expect PASS**

Run: `bunx vitest run src/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint + commit**

Run: `bun run typecheck && bun run lint` (the `reduce` switch stays exhaustive). Then:
```bash
cd /Users/julianshen/prj/fAIry
git add packages/agent-panel/src/types.ts packages/agent-panel/src/engine.ts packages/agent-panel/src/engine.test.ts
git commit -F - <<'MSG'
feat(panel): savedActions state + actions beat reducer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 5: Empty-state run-chips + Panel wiring (agent-panel)

**Files:**
- Modify: `packages/agent-panel/src/components/EmptyState.tsx`
- Modify: `packages/agent-panel/src/components/Panel.tsx`
- Modify: `packages/agent-panel/src/usePanelController.ts`
- Modify: a panel CSS file (where `.empty`/`.sug` styles live — likely `styles/content.css`)
- Test: `packages/agent-panel/src/components/EmptyState.test.tsx`

- [ ] **Step 1: Write the failing test**

In `packages/agent-panel/src/components/EmptyState.test.tsx` (match its render idiom):

```ts
const savedActions = [
  { name: "reorder usuals", content: "re-buy my usuals", attach: "activeTab" as const, host: "shop.example" },
  { name: "weekly report", content: "draft the report", attach: "none" as const },
];

it("renders a run-chip per saved action and calls onRunAction on click", async () => {
  const onRunAction = vi.fn();
  render(
    <EmptyState variant="suggestions" suggestions={[]} savedActions={savedActions} onPick={() => {}} onRunAction={onRunAction} />,
  );
  expect(screen.getByText("reorder usuals")).toBeTruthy();
  expect(screen.getByText("weekly report")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: /reorder usuals/i }));
  expect(onRunAction).toHaveBeenCalledWith(savedActions[0]);
});

it("shows no saved-actions section when there are none", () => {
  render(<EmptyState variant="suggestions" suggestions={[]} savedActions={[]} onPick={() => {}} onRunAction={() => {}} />);
  expect(screen.queryByText(/saved actions/i)).toBeNull();
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `bunx vitest run src/components/EmptyState.test.tsx -t "run-chip|saved-actions"`
Expected: FAIL — `EmptyState` has no `savedActions`/`onRunAction` props.

- [ ] **Step 3: Implement**

(a) `EmptyState.tsx` — extend `EmptyStateProps`:
```ts
  savedActions: SavedActionView[];
  onRunAction: (action: SavedActionView) => void;
```
(import `SavedActionView` from `../types`.) Add a section component and render it at the TOP of every variant's returned tree (so chips show regardless of variant). Add above the variant branches:
```tsx
  const actionsSection =
    savedActions.length > 0 ? (
      <div className="saved-actions">
        <div className="sug-cap">Saved actions</div>
        {savedActions.map((a) => (
          <button key={a.name} className="sug" onClick={() => onRunAction(a)}>
            <span className="si">
              <Icon name="play" size={15} />
            </span>
            <span className="st">
              <b>{a.name}</b>
              <span>{a.host ?? a.attach}</span>
            </span>
            <span className="go">
              <Icon name="arrowR" size={16} />
            </span>
          </button>
        ))}
      </div>
    ) : null;
```
Then wrap each variant's root so `actionsSection` renders first, e.g. for the default `suggestions` variant put `{actionsSection}` as the first child inside `<div className="empty" data-empty="suggestions">`, and likewise add `{actionsSection}` near the top of the `hero` and `grid` returns. (If an `Icon` named `play` doesn't exist, use an existing one such as `arrowR`/`sparkle` — check `components/Icon`.)

(b) `usePanelController.ts` — nothing new is required if `savedActions` comes from `state` (the reducer already stores it). Confirm `PanelController` exposes `state` (it does); the chips read `controller.state.savedActions`. No new callback here — `onRunAction` is host-supplied (extension), threaded through `Panel`.

(c) `Panel.tsx` — add props `savedActions?: SavedActionView[]` (default from `props.state.savedActions`) and `onRunAction: (action: SavedActionView) => void`; pass them to `<EmptyState … savedActions={props.state.savedActions} onRunAction={props.onRunAction} />`. (Import `SavedActionView` from `../types`.)

(d) CSS — add minimal rules in the card/empty styles file (bare selectors), reusing existing `.sug` styling:
```css
.saved-actions { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
```
(`.sug`/`.sug-cap`/`.si`/`.st`/`.go` already exist — the chips reuse them.)

- [ ] **Step 4: Run it, expect PASS**

Run: `bunx vitest run src/components/EmptyState.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full agent-panel suite + typecheck + lint + commit**

Run: `bun run test && bun run typecheck && bun run lint` (PASS — update any existing `EmptyState`/`Panel` tests/harness that construct the component without the new required props, adding `savedActions={[]}`/`onRunAction={() => {}}`). Then:
```bash
cd /Users/julianshen/prj/fAIry
git add packages/agent-panel/src/components/EmptyState.tsx packages/agent-panel/src/components/Panel.tsx packages/agent-panel/src/usePanelController.ts packages/agent-panel/src/components/EmptyState.test.tsx packages/agent-panel/src/styles/*.css
git commit -F - <<'MSG'
feat(panel): saved-action run-chips in the empty state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 6: Run path — SW bind + extension glue

**Files:**
- Modify: `packages/extension/src/background.ts` (SW glue, coverage-excluded)
- Modify: `packages/extension/src/panel/main.tsx` (glue)

- [ ] **Step 1: SW — honor `{bind:false}`**

In `packages/extension/src/background.ts`, the `agent:taskStart` handler currently always queries the active tab and `bindSession`s it. Change it to honor an optional `bind` field:

Find the handler body (the `tabsApi.queryActive().then(...)` block) and replace the bind logic so that:
```ts
    const bind = (msg as { bind?: unknown }).bind !== false; // default true
    if (!bind) {
      // Unbound run (attach:"none"): clear ownership + drop prior CDP subscriptions
      // for task isolation, then ack — no active tab needed.
      agentTabs.clear();
      events.unsubscribe();
      sendResponse({ ok: true });
      return true;
    }
```
Place this BEFORE the `tabsApi.queryActive()` call (keep the existing active-tab bind path for `bind !== false`). The `fromOwnPage` guard and `type === "agent:taskStart"` check are unchanged. (`background.ts` is coverage-excluded glue — verified by `bun run typecheck`, not a unit test.)

- [ ] **Step 2: Panel — `onRunAction`**

In `packages/extension/src/panel/main.tsx`, add an `onRunAction` wired to `<Panel>`, mirroring the existing `send`:
```tsx
  const runAction = (action: { content: string; attach: "activeTab" | "allTabs" | "none" }): void => {
    controller.reset();
    const bind = action.attach !== "none";
    chrome.runtime
      .sendMessage({ type: "agent:taskStart", bind })
      .then((res) => {
        if ((res as { ok?: boolean })?.ok) clientRef.current?.start(action.content);
        else console.error("[fairy] could not prepare a tab for the action", res);
      })
      .catch((err) => console.error("[fairy] runAction failed", err));
  };
```
and pass `onRunAction={runAction}` to `<Panel … />`. (Type `action` as `SavedActionView` imported from `@fairy/agent-panel` if it's exported there; otherwise the inline structural type above is fine.)

- [ ] **Step 3: Verify**

Run from `packages/extension/`: `bun run test && bun run typecheck && bun run lint` (PASS). If `@fairy/agent-panel` needs `SavedActionView` exported for `main.tsx`, add it to the package barrel (`src/index.ts`) and rebuild. (No unit test for the SW glue; the `agentTabs.clear()` unit test from Task 1 covers the testable core.)

- [ ] **Step 4: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/extension/src/background.ts packages/extension/src/panel/main.tsx packages/agent-panel/src/index.ts
git commit -F - <<'MSG'
feat(extension): run a saved action (attach-aware tab bind)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

## Self-Review

**1. Spec coverage.**
- Push actions list as a state-updating `{kind:"actions"}` beat on auth + after save → Tasks 2 (controller `pushActions` + re-push) + 3 (push on auth + `createDaemon` `listActions`).
- Panel stores in a non-feed `savedActions` slice; defensive coercion → Task 4.
- Run-chips in the empty state → Task 5.
- Run reuses the start flow; `attach:"activeTab"`/`"allTabs"` bind active, `"none"` runs unbound via `agent:taskStart {bind:false}` + `agentTabs.clear()` → Tasks 1 (`clear`) + 6 (SW + `onRunAction`).
- `SavedActionView` (project drops `createdAt`) → Tasks 2/3/4.
- Error handling (empty list, malformed beat, no-active-tab) → Task 4 (coercion) + Task 6 (existing no-active-tab path).
  No spec requirement is left without a task.

**2. Placeholder scan.** Every code step shows complete code; tests are full. Where a test binds to an existing harness (auth handshake, component test, fake drivers), the step says to copy the adjacent PR-A test and adapt — not a placeholder. No "TBD"/"add validation"/"similar to Task N". The one adaptive UI step (placing `{actionsSection}` in each variant + the `Icon` name) is explicit with a fallback.

**3. Type consistency.** `SavedActionView` is defined identically in daemon `beatMapper.ts` and panel `types.ts` (JSON-over-WS, like `PanelBeat`/`Beat`) and used by `listActions` (Task 3), the controller `pushActions` (Task 2), the reducer (Task 4), `EmptyState`/`Panel` props (Task 5), and `onRunAction` (Task 6). `ConversationDriver` gains `pushActions(): void` (Task 3) implemented by `ConversationController.pushActions` (Task 2). `agentTabs.clear()` (Task 1) is called by the SW (Task 6). `listActions` is optional on the controller/server until `createDaemon` provides it (Task 3), so each prior task typechecks.
