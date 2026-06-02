import { isAllowedOrigin } from "./origin";

describe("isAllowedOrigin", () => {
  describe("without an allowlist (default)", () => {
    it("allows a missing Origin (native/extension clients send none)", () => {
      expect(isAllowedOrigin(undefined)).toBe(true);
    });

    it("allows a non-web origin such as a Chrome extension", () => {
      expect(isAllowedOrigin("chrome-extension://abcdefg")).toBe(true);
    });

    it("rejects web origins — the DNS-rebinding / browser-page vector", () => {
      expect(isAllowedOrigin("http://evil.example")).toBe(false);
      expect(isAllowedOrigin("https://evil.example")).toBe(false);
      // Scheme check is case-insensitive.
      expect(isAllowedOrigin("HTTPS://evil.example")).toBe(false);
    });

    it("rejects the opaque 'null' origin (file:/sandboxed documents)", () => {
      expect(isAllowedOrigin("null")).toBe(false);
    });
  });

  describe("with an explicit allowlist", () => {
    const allowed = ["chrome-extension://the-real-id"];

    it("allows only exact matches", () => {
      expect(isAllowedOrigin("chrome-extension://the-real-id", allowed)).toBe(true);
      expect(isAllowedOrigin("chrome-extension://other", allowed)).toBe(false);
    });

    it("rejects a missing Origin when an allowlist is set", () => {
      expect(isAllowedOrigin(undefined, allowed)).toBe(false);
    });
  });
});
