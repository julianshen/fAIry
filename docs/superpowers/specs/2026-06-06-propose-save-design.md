# proposeSave (save loop) — design

**Status:** approved (design phase) · **Date:** 2026-06-06 · **Components:** pi-daemon (beatMapper + conversation session + new actions store), agent-panel (proposal card), extension (conversationClient) · **Builds on:** the daemon domain-skills store + the render_ui beat pattern + the panel's confirm primitive · **Part of:** M4 "PR4" decomposition.

## Context

When the user asks the agent to "save what you learned/did," the agent should not write to disk directly — it **drafts** a save and the user **confirms** it in the panel. This is the POC's `browser_propose_save`: the agent proposes `{kind, name, content, host?, attach?}`, the user reviews a card and confirms, and only then is it persisted.

Two kinds:
- **skill** — per-site markdown knowledge → the daemon's existing `domainSkills` store (`domainSkills.save(host, name, content)`).
- **action** — a re-runnable saved prompt (`name` + a `content` prompt + an `attach` scope) → a **new daemon `actionsStore`** this PR introduces.

This is **PR-A** of a two-PR decomposition. **PR-B (separate, later): the actions runner** — a panel list of saved actions + a Run button that re-feeds the prompt as a task, honoring `attach`. PR-A only needs the *save* side, so it adds `actionsStore.save` (PR-B adds `list`/run).

## Goal & non-goals

**Goal:** the agent calls `browser_propose_save`; a proposal **card** appears in the panel previewing the draft; on **Save**, the daemon validates and persists it (skill→domainSkills, action→actionsStore); on **Dismiss**, nothing is saved. The tool returns immediately (`{proposed:true}`) — the save is out-of-band, driven by the user's confirmation.

**Non-goals (PR-A):**
- Listing or **running** saved actions (PR-B).
- `attach`-scope tab targeting (PR-B; PR-A only persists the `attach` value).
- Server-side host defaulting via a relay — the agent provides `host` for skills (see Decisions).
- Editing a draft in the panel before saving (the card is review-then-confirm; the agent re-proposes to change it).

## Decisions (and why)

1. **Proposal reaches the panel via the `beatMapper`** (approach A), not a router push. `browser_propose_save` returns `{proposed:true}` locally in the `-e` script (like `render_ui`); the daemon's `beatMapper` recognizes its `tool_use` and emits a `{kind:"proposal", proposal}` beat from the tool args. Reuses the proven render_ui pattern, is fully unit-testable in `beatMapper.test`, and orders naturally in the feed. (Rejected: a daemon-router tool that relays `getUrl` to default `host` and pushes out-of-band to `activeConversation` — more wiring, weaker ordering, and the active tab may differ from the agent's.)
2. **The agent provides `host` for skills.** A consequence of (1): the `beatMapper` is synchronous and can't relay `getUrl`. The agent just browsed the site, so requiring `host` in the tool call is reasonable; the tool description states it. The save **validates** host (non-empty + file-safe) and reports an error if missing.
3. **The panel holds the draft between propose and confirm** (the daemon is stateless about pending proposals). The proposal beat carries the full draft; the panel keeps it in the feed item; on Save it sends `{type:"resolveProposal", proposal, accept:true}` back. No daemon-side pending map to expire or clean up on disconnect. The id, if any, is only UI correlation (the panel uses its own feed key).
4. **`actionsStore` is a JSON store** analogous to `helperRegistry` (atomic write, load-once), not per-file markdown — an action is a prompt + metadata (`attach`, optional `host`), which suits one JSON file (`actions.json`). PR-B reads it.
5. **Save outcome is reported as a `say` beat.** The user already clicked Save, so a silent failure is wrong; a success/failure `say` ("Saved skill *checkout-flow* for shop.example" / "⚠️ Couldn't save: …") closes the loop.

## Architecture & components

```text
agent (Pi) --browser_propose_save({kind,name,content,host?,attach?})-->
  -e returns {proposed:true} locally   AND   Pi emits tool_use
        |                                          |
        |                            daemon ConversationController/BeatMapper
        |                                          | maps tool_use -> {kind:"proposal", proposal}
        |                                          v
        |                                   panel: proposal CARD (preview + Save/Dismiss)
        |                                          | user clicks Save
        |                            panel -> conversationClient -> {type:"resolveProposal", proposal, accept:true}
        |                                          v
        |                            daemon ConversationSession -> onResolveProposal(proposal)
        |                                          | kind==='skill'  -> domainSkills.save(host,name,content)
        |                                          | kind==='action' -> actionsStore.save({name,content,attach,host?})
        |                                          v
        |                            daemon pushes a {kind:"say"} outcome beat -> panel
```

### pi-daemon

- **`beatMapper.ts`** (modify) — recognize the propose-save tool at `tool_use` (a `PROPOSE_SAVE_TOOL` constant, mirroring `RENDER_UI_TOOL`) and emit `{kind:"proposal", proposal}` from `event.input`. The `proposal` is the opaque-but-shaped draft `{kind, name, content, host?, attach?}` (the mapper coerces defensively: non-object input → no beat).
- **`PanelBeat`** (in `beatMapper.ts`) — add the `proposal` variant.
- **`actionsStore.ts`** (new) — `createActionsStore(filePath): ActionsStore` with `save(action: SavedAction): Promise<SavedAction>` for PR-A; `SavedAction = { name, content, attach: "activeTab"|"allTabs"|"none", host?, createdAt }`. Atomic write via `fsAtomic.writeJsonFile`, load-once via `fsAtomic.loadJsonArray` (the shared helpers the other JSON stores use). Validates `name` non-empty + file-safe (reuse the `mdFiles`/`normalizeHost`-style guard or a local equivalent); upsert by `name`.
- **`conversationSession.ts`** (modify) — handle an inbound `{type:"resolveProposal", proposal, accept}` command: on `accept`, dispatch to the driver (`this.driver?.resolveProposal(proposal)`), exactly mirroring how `start`/`stop` dispatch. (`accept:false` is a no-op — Dismiss is panel-local.)
- **`conversation.ts` / `ConversationDriver`** (modify) — add `resolveProposal(proposal): void` to the `ConversationDriver` interface. The `ConversationController` implements it: it `await`s an injected `saveProposal(proposal)` and emits the outcome `say` beat (success or error) through its existing `onBeat`. The save itself is injected (DI) so the controller stays free of store wiring and is unit-testable with a fake.
- **`daemon.ts` (`createDaemon`)** (modify) — build the `ConversationController` with `saveProposal = (p) => p.kind === "skill" ? domainSkills.save(p.host, p.name, p.content) : actionsStore.save({ name: p.name, content: p.content, attach: p.attach ?? "none", host: p.host })`. Take `actionsStore` via `DaemonOptions` (like `domainSkills`); `main.ts` glue constructs it (path beside the domain-skills root).

### agent-panel

- **`types.ts`** — add `Beat` variant `{kind:"proposal", proposal: SaveProposal}`; `FeedItem` `{type:"proposal", key, proposal, resolved?: "saved"|"dismissed"}`; `PanelAction` `{kind:"resolveProposal", key, accept: boolean}`. `SaveProposal = {kind:"skill"|"action", name, content, host?, attach?}`.
- **`engine.ts`** — reduce the `proposal` beat into a `proposal` feed item; reduce `resolveProposal` by marking the item `saved`/`dismissed` (idempotent — a second click is a no-op) and signalling the outbound send for `accept:true`.
- **proposal card component** — render the card (kind badge, name, host/attach, a clamped content preview, Save/Dismiss). Bare-selector CSS per the panel.css/content.css convention. Disabled/!buttons once resolved.

### extension

- **`conversationClient.ts`** — add `resolveProposal(proposal, accept)` → `send({type:"resolveProposal", proposal, accept})` (queued-before-open like `start`/`stop`).
- **side-panel glue** — map the panel's `resolveProposal` action (for `accept:true`) to `controller.resolveProposal(...)`, the same way `startTask`→`controller.start` is wired.

## Error handling

- Malformed `proposeSave` args (bad `kind`, empty `name`/`content`): the `-e` tool returns a tool error to Pi (it validates before returning `{proposed:true}`); the `beatMapper` also coerces defensively (non-object/empty → no proposal beat) so a malformed event never crashes the feed.
- Save validation failure (skill with missing/unsafe host; store I/O error): `onResolveProposal` catches and the controller emits an error `say` beat; nothing is persisted. The store's own guards (file-safe name/host) are the backstop.
- `resolveProposal` arriving with `accept:false` or for an already-resolved item: no save, idempotent.
- A proposal beat arriving with a non-object/!valid `proposal`: the panel renders nothing (defensive, like the a2ui unknown-node fallback).

## Testing

- **beatMapper**: `tool_use` for the propose-save tool → one `{kind:"proposal", proposal}` beat carrying the args; non-object input → no beat.
- **actionsStore** (pure-ish, temp dir): `save` persists + returns the record; upsert by name; rejects empty/unsafe name; atomic (load-once, survives reload); load tolerates ENOENT/empty.
- **agent-panel engine**: `proposal` beat → `proposal` feed item; `resolveProposal{accept:true}` → item `saved` + outbound signalled; `{accept:false}` → `dismissed`, no outbound; second resolve is a no-op; malformed proposal → no item.
- **daemon integration**: a `resolveProposal` command over the conversation WS triggers `domainSkills.save` (skill) and `actionsStore.save` (action) via injected fakes, and a save failure emits an error `say` beat. (Mirrors the existing conversation-session tests.)
- **conversationClient**: `resolveProposal` sends the right frame (and queues before open).
- TDD throughout; ≥90% coverage per package. Page-side `-e` tool code is not unit-tested (consistent with the other `-e` tools).

## Sequencing

PR-A (this spec). **PR-B (next):** actions runner — `actionsStore.list`, a panel list of saved actions, a Run button → re-feed `content` as a task honoring `attach` (activeTab/allTabs/none) tab targeting. Remaining M4-PR4 after that: the group-2 finishers (`reader_extract` inject Readability, `waitFor` networkIdle).
