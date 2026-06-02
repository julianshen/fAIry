import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mintToken, writeToken, TOKEN_FILENAME } from "./tokenStore";

describe("mintToken", () => {
  it("produces a URL-safe token with at least 256 bits of entropy", () => {
    const token = mintToken();
    // 32 random bytes base64url-encode to 43 chars (no padding).
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("mints a fresh, unguessable value each call", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => mintToken()));
    expect(tokens.size).toBe(100);
  });
});

describe("writeToken", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "fairy-token-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the token as JSON to token.json and returns the path", () => {
    const file = writeToken(dir, "tok-abc");
    expect(file).toBe(path.join(dir, TOKEN_FILENAME));
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ token: "tok-abc" });
  });

  it("creates the appData directory if it does not exist", () => {
    const nested = path.join(dir, "does", "not", "exist");
    const file = writeToken(nested, "tok-xyz");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ token: "tok-xyz" });
  });

  it("writes the secret file with 0600 permissions", () => {
    const file = writeToken(dir, "tok-secret");
    // Low 9 mode bits: owner-only read/write.
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("replaces a stale token from a previous session", () => {
    const file = path.join(dir, TOKEN_FILENAME);
    writeFileSync(file, JSON.stringify({ token: "old-session" }));
    writeToken(dir, "new-session");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ token: "new-session" });
  });
});
