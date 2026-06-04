import { describe, expect, it } from "vitest";
import { analyzeUrls } from "./analyzeUrls";

describe("analyzeUrls", () => {
  it("collapses numeric and uuid path segments and counts patterns (desc)", () => {
    const hrefs = [
      "https://x.com/users/1",
      "https://x.com/users/2",
      "https://x.com/users/3",
      "https://x.com/about",
    ];
    const r = analyzeUrls(hrefs, "https://x.com/home");
    expect(r.patterns[0]).toEqual({ pattern: "/users/:id", count: 3 });
    expect(r.patterns).toContainEqual({ pattern: "/about", count: 1 });
  });

  it("collapses a uuid segment to :uuid", () => {
    const r = analyzeUrls(["https://x.com/o/3f2504e0-4f89-41d3-9a0c-0305e82c3301"], "https://x.com/");
    expect(r.patterns[0]!.pattern).toBe("/o/:uuid");
  });

  it("extracts the current URL's query-param names", () => {
    const r = analyzeUrls([], "https://x.com/search?q=hi&page=2");
    expect(r.queryParams.sort()).toEqual(["page", "q"]);
  });

  it("resolves relative hrefs against the current URL and ignores unparseable ones", () => {
    const r = analyzeUrls(["/users/9", "not a url"], "https://x.com/home");
    expect(r.patterns).toEqual([{ pattern: "/users/:id", count: 1 }]);
  });
});
