import { describe, expect, it } from "vitest";
import { fakeCdp } from "../cdp/testCdp";
import { NO_TAB_BOUND } from "../tabs/agentTabs";
import type { CdpClient } from "../cdp/cdpClient";
import { readerExtract } from "./reader";

const cdpReturning = (value: unknown): CdpClient => fakeCdp({ "Runtime.evaluate": { result: { value } } });
const ARTICLE = { title: "T", byline: "By A", excerpt: "Ex", textContent: "Body text", length: 9, lang: "en" };

describe("readerExtract", () => {
  it("returns a well-formed article result", async () => {
    expect(await readerExtract(cdpReturning(ARTICLE))).toEqual(ARTICLE);
  });

  it("coerces missing optional fields to null and recomputes length", async () => {
    const res = await readerExtract(cdpReturning({ title: "T", textContent: "hello" }));
    expect(res).toEqual({ title: "T", byline: null, excerpt: null, textContent: "hello", length: 5, lang: null });
  });

  it("returns {error} when the script yields null", async () => {
    expect(await readerExtract(cdpReturning(null))).toEqual({ error: "no readable content" });
  });

  it("returns {error} for a result with no textContent", async () => {
    expect(await readerExtract(cdpReturning({ title: "T" }))).toEqual({ error: "no readable content" });
  });

  it("returns {error} for an empty textContent", async () => {
    expect(await readerExtract(cdpReturning({ textContent: "" }))).toEqual({ error: "no readable content" });
  });

  it("propagates an unbound-tab error", async () => {
    const cdp: CdpClient = { send: () => Promise.reject(new Error(NO_TAB_BOUND)) };
    await expect(readerExtract(cdp)).rejects.toThrow(NO_TAB_BOUND);
  });
});
