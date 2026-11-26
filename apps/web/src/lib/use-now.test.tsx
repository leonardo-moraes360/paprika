import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow } from "./use-now";

describe("useNow", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts from the injected clock and ticks every interval", () => {
    let time = 1000;
    const clock = vi.fn(() => time);
    const { result } = renderHook(() => useNow(undefined, clock, 500));
    expect(result.current).toBe(1000);
    time = 2000;
    act(() => vi.advanceTimersByTime(499));
    expect(result.current).toBe(1000);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(2000);
    time = 3500;
    act(() => vi.advanceTimersByTime(500));
    expect(result.current).toBe(3500);
  });

  it("uses a 1 second interval by default", () => {
    let time = 0;
    const { result } = renderHook(() => useNow(undefined, () => time));
    time = 10;
    act(() => vi.advanceTimersByTime(999));
    expect(result.current).toBe(0);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(10);
  });

  it("returns the controlled value and sets no timer", () => {
    const clock = vi.fn(() => 5);
    const { result, rerender } = renderHook(({ now }) => useNow(now, clock, 100), { initialProps: { now: 42 as number | undefined } });
    expect(result.current).toBe(42);
    expect(vi.getTimerCount()).toBe(0);
    rerender({ now: 99 });
    expect(result.current).toBe(99);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(99);
  });

  it("resumes from the clock when the controlled value is dropped", () => {
    const { result, rerender } = renderHook(({ now }) => useNow(now, () => 7, 100), { initialProps: { now: 1 as number | undefined } });
    expect(result.current).toBe(1);
    rerender({ now: undefined });
    expect(result.current).toBe(7);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("clears the timer on unmount", () => {
    const { unmount } = renderHook(() => useNow(undefined, () => 1, 100));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
