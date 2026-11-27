import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createPerfLog, perfRequested } from "./perf-log";
import { PerfProvider, RegionProfiler } from "./region-profiler";

afterEach(() => {
  window.history.replaceState(null, "", "/");
  delete window.__paprikaPerf;
});

function Counter({ id }: { id: string }) {
  const [n, setN] = useState(0);
  return (
    <RegionProfiler id={id}>
      <button onClick={() => setN(n + 1)}>{n}</button>
    </RegionProfiler>
  );
}

describe("perf log", () => {
  it("counts mounts and updates per region and keeps the slowest commit", () => {
    const log = createPerfLog();
    log.record("a", "mount", 4, 4, 0, 1);
    log.record("a", "update", 9, 9, 1, 2);
    log.record("a", "nested-update", 2, 2, 2, 3);
    log.record("b", "mount", 1, 1, 0, 1);
    expect(log.commits("a")).toBe(3);
    expect(log.commits("missing")).toBe(0);
    expect(log.stats().a).toMatchObject({ commits: 3, mounts: 1, updates: 2, actualDuration: 15, maxActualDuration: 9, lastActualDuration: 2 });
    expect(log.entries()).toHaveLength(4);
    log.reset();
    expect(log.stats()).toEqual({});
    expect(log.entries()).toEqual([]);
  });

  it("only keeps the last entries", () => {
    const log = createPerfLog();
    for (let i = 0; i < 5100; i += 1) log.record("a", "update", i, i, 0, i);
    expect(log.entries()).toHaveLength(5000);
    expect(log.entries().at(-1)?.actualDuration).toBe(5099);
    // Oldest first, in order, after the ring wrapped (and still in order after one more lap).
    expect(log.entries()[0]?.actualDuration).toBe(100);
    for (let i = 5100; i < 10_050; i += 1) log.record("a", "update", i, i, 0, i);
    expect(log.entries().map((entry) => entry.actualDuration)).toEqual(Array.from({ length: 5000 }, (_, i) => 5050 + i));
    expect(log.commits("a")).toBe(10_050);
  });
});

describe("RegionProfiler", () => {
  it("renders only its children when profiling is off (no register in the tree)", () => {
    render(
      <RegionProfiler id="x">
        <span>child</span>
      </RegionProfiler>,
    );
    expect(screen.getByText("child")).toBeInTheDocument();
  });

  it("records the commits of its region in the register it is given, and no window global", async () => {
    const log = createPerfLog();
    render(
      <PerfProvider log={log}>
        <Counter id="region" />
        <Counter id="other" />
      </PerfProvider>,
    );
    expect(log.stats().region?.mounts).toBe(1);
    log.reset();
    await act(async () => screen.getAllByRole("button")[0]?.click());
    expect(log.commits("region")).toBe(1);
    expect(log.commits("other")).toBe(0);
    expect(window.__paprikaPerf).toBeUndefined();
  });

  it("a region inside another is not counted for the outer one when only the inner one rendered", async () => {
    function Inner() {
      const [n, setN] = useState(0);
      return <button onClick={() => setN(n + 1)}>inner {n}</button>;
    }
    function Outer() {
      const [n, setN] = useState(0);
      return (
        <div>
          <button onClick={() => setN(n + 1)}>outer {n}</button>
          {Array.from({ length: 300 }, (_, i) => (
            <span key={i}>{i + n}</span>
          ))}
          <RegionProfiler id="inner">
            <Inner />
          </RegionProfiler>
        </div>
      );
    }
    const log = createPerfLog();
    render(
      <PerfProvider log={log}>
        <RegionProfiler id="outer">
          <Outer />
        </RegionProfiler>
      </PerfProvider>,
    );
    expect(log.stats().outer?.mounts).toBe(1);
    expect(log.stats().inner?.mounts).toBe(1);
    log.reset();
    await act(async () => screen.getByRole("button", { name: /inner/ }).click());
    expect(log.commits("inner")).toBe(1);
    expect(log.commits("outer")).toBe(0);
    await act(async () => screen.getByRole("button", { name: /outer/ }).click());
    expect(log.commits("outer")).toBe(1);
    expect(log.commits("inner")).toBe(2);
  });

  it("exposes window.__paprikaPerf only with ?perf=1, and removes it on unmount", async () => {
    const off = render(
      <PerfProvider>
        <Counter id="r" />
      </PerfProvider>,
    );
    expect(window.__paprikaPerf).toBeUndefined();
    off.unmount();

    window.history.replaceState(null, "", "/?perf=1");
    const on = render(
      <PerfProvider>
        <Counter id="r" />
      </PerfProvider>,
    );
    expect(window.__paprikaPerf).toBeDefined();
    expect(window.__paprikaPerf?.commits("r")).toBe(1);
    await act(async () => screen.getByRole("button").click());
    expect(window.__paprikaPerf?.stats().r?.commits).toBe(2);
    window.__paprikaPerf?.reset();
    expect(window.__paprikaPerf?.commits("r")).toBe(0);
    on.unmount();
    expect(window.__paprikaPerf).toBeUndefined();
  });

  it("perfRequested needs ?perf=1 and a dev or test build", () => {
    expect(perfRequested("?perf=1", { dev: true, test: false })).toBe(true);
    expect(perfRequested("?perf=1", { dev: false, test: true })).toBe(true);
    expect(perfRequested("?perf=1", { dev: false, test: false })).toBe(false);
    expect(perfRequested("?perf=0", { dev: true, test: true })).toBe(false);
    expect(perfRequested("", { dev: true, test: true })).toBe(false);
  });
});
