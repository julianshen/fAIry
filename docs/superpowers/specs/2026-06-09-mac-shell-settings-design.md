# macOS shell — native Settings UI — design

**Status:** approved (design phase) · **Date:** 2026-06-09 · **Component:** `packages/mac-shell` (extends M5-1/M5-2) · **Builds on:** the daemon's `GET`/`PUT /settings` control plane + the M5-1 HTTP/token plumbing · **Part of:** M5 (macOS shell), sub-project 3 of 5.

## Context

The daemon exposes a bearer-authenticated settings control plane on loopback:

- **`GET /settings`** → a **redacted** config: `{ providers: [{ id, hasKey }], defaultProvider?, defaultModel?, enabledModels? }`. Each provider's API key collapses to a `hasKey` boolean — **secrets never leave the daemon**, so the UI can know *whether* a key is set but can never read it back.
- **`PUT /settings`** → takes a full `PiConfig` (`{ providers: [{ id, apiKey }], defaultProvider?, defaultModel?, enabledModels? }`), validated by `isPiConfig`, then merged via `mergeProviderKeys`. The merge contract: a **blank** incoming `apiKey` keeps the provider's stored key; a **non-blank** key replaces it; a provider **omitted** from the payload is removed.

M5-1 gave the shell the menu-bar app + the token-read/transport plumbing (`HTTPTransport`, `StatusClient` reading `token.json`, bearer `GET`). M5-2 added the pairing surface. This sub-project adds a **native Settings window** so the user can configure provider API keys, the default provider/model, and the enabled-models list without editing files.

## Goal & non-goals

**Goal:** a SwiftUI Settings window, opened from the status menu, that loads the redacted config, lets the user edit the **full** config surface (provider keys, `defaultProvider`, `defaultModel`, `enabledModels`), and saves it via `PUT /settings` — honoring the redaction/merge contract so secrets are neither leaked nor accidentally wiped.

**Non-goals (this sub-project):** a model **catalog** (the daemon exposes none — `defaultModel`/`enabledModels` are free text); a "test connection / validate key" action; live-apply on keystroke (Save is explicit); any daemon-side change (the contract is fixed and sufficient); the conversation panel (sub-project 4).

## Decisions (and why)

1. **Thin SwiftUI view over a tested pure core.** The risky logic — decoding the redacted config and *building the PUT payload* from (redacted state + user edits) under the blank-keeps / omit-removes contract — lives in the `FairyShell` library as pure, TDD'd units. The SwiftUI form, the `NSWindow`/`NSHostingController`, and URLSession are coverage-excluded glue. This mirrors the M5-1/M5-2 convention ("pure logic tested, AppKit/main excluded") and puts tests exactly where the contract bugs hide. Rejected: everything inline in the view (`@State` + URLSession) — the merge logic becomes untestable inside the view; and a daemon change to expose a catalog — out of scope.
2. **Clearing a key = Remove the provider, not blank the field.** Because `mergeProviderKeys` makes a blank key *keep* the stored key, the only way to clear a key is to omit the provider from the PUT. The UI therefore has an explicit per-provider **Remove** action; the payload builder drops removed rows. (Blanking a field is a no-op against a stored key, by contract.)
3. **Curated provider rows + a custom escape hatch.** Well-known Pi provider ids (`anthropic`, `openai`, `google`, …) render as ready rows with key fields; an "Add custom provider" row covers any other id. Cost: a small hardcoded id list in the shell that could drift from Pi — acceptable for friendliness; the custom row keeps it from being a hard limit.
4. **Explicit Save with an inline status line.** You never `PUT` a half-typed key; Save sends the payload once and reports success/failure in place, preserving the user's edits on error.

## Architecture & components

In `packages/mac-shell/`:

**`Sources/FairyShell/` (new, TESTED):**

- **`SettingsModels.swift`** —
  - `RedactedConfig` (Decodable): `providers: [RedactedProvider]` where `RedactedProvider = { id: String, hasKey: Bool }`; optional `defaultProvider`, `defaultModel`, `enabledModels: [String]`. Decoded from `GET /settings`.
  - `PiConfigPayload` (Encodable): `providers: [ProviderPayload]` where `ProviderPayload = { id: String, apiKey: String }`; optional `defaultProvider`, `defaultModel`, `enabledModels: [String]`. Encoded for `PUT /settings`. Optionals are omitted from JSON when nil (so the daemon's `isPiConfig` optional-field rules hold).
- **`KnownProviders.swift`** — `public enum KnownProviders { public static let ids: [String] }`, the curated well-known Pi provider ids for the default rows.
- **`SettingsForm.swift`** — the pure heart.
  - `SettingsForm` value type with: `providers: [ProviderRow]` (`ProviderRow = { id: String, hasKey: Bool, keyInput: String, removed: Bool }`), `defaultProvider: String`, `defaultModel: String`, `enabledModels: [String]`.
  - `static func from(_ redacted: RedactedConfig, known: [String] = KnownProviders.ids) -> SettingsForm` — union of the redacted providers and the known ids (known ids absent from the config appear as rows with `hasKey=false`); `keyInput=""`, `removed=false`; defaults/enabledModels copied (nil → "" / []).
  - `func buildUpdate() -> PiConfigPayload` — the contract encoder:
    - include a provider row **iff** `!removed && (hasKey || !keyInput.trimmed.isEmpty)`;
    - `apiKey = keyInput` (blank → daemon keeps stored; non-blank → replaces);
    - `removed` rows omitted → daemon drops them;
    - `defaultProvider`/`defaultModel` included when non-empty (trimmed), else nil;
    - `enabledModels` blank-filtered; included when non-empty, else nil.
- **`SettingsClient.swift`** — `public struct SettingsClient` (mirrors `StatusClient`: `baseURL`, `tokenURL`, `transport` injected).
  - `func load() async -> Result<RedactedConfig, SettingsError>` — read token, `GET /settings` (reuses the existing `get`, which already returns the body), decode.
  - `func save(_ payload: PiConfigPayload) async -> Result<RedactedConfig, SettingsError>` — read token, encode, `PUT /settings`, decode the re-redacted 200 body.
  - `SettingsError`: `.unreachable` (no token / transport nil), `.unauthorized` (401), `.server(status: Int)` (other non-200), `.decode`.
- **`HTTPTransport`** gains a symmetric **`func put(_ url: URL, bearer: String, body: Data) async -> (status: Int, body: Data)?`** alongside the existing `get` (PUT is the one capability the seam lacks).

**`Sources/fairy-shell/` (glue, coverage-excluded):**

- **`SettingsView.swift`** — SwiftUI form: curated + custom provider rows (a `SecureField` for the key, a "key is set" indicator when `hasKey`, a **Remove** button per row), an "Add custom provider" row (free-text id), `defaultProvider`/`defaultModel` fields, an editable `enabledModels` list, and a **Save** button with an inline status line. Holds a `SettingsForm` in view state; calls the injected `SettingsClient`.
- **`SettingsWindowController.swift`** — `@MainActor` controller owning an `NSWindow` + `NSHostingController(rootView: SettingsView)`; opened from a new **"Settings…"** status-menu item; singleton (re-focus + bring-to-front if already open).
- **`URLSessionTransport`** gains the `put` implementation; **`AppDelegate`** adds the "Settings…" menu item (between the pairing section and Restart) and owns the `SettingsWindowController`.

## Data flow

```text
"Settings…" → SettingsWindowController shows the window
  onAppear → SettingsClient.load() → GET /settings → RedactedConfig
           → SettingsForm.from(redacted, known) → bound to the view
  user edits keys / defaults / enabledModels; Remove to drop a provider
  Save → form.buildUpdate() → SettingsClient.save() → PUT /settings
       → .success(redacted) → rebuild form + "Saved"
       → .failure(error)   → status line shows the error, edits preserved
```

## Error handling

- **Load fails** (daemon down / 401 / unreachable / decode) → the view shows a non-editable "Couldn't reach the daemon — is it running?" state with a **Retry**, rather than an empty form that would `PUT` an empty config and wipe everything.
- **Save fails** → the inline status line surfaces the cause (`400 invalid_config`, `401 unauthorized`, `500` store failure, transport failure); the form **keeps the user's edits** so nothing is lost.
- **Secrets never round-trip** — the form only ever holds `hasKey` + what the user just typed; a stored key is never read back, and `buildUpdate` sends a blank key (which the daemon keeps) for untouched providers.

## Testing

`FairyShell` (TDD'd, ≥90% holds):

- **`SettingsForm.buildUpdate()` — the contract matrix:** untouched `hasKey` row → blank key (daemon keeps it); typed key → replaces; `removed` row → omitted; ignored empty curated row (`!hasKey`, no input) → omitted; `defaultProvider`/`defaultModel` include-when-nonempty + trim; `enabledModels` blank-filter + include-when-nonempty.
- **`SettingsForm.from`:** union of redacted providers + known ids; nil defaults → ""/[].
- **`SettingsModels`:** `RedactedConfig` decode (with/without optionals); `PiConfigPayload` encode omits nil optionals; round-trip a representative config.
- **`SettingsClient` (fake transport):** `load` 200 → decoded; 401 → `.unauthorized`; other non-200 → `.server`; transport nil → `.unreachable`; missing token → `.unreachable`; bad body → `.decode`. `save` 200 → decoded redacted; non-200 paths mirror load; verifies the `put` body is the encoded payload.
- **`KnownProviders.ids`:** non-empty, includes `anthropic`/`openai`, no blanks/dupes.

The SwiftUI `SettingsView`, `SettingsWindowController` (NSWindow/NSHostingController), and the URLSession `put` are AppKit/SwiftUI glue — runtime-verified by launching the app (open Settings, edit, Save), not unit-tested (consistent with M5-1/M5-2's executable target).

## Sequencing

M5 sub-project 3 (this). Next: **(4) WKWebView conversation panel** (host the agent-panel build ↔ the conversation WS). Then (5) packaging (sign/notarize/Sparkle/login-item). A future enhancement: a daemon endpoint exposing a provider/model **catalog**, which would let this UI replace the free-text `defaultModel`/`enabledModels` fields with validated pickers.
