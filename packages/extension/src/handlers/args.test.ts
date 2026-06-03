import { describe, expect, it } from "vitest";
import { optionalNumber, optionalObject, optionalString, requireNumber, requireString } from "./args";

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
  it("returns the string, or the fallback only when the key is absent", () => {
    expect(optionalString({ s: "a" }, "s")).toBe("a");
    expect(optionalString({}, "s")).toBeUndefined();
    expect(optionalString({}, "s", "def")).toBe("def");
    expect(optionalString({ s: undefined }, "s", "def")).toBe("def");
  });
  it("throws when the value is present but not a string (don't silently default)", () => {
    expect(() => optionalString({ s: 5 }, "s", "def")).toThrow(/s.*string/);
  });
});

describe("optionalNumber", () => {
  it("returns the number, or the fallback only when the key is absent", () => {
    expect(optionalNumber({ n: 3 }, "n")).toBe(3);
    expect(optionalNumber({}, "n", 7)).toBe(7);
    expect(optionalNumber({ n: undefined }, "n", 7)).toBe(7);
  });
  it("throws when the value is present but not a usable number", () => {
    expect(() => optionalNumber({ n: "3" }, "n", 7)).toThrow(/n.*number/);
    expect(() => optionalNumber({ n: Number.NaN }, "n", 7)).toThrow(/n.*number/);
  });
});

describe("optionalObject", () => {
  it("returns a plain object, or the fallback when the key is absent", () => {
    expect(optionalObject({ p: { a: 1 } }, "p")).toEqual({ a: 1 });
    expect(optionalObject({}, "p")).toBeUndefined();
    expect(optionalObject({}, "p", {})).toEqual({});
  });
  it("throws when present but not a plain object (null, array, primitive)", () => {
    expect(() => optionalObject({ p: null }, "p", {})).toThrow(/p.*object/);
    expect(() => optionalObject({ p: [1, 2] }, "p", {})).toThrow(/p.*object/);
    expect(() => optionalObject({ p: "x" }, "p", {})).toThrow(/p.*object/);
  });
});
