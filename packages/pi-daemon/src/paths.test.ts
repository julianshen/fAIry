import { resolvePaths } from "./paths";
import type { ResolvePathsInput } from "./paths";

const base: ResolvePathsInput = { platform: "linux", env: {}, home: "/home/alex" };

describe("resolvePaths — per-OS app data location", () => {
  it("uses Application Support on macOS", () => {
    const p = resolvePaths({ ...base, platform: "darwin", home: "/Users/alex" });
    expect(p.appData).toBe("/Users/alex/Library/Application Support/fAIry");
  });

  it("honors XDG_DATA_HOME on Linux", () => {
    const p = resolvePaths({ ...base, platform: "linux", env: { XDG_DATA_HOME: "/data" } });
    expect(p.appData).toBe("/data/fAIry");
  });

  it("falls back to ~/.local/share on Linux without XDG_DATA_HOME", () => {
    const p = resolvePaths({ ...base, platform: "linux", env: {} });
    expect(p.appData).toBe("/home/alex/.local/share/fAIry");
  });

  it("ignores an empty XDG_DATA_HOME", () => {
    const p = resolvePaths({ ...base, platform: "linux", env: { XDG_DATA_HOME: "" } });
    expect(p.appData).toBe("/home/alex/.local/share/fAIry");
  });

  it("uses %APPDATA% on Windows with backslash paths", () => {
    const p = resolvePaths({
      platform: "win32",
      home: "C:\\Users\\alex",
      env: { APPDATA: "C:\\Users\\alex\\AppData\\Roaming" },
    });
    expect(p.appData).toBe("C:\\Users\\alex\\AppData\\Roaming\\fAIry");
  });

  it("falls back to AppData\\Roaming on Windows without %APPDATA%", () => {
    const p = resolvePaths({ platform: "win32", home: "C:\\Users\\alex", env: {} });
    expect(p.appData).toBe("C:\\Users\\alex\\AppData\\Roaming\\fAIry");
  });

  it("treats an unknown platform like Linux", () => {
    const p = resolvePaths({ ...base, platform: "freebsd" as NodeJS.Platform });
    expect(p.appData).toBe("/home/alex/.local/share/fAIry");
  });
});

describe("resolvePaths — FAIRY_HOME override", () => {
  it("overrides the OS default on any platform", () => {
    const p = resolvePaths({ ...base, platform: "darwin", env: { FAIRY_HOME: "/custom/fairy" } });
    expect(p.appData).toBe("/custom/fairy");
  });

  it("is ignored when empty", () => {
    const p = resolvePaths({ ...base, platform: "darwin", home: "/Users/alex", env: { FAIRY_HOME: "" } });
    expect(p.appData).toBe("/Users/alex/Library/Application Support/fAIry");
  });
});

describe("resolvePaths — derived directories", () => {
  it("nests the isolated Pi config dir and workspace under appData", () => {
    const p = resolvePaths({ ...base, platform: "darwin", home: "/Users/alex" });
    expect(p.piAgentDir).toBe("/Users/alex/Library/Application Support/fAIry/pi");
    expect(p.workspace).toBe("/Users/alex/Library/Application Support/fAIry/workspace");
  });

  it("derives them with Windows separators on win32", () => {
    const p = resolvePaths({ platform: "win32", home: "C:\\Users\\alex", env: { FAIRY_HOME: "D:\\fairy" } });
    expect(p.piAgentDir).toBe("D:\\fairy\\pi");
    expect(p.workspace).toBe("D:\\fairy\\workspace");
  });
});
