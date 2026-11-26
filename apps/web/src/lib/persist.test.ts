import { afterEach, describe, expect, it, vi } from "vitest";
import { readPersisted, readPersistedBoolean, readPersistedNumber, writePersisted, writePersistedBoolean } from "./persist";

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
