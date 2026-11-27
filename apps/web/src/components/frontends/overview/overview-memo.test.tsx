import { act, render } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as model from "./model";
import { Overview } from "./overview";
import type { WorkspaceEntry } from "./types";

vi.mock("./model", async (original) => {
  const actual = await original<typeof import("./model")>();
  return { ...actual, relativeTime: vi.fn(actual.relativeTime) };
});

const NOW = 1_700_000_000_000;
const entries: WorkspaceEntry[] = Array.from({ length: 200 }, (_, i) => ({ id: `w${i}`, name: `Workspace ${i}`, nodes: i, updatedAt: NOW }));
const noop = () => undefined;
const handlers = { onOpen: noop, onCreate: noop, onRename: noop, onDelete: noop, onArchive: noop, onRestore: noop, onChangeCover: noop, onMoveToProject: noop };

describe("Overview cards", () => {
  it("a list where ONE entry changed re-renders that card only, even when the owner passes new inline callbacks and a new renderPreview", () => {
    const calls = vi.mocked(model.relativeTime);
    const view = render(<Overview workspaces={entries} now={NOW} {...handlers} renderPreview={() => null} />);
    expect(calls.mock.calls.length).toBeGreaterThanOrEqual(200);
    calls.mockClear();
    const next = entries.map((entry, i) => (i === 7 ? { ...entry, name: "Renamed", nodes: 99 } : entry));
    view.rerender(<Overview workspaces={next} now={NOW} {...handlers} onRename={() => undefined} onArchive={() => undefined} renderPreview={() => null} />);
    // the changed card renders once or twice; the other 199 do not render at all (they were 200 renders each time before the cards were memoized)
    expect(calls.mock.calls.length).toBeLessThanOrEqual(2);
    expect(view.getByText("Renamed")).toBeInTheDocument();
  });

  describe("the 30 s clock", () => {
    afterEach(() => vi.useRealTimers());

    it("re-renders no card while the grid is left open and no label turns over (200 cards, 31 s)", () => {
      vi.useFakeTimers({ now: NOW });
      let commits = 0;
      render(
        <Profiler id="grid" onRender={() => (commits += 1)}>
          <Overview workspaces={entries} {...handlers} renderPreview={() => null} />
        </Profiler>,
      );
      commits = 0;
      act(() => void vi.advanceTimersByTime(31_000));
      // "now" lasts 45 s: the tick compares labels and sets nothing, so there is no commit at all (it used to rebuild the 200 cards).
      expect(commits).toBe(0);
      act(() => void vi.advanceTimersByTime(30_000));
      // 61 s old: every label turned over to "1 minute ago", and only the label leaves re-render (one render each, no grid).
      expect(commits).toBeGreaterThan(0);
    });
  });
});
