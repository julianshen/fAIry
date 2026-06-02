import { createPairingStore } from "./pairing";

const TOKEN = "session-token-xyz";

describe("createPairingStore", () => {
  it("mints a strong, URL-safe pairing code", () => {
    const store = createPairingStore({ token: TOKEN });
    // 16 random bytes base64url-encode to ~22 chars (128 bits).
    expect(store.code.length).toBeGreaterThanOrEqual(22);
    expect(store.code).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("mints a fresh code per store", () => {
    const codes = new Set(Array.from({ length: 50 }, () => createPairingStore({ token: TOKEN }).code));
    expect(codes.size).toBe(50);
  });

  it("redeems the correct code for the session token, exactly once (single-use)", () => {
    const store = createPairingStore({ token: TOKEN, code: "CODE" });
    expect(store.redeem("CODE")).toBe(TOKEN);
    expect(store.redeem("CODE")).toBeNull(); // already redeemed
  });

  it("rejects a wrong code without consuming the real one", () => {
    const store = createPairingStore({ token: TOKEN, code: "CODE" });
    expect(store.redeem("nope")).toBeNull();
    expect(store.redeem("CODE")).toBe(TOKEN); // still redeemable
  });
});

describe("createPairingStore TTL", () => {
  it("redeems within the TTL window", () => {
    let t = 1000;
    const store = createPairingStore({ token: TOKEN, code: "CODE", ttlMs: 500, now: () => t });
    t = 1499;
    expect(store.redeem("CODE")).toBe(TOKEN);
  });

  it("rejects once the TTL has elapsed", () => {
    let t = 1000;
    const store = createPairingStore({ token: TOKEN, code: "CODE", ttlMs: 500, now: () => t });
    t = 1500;
    expect(store.redeem("CODE")).toBeNull();
  });

  it("never expires when no TTL is given", () => {
    const store = createPairingStore({ token: TOKEN, code: "CODE" });
    expect(store.redeem("CODE")).toBe(TOKEN);
  });
});
