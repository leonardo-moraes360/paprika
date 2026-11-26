import { describe, expect, it } from "vitest";
import { allowsNumberFieldInput, commitNumeric, formatPadding, lockedSize, parseNumeric, parsePadding, stepNumeric } from "./numeric-input";

describe("parseNumeric", () => {
  it("accepts a comma as decimal separator and rejects partial input", () => {
    expect(parseNumeric(" 1,5 ")).toBe(1.5);
    expect(parseNumeric("-")).toBeUndefined();
    expect(parseNumeric("")).toBeUndefined();
    expect(parseNumeric("abc")).toBeUndefined();
  });
});

describe("allowsNumberFieldInput", () => {
  it("allows keyword prefixes only when keywords are given", () => {
    expect(allowsNumberFieldInput("hu", ["hug", "fill"])).toBe(true);
    expect(allowsNumberFieldInput("hu")).toBe(false);
    expect(allowsNumberFieldInput("-1,5")).toBe(true);
  });
});

describe("commitNumeric", () => {
  it("clamps into the range and reports the issue", () => {
    expect(commitNumeric("1.4", { min: 0, max: 1 })).toEqual({ ok: true, value: 1, text: "1", clamped: true, issue: { kind: "between", min: 0, max: 1 } });
  });
  it("rounds integers and fails on text", () => {
    expect(commitNumeric("2.6", { integer: true })).toMatchObject({ ok: true, value: 3, clamped: true });
    expect(commitNumeric("x")).toEqual({ ok: false, issue: { kind: "number" } });
  });
});

describe("stepNumeric", () => {
  it("steps by 1, by 10 with shift and by 0.05 in the 0..1 range without float noise", () => {
    expect(stepNumeric(5, 1)).toMatchObject({ value: 6 });
    expect(stepNumeric(5, -1, {}, { shift: true })).toMatchObject({ value: -5 });
    expect(stepNumeric(0.9, 1, { min: 0, max: 1 })).toMatchObject({ value: 0.95 });
    expect(stepNumeric(0.95, 1, { min: 0, max: 1 }, { shift: true })).toMatchObject({ value: 1, clamped: true });
  });
  it("starts from the minimum when there is no current value", () => {
    expect(stepNumeric(undefined, 1, { min: 100, max: 900, integer: true })).toMatchObject({ value: 200 });
  });
});

describe("lockedSize", () => {
  it("lets the changed side command the other one", () => {
    expect(lockedSize("width", 200, { width: 100, height: 50 })).toEqual({ width: 200, height: 100 });
    expect(lockedSize("height", 25, { width: 100, height: 50 })).toEqual({ width: 50, height: 25 });
  });
  it("gives up when a side has no usable size", () => {
    expect(lockedSize("width", 10, { width: 0, height: 50 })).toBeNull();
    expect(lockedSize("width", 0, { width: 10, height: 50 })).toBeNull();
  });
});

describe("padding", () => {
  it("parses one or four non-negative values", () => {
    expect(parsePadding("8")).toBe(8);
    expect(parsePadding("1 2, 3 4")).toEqual([1, 2, 3, 4]);
    expect(parsePadding("1 2")).toBeNull();
    expect(parsePadding("-1")).toBeNull();
    expect(parsePadding("a")).toBeNull();
    expect(parsePadding("$space")).toBe("$space");
    expect(parsePadding("1 $x 3 4")).toEqual([1, "$x", 3, 4]);
  });
  it("formats both shapes", () => {
    expect(formatPadding([1, 2, 3, 4])).toBe("1 2 3 4");
    expect(formatPadding(6)).toBe("6");
    expect(formatPadding(undefined)).toBe("");
  });
});
