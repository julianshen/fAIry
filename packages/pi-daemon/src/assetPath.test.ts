import { resolveAssetPath } from "./assetPath";

describe("resolveAssetPath", () => {
  const fallback = "/repo/packages/pi-daemon/../pi-extension/browser-bridge.ts";

  it("uses the env override when set", () => {
    expect(resolveAssetPath({ FAIRY_X: "/bundled/x.ts" }, "FAIRY_X", fallback)).toBe("/bundled/x.ts");
  });
  it("trims surrounding whitespace from the override", () => {
    expect(resolveAssetPath({ FAIRY_X: "  /bundled/x.ts  " }, "FAIRY_X", fallback)).toBe("/bundled/x.ts");
  });
  it("falls back when the key is unset", () => {
    expect(resolveAssetPath({}, "FAIRY_X", fallback)).toBe(fallback);
  });
  it("falls back when the override is blank/whitespace", () => {
    expect(resolveAssetPath({ FAIRY_X: "   " }, "FAIRY_X", fallback)).toBe(fallback);
  });
});
