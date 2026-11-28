import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveProvider } from "@/data/live";
import { createLiveRig, docMessage, makeDocument, nodeDelta, type LiveRig } from "@/test/live-harness";
import { HISTORY_SETTLE_MS, useHistory, type PanelView } from "./history";

const view = (version: number): PanelView => ({ version, steps: [], canUndo: false, canRedo: false });
const doc = makeDocument(20, { id: "w" });
const node = Object.keys(doc.nodes)[3] as string;

describe("history query", () => {
  let fetches: string[];
  let client: QueryClient;
  let rig: LiveRig;
  beforeEach(() => {
    fetches = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetches.push(url);
        return new Response(JSON.stringify(view(1)), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
    rig = createLiveRig();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <LiveProvider client={rig.client}>{children}</LiveProvider>
    </QueryClientProvider>
  );
  const bump = (from: number, to: number) => {
    for (let version = from; version <= to; version += 1) rig.deliver(nodeDelta(doc, node, { x: version }, version));
  };

  it("asks the workspace's own history route", async () => {
    const { result } = renderHook(() => useHistory("ws 1"), { wrapper });
    await waitFor(() => expect(result.current.data?.version).toBe(1));
    expect(fetches[0]).toContain("/api/workspaces/ws%201/history");
  });

  it("keeps one cache entry per workspace, whatever the version", async () => {
    await rig.connect();
    rig.deliver(docMessage(doc, 1));
    const { result } = renderHook(() => useHistory("w"), { wrapper });
    await waitFor(() => expect(result.current.data?.version).toBe(1));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    for (let version = 2; version <= 9; version += 3) {
      bump(version, version);
      await act(async () => void (await vi.advanceTimersByTimeAsync(HISTORY_SETTLE_MS + 10)));
    }
    expect(client.getQueryCache().findAll({ queryKey: ["history"] }).map((q) => q.queryKey)).toEqual([["history", "w"]]);
  });

  it("refetches once, only after the version stops changing, keeping the previous data meanwhile", async () => {
    await rig.connect();
    rig.deliver(docMessage(doc, 1));
    const { result } = renderHook(() => useHistory("w"), { wrapper });
    await waitFor(() => expect(result.current.data?.version).toBe(1));
    const base = fetches.length;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    for (let version = 2; version <= 6; version += 1) {
      bump(version, version);
      act(() => void vi.advanceTimersByTime(HISTORY_SETTLE_MS - 50));
    }
    expect(fetches).toHaveLength(base);
    expect(result.current.data?.version).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HISTORY_SETTLE_MS + 10);
    });
    expect(fetches).toHaveLength(base + 1);
    expect(result.current.data?.version).toBe(1);
  });

  it("does not refetch because the first document arrived, nor for another workspace's versions", async () => {
    await rig.connect();
    const { result } = renderHook(() => useHistory("w"), { wrapper });
    await waitFor(() => expect(result.current.data?.version).toBe(1));
    const base = fetches.length;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    rig.deliver(docMessage(doc, 1));
    const other = makeDocument(5, { id: "other" });
    rig.deliver(docMessage(other, 30));
    rig.deliver(nodeDelta(other, Object.keys(other.nodes)[1] as string, { x: 1 }, 31));
    await act(async () => void (await vi.advanceTimersByTimeAsync(HISTORY_SETTLE_MS * 3)));
    expect(fetches).toHaveLength(base);
  });

  it("keeps the previous steps visible while the next fetch is in flight", async () => {
    await rig.connect();
    rig.deliver(docMessage(doc, 1));
    let release: () => void = () => {};
    const { result } = renderHook(() => useHistory("w"), { wrapper });
    await waitFor(() => expect(result.current.data?.version).toBe(1));
    const base = vi.mocked(fetch).mock.calls.length;
    (fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(new Response(JSON.stringify(view(9)), { status: 200, headers: { "content-type": "application/json" } })))));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    bump(2, 2);
    await act(async () => void (await vi.advanceTimersByTimeAsync(HISTORY_SETTLE_MS + 10)));
    await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
    expect(fetch).toHaveBeenCalledTimes(base + 1);
    expect(client.getQueryState(["history", "w"])?.fetchStatus).toBe("fetching");
    expect(result.current.data?.version).toBe(1);
    vi.useRealTimers();
    release();
    await waitFor(() => expect(result.current.data?.version).toBe(9));
  });

  it("stops following when it unmounts", async () => {
    await rig.connect();
    rig.deliver(docMessage(doc, 1));
    const { result, unmount } = renderHook(() => useHistory("w"), { wrapper });
    await waitFor(() => expect(result.current.data?.version).toBe(1));
    const base = fetches.length;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    bump(2, 2);
    unmount();
    await act(async () => void (await vi.advanceTimersByTimeAsync(HISTORY_SETTLE_MS * 2)));
    expect(fetches).toHaveLength(base);
  });
});
