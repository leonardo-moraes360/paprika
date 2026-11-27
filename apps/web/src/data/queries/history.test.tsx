import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HISTORY_SETTLE_MS, useHistory, type PanelView } from "./history";

const view = (version: number): PanelView => ({ version, steps: [], canUndo: false, canRedo: false });

describe("history query", () => {
  let fetches: string[];
  beforeEach(() => {
    fetches = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetches.push(url);
        return new Response(JSON.stringify(view(1)), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  let client: QueryClient;
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

  it("asks the workspace's own history route", async () => {
    const { result } = renderHook(() => useHistory("ws 1", 1), { wrapper });
    await waitFor(() => expect(result.current.data?.version).toBe(1));
    expect(fetches[0]).toContain("/api/workspaces/ws%201/history");
  });

  it("refetches once, only after the version stops changing, keeping the previous data meanwhile", async () => {
    const { result, rerender } = renderHook(({ version }) => useHistory("w", version), { wrapper, initialProps: { version: 1 } });
    await waitFor(() => expect(result.current.data?.version).toBe(1));
    const base = fetches.length;
    vi.useFakeTimers();
    for (let version = 2; version <= 6; version += 1) {
      rerender({ version });
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

  it("keeps the previous steps visible while the next fetch is in flight", async () => {
    let release: () => void = () => {};
    const { result, rerender } = renderHook(({ version }) => useHistory("w", version), { wrapper, initialProps: { version: 1 } });
    await waitFor(() => expect(result.current.data?.version).toBe(1));
    (fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(new Response(JSON.stringify(view(9)), { status: 200, headers: { "content-type": "application/json" } })))));
    rerender({ version: 2 });
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.data?.version).toBe(1);
    release();
    await waitFor(() => expect(result.current.data?.version).toBe(9));
  });
});
