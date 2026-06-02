# fAIry

A browser agent you talk to. **Fairy** pairs a Chrome extension with a local,
standalone agent daemon (the "pi agent") so a team of specialist agents can
perceive the page, drive it, read it, and fill things in — while you watch and
stay in control.

This is the production reimplementation of an earlier Electron proof-of-concept
(*Horizon Browser*). Instead of shipping a whole browser, fАIry runs as:

| Component | Stack | Role |
| --- | --- | --- |
| **Chrome extension** | TypeScript | The browser surface. Executes agent actions on the live tab via `chrome.debugger` / `chrome.tabs` / `chrome.scripting`. Hosts the Fairy agent panel UI. |
| **pi-daemon** | Bun + TypeScript | Standalone local agent. Spawns the Pi coding agent (`pi --mode rpc`), bridges browser tools, owns an app-local workspace + isolated config, supports multiple providers/models. Launched at login. |
| **macOS shell** | Swift | Menu-bar tray app. Manages the daemon lifecycle and hosts native (WKWebView) Settings + Conversation windows. |

The extension and the macOS shell both talk to the daemon over `localhost`.

## Repository layout

This is a [Bun workspaces](https://bun.sh/docs/install/workspaces) monorepo.

```
packages/
  agent-panel/     React + TypeScript UI for the Fairy agent panel (this is what's built first)
  # pi-daemon/     (planned) Bun standalone agent daemon
  # chrome-extension/ (planned) Chrome extension host
```

## Development

```bash
bun install                       # install all workspace deps
bun run --filter agent-panel dev  # run a package's dev server
bun run --filter agent-panel test # run a package's tests
```

Each package documents its own commands in its `README` / `package.json`.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the design: components,
  flows, protocols/seams, isolation, POC reuse, and open questions.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — status, milestones (M1–M6), the
  **non-goals** that bound scope, and the decision log.

## Conventions

- **Trunk-based with PRs.** No direct commits of feature work to `main`; every
  change lands through a pull request.
- **TDD.** Red → green → refactor. New behavior starts with a failing test.
- **Coverage ≥ 90%** is enforced per package.
