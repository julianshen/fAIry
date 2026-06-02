import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildAuth, buildSettings, writePiConfig } from "./piConfig";
import type { PiConfig } from "./piConfig";

const CONFIG: PiConfig = {
  providers: [
    { id: "anthropic", apiKey: "sk-ant-1" },
    { id: "openai", apiKey: "sk-oai-2" },
  ],
  defaultProvider: "anthropic",
  defaultModel: "claude-opus-4-8",
  enabledModels: ["claude-opus-4-8", "gpt-5"],
};

describe("buildAuth", () => {
  it("maps each provider to a Pi api_key entry", () => {
    expect(buildAuth(CONFIG)).toEqual({
      anthropic: { type: "api_key", key: "sk-ant-1" },
      openai: { type: "api_key", key: "sk-oai-2" },
    });
  });

  it("skips providers with a blank key", () => {
    const auth = buildAuth({ providers: [{ id: "anthropic", apiKey: "" }, { id: "openai", apiKey: "k" }] });
    expect(auth).toEqual({ openai: { type: "api_key", key: "k" } });
  });
});

describe("buildSettings", () => {
  it("includes the defaults and enabled models when present", () => {
    expect(buildSettings(CONFIG)).toEqual({
      defaultProvider: "anthropic",
      defaultModel: "claude-opus-4-8",
      enabledModels: ["claude-opus-4-8", "gpt-5"],
    });
  });

  it("omits keys that aren't set", () => {
    expect(buildSettings({ providers: [{ id: "anthropic", apiKey: "k" }] })).toEqual({});
  });
});

describe("writePiConfig", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "fairy-cfg-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const read = (file: string): unknown => JSON.parse(readFileSync(path.join(dir, file), "utf-8"));

  it("creates the agent dir if missing and writes settings + auth", () => {
    const agentDir = path.join(dir, "pi");
    writePiConfig(agentDir, CONFIG);
    expect(existsSync(agentDir)).toBe(true);
    expect(JSON.parse(readFileSync(path.join(agentDir, "auth.json"), "utf-8"))).toEqual(buildAuth(CONFIG));
    expect(JSON.parse(readFileSync(path.join(agentDir, "settings.json"), "utf-8"))).toEqual(
      buildSettings(CONFIG),
    );
  });

  it("writes auth.json with 0600 permissions", () => {
    writePiConfig(dir, CONFIG);
    expect(statSync(path.join(dir, "auth.json")).mode & 0o777).toBe(0o600);
  });

  it("overwrites prior config (a removed provider's key is gone)", () => {
    writePiConfig(dir, CONFIG);
    writePiConfig(dir, { providers: [{ id: "anthropic", apiKey: "sk-ant-1" }] });
    expect(read("auth.json")).toEqual({ anthropic: { type: "api_key", key: "sk-ant-1" } });
  });

  it("re-enforces 0600 when overwriting an existing auth.json", () => {
    writePiConfig(dir, CONFIG);
    writePiConfig(dir, CONFIG);
    expect(statSync(path.join(dir, "auth.json")).mode & 0o777).toBe(0o600);
  });
});
