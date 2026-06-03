import { describe, expect, it } from "vitest";
import { fakeCdp } from "../cdp/testCdp";
import { evaluate, evaluateExpression } from "./evaluate";

describe("evaluateExpression", () => {
  it("returns the value of a successful Runtime.evaluate", async () => {
    const cdp = fakeCdp({ "Runtime.evaluate": { result: { value: 42 } } });
    const v = await evaluateExpression(cdp, "6*7");
    expect(v).toBe(42);
    expect(cdp.calls[0]?.params).toEqual({
      expression: "6*7",
      returnByValue: true,
      awaitPromise: true,
    });
  });

  it("throws with the exception description on a page error", async () => {
    const cdp = fakeCdp({
      "Runtime.evaluate": {
        exceptionDetails: { text: "Uncaught", exception: { description: "ReferenceError: boom" } },
      },
    });
    await expect(evaluateExpression(cdp, "boom")).rejects.toThrow("ReferenceError: boom");
  });

  it("falls back to exceptionDetails.text when there is no description", async () => {
    const cdp = fakeCdp({
      "Runtime.evaluate": { exceptionDetails: { text: "Syntax error" } },
    });
    await expect(evaluateExpression(cdp, "(")).rejects.toThrow("Syntax error");
  });

  it("surfaces non-JSON primitives as their wire-safe string (they can't survive JSON.stringify)", async () => {
    // Returning raw NaN/Infinity/-0/bigint would be lost or throw when the bridge
    // JSON-encodes the reply; the unserializableValue string is the safe form.
    for (const unserializableValue of ["NaN", "Infinity", "-Infinity", "-0", "42n"]) {
      const cdp = fakeCdp({ "Runtime.evaluate": { result: { unserializableValue } } });
      const v = await evaluateExpression(cdp, "x");
      expect(v).toBe(unserializableValue);
      // proof it crosses the bridge intact
      expect(JSON.parse(JSON.stringify(v))).toBe(unserializableValue);
    }
  });

  it("still returns falsy JSON values (0, false, null) as themselves", async () => {
    for (const value of [0, false, null, ""]) {
      const cdp = fakeCdp({ "Runtime.evaluate": { result: { value } } });
      expect(await evaluateExpression(cdp, "x")).toBe(value);
    }
  });
});

describe("evaluate (tool)", () => {
  it("wraps success as {ok:true, value}", async () => {
    const cdp = fakeCdp({ "Runtime.evaluate": { result: { value: "hi" } } });
    expect(await evaluate(cdp, { expression: "'hi'" })).toEqual({ ok: true, value: "hi" });
  });

  it("wraps a page exception as {ok:false, error} instead of rejecting", async () => {
    const cdp = fakeCdp({
      "Runtime.evaluate": { exceptionDetails: { text: "boom" } },
    });
    expect(await evaluate(cdp, { expression: "x" })).toEqual({ ok: false, error: "boom" });
  });

  it("rejects when expression is missing", async () => {
    const cdp = fakeCdp();
    await expect(evaluate(cdp, {})).rejects.toThrow(/expression.*string/);
  });
});
