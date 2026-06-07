# proposeSave (save loop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The agent drafts a save via `browser_propose_save`; a proposal card appears in the panel; on **Save** the daemon persists it (skill→`domainSkills`, action→a new `actionsStore`); on **Dismiss** nothing is saved.

**Architecture:** `browser_propose_save` returns `{proposed:true}` locally; the daemon `beatMapper` emits a `{kind:"proposal", proposal}` beat (the render_ui pattern). The panel renders a card and, on Save, sends `{type:"resolveProposal", proposal, accept:true}` back over the conversation WS; the daemon's `ConversationController.resolveProposal` runs an injected `saveProposal` and emits a `say` outcome beat. The daemon holds no pending-proposal state.

**Tech Stack:** Bun + TypeScript (strict, `noUncheckedIndexedAccess`), Vitest (≥90% per package), React (agent-panel).

**Spec:** `docs/superpowers/specs/2026-06-06-propose-save-design.md`.

---

## File structure

- **pi-daemon** (`packages/pi-daemon/src/`):
  - `actionsStore.ts` — **new**; JSON store for saved actions (`save`), modeled on `helperRegistry.ts`.
  - `beatMapper.ts` — **modify**; recognize the propose-save tool → `{kind:"proposal", proposal}` beat (+ `PanelBeat` variant).
  - `conversation.ts` — **modify**; `ConversationController` gains an injected `saveProposal` + a `resolveProposal(proposal)` method (save + outcome `say` beat).
  - `conversationSession.ts` — **modify**; `ConversationDriver` gains `resolveProposal`; handle the inbound `{type:"resolveProposal", …}` command.
  - `daemon.ts` — **modify**; build the controller with a `saveProposal` dispatcher (skill→`domainSkills`, action→`actionsStore`); add `actionsStore` to `DaemonOptions`.
  - `main.ts` — **modify** (glue, coverage-excluded); construct the `actionsStore`.
  - `testFakes.ts` — **modify**; add `fakeActionsStore`.
- **extension** (`packages/extension/src/`):
  - `conversationClient.ts` — **modify**; add `resolveProposal(proposal)`.
  - `panel/main.tsx` — **modify** (glue); wire the panel's resolve callback.
- **agent-panel** (`packages/agent-panel/src/`):
  - `types.ts` — **modify**; `SaveProposal`, the `proposal` Beat/FeedItem, the `resolveProposal` UiAction.
  - `engine.ts` — **modify**; reduce the proposal beat + resolveProposal; counts.
  - `usePanelController.ts` — **modify**; `resolveProposal` callback.
  - `components/ProposalCard.tsx` — **new**; the card.
  - `components/Panel.tsx` + feed renderer — **modify**; render the card, thread `onResolveProposal`.
  - styles (`*.css`) — **modify**; card styles (bare selectors).

Run per-package from its dir. Single test file: `bunx vitest run src/<file>.test.ts`. Commit trailer MUST be exactly:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

`SaveProposal` shape (used identically in daemon validation and panel types):
```ts
// kind:"skill"  → saved to domainSkills (host required)
// kind:"action" → saved to actionsStore (attach defaults to "none"; host optional)
{ kind: "skill" | "action"; name: string; content: string; host?: string; attach?: "activeTab" | "allTabs" | "none" }
```

---

### Task 1: `actionsStore` (daemon)

**Files:**
- Create: `packages/pi-daemon/src/actionsStore.ts`
- Test: `packages/pi-daemon/src/actionsStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/pi-daemon/src/actionsStore.test.ts` (model: `helperRegistry.test.ts` — open it to match the temp-dir idiom and vitest-import convention):

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createActionsStore } from "./actionsStore";

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "actions-"));
  file = join(dir, "actions.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("actionsStore", () => {
  it("saves an action and returns the stored record", () => {
    const store = createActionsStore(file);
    const saved = store.save({ name: "reorder", content: "re-buy my usuals", attach: "activeTab" });
    expect(saved).toMatchObject({ name: "reorder", content: "re-buy my usuals", attach: "activeTab" });
    expect(typeof saved.createdAt).toBe("number");
  });

  it("persists across reloads (atomic, load-once)", () => {
    createActionsStore(file).save({ name: "reorder", content: "x", attach: "none" });
    expect(createActionsStore(file).list().map((a) => a.name)).toEqual(["reorder"]);
  });

  it("upserts by name (no duplicates)", () => {
    const store = createActionsStore(file);
    store.save({ name: "reorder", content: "v1", attach: "none" });
    store.save({ name: "reorder", content: "v2", attach: "allTabs" });
    const all = store.list();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ content: "v2", attach: "allTabs" });
  });

  it("rejects an empty/whitespace name", () => {
    const store = createActionsStore(file);
    expect(() => store.save({ name: "  ", content: "x", attach: "none" })).toThrow(/name/i);
  });

  it("rejects empty content", () => {
    const store = createActionsStore(file);
    expect(() => store.save({ name: "ok", content: "  ", attach: "none" })).toThrow(/content/i);
  });

  it("reads an absent file as empty", () => {
    expect(createActionsStore(file).list()).toEqual([]);
  });
});
```

(`list()` is included now because the test needs it to assert persistence; it's a trivial accessor PR-B will also use.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/pi-daemon && bunx vitest run src/actionsStore.test.ts`
Expected: FAIL — `createActionsStore` cannot be imported.

- [ ] **Step 3: Implement `actionsStore`**

Create `packages/pi-daemon/src/actionsStore.ts`:

```ts
import { loadJsonArray, writeJsonFile } from "./fsAtomic";

/** A re-runnable prompt the user saved (the agent proposes, the user confirms). */
export interface SavedAction {
  name: string;
  /** The natural-language prompt to re-feed as a task. */
  content: string;
  /** Which tab(s) a future run targets (honored by PR-B's runner). */
  attach: "activeTab" | "allTabs" | "none";
  /** Optional site the action was drafted on. */
  host?: string;
  createdAt: number;
}

export interface ActionsStore {
  list(): SavedAction[];
  save(input: { name: string; content: string; attach: SavedAction["attach"]; host?: string }): SavedAction;
}

/**
 * Persistent store of saved "actions" (re-runnable prompts). Daemon-owned,
 * JSON-backed (atomic writes), loaded once; a missing/corrupt file reads as
 * empty. The name is an in-memory key (not a path), so only non-empty is
 * required. PR-B adds listing + a runner on top of this.
 */
export function createActionsStore(file: string): ActionsStore {
  let actions = loadJsonArray<SavedAction>(file);
  return {
    list: () => actions.slice(),
    save: (input) => {
      const name = input.name.trim();
      if (name.length === 0) throw new Error("action name required");
      if (input.content.trim().length === 0) throw new Error("action content required");
      const record: SavedAction = { name, content: input.content, attach: input.attach, host: input.host, createdAt: Date.now() };
      actions = actions.filter((a) => a.name !== name).concat(record);
      writeJsonFile(file, actions, 0o600);
      return record;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/actionsStore.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck + lint + commit**

Run: `bun run typecheck && bun run lint` (PASS). Then:
```bash
cd /Users/julianshen/prj/fAIry
git add packages/pi-daemon/src/actionsStore.ts packages/pi-daemon/src/actionsStore.test.ts
git commit -F - <<'MSG'
feat(daemon): actionsStore — persist saved actions (for proposeSave)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 2: `beatMapper` — proposal beat (daemon)

**Files:**
- Modify: `packages/pi-daemon/src/beatMapper.ts`
- Test: `packages/pi-daemon/src/beatMapper.test.ts`

- [ ] **Step 1: Write the failing test**

Open `packages/pi-daemon/src/beatMapper.test.ts` and find an existing `render_ui` `tool_use` test to copy its event shape. Add:

```ts
it("maps a propose_save tool_use to a proposal beat carrying the draft", () => {
  const mapper = new BeatMapper();
  const proposal = { kind: "skill", name: "checkout", content: "# notes", host: "shop.example" };
  const beats = mapper.apply({ type: "tool_use", name: "browser_propose_save", input: proposal });
  expect(beats).toContainEqual({ kind: "proposal", proposal });
});

it("ignores a propose_save tool_use with a non-object input", () => {
  const mapper = new BeatMapper();
  const beats = mapper.apply({ type: "tool_use", name: "browser_propose_save", input: "nope" });
  expect(beats.some((b) => b.kind === "proposal")).toBe(false);
});
```

(Match the exact `AgentEvent` shape the other `tool_use` tests use — `type`/`name`/`input` field names may differ; adapt to the file's idiom. If `BeatMapper` isn't exported as a class there, follow how the existing tests construct it.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/beatMapper.test.ts -t "propose_save"`
Expected: FAIL — no proposal beat emitted (and a TS error if `proposal` isn't a `PanelBeat` variant yet).

- [ ] **Step 3: Implement**

In `packages/pi-daemon/src/beatMapper.ts`:

1. Add the `PanelBeat` variant (next to the `ui` one):
```ts
  // A save the agent drafted (from the propose_save tool). The daemon is shape-
  // agnostic — the proposal is opaque, like `a2ui`; the panel coerces it.
  | { kind: "proposal"; proposal: unknown }
```

2. Add the tool constant near `RENDER_UI_TOOL`:
```ts
const PROPOSE_SAVE_TOOL = "browser_propose_save";
```

3. In the `tool_use` case, mirroring the `RENDER_UI_TOOL` branch, before the generic `act` push:
```ts
        if (event.name === PROPOSE_SAVE_TOOL) {
          // Only surface a proposal for a well-formed draft; a malformed call
          // shouldn't crash the feed (the panel coerces too).
          if (typeof event.input === "object" && event.input !== null) {
            beats.push({ kind: "proposal", proposal: event.input });
          }
          return beats;
        }
```

(Match the surrounding control flow — whether the branch `return`s the accumulated `beats` or pushes and falls through. Use the same `event.input` accessor the `render_ui` branch uses.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/beatMapper.test.ts`
Expected: PASS (all, incl. the 2 new).

- [ ] **Step 5: Typecheck + lint + commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/pi-daemon/src/beatMapper.ts packages/pi-daemon/src/beatMapper.test.ts
git commit -F - <<'MSG'
feat(daemon): beatMapper emits a proposal beat for browser_propose_save

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 3: `ConversationController.resolveProposal` (daemon)

**Files:**
- Modify: `packages/pi-daemon/src/conversation.ts`
- Test: `packages/pi-daemon/src/conversation.test.ts`

- [ ] **Step 1: Write the failing test**

Open `packages/pi-daemon/src/conversation.test.ts` to match its `ConversationController` construction idiom (it injects `spawn` + `onBeat`; use a silent spawner from `testFakes`). Add:

```ts
it("resolveProposal saves via the injected saveProposal and emits a success say beat", async () => {
  const beats: PanelBeat[] = [];
  const saved: unknown[] = [];
  const c = new ConversationController({
    spawn: silentSpawn,
    onBeat: (b) => beats.push(b),
    saveProposal: async (p) => { saved.push(p); },
  });
  const proposal = { kind: "skill", name: "checkout", content: "# notes", host: "shop.example" };
  c.resolveProposal(proposal);
  await new Promise((r) => setTimeout(r, 0)); // let the async save settle
  expect(saved).toEqual([proposal]);
  expect(beats.some((b) => b.kind === "say" && /saved/i.test((b as { text: string }).text))).toBe(true);
});

it("resolveProposal emits an error say beat when the save fails", async () => {
  const beats: PanelBeat[] = [];
  const c = new ConversationController({
    spawn: silentSpawn,
    onBeat: (b) => beats.push(b),
    saveProposal: async () => { throw new Error("bad host"); },
  });
  c.resolveProposal({ kind: "skill", name: "x", content: "y" });
  await new Promise((r) => setTimeout(r, 0));
  expect(beats.some((b) => b.kind === "say" && /couldn.t save|bad host/i.test((b as { text: string }).text))).toBe(true);
});
```

Import `silentSpawn` from `./testFakes` and `PanelBeat` from `./beatMapper` (match the file's existing imports).

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/conversation.test.ts -t "resolveProposal"`
Expected: FAIL — `saveProposal` not an option / `resolveProposal` not a method.

- [ ] **Step 3: Implement**

In `packages/pi-daemon/src/conversation.ts`:

1. Add to `ConversationControllerOptions`:
```ts
  /** Persist a user-confirmed save proposal (skill→domainSkills, action→actionsStore).
   *  Injected so the controller stays free of store wiring. Rejects on invalid/failed save. */
  saveProposal: (proposal: unknown) => Promise<void>;
```

2. Add the method (after `compact`):
```ts
  /** Persist a proposal the user confirmed in the panel, then report the outcome. */
  resolveProposal(proposal: unknown): void {
    void this.opts
      .saveProposal(proposal)
      .then(() => {
        const name = typeof proposal === "object" && proposal !== null && typeof (proposal as { name?: unknown }).name === "string"
          ? (proposal as { name: string }).name
          : "draft";
        this.opts.onBeat({ kind: "say", agent: "sage", text: `Saved ${name}.` });
      })
      .catch((err: unknown) => {
        this.opts.onBeat({ kind: "say", agent: "sage", text: `⚠️ Couldn't save: ${err instanceof Error ? err.message : String(err)}` });
      });
  }
```

(Use the same `agent` id the controller uses elsewhere — grep the file for the existing `kind: "say"` / agent literal, e.g. `"sage"`, and match it.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/conversation.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `bun run typecheck` — it will FAIL where `createDaemon` constructs `ConversationController` without the now-required `saveProposal`. That's fixed in Task 4; if you must keep typecheck green between tasks, temporarily make `saveProposal` optional and guard it (`await this.opts.saveProposal?.(proposal)`), then make it required in Task 4. Otherwise proceed to Task 4 before the package-wide typecheck. **Commit:**
```bash
cd /Users/julianshen/prj/fAIry
git add packages/pi-daemon/src/conversation.ts packages/pi-daemon/src/conversation.test.ts
git commit -F - <<'MSG'
feat(daemon): ConversationController.resolveProposal (save + outcome beat)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 4: Session command + `createDaemon` wiring (daemon)

**Files:**
- Modify: `packages/pi-daemon/src/conversationSession.ts`
- Modify: `packages/pi-daemon/src/daemon.ts`
- Modify: `packages/pi-daemon/src/testFakes.ts`
- Modify: `packages/pi-daemon/src/main.ts` (glue, coverage-excluded)
- Test: `packages/pi-daemon/src/conversationSession.test.ts`, `packages/pi-daemon/src/daemon.test.ts`

- [ ] **Step 1: Write the failing tests**

(a) In `packages/pi-daemon/src/conversationSession.test.ts` (match its driver-fake idiom — the existing tests pass a fake `createDriver` and assert `start`/`stop` dispatch):

```ts
it("dispatches a resolveProposal command to the driver on accept", async () => {
  const calls: unknown[] = [];
  const driver = { start() {}, stop() {}, compact() { return; }, dispose() {}, resolveProposal: (p: unknown) => calls.push(p) };
  // ...construct the session with createDriver: () => driver, authenticate it
  // (copy the auth handshake from the existing start/stop test), then:
  session.onMessageForTest({ type: "resolveProposal", proposal: { kind: "skill", name: "n" }, accept: true });
  expect(calls).toEqual([{ kind: "skill", name: "n" }]);
});

it("ignores resolveProposal when accept is false", async () => {
  const calls: unknown[] = [];
  const driver = { start() {}, stop() {}, compact() { return; }, dispose() {}, resolveProposal: (p: unknown) => calls.push(p) };
  // ...authenticate as above, then:
  session.onMessageForTest({ type: "resolveProposal", proposal: { kind: "skill", name: "n" }, accept: false });
  expect(calls).toEqual([]);
});
```

Use the SAME mechanism the existing `start`/`stop` tests use to deliver an authed message (there is no `onMessageForTest` — replace those two lines with the real handshake + message-delivery the file already uses; adapt exactly).

(b) In `packages/pi-daemon/src/daemon.test.ts`, an integration test (model: the existing conversation relay/handshake tests + the `fakeDomainSkills`/`fakeActionsStore` opts):

```ts
it("resolveProposal over the conversation WS saves a skill via domainSkills", async () => {
  const saved: Array<{ host: string; name: string; body: string }> = [];
  const daemon = await createDaemon({
    token: TOKEN, settings: fakeStore(), skills: fakeSkills(), helpers: fakeHelpers(),
    domainSkills: fakeDomainSkills({ save: (host, name, body) => { saved.push({ host, name, body }); return Promise.resolve({ name, host, body, bytes: body.length, updatedAt: 0 }); } }),
    actionsStore: fakeActionsStore(), recorder: fakeRecorder(), spawnPi: silentSpawn,
  });
  try {
    const panel = lineClient(daemon.ports.conversation); // use the conversation port + its auth idiom
    // ...authenticate the panel (copy an existing conversation-session test), then:
    panel.send({ type: "resolveProposal", proposal: { kind: "skill", name: "checkout", content: "# n", host: "shop.example" }, accept: true });
    await waitFor(() => saved.length === 1);
    expect(saved[0]).toEqual({ host: "shop.example", name: "checkout", body: "# n" });
  } finally { await daemon.close(); }
});
```

Adapt the panel-connect + auth + the conversation port accessor to the file's existing conversation tests (the WS uses the same `{type:"auth",token}` handshake; `daemon.ports` field name for the conversation server may differ — grep the file). Add a small `waitFor(pred)` poll if the file doesn't have one.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/conversationSession.test.ts src/daemon.test.ts -t "resolveProposal"`
Expected: FAIL — driver has no `resolveProposal`; `actionsStore`/`fakeActionsStore` unknown.

- [ ] **Step 3: Implement**

1. `conversationSession.ts` — add to `ConversationDriver`:
```ts
  resolveProposal(proposal: unknown): void;
```
and in `onAuthedMessage`, after the `stop` branch:
```ts
    } else if (cmd.type === "resolveProposal" && (cmd as { accept?: unknown }).accept === true) {
      this.driver?.resolveProposal((cmd as { proposal?: unknown }).proposal);
    }
```
(widen the local `cmd` cast to include `proposal?: unknown; accept?: unknown`).

2. `testFakes.ts` — add:
```ts
export const fakeActionsStore = (over: Partial<ActionsStore> = {}): ActionsStore => ({
  list: () => [],
  save: (input) => ({ ...input, createdAt: 0 }),
  ...over,
});
```
(import `ActionsStore` from `./actionsStore`; match the file's other `fake*` export style.)

3. `daemon.ts` — add `actionsStore: ActionsStore` to `DaemonOptions` (import the type); in the `createDriver` wiring (where `ConversationController` is built with `spawn`/`onBeat`), add the dispatcher:
```ts
      saveProposal: async (proposal: unknown) => {
        const p = coerceProposal(proposal); // validates kind/name/content/host/attach; throws on invalid
        if (p.kind === "skill") {
          await opts.domainSkills.save(p.host, p.name, p.content);
        } else {
          opts.actionsStore.save({ name: p.name, content: p.content, attach: p.attach, host: p.host });
        }
      },
```
and add the validator near the top of `daemon.ts` (or a tiny local helper file if you prefer):
```ts
type CoercedProposal =
  | { kind: "skill"; name: string; content: string; host: string }
  | { kind: "action"; name: string; content: string; attach: "activeTab" | "allTabs" | "none"; host?: string };

function coerceProposal(v: unknown): CoercedProposal {
  if (typeof v !== "object" || v === null) throw new Error("invalid proposal");
  const o = v as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  const content = typeof o.content === "string" ? o.content : "";
  if (name.length === 0) throw new Error("proposal name required");
  if (content.trim().length === 0) throw new Error("proposal content required");
  if (o.kind === "skill") {
    const host = typeof o.host === "string" ? o.host : "";
    if (host.trim().length === 0) throw new Error("a skill proposal needs a host");
    return { kind: "skill", name, content, host };
  }
  if (o.kind === "action") {
    const attach = o.attach === "activeTab" || o.attach === "allTabs" || o.attach === "none" ? o.attach : "none";
    return { kind: "action", name, content, attach, host: typeof o.host === "string" ? o.host : undefined };
  }
  throw new Error(`unknown proposal kind: ${String(o.kind)}`);
}
```

4. `main.ts` (glue) — construct the store and pass it (mirror how `domainSkills` is constructed there):
```ts
  actionsStore: createActionsStore(path.join(workspace, "actions.json")),
```
(use the same workspace/paths variable `domainSkills` uses; import `createActionsStore`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/conversationSession.test.ts src/daemon.test.ts`
Expected: PASS.

- [ ] **Step 5: Full daemon suite + coverage + typecheck + lint + commit**

Run: `bun run test && bun run typecheck && bun run lint && bun run test:coverage` (all PASS, ≥90%). If Task 3 made `saveProposal` optional, make it required now and re-run. Then:
```bash
cd /Users/julianshen/prj/fAIry
git add packages/pi-daemon/src/conversationSession.ts packages/pi-daemon/src/daemon.ts packages/pi-daemon/src/testFakes.ts packages/pi-daemon/src/main.ts packages/pi-daemon/src/conversationSession.test.ts packages/pi-daemon/src/daemon.test.ts
git commit -F - <<'MSG'
feat(daemon): resolveProposal command saves via domainSkills/actionsStore

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 5: `conversationClient.resolveProposal` (extension)

**Files:**
- Modify: `packages/extension/src/conversationClient.ts`
- Test: `packages/extension/src/conversationClient.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/extension/src/conversationClient.test.ts` (match its fake-socket idiom used for the `start`/`stop` send tests):

```ts
it("resolveProposal sends a resolveProposal frame after auth", async () => {
  // ...open + auth the client against the fake socket exactly as the start/stop test does, then:
  client.resolveProposal({ kind: "skill", name: "checkout", content: "# n", host: "shop.example" });
  expect(sentFrames()).toContainEqual(
    JSON.stringify({ type: "resolveProposal", proposal: { kind: "skill", name: "checkout", content: "# n", host: "shop.example" }, accept: true }),
  );
});
```

(Replace `sentFrames()`/`client` setup with the file's actual helpers — copy the `start`/`stop` test's harness verbatim and just swap the call + assertion.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/extension && bunx vitest run src/conversationClient.test.ts -t "resolveProposal"`
Expected: FAIL — `resolveProposal` not on the client.

- [ ] **Step 3: Implement**

In `packages/extension/src/conversationClient.ts`: add to the `ConversationClient` interface:
```ts
  /** Send a user-confirmed save proposal to the daemon. */
  resolveProposal(proposal: unknown): void;
```
and to the returned object (next to `start`/`stop`):
```ts
    resolveProposal: (proposal) => send({ type: "resolveProposal", proposal, accept: true }),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/conversationClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint + commit**

Run: `bun run typecheck && bun run lint`. Then:
```bash
cd /Users/julianshen/prj/fAIry
git add packages/extension/src/conversationClient.ts packages/extension/src/conversationClient.test.ts
git commit -F - <<'MSG'
feat(extension): conversationClient.resolveProposal sends the confirmed save

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 6: Panel types + reducer (agent-panel)

**Files:**
- Modify: `packages/agent-panel/src/types.ts`
- Modify: `packages/agent-panel/src/engine.ts`
- Test: `packages/agent-panel/src/engine.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/agent-panel/src/engine.test.ts` (match its `reduce(initialState(), beat)` idiom):

```ts
const PROPOSAL = { kind: "skill", name: "checkout", content: "# notes", host: "shop.example" } as const;

it("a proposal beat appends a proposal feed item", () => {
  const s = reduce(initialState(), { kind: "proposal", proposal: PROPOSAL });
  const it = s.items.at(-1)!;
  expect(it.type).toBe("proposal");
  expect((it as { proposal: unknown }).proposal).toEqual(PROPOSAL);
  expect((it as { resolved?: string }).resolved).toBeUndefined();
});

it("resolveProposal(accept) marks the item saved", () => {
  let s = reduce(initialState(), { kind: "proposal", proposal: PROPOSAL });
  const key = s.items.at(-1)!.key;
  s = reduce(s, { kind: "resolveProposal", key, accept: true });
  expect((s.items.at(-1) as { resolved?: string }).resolved).toBe("saved");
});

it("resolveProposal(dismiss) marks the item dismissed", () => {
  let s = reduce(initialState(), { kind: "proposal", proposal: PROPOSAL });
  const key = s.items.at(-1)!.key;
  s = reduce(s, { kind: "resolveProposal", key, accept: false });
  expect((s.items.at(-1) as { resolved?: string }).resolved).toBe("dismissed");
});

it("resolving an already-resolved proposal is a no-op", () => {
  let s = reduce(initialState(), { kind: "proposal", proposal: PROPOSAL });
  const key = s.items.at(-1)!.key;
  s = reduce(s, { kind: "resolveProposal", key, accept: true });
  s = reduce(s, { kind: "resolveProposal", key, accept: false });
  expect((s.items.at(-1) as { resolved?: string }).resolved).toBe("saved");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/agent-panel && bunx vitest run src/engine.test.ts -t "proposal"`
Expected: FAIL — unknown beat/action kinds; TS errors.

- [ ] **Step 3: Implement**

1. `types.ts` — add the shared type and the three unions:
```ts
export interface SaveProposal {
  kind: "skill" | "action";
  name: string;
  content: string;
  host?: string;
  attach?: "activeTab" | "allTabs" | "none";
}
```
- to `FeedItem`: `| (ItemBase & { type: "proposal"; proposal: SaveProposal; resolved?: "saved" | "dismissed" })`
- to `Beat`: `| { kind: "proposal"; proposal: SaveProposal }`
- to `UiAction`: `| { kind: "resolveProposal"; key: number; accept: boolean }`

2. `engine.ts` — add two cases to `reduce` (place near `confirm`/`answerConfirm`):
```ts
    case "proposal": {
      const seq = state.seq + 1;
      return {
        ...state,
        seq,
        items: [...finalizeActions(state.items), { type: "proposal", key: seq, proposal: action.proposal }],
      };
    }

    case "resolveProposal":
      return {
        ...state,
        items: state.items.map((it) =>
          it.type === "proposal" && it.key === action.key && it.resolved === undefined
            ? { ...it, resolved: action.accept ? "saved" : "dismissed" }
            : it,
        ),
      };
```

3. `engine.ts` — in `counts()`, add `"proposal"` to the `chat` group condition (the `it.type === "user" || …` list).

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint + commit**

Run: `bun run typecheck && bun run lint` (PASS — `reduce`'s switch stays exhaustive). Then:
```bash
cd /Users/julianshen/prj/fAIry
git add packages/agent-panel/src/types.ts packages/agent-panel/src/engine.ts packages/agent-panel/src/engine.test.ts
git commit -F - <<'MSG'
feat(panel): proposal beat + resolveProposal reducer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 7: Proposal card + Panel wiring (agent-panel + extension)

**Files:**
- Create: `packages/agent-panel/src/components/ProposalCard.tsx`
- Modify: `packages/agent-panel/src/usePanelController.ts`
- Modify: `packages/agent-panel/src/components/Panel.tsx` (+ the feed renderer that switches on `item.type`)
- Modify: a panel CSS file (where `.confirm`/card styles live)
- Modify: `packages/extension/src/panel/main.tsx`
- Test: `packages/agent-panel/src/components/ProposalCard.test.tsx` (match the existing component-test idiom, e.g. the confirm card's test if present; otherwise a focused render + click test with @testing-library)

- [ ] **Step 1: Write the failing test**

Create `packages/agent-panel/src/components/ProposalCard.test.tsx` (mirror an existing component test — open one under `components/` for the render/click idiom; if the project uses `@testing-library/react`, follow that):

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProposalCard } from "./ProposalCard";

const proposal = { kind: "skill", name: "checkout", content: "# notes\nstep 1", host: "shop.example" } as const;

describe("ProposalCard", () => {
  it("shows the name, host, a content preview, and Save/Dismiss", () => {
    render(<ProposalCard proposal={proposal} onResolve={() => {}} />);
    expect(screen.getByText("checkout")).toBeTruthy();
    expect(screen.getByText(/shop\.example/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /save/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeTruthy();
  });

  it("calls onResolve(true) on Save and onResolve(false) on Dismiss", () => {
    const onResolve = vi.fn();
    render(<ProposalCard proposal={proposal} onResolve={onResolve} />);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onResolve.mock.calls).toEqual([[true], [false]]);
  });

  it("disables the buttons once resolved", () => {
    render(<ProposalCard proposal={proposal} resolved="saved" onResolve={() => {}} />);
    expect((screen.getByRole("button", { name: /saved|save/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
```

(If the project's component tests don't use `@testing-library`, adapt to whatever the existing card tests use. If there are NO component tests in the package, keep this one and add `@testing-library/react` only if it's already a devDependency; otherwise drop the test to a shallow render via the package's existing approach and note it.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/components/ProposalCard.test.tsx`
Expected: FAIL — `ProposalCard` doesn't exist.

- [ ] **Step 3: Implement the card**

Create `packages/agent-panel/src/components/ProposalCard.tsx` (match the import/style conventions of a neighboring card, e.g. how the confirm/result card is written — `Icon`, class names):

```tsx
import type { SaveProposal } from "../types";

const PREVIEW_LINES = 6;

export function ProposalCard(props: {
  proposal: SaveProposal;
  resolved?: "saved" | "dismissed";
  onResolve: (accept: boolean) => void;
}): JSX.Element {
  const { proposal, resolved, onResolve } = props;
  const preview = proposal.content.split("\n").slice(0, PREVIEW_LINES).join("\n");
  const done = resolved !== undefined;
  return (
    <div className="proposal">
      <div className="proposal-head">
        💾 Save proposal · <span className="proposal-kind">{proposal.kind}</span>
      </div>
      <div className="proposal-name">{proposal.name}</div>
      {proposal.host !== undefined && <div className="proposal-meta">Host: {proposal.host}</div>}
      {proposal.kind === "action" && proposal.attach !== undefined && (
        <div className="proposal-meta">Attach: {proposal.attach}</div>
      )}
      <pre className="proposal-preview">{preview}</pre>
      <div className="proposal-actions">
        <button type="button" disabled={done} onClick={() => onResolve(true)}>
          {resolved === "saved" ? "Saved" : "Save"}
        </button>
        <button type="button" disabled={done} onClick={() => onResolve(false)}>
          {resolved === "dismissed" ? "Dismissed" : "Dismiss"}
        </button>
      </div>
    </div>
  );
}
```

(If the package targets a JSX runtime where `JSX.Element` isn't in scope, use `ReactElement` from `react` like the other components do.)

- [ ] **Step 4: Run the card test to verify it passes**

Run: `bunx vitest run src/components/ProposalCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire it into the controller, Panel, feed, CSS, and extension glue**

1. `usePanelController.ts` — add to `PanelController` and the returned object (next to `answer`):
```ts
  resolveProposal: (key: number, accept: boolean) => void;
```
```ts
  const resolveProposal = useCallback(
    (key: number, accept: boolean) => dispatch({ kind: "resolveProposal", key, accept }),
    [],
  );
```
(add `resolveProposal` to the returned object and the interface.)

2. `Panel.tsx` — add a prop `onResolveProposal: (item: { key: number; proposal: SaveProposal }, accept: boolean) => void;` and, in the feed renderer that switches on `item.type` (find the `case "confirm"` / `item.type === "confirm"` render), add:
```tsx
        {item.type === "proposal" && (
          <ProposalCard
            proposal={item.proposal}
            resolved={item.resolved}
            onResolve={(accept) => onResolveProposal({ key: item.key, proposal: item.proposal }, accept)}
          />
        )}
```
(import `ProposalCard`; match the surrounding rendering structure exactly — keys, wrapper elements.)

3. CSS — in the file holding the confirm/result card styles, add bare-selector rules (match the convention):
```css
.proposal { border: 1px solid var(--line, #2a2a2a); border-radius: 8px; padding: 10px; margin: 6px 0; }
.proposal-head { font-size: 12px; opacity: 0.7; }
.proposal-name { font-weight: 600; margin: 2px 0; }
.proposal-meta { font-size: 12px; opacity: 0.7; }
.proposal-preview { white-space: pre-wrap; max-height: 8em; overflow: auto; font-size: 12px; opacity: 0.85; }
.proposal-actions { display: flex; gap: 8px; margin-top: 8px; }
```
(reuse existing variables/spacing from neighboring card rules; don't introduce a new theming scheme.)

4. `extension/src/panel/main.tsx` — pass the new prop, wiring local mark + outbound send (send only on accept):
```tsx
      onResolveProposal={(item, accept) => {
        controller.resolveProposal(item.key, accept);
        if (accept) clientRef.current?.resolveProposal(item.proposal);
      }}
```

- [ ] **Step 6: Run all three packages' suites + builds**

```bash
cd packages/agent-panel && bun run test && bun run typecheck && bun run lint
cd ../extension && bun run test && bun run typecheck && bun run lint
cd ../pi-daemon && bun run test && bun run typecheck && bun run lint
```
Expected: all PASS, ≥90% coverage where gated. (If `@fairy/agent-panel` is consumed by the extension via a build, also run the extension's `vite build` if that's part of `bun run build` — confirm the new export resolves.)

- [ ] **Step 7: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/agent-panel/src/components/ProposalCard.tsx packages/agent-panel/src/components/ProposalCard.test.tsx packages/agent-panel/src/usePanelController.ts packages/agent-panel/src/components/Panel.tsx packages/agent-panel/src/*.css packages/extension/src/panel/main.tsx
git commit -F - <<'MSG'
feat(panel): proposal card + Save/Dismiss wiring to the daemon

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 8: `-e` tool + end-to-end check

**Files:**
- Modify: `packages/pi-daemon/pi-extension/browser-bridge.ts`

- [ ] **Step 1: Add the tool** (the `-e` script is standalone, outside the daemon tsconfig/coverage — not unit-tested, like the other `-e` tools). After a neighboring tool registration (e.g. near `render_ui`, which also returns locally), add:

```ts
  pi.registerTool({
    name: "browser_propose_save",
    label: "Propose a save",
    description:
      "Draft something for the user to save — you do NOT save directly; the user reviews a card and confirms. " +
      "kind='skill' for per-site knowledge (markdown 'content' + 'host' — pass the host of the site you're on); " +
      "kind='action' for a re-runnable request ('name' + a 'content' prompt + 'attach'=activeTab|allTabs|none). " +
      "Pick the single most useful thing and give it a short, clear name.",
    parameters: Type.Object({
      kind: Type.Union([Type.Literal("skill"), Type.Literal("action")]),
      name: Type.String(),
      content: Type.String(),
      host: Type.Optional(Type.String()),
      attach: Type.Optional(Type.Union([Type.Literal("activeTab"), Type.Literal("allTabs"), Type.Literal("none")])),
    }),
    // Returns locally (like render_ui) — the proposal surfaces as a panel beat via
    // the daemon's beatMapper; it is NOT forwarded to the browser executor.
    execute: async (_id, _params) => ({ proposed: true }),
  });
```

(Match the file's `Type`/`registerTool` idiom exactly; confirm `render_ui` is the local-return precedent and mirror its `execute` style.)

- [ ] **Step 2: Verify the standalone script still loads**

Run from `packages/pi-daemon`: `bun run test` — the existing `piBrowserExtension.test.ts` (real-`pi` `-e` load smoke; skips if `pi` is absent) must still pass / not regress. Also `bun run typecheck`.

- [ ] **Step 3: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/pi-daemon/pi-extension/browser-bridge.ts
git commit -F - <<'MSG'
feat(daemon): browser_propose_save -e tool (local return; beat-surfaced)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

## Self-Review

**1. Spec coverage.**
- `-e` tool `browser_propose_save` (returns `{proposed:true}` locally) → Task 8.
- beatMapper proposal beat → Task 2.
- New `actionsStore` (JSON, save) → Task 1; wired (skill→domainSkills, action→actionsStore) → Task 4.
- Panel holds the draft; `resolveProposal` outbound → Tasks 5 (client) + 6 (reducer) + 7 (card/wiring).
- Daemon stateless; driver `resolveProposal` + injected `saveProposal` + outcome `say` → Tasks 3 + 4.
- Dedicated proposal card previewing the draft → Task 7.
- Validation (kind/name/content; skill host; attach default) → `coerceProposal` (Task 4) + `actionsStore` (Task 1).
- Error-say on save failure → Task 3 (+ daemon integration test Task 4).
- Out of scope (list/run/attach-targeting) → not built; `actionsStore.list` added only as a trivial accessor PR-B reuses.
  No spec requirement is left without a task.

**2. Placeholder scan.** Code is provided for every implementation step. Where a test must bind to an existing file's harness (handshake helpers, fake-socket, component-test framework), the step says to copy the adjacent `start`/`stop`/`confirm` test's harness verbatim and only swap the call+assertion — this is adaptation to unread existing idioms, not a placeholder; the new assertions and production code are fully specified. No "TBD"/"add error handling"/"similar to Task N".

**3. Type consistency.** `SaveProposal` (panel) and `coerceProposal`/`CoercedProposal` (daemon) agree field-for-field (`kind/name/content/host?/attach?`). `ConversationController.resolveProposal(proposal: unknown)` ↔ `ConversationDriver.resolveProposal(proposal: unknown)` ↔ session dispatch ↔ `conversationClient.resolveProposal(proposal: unknown)` ↔ wire `{type:"resolveProposal", proposal, accept}`. `ActionsStore.save(input)` (Task 1) matches the `daemon.ts` call and `fakeActionsStore` (Task 4). The panel `resolveProposal` UiAction `{key, accept}` (Task 6) matches `usePanelController.resolveProposal(key, accept)` and the reducer (Task 7). `onBeat({kind:"say", agent})` uses the controller's existing agent id (verify in Task 3).
