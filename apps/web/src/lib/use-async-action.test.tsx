import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { errorOrFallback, errorText, useAsyncAction } from "./use-async-action";

const deferred = () => {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("errorText", () => {
  it("reads Error messages and strings, and is empty for anything else", () => {
    expect(errorText(new Error("boom"))).toBe("boom");
    expect(errorText("plain")).toBe("plain");
    expect(errorText(new Error(""))).toBe("");
    expect(errorText(undefined)).toBe("");
    expect(errorText({ message: "x" })).toBe("");
  });
});

describe("errorOrFallback", () => {
  it("never returns an empty message for an error", () => {
    expect(errorOrFallback(null, "generic")).toBeNull();
    expect(errorOrFallback("boom", "generic")).toBe("boom");
    expect(errorOrFallback("", "generic")).toBe("generic");
    expect(errorOrFallback("   ", "generic")).toBe("generic");
  });
});

describe("useAsyncAction", () => {
  it("is pending while the action runs and clean after it resolves", async () => {
    const gate = deferred();
    const { result } = renderHook(() => useAsyncAction());
    let outcome!: Promise<boolean>;
    act(() => {
      outcome = result.current.run(() => gate.promise);
    });
    expect(result.current.pending).toBe(true);
    await act(async () => {
      gate.resolve();
      await outcome;
    });
    expect(await outcome).toBe(true);
    expect(result.current).toMatchObject({ pending: false, error: null });
  });

  it("returns false for a second click while the first is still running", async () => {
    const gate = deferred();
    const action = vi.fn(() => gate.promise);
    const { result } = renderHook(() => useAsyncAction());
    let first!: Promise<boolean>;
    act(() => {
      first = result.current.run(action);
    });
    let second = true;
    await act(async () => {
      second = await result.current.run(action);
    });
    expect(second).toBe(false);
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => {
      gate.resolve();
      await first;
    });
    await act(async () => {
      await result.current.run(action);
    });
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("stores the failure message, and clearError removes it", async () => {
    const { result } = renderHook(() => useAsyncAction());
    await act(async () => {
      expect(await result.current.run(() => Promise.reject(new Error("nope")))).toBe(false);
    });
    expect(result.current).toMatchObject({ pending: false, error: "nope" });
    expect(result.current.errorText("generic")).toBe("nope");
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
    expect(result.current.errorText("generic")).toBeNull();
  });

  it("exposes a non-empty errorText when the rejection carries no message", async () => {
    const { result } = renderHook(() => useAsyncAction());
    await act(async () => {
      await result.current.run(() => Promise.reject(new Error("")));
    });
    expect(result.current.error).toBe("");
    expect(result.current.errorText("Could not save")).toBe("Could not save");
    await act(async () => {
      await result.current.run(() => Promise.reject(undefined));
    });
    expect(result.current.errorText("Could not save")).toBe("Could not save");
  });

  it("a synchronous throw is a failure too", async () => {
    const { result } = renderHook(() => useAsyncAction());
    await act(async () => {
      expect(
        await result.current.run(() => {
          throw new Error("sync");
        }),
      ).toBe(false);
    });
    expect(result.current.error).toBe("sync");
  });

  it("does not set state after unmount", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const gate = deferred();
    const { result, unmount } = renderHook(() => useAsyncAction());
    let outcome!: Promise<boolean>;
    act(() => {
      outcome = result.current.run(() => gate.promise);
    });
    const before = result.current;
    unmount();
    gate.reject(new Error("late"));
    expect(await outcome).toBe(false);
    expect(result.current).toBe(before);
    expect(result.current.pending).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
