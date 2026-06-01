# @fairy/pi-daemon

Fairy's standalone local **agent daemon** (Bun + TypeScript). It runs on the
user's machine, launched at login, and is the hub the Chrome extension and the
native macOS shell both connect to over `localhost`.

Planned responsibilities (built incrementally, PR by PR):

- Spawn and supervise the **Pi** coding agent (`pi --mode rpc`, JSON-line RPC).
- Run the **loopback bridge** that exposes browser tools to Pi; its browser
  backend is the Chrome extension (vs. the POC's Electron CDP).
- Own an **isolated workspace + config** under the app data directory — never
  the user's global `~/.pi`.
- Support **multiple providers/models** and switching between them.

## Status

Scaffold + first module. Implemented so far:

- **`src/paths.ts`** — pure, per-OS resolution of the daemon's isolated
  directories (`appData`, `piAgentDir` → `PI_CODING_AGENT_DIR`, `workspace`).
  `FAIRY_HOME` overrides the OS default. macOS → `Application Support`,
  Windows → `%APPDATA%`, else the XDG data dir.

`src/main.ts` is a placeholder entry that prints the resolved paths.

## Commands

```bash
bun run start          # run the daemon entry (prints resolved paths for now)
bun run dev            # run with --watch
bun run test           # vitest
bun run test:coverage  # coverage, enforces ≥90% on src modules
bun run typecheck      # tsc --noEmit
bun run lint           # eslint
```
