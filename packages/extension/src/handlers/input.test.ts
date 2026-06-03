import { describe, expect, it } from "vitest";
import { fakeCdp } from "../cdp/testCdp";
import { click, scroll, type } from "./input";

describe("click", () => {
  it("dispatches a press then a release at (x,y) with the default left button", async () => {
    const cdp = fakeCdp();
    const result = await click(cdp, { x: 10, y: 20 });
    expect(cdp.calls).toEqual([
      {
        method: "Input.dispatchMouseEvent",
        params: { type: "mousePressed", x: 10, y: 20, button: "left", clickCount: 1 },
      },
      {
        method: "Input.dispatchMouseEvent",
        params: { type: "mouseReleased", x: 10, y: 20, button: "left", clickCount: 1 },
      },
    ]);
    expect(result).toEqual({ ok: true });
  });

  it("honors an explicit button", async () => {
    const cdp = fakeCdp();
    await click(cdp, { x: 1, y: 2, button: "right" });
    expect(cdp.calls[0]?.params).toMatchObject({ button: "right" });
  });

  it("rejects when x or y is missing", async () => {
    const cdp = fakeCdp();
    await expect(click(cdp, { x: 1 })).rejects.toThrow(/y.*number/);
    expect(cdp.calls).toEqual([]);
  });
});

describe("type", () => {
  it("dispatches one char key event per character", async () => {
    const cdp = fakeCdp();
    const result = await type(cdp, { text: "hi" });
    expect(cdp.calls).toEqual([
      { method: "Input.dispatchKeyEvent", params: { type: "char", text: "h" } },
      { method: "Input.dispatchKeyEvent", params: { type: "char", text: "i" } },
    ]);
    expect(result).toEqual({ ok: true });
  });

  it("rejects when text is missing", async () => {
    const cdp = fakeCdp();
    await expect(type(cdp, {})).rejects.toThrow(/text.*string/);
  });
});

describe("scroll", () => {
  it("dispatches a mouseWheel event with deltas, defaulting position to 0", async () => {
    const cdp = fakeCdp();
    const result = await scroll(cdp, { deltaY: 300 });
    expect(cdp.calls).toEqual([
      {
        method: "Input.dispatchMouseEvent",
        params: { type: "mouseWheel", x: 0, y: 0, deltaX: 0, deltaY: 300 },
      },
    ]);
    expect(result).toEqual({ ok: true });
  });
});
