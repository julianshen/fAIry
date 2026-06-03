import { describe, expect, it } from "vitest";
import { optionalNumber, optionalString, requireNumber, requireString } from "./args";

describe("requireString", () => {
  it("returns the value when it is a string", () => {
    expect(requireString({ url: "x" }, "url")).toBe("x");
  });
  it("throws a named error when missing or non-string", () => {
    expect(() => requireString({}, "url")).toThrow(/url.*string/);
    expect(() => requireString({ url: 1 }, "url")).toThrow(/url.*string/);
  });
});

describe("requireNumber", () => {
  it("returns the value when it is a number", () => {
    expect(requireNumber({ x: 0 }, "x")).toBe(0);
  });
  it("throws when missing, non-number, or NaN", () => {
    expect(() => requireNumber({}, "x")).toThrow(/x.*number/);
    expect(() => requireNumber({ x: "1" }, "x")).toThrow(/x.*number/);
    expect(() => requireNumber({ x: Number.NaN }, "x")).toThrow(/x.*number/);
  });
});

describe("optionalString", () => {
  it("returns the string or the fallback", () => {
    expect(optionalString({ s: "a" }, "s")).toBe("a");
    expect(optionalString({}, "s")).toBeUndefined();
    expect(optionalString({}, "s", "def")).toBe("def");
  });
  it("falls back when the value is the wrong type", () => {
    expect(optionalString({ s: 5 }, "s", "def")).toBe("def");
  });
});

describe("optionalNumber", () => {
  it("returns the number or the fallback", () => {
    expect(optionalNumber({ n: 3 }, "n")).toBe(3);
    expect(optionalNumber({}, "n", 7)).toBe(7);
    expect(optionalNumber({ n: "3" }, "n", 7)).toBe(7);
    expect(optionalNumber({ n: Number.NaN }, "n", 7)).toBe(7);
  });
});
