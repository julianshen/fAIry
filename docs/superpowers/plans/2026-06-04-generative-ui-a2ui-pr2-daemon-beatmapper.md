# Generative UI (A2UI) — PR-2: Daemon `beatMapper` → `ui` beat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the agent calls the `render_ui` tool, the daemon emits a `ui` beat carrying the A2UI message, so the agent's generated UI shows in the panel end-to-end.

**Architecture:** Single-file change in the daemon's `packages/pi-daemon/src/beatMapper.ts`. The mapper already translates Pi's `AgentEvent` stream into `PanelBeat`s. We add a `ui` beat variant and, in the existing `tool_use` case, special-case `render_ui`: flush any buffered text and emit `{ kind: "ui", a2ui: <message> }` instead of the page-action `act` beat. The daemon stays A2UI-agnostic — `a2ui` is typed `unknown` and passed through opaquely. Everything downstream is already generic (verified): `conversation.ts` pipes every beat to `onBeat` → WS; the extension's `conversationClient` forwards beats as opaque `unknown`; the panel's reducer + `A2UIView` (PR-1) render the `ui` beat.

**Tech Stack:** Bun + TypeScript (strict, `noUncheckedIndexedAccess`), Vitest (daemon coverage gate ≥90%).

---

## Verification outcome (the spec's flagged integration point — resolved)

The spec (`docs/superpowers/specs/2026-06-03-generative-ui-a2ui-design.md`) flagged: *does Pi's `AgentEvent` stream surface tool results richly, or must `render_ui` read `args.message`?* Resolved by reading the daemon:

- **`piSession.ts` emits two events per tool call:** `tool_use` (carries `id`, `name`, `input` — the call args) and `tool_result` (carries `id`, `output`, `isError`).
- **`render_ui` (`pi-extension/browser-bridge.ts`)** has args schema `{ message: Type.Any() }`, so `tool_use.input.message` is the A2UI message **object, directly**, always present.
- **The result is inferior here:** `piSession.onToolEnd` builds `output` by *joining the result's text blocks*, so `render_ui`'s result arrives **JSON-stringified** (`output = JSON.stringify(message)`), and the raw `details:message` object is dropped. Sourcing from the result would need `JSON.parse` plus correlating the `tool_result.id` back to the `tool_use.name`.

**Decision: source from `tool_use.input.message` (args).** Object directly, no parse, no correlation, always available. The spec explicitly pre-authorized this ("render_ui reads `args.message` — always available"). PR-3's convenience tools (`render_table`/etc.) don't carry the message in args and will be handled separately in their own plan — out of scope here.

---

## File Structure

- **Modify only:** `packages/pi-daemon/src/beatMapper.ts` — add the `ui` beat to `PanelBeat`; special-case `render_ui` in the `tool_use` case.
- **Test:** `packages/pi-daemon/src/beatMapper.test.ts` — new `render_ui` cases.

No other daemon file changes: `conversation.ts` consumes `PanelBeat` opaquely (`onBeat`), and the WS / `conversationClient` / panel path is generic and already handles new beat kinds (PR-1 renders `ui`).

---

### Task 1: Emit a `ui` beat for `render_ui`

**Files:**
- Modify: `packages/pi-daemon/src/beatMapper.ts`
- Test: `packages/pi-daemon/src/beatMapper.test.ts`

Run all commands from `packages/pi-daemon/`. Single-file test runs: `bunx vitest run src/beatMapper.test.ts`. Commit trailer MUST be exactly:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

- [ ] **Step 1: Write the failing tests**

Append this `describe` block to the end of `packages/pi-daemon/src/beatMapper.test.ts` (the file already defines `run(...events)` at the top and imports `BeatMapper`, `PanelBeat`, `AgentEvent` — reuse them):

```ts
describe("BeatMapper — render_ui (generative UI)", () => {
  it("emits a ui beat carrying the A2UI message instead of an act", () => {
    const message = { type: "card", title: "Summary", children: [] };
    const beats = run({ type: "tool_use", id: "u1", name: "render_ui", input: { message } });
    expect(beats).toEqual([{ kind: "ui", a2ui: message }]);
  });

  it("flushes buffered text before the ui beat", () => {
    const message = { type: "text", text: "hi" };
    const beats = run(
      { type: "text_delta", text: "here you go" },
      { type: "tool_use", id: "u1", name: "render_ui", input: { message } },
    );
    expect(beats).toEqual([
      { kind: "thinking", agent: "sage" },
      { kind: "say", agent: "sage", text: "here you go" },
      { kind: "ui", a2ui: message },
    ]);
  });

  it("does not open an action group for render_ui (a later page tool opens its own)", () => {
    const beats = run(
      { type: "tool_use", id: "u1", name: "render_ui", input: { message: { type: "text", text: "x" } } },
      { type: "tool_use", id: "t2", name: "click", input: { selector: "#go" } },
    );
    expect(beats.filter((b) => b.kind === "actGroup")).toHaveLength(1);
    expect(beats.filter((b) => b.kind === "ui")).toHaveLength(1);
    expect(beats.filter((b) => b.kind === "act")).toHaveLength(1);
  });

  it("still emits a ui beat when the message arg is missing", () => {
    const beats = run({ type: "tool_use", id: "u1", name: "render_ui", input: {} });
    expect(beats).toEqual([{ kind: "ui", a2ui: undefined }]);
  });

  it("closes the open action group: a page tool after render_ui opens a fresh group", () => {
    // The panel finalizes the running action group on a ui beat (like a say), so
    // the mapper must too — otherwise the next tool's act lands in a group the
    // panel already closed and is dropped.
    const beats = run(
      { type: "tool_use", id: "t1", name: "navigate", input: { url: "https://x.com" } },
      { type: "tool_use", id: "u1", name: "render_ui", input: { message: { type: "text", text: "x" } } },
      { type: "tool_use", id: "t2", name: "click", input: { selector: "#go" } },
    );
    expect(beats.filter((b) => b.kind === "actGroup")).toHaveLength(2);
    expect(beats.filter((b) => b.kind === "act")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/beatMapper.test.ts`
Expected: FAIL. The `ui`-beat tests fail two ways: TypeScript rejects `{ kind: "ui"; a2ui: ... }` (not yet in the `PanelBeat` union), and at runtime `render_ui` currently produces `actGroup` + `act` beats, not a `ui` beat.

- [ ] **Step 3: Add the `ui` beat to the `PanelBeat` union**

In `packages/pi-daemon/src/beatMapper.ts`, find the `PanelBeat` union. Find:

```ts
  | { kind: "act"; agent: PanelAgentId; verb: string; target: string; sub?: string }
  | { kind: "status"; run: PanelRun };
```

Replace with:

```ts
  | { kind: "act"; agent: PanelAgentId; verb: string; target: string; sub?: string }
  // A2UI message rendered into the panel (from the render_ui tool). The daemon is
  // A2UI-agnostic: `a2ui` is opaque wire data passed straight through to the panel.
  | { kind: "ui"; a2ui: unknown }
  | { kind: "status"; run: PanelRun };
```

- [ ] **Step 4: Add the `render_ui` tool-name constant**

In `packages/pi-daemon/src/beatMapper.ts`, find:

```ts
/** v1: a single agent. Multi-agent attribution is a deferred product decision. */
const AGENT: PanelAgentId = "sage";
```

Insert directly after it:

```ts
/**
 * The tool (registered in the Pi browser-bridge `-e` script) whose call produces
 * generative UI for the panel rather than a page action (see PR-2 plan).
 */
const RENDER_UI_TOOL = "render_ui";
```

- [ ] **Step 5: Special-case `render_ui` in the `tool_use` handler**

In `packages/pi-daemon/src/beatMapper.ts`, find the `tool_use` case:

```ts
      case "tool_use": {
        const beats = this.flush();
        if (!this.groupOpen) {
          beats.push({ kind: "actGroup", agent: AGENT, title: "Working on the page" });
          this.groupOpen = true;
        }
        beats.push({ kind: "act", agent: AGENT, verb: verbFor(event.name), target: targetFor(event.input) });
        return beats;
      }
```

Replace with:

```ts
      case "tool_use": {
        const beats = this.flush();
        if (event.name === RENDER_UI_TOOL) {
          // Generative UI, not a page action: emit a ui beat carrying the A2UI
          // message (from the call args — see the PR-2 plan's verification note)
          // instead of opening an action group. The panel finalizes the running
          // group on a ui beat (like a say), so clear groupOpen to stay in sync —
          // otherwise a later tool's act lands in a group the panel has closed.
          this.groupOpen = false;
          beats.push({ kind: "ui", a2ui: event.input.message });
          return beats;
        }
        if (!this.groupOpen) {
          beats.push({ kind: "actGroup", agent: AGENT, title: "Working on the page" });
          this.groupOpen = true;
        }
        beats.push({ kind: "act", agent: AGENT, verb: verbFor(event.name), target: targetFor(event.input) });
        return beats;
      }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bunx vitest run src/beatMapper.test.ts`
Expected: PASS (all existing beatMapper tests plus the four new `render_ui` tests).

- [ ] **Step 7: Run the full daemon suite + coverage + typecheck + lint**

Run: `bun run test && bun run typecheck && bun run lint`
Expected: PASS. (If the daemon's `package.json` lacks a `lint` script, skip lint and note it; `test` + `typecheck` must pass.) The new branch is covered by Step 1's tests, so the ≥90% coverage gate holds.

- [ ] **Step 8: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/pi-daemon/src/beatMapper.ts packages/pi-daemon/src/beatMapper.test.ts
git commit -F - <<'MSG'
feat(daemon): emit a ui beat for the render_ui tool (A2UI PR-2)

The beatMapper now recognizes the render_ui tool call and emits a `ui` beat
carrying the A2UI message (read from the call args — the result arrives
JSON-stringified, so args is the direct source) instead of a page-action `act`.
Everything downstream is already generic, so the agent's render_ui now shows in
the panel end-to-end. Convenience tools (render_table/chart/list) are PR-3.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

## Manual end-to-end check (optional, needs a real `pi`)

Unit tests fully cover the mapper logic. To eyeball the whole path with a live agent: run the daemon (`bun src/main.ts`), pair the extension, and prompt the agent to "show a comparison table" (or have it call `render_ui` directly). The panel should render the A2UI table/card/chart inline instead of an activity row. Not required to land PR-2.

---

## Self-Review

**1. Spec coverage.** The spec's PR-2 item — "Daemon `beatMapper` → `ui` beat on `render_ui` — now the agent's `render_ui` actually shows in the panel end-to-end" — is implemented by Task 1. The spec's flagged integration point is resolved in the Verification section (args over result, with evidence). Convenience tools and the `render_ui`-family recognition are explicitly PR-3 (deferred), per the spec's own sequencing. No PR-2 spec requirement is left without a task.

**2. Placeholder scan.** No "TBD"/"TODO"/"handle edge cases"/"similar to Task N". Every code step shows the complete before/after; the test step shows full test code; commands show expected outcomes. ✓

**3. Type consistency.** The new beat is `{ kind: "ui"; a2ui: unknown }` in both the `PanelBeat` union (Step 3) and the emitted object (Step 5), and the tests assert `{ kind: "ui", a2ui: <message> }` (Step 1). `RENDER_UI_TOOL` is defined in Step 4 and used in Step 5. `event.input.message` is valid: `AgentEvent`'s `tool_use.input` is `Record<string, unknown>`, so `.message` is `unknown`, matching `a2ui: unknown`. ✓
