import { describe, expect, it } from "vitest";
import { parseModeTokenAssignment, parseTokenAssignment, tokenValue } from "./token-parsing";

describe("parseTokenAssignment", () => {
  it("reads name = value and a leading dollar", () => {
    expect(parseTokenAssignment("brand = #e8553d")).toEqual({ name: "brand", value: "#e8553d" });
    expect(parseTokenAssignment("$gap: 8")).toEqual({ name: "gap", value: "8" });
  });
  it("reads a type before the name and a collection before a slash", () => {
    expect(parseTokenAssignment("color brand = #fff")).toEqual({ name: "brand", value: "#fff", type: "color" });
    expect(parseTokenAssignment("core/color brand = #fff")).toEqual({ name: "brand", value: "#fff", type: "color", collection: "core" });
  });
  it("rejects text without an assignment or without a value", () => {
    expect(parseTokenAssignment("brand")).toBeNull();
    expect(parseTokenAssignment("brand =")).toBeNull();
    expect(parseTokenAssignment("= 1")).toBeNull();
  });
});

describe("parseModeTokenAssignment", () => {
  it("reads mode: name = value", () => {
    expect(parseModeTokenAssignment("dark: bg = #14161f")).toEqual({ mode: "dark", name: "bg", value: "#14161f" });
    expect(parseModeTokenAssignment("bg = #14161f")).toBeNull();
  });
});

describe("tokenValue", () => {
  it("turns numeric text into numbers", () => {
    expect(tokenValue("12")).toBe(12);
    expect(tokenValue("#fff")).toBe("#fff");
  });
});
