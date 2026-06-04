import { describe, expect, it } from "vitest";
import { classify } from "./classify";
import type { Collected, UrlAnalysis } from "./types";

const EMPTY: Collected = {
  origin: "https://x.com",
  url: "https://x.com/",
  elementsByRole: {},
  interactive: [],
  searchInputs: [],
  forms: [],
  nav: [],
  hrefs: [],
  declaredActions: [],
};
const NO_URLS: UrlAnalysis = { patterns: [], queryParams: [] };

describe("classify", () => {
  it("treats data-agent-action as authoritative (high-confidence custom)", () => {
    const c = { ...EMPTY, declaredActions: [{ name: "checkout", tag: "button", label: "Buy" }] };
    const out = classify(c, NO_URLS);
    expect(out).toContainEqual(
      expect.objectContaining({ name: "checkout", category: "custom", confidence: "high" }),
    );
  });

  it("ignores a data-agent-action with an empty name", () => {
    const c = { ...EMPTY, declaredActions: [{ name: "", tag: "button", label: "x" }] };
    expect(classify(c, NO_URLS)).toEqual([]);
  });

  it("classifies search inputs as a search action", () => {
    const c = { ...EMPTY, searchInputs: [{ label: "Search" }] };
    expect(classify(c, NO_URLS)).toContainEqual(
      expect.objectContaining({ name: "search", category: "search", confidence: "high" }),
    );
  });

  it("classifies a login form (password + user field) as auth", () => {
    const c = {
      ...EMPTY,
      forms: [{ action: "/login", method: "post", fields: [{ name: "email", type: "email" }, { name: "pw", type: "password" }], submitLabel: "Sign in" }],
    };
    expect(classify(c, NO_URLS)).toContainEqual(
      expect.objectContaining({ name: "login", category: "auth", confidence: "high" }),
    );
  });

  it("maps form submit labels to crud/export/filter", () => {
    const mk = (submitLabel: string) => ({
      ...EMPTY,
      forms: [{ action: "/", method: "post", fields: [{ name: "x", type: "text" }], submitLabel }],
    });
    expect(classify(mk("Create item"), NO_URLS)).toContainEqual(expect.objectContaining({ category: "crud" }));
    expect(classify(mk("Export CSV"), NO_URLS)).toContainEqual(expect.objectContaining({ category: "export" }));
    expect(classify(mk("Filter results"), NO_URLS)).toContainEqual(expect.objectContaining({ category: "filter" }));
  });

  it("emits a navigation action for URL patterns with >= 5 links", () => {
    const urls: UrlAnalysis = { patterns: [{ pattern: "/p/:id", count: 7 }, { pattern: "/about", count: 2 }], queryParams: [] };
    const out = classify(EMPTY, urls);
    expect(out).toContainEqual(expect.objectContaining({ category: "navigation", confidence: "low" }));
    expect(out.filter((a) => a.category === "navigation")).toHaveLength(1); // /about (count 2) excluded
  });

  it("includes observed endpoints when a network block is supplied", () => {
    const out = classify(EMPTY, NO_URLS, { endpoints: [{ method: "POST", path: "/auth/login", auth: true }] });
    expect(out).toContainEqual(
      expect.objectContaining({ category: "auth", observedEndpoint: { method: "POST", path: "/auth/login" } }),
    );
  });

  it("returns nothing for a clean empty page", () => {
    expect(classify(EMPTY, NO_URLS)).toEqual([]);
  });
});
