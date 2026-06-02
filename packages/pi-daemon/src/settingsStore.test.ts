import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFileSettingsStore } from "./settingsStore";
import type { PiConfig } from "./piConfig";

describe("createFileSettingsStore", () => {
  let dir: string;
  let configFile: string;
  let piAgentDir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "fairy-store-"));
    configFile = path.join(dir, "config.json");
    piAgentDir = path.join(dir, "pi");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("starts from an empty config when no file exists", () => {
    expect(createFileSettingsStore({ configFile, piAgentDir }).get()).toEqual({ providers: [] });
  });

  it("loads an existing valid config.json", () => {
    const cfg: PiConfig = { providers: [{ id: "anthropic", apiKey: "k" }], defaultModel: "m" };
    writeFileSync(configFile, JSON.stringify(cfg));
    expect(createFileSettingsStore({ configFile, piAgentDir }).get()).toEqual(cfg);
  });

  it("falls back to empty when config.json is malformed or not a config", () => {
    writeFileSync(configFile, "{ not json");
    expect(createFileSettingsStore({ configFile, piAgentDir }).get()).toEqual({ providers: [] });
    writeFileSync(configFile, JSON.stringify({ providers: "nope" }));
    expect(createFileSettingsStore({ configFile, piAgentDir }).get()).toEqual({ providers: [] });
  });

  it("save() persists config.json at 0600, materializes Pi's files, and updates get()", () => {
    const store = createFileSettingsStore({ configFile, piAgentDir });
    const cfg: PiConfig = { providers: [{ id: "anthropic", apiKey: "sk" }], defaultModel: "m" };
    store.save(cfg);
    expect(store.get()).toEqual(cfg);
    expect(JSON.parse(readFileSync(configFile, "utf8"))).toEqual(cfg);
    expect(statSync(configFile).mode & 0o777).toBe(0o600);
    expect(existsSync(path.join(piAgentDir, "auth.json"))).toBe(true);
    expect(existsSync(path.join(piAgentDir, "settings.json"))).toBe(true);
  });

  it("materializes Pi's derived files on construction to match config.json", () => {
    const cfg: PiConfig = { providers: [{ id: "anthropic", apiKey: "sk" }], defaultModel: "m" };
    writeFileSync(configFile, JSON.stringify(cfg));
    createFileSettingsStore({ configFile, piAgentDir });
    expect(JSON.parse(readFileSync(path.join(piAgentDir, "auth.json"), "utf8"))).toEqual({
      anthropic: { type: "api_key", key: "sk" },
    });
  });

  it("a saved config is reloaded by a fresh store (survives restart)", () => {
    const cfg: PiConfig = { providers: [{ id: "openai", apiKey: "sk-oai" }] };
    createFileSettingsStore({ configFile, piAgentDir }).save(cfg);
    expect(createFileSettingsStore({ configFile, piAgentDir }).get()).toEqual(cfg);
  });
});
