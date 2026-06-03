import { describe, expect, it } from "vitest";
import { assertHttpUrl } from "./urlPolicy";

describe("assertHttpUrl", () => {
  it("accepts http and https", () => {
    expect(() => assertHttpUrl("http://localhost:3000/x")).not.toThrow();
    expect(() => assertHttpUrl("https://example.com")).not.toThrow();
  });

  it("refuses non-http(s) schemes and unparseable urls", () => {
    for (const url of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,<h1>x</h1>",
      "chrome://settings",
      "chrome-extension://abc/x.html",
      "about:blank",
      "not a url",
    ]) {
      expect(() => assertHttpUrl(url), url).toThrow(/http/);
    }
  });
});
