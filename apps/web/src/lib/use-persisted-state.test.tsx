import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it } from "vitest";
import { booleanCodec, numberCodec } from "./persist";
import { usePersistedState } from "./use-persisted-state";

describe("usePersistedState", () => {
  it("starts from the initial value and writes on update", () => {
    const { result } = renderHook(() => usePersistedState("k", 5, numberCodec));
    expect(result.current[0]).toBe(5);
    act(() => result.current[1](9));
    expect(result.current[0]).toBe(9);
    expect(window.localStorage.getItem("paprika.k")).toBe("9");
  });

  it("reads the stored value and falls back when it is invalid", () => {
    window.localStorage.setItem("paprika.k", "1");
    expect(renderHook(() => usePersistedState("k", false, booleanCodec)).result.current[0]).toBe(true);
    window.localStorage.setItem("paprika.k", "maybe");
    expect(renderHook(() => usePersistedState("k", false, booleanCodec)).result.current[0]).toBe(false);
  });

  it("restores a stored false over a true initial value", () => {
    window.localStorage.setItem("paprika.k", "0");
    expect(renderHook(() => usePersistedState("k", true, booleanCodec)).result.current[0]).toBe(false);
  });

  it("never touches storage without a key", () => {
    const { result } = renderHook(() => usePersistedState(undefined, 1, numberCodec));
    act(() => result.current[1](2));
    expect(result.current[0]).toBe(2);
    expect(window.localStorage.length).toBe(0);
  });

  it("is stable under StrictMode", () => {
    window.localStorage.setItem("paprika.k", "7");
    const { result } = renderHook(() => usePersistedState("k", 1, numberCodec), { wrapper: StrictMode });
    expect(result.current[0]).toBe(7);
  });
});
