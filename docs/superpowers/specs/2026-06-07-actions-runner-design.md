# actions runner — design

**Status:** approved (design phase) · **Date:** 2026-06-07 · **Components:** pi-daemon (conversation session/controller), agent-panel (empty-state chips + state), extension (run path + SW) · **Builds on:** proposeSave PR-A (`actionsStore`, the conversation WS, the empty-state) · **Part of:** M4 "PR4" decomposition (PR-B; PR-A was the save loop).

## Context

PR-A let the agent draft a re-runnable **action** (a saved prompt + an `attach` scope) that the user confirms into a daemon-side `actionsStore`. This PR (PR-B) **runs** them: the panel lists saved actions and a click re-feeds the action's prompt as a task, honoring `attach`.

Running a task already exists: the panel's `send(task)` → SW `agent:taskStart` (binds the active tab via `agentTabs.bindSession`, drops prior CDP subscriptions for task isolation, acks) → `conversationClient.start(task)` → daemon `ConversationController.start`. "Run an action" reuses this with the action's `content` and an `attach`-aware bind step.

## Goal & non-goals

**Goal:** saved actions appear as run-chips in the panel's empty state; clicking one runs `action.content` as a fresh task, binding the active tab for `attach:"activeTab"` and running unbound for `attach:"none"`. The list stays current as new actions are saved.

**Non-goals (v1):**
- Managing actions (delete/edit/rename) — list + run only.
- True `attach:"allTabs"` fan-out — it doesn't fit the one-tab-ownership security model (driving arbitrary user tabs would break the cross-tab TOCTOU protection); v1 treats `allTabs` as `activeTab` (the card shows the stored value; the run binds the active tab). A real multi-tab model is a future enhancement.
- A persistent mid-session actions drawer — chips live in the empty state (between tasks). (A drawer is a noted future option.)
- Request/response over the WS — the list is pushed (see Decisions).

## Decisions (and why)

1. **The daemon pushes the actions list as a state-updating beat** `{kind:"actions", actions}` (not request/response). Emitted on conversation auth (initial list) and after a successful **action** save. Fits the existing one-way beat model, keeps the list fresh automatically (a just-confirmed action appears at once), and adds no request/response machinery. The panel stores it in a **non-feed** state slice — like `status` beats set run-state rather than appending a feed item. The beat is emitted directly by the session/controller (it's not derived from a Pi `AgentEvent`, so it does not go through the `beatMapper`).
2. **Run is panel-side, reusing the start flow.** Tab binding lives in the extension SW, so the run (and its `attach` handling) belongs there, not in the daemon. A click calls `onRunAction(action)`: `controller.reset()` → bind per `attach` → `client.start(action.content)`.
3. **`attach:"none"` runs unbound** via an `agent:taskStart` variant (`{ bind:false }`) that **clears** the agent's tab ownership (and unsubscribes events) instead of binding the active tab — a fresh, browser-less task. `attach:"activeTab"` (and `allTabs`) bind the active tab as today.
4. **Chips reuse the empty state.** Saved actions render where the static suggestions already live (`EmptyState` + an `onPick`-style callback), so there's no new persistent chrome. Reachable between tasks; running one starts a task (which replaces the empty state with the feed).

## Architecture & components

```text
proposeSave action save (PR-A)  ──┐
conversation auth                 ├─► daemon: ConversationSession emits {type:"beat", beat:{kind:"actions", actions}}
                                  ┘        (actions = actionsStore.list() projected to {name,content,attach,host?})
                                              │
                                   panel reducer: state.savedActions = actions  (replace; non-feed slice)
                                              │
                                   EmptyState renders a run-chip per action
                                              │ user clicks ▶
                                   onRunAction(action):
                                     controller.reset()
                                     attach==="none"
                                       ? sendMessage({type:"agent:taskStart", bind:false})  // SW clears ownership
                                       : sendMessage({type:"agent:taskStart"})              // SW binds active tab
                                     → client.start(action.content)
```

### pi-daemon

- **`conversationSession.ts` / `conversation.ts`** — push the current actions list to the panel. `ConversationDriver` gains `pushActions(): void` (a method, dispatched like `resolveProposal`, so timing is explicit). `ConversationController.pushActions()` builds `{kind:"actions", actions: this.opts.listActions()}` and emits it through `onBeat`; `listActions: () => SavedActionView[]` is a new injected option. The session calls `this.driver?.pushActions()` in `onAuthenticated` (right after the driver is created, when the connection is authenticated) for the initial list. The controller's `resolveProposal` calls `this.pushActions()` on a successful save (re-push after **any** save — re-emitting an unchanged list for a skill save is harmless and keeps the rule simple).
- **`daemon.ts`** — inject `listActions: () => opts.actionsStore.list().map(project)` into the controller (threaded through `ConversationServer`, like `saveProposal`). `project` drops `createdAt` → `SavedActionView = {name, content, attach, host?}`.
- **`beatMapper.ts` `PanelBeat`** — add the `{kind:"actions"; actions: SavedActionView[]}` variant to the daemon's beat union (the shared wire shape), even though the mapper doesn't produce it (the session does). Keeps the union the single source of the wire contract.

### agent-panel

- **`types.ts`** — `SavedActionView` (`{name, content, attach:"activeTab"|"allTabs"|"none", host?}`); `Beat` variant `{kind:"actions"; actions: SavedActionView[]}`; `PanelState.savedActions: SavedActionView[]` (default `[]`).
- **`engine.ts`** — reduce `actions` beat → `{...state, savedActions: <coerced array>}` (replace; drop malformed entries defensively). `initialState` adds `savedActions: []`.
- **EmptyState** (`components/…`) — render a run-chip per saved action (name + a small `attach`/host hint) above/with the existing suggestions; each calls `onRunAction(action)`. Keep the static suggestions for when there are no saved actions.
- **`usePanelController.ts` / Panel props** — expose `savedActions` and thread an `onRunAction(action)` prop to the empty state.

### extension

- **`panel/main.tsx`** — implement `onRunAction(action)`: `controller.reset()`; `bind = action.attach !== "none"`; `chrome.runtime.sendMessage({type:"agent:taskStart", bind})` then, on ok, `clientRef.current?.start(action.content)` (mirrors the existing `send`).
- **`background.ts`** — extend the `agent:taskStart` handler: when `bind === false`, clear ownership (`agentTabs.clear()` — new) + `events.unsubscribe()` + ack ok (no active-tab query); otherwise the current bind-active behavior. The "only own extension pages may bind/unbind" guard is unchanged.
- **`tabs/agentTabs.ts`** — add `clear()` (drop all owned tabs + current → null), for the unbound-run case.

## Error handling

- Empty `savedActions` → no chips; the existing empty-state suggestions show as before.
- Malformed `actions` beat (non-array, or entries missing `name`/`content`, or non-string `attach`) → ignored / filtered (defensive, like the proposal guard) so bad wire data can't crash the chips.
- `activeTab` run with no active tab → the existing `agent:taskStart` "no active tab to bind" error path (logged; no task started), unchanged.
- `none` run → never needs a tab; the cleared binding means a subsequent browser tool in that task fails with `NO_TAB_BOUND` (the action declared it doesn't need the browser — that's its contract).
- Running while a task runs → `reset()` + start, same as any task start.

## Testing

- **daemon**: the conversation session pushes an `actions` beat on auth (integration test: connect+auth a panel client, assert an `{type:"beat", beat:{kind:"actions"}}` frame with the store's list); after an action `resolveProposal` save, a fresh `actions` beat is pushed including the new action. `listActions` projection drops `createdAt`.
- **agent-panel engine**: `actions` beat → `state.savedActions` replaced; a second beat replaces (not appends); malformed entries dropped; non-array ignored.
- **agent-panel EmptyState**: renders a chip per saved action with the name; clicking calls `onRunAction` with that action; with no saved actions, the static suggestions render.
- **extension SW**: `agent:taskStart {bind:false}` clears ownership + unsubscribes + acks ok without querying the active tab (mirrors the existing bind test); `{bind:true}`/default still binds the active tab.
- **agentTabs**: `clear()` drops owned + current.
- TDD throughout; ≥90% per package. The `-e` script is unchanged (no new tool).

## Sequencing

PR-B (this spec) completes the proposeSave feature pair. Remaining M4-PR4: the group-2 finishers — `reader_extract` (inject Readability) and `waitFor` networkIdle. Then M5 (Swift shell), M6 (packaging). Future action enhancements (delete/edit, a mid-session drawer, real `allTabs`) are separate.
