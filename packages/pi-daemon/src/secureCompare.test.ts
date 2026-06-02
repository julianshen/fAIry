import { timingSafeStrEqual } from "./secureCompare";

describe("timingSafeStrEqual", () => {
  it("is true for equal strings", () => {
    expect(timingSafeStrEqual("abc123", "abc123")).toBe(true);
  });

  it("is false for different strings of the same length", () => {
    expect(timingSafeStrEqual("abc123", "abc124")).toBe(false);
  });

  it("is false for strings of different length", () => {
    expect(timingSafeStrEqual("abc", "abcd")).toBe(false);
  });

  it("handles empty and multi-byte strings", () => {
    expect(timingSafeStrEqual("", "")).toBe(true);
    expect(timingSafeStrEqual("café", "café")).toBe(true);
    expect(timingSafeStrEqual("café", "cafe")).toBe(false);
  });
});
