import { afterEach, describe, expect, it, vi } from "vitest";
import {
  booleanCodec,
  jsonCodec,
  numberCodec,
  readPersisted,
  readPersistedBoolean,
  readPersistedJson,
  readPersistedNumber,
  writePersisted,
  writePersistedBoolean,
  writePersistedJson,
} from "./persist";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("persist", () => {
  it("stores values under the paprika. prefix", () => {
    writePersisted("panel.left", "300");
    expect(window.localStorage.getItem("paprika.panel.left")).toBe("300");
    expect(readPersisted("panel.left")).toBe("300");
  });

  it("removes a key when the value is null", () => {
    writePersisted("a", "1");
    writePersisted("a", null);
    expect(readPersisted("a")).toBeNull();
  });

  it("reads numbers and rejects what is not one", () => {
    writePersisted("n", "320");
    expect(readPersistedNumber("n")).toBe(320);
    writePersisted("n", "abc");
    expect(readPersistedNumber("n")).toBeNull();
    writePersisted("n", "");
    expect(readPersistedNumber("n")).toBeNull();
    expect(readPersistedNumber("missing")).toBeNull();
  });

  it("round-trips booleans and returns null when unset", () => {
    expect(readPersistedBoolean("b")).toBeNull();
    writePersistedBoolean("b", true);
    expect(readPersistedBoolean("b")).toBe(true);
    writePersistedBoolean("b", false);
    expect(readPersistedBoolean("b")).toBe(false);
  });

  it("does not throw when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(readPersisted("x")).toBeNull();
    expect(() => writePersisted("x", "1")).not.toThrow();
  });

  it("does not throw when the accessor itself throws", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readPersisted("x")).toBeNull();
    expect(() => writePersisted("x", "1")).not.toThrow();
  });

  it("is safe when there is no window (prerender)", () => {
    vi.stubGlobal("window", undefined);
    expect(readPersisted("x")).toBeNull();
    expect(() => writePersisted("x", "1")).not.toThrow();
  });
});

describe("persist json and codecs", () => {
  const isSize = (value: unknown): value is { w: number } => typeof value === "object" && value !== null && typeof (value as { w?: unknown }).w === "number";

  it("reads json only when it passes the validator", () => {
    writePersistedJson("j", { w: 3 });
    expect(readPersistedJson("j", isSize)).toEqual({ w: 3 });
    writePersisted("j", JSON.stringify({ w: "x" }));
    expect(readPersistedJson("j", isSize)).toBeNull();
    writePersisted("j", "{broken");
    expect(readPersistedJson("j", isSize)).toBeNull();
    expect(readPersistedJson("missing", isSize)).toBeNull();
  });

  it("rejects hexadecimal and padded numbers", () => {
    writePersisted("n", "0x10");
    expect(readPersistedNumber("n")).toBeNull();
    writePersisted("n", "1e3");
    expect(readPersistedNumber("n")).toBeNull();
    writePersisted("n", " 42 ");
    expect(readPersistedNumber("n")).toBe(42);
  });

  it("codecs round-trip and reject garbage", () => {
    expect(booleanCodec.parse(booleanCodec.serialize(false))).toBe(false);
    expect(booleanCodec.parse("yes")).toBeNull();
    expect(numberCodec.parse(numberCodec.serialize(248))).toBe(248);
    expect(numberCodec.parse("abc")).toBeNull();
    expect(jsonCodec(isSize).parse(jsonCodec(isSize).serialize({ w: 1 }))).toEqual({ w: 1 });
  });
});
