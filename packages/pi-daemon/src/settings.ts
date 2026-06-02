import { normalizedApiKey, type PiConfig } from "./piConfig";

/** A provider as exposed to clients — its key presence, never the key itself. */
export interface RedactedProvider {
  id: string;
  hasKey: boolean;
}

/** The non-secret view of {@link PiConfig} safe to return over the wire. */
export interface RedactedConfig {
  providers: RedactedProvider[];
  defaultProvider?: string;
  defaultModel?: string;
  enabledModels?: string[];
}

/**
 * Project a {@link PiConfig} to its non-secret view: each provider's `apiKey`
 * collapses to a `hasKey` boolean (via {@link normalizedApiKey}, the same rule
 * `buildAuth` uses to decide which keys to write), so secrets never leave the daemon.
 */
export function redactConfig(config: PiConfig): RedactedConfig {
  const redacted: RedactedConfig = {
    providers: config.providers.map((p) => ({ id: p.id, hasKey: normalizedApiKey(p) !== "" })),
  };
  if (config.defaultProvider !== undefined) redacted.defaultProvider = config.defaultProvider;
  if (config.defaultModel !== undefined) redacted.defaultModel = config.defaultModel;
  if (config.enabledModels !== undefined) redacted.enabledModels = config.enabledModels;
  return redacted;
}

/**
 * Validate that an arbitrary parsed value matches the {@link PiConfig} contract:
 * a `providers` array of `{ id, apiKey }` strings, with optional string
 * `defaultProvider`/`defaultModel` and a `string[]` `enabledModels`. Untrusted
 * input (a `PUT /settings` body) must pass this before it's saved — otherwise a
 * malformed key would later throw, or a contract-violating value (e.g. a string
 * `enabledModels`) would be persisted into Pi's config.
 */
export function isPiConfig(value: unknown): value is PiConfig {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  if (!Array.isArray(o.providers)) return false;
  for (const p of o.providers) {
    if (typeof p !== "object" || p === null) return false;
    const prov = p as Record<string, unknown>;
    if (typeof prov.id !== "string" || typeof prov.apiKey !== "string") return false;
  }
  if (o.defaultProvider !== undefined && typeof o.defaultProvider !== "string") return false;
  if (o.defaultModel !== undefined && typeof o.defaultModel !== "string") return false;
  if (o.enabledModels !== undefined) {
    if (!Array.isArray(o.enabledModels)) return false;
    if (!o.enabledModels.every((m) => typeof m === "string")) return false;
  }
  return true;
}

/**
 * Merge a settings update onto the current config, preserving secrets the client
 * couldn't have seen. `GET /settings` is redacted (keys → `hasKey`), so a client
 * editing a non-secret field can only send a blank key back. The contract: a
 * blank incoming key keeps the provider's stored key, a non-blank key sets it,
 * and omitting a provider removes it. Without this, a settings UI would silently
 * wipe every API key whenever it saved.
 */
export function mergeProviderKeys(current: PiConfig, incoming: PiConfig): PiConfig {
  const storedKeys = new Map(current.providers.map((p) => [p.id, p.apiKey]));
  return {
    ...incoming,
    providers: incoming.providers.map((p) => {
      if (normalizedApiKey(p) !== "") return p;
      const stored = storedKeys.get(p.id);
      return stored !== undefined ? { ...p, apiKey: stored } : p;
    }),
  };
}

/**
 * The daemon's settings source of truth, injected into the HTTP endpoint so the
 * transport stays pure/testable. `get` returns the current config; `save`
 * persists an update (the production impl writes Pi's config via `writePiConfig`
 * and updates its in-memory copy).
 */
export interface SettingsStore {
  get(): PiConfig;
  save(config: PiConfig): void;
}
