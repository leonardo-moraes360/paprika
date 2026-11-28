import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveProvider } from "@/data/live";
import { createLiveRig, docMessage, makeDocument, nodeDelta } from "@/test/live-harness";
import { createRefreshThrottle, createWorkspaceActions, refreshIntervalMs, useWorkspacesFollow, workspacesQuery, type WorkspaceList } from "./workspaces";

afterEach(() => vi.useRealTimers());

describe("createRefreshThrottle", () => {
  it("runs the first request at once and at most once per interval after it, never losing the last one", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    let clock = 10_000;
    const throttle = createRefreshThrottle(run, 500, () => clock);
    throttle.request();
    expect(run).toHaveBeenCalledTimes(1);
    clock += 100;
    throttle.request();
    throttle.request();
    expect(run).toHaveBeenCalledTimes(1);
    clock += 400;
    vi.advanceTimersByTime(400);
    expect(run).toHaveBeenCalledTimes(2);
    clock += 600;
    throttle.request();
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("`now` runs at once and resets the interval; `cancel` drops a waiting run", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    let clock = 0;
    const throttle = createRefreshThrottle(run, 500, () => clock);
    throttle.request();
    clock += 10;
    throttle.request();
    throttle.cancel();
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(1);
    throttle.now();
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("useWorkspacesFollow", () => {
  function setup() {
    const rig = createLiveRig();
    const queries = new QueryClient();
    const invalidate = vi.spyOn(queries, "invalidateQueries").mockResolvedValue();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queries}>
        <LiveProvider client={rig.client}>{children}</LiveProvider>
      </QueryClientProvider>
    );
    const hook = renderHook(() => useWorkspacesFollow(), { wrapper });
    return { rig, invalidate, ...hook };
  }

  it("a stream of deltas refetches at most every 500 ms, the first document does not refetch, another active workspace does at once", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { rig, invalidate } = setup();
    await act(async () => {
      await rig.connect();
    });
    act(() => {
      vi.advanceTimersByTime(refreshIntervalMs);
    });
    invalidate.mockClear();
    const doc = makeDocument(20, { id: "a" });
    rig.deliver(docMessage(doc, 1));
    expect(invalidate).not.toHaveBeenCalled();
    rig.deliver(nodeDelta(doc, Object.keys(doc.nodes)[3] as string, { x: 1 }, 2));
    expect(invalidate).toHaveBeenCalledTimes(1);
    for (let v = 3; v < 60; v += 1) rig.deliver(nodeDelta(doc, Object.keys(doc.nodes)[3] as string, { x: v }, v));
    expect(invalidate).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(refreshIntervalMs);
    });
    expect(invalidate).toHaveBeenCalledTimes(2);
    rig.deliver(docMessage(makeDocument(5, { id: "b" }), 61));
    expect(invalidate).toHaveBeenCalledTimes(3);
  });

  it("refetches at once on a workspace operation and when the connection comes back", async () => {
    const { rig, invalidate } = setup();
    const socket = await rig.connect();
    invalidate.mockClear();
    rig.push({ type: "workspaceOp", op: { at: 1, actor: "user", op: "create", workspaceId: "n", workspaceName: "N", detail: {} } });
    expect(invalidate).toHaveBeenCalledTimes(1);
    act(() => socket.drop());
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("stops listening on unmount", async () => {
    const { rig, invalidate, unmount } = setup();
    await rig.connect();
    unmount();
    invalidate.mockClear();
    rig.push({ type: "workspaceOp", op: { at: 1, actor: "user", op: "create", workspaceId: "n", workspaceName: "N", detail: {} } });
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("rename", () => {
  const list = (names: Record<string, string>): WorkspaceList => ({
    active: "a",
    folders: [],
    workspaces: Object.entries(names).map(([id, name]) => ({ id, name, nodes: 1, updatedAt: 1, active: id === "a", cover: null, archived: false, folderId: "", preview: [] })),
  });
  const nameOf = (queries: QueryClient, id: string) => queries.getQueryData<WorkspaceList>(workspacesQuery().queryKey)?.workspaces.find((w) => w.id === id)?.name;

  afterEach(() => vi.unstubAllGlobals());

  it("shows the new name at once and puts the old one back when the request fails and the list cannot be fetched either", async () => {
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queries.setQueryData(workspacesQuery().queryKey, list({ a: "Demo", b: "Checkout" }));
    let fail: () => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve) => {
        if (init?.method === "PATCH") fail = () => resolve(new Response(JSON.stringify({ error: "boom" }), { status: 500, headers: { "content-type": "application/json" } }));
        else resolve(new Response("down", { status: 503 }));
      })),
    );
    const actions = createWorkspaceActions(queries);
    const done = actions.rename("b", "Payments").catch((e: unknown) => e);
    await vi.waitFor(() => expect(nameOf(queries, "b")).toBe("Payments"));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    fail();
    expect(await done).toBeInstanceOf(Error);
    await vi.waitFor(() => expect(nameOf(queries, "b")).toBe("Checkout"));
    expect(nameOf(queries, "a")).toBe("Demo");
  });

  it("does not undo a newer name that arrived meanwhile", async () => {
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queries.setQueryData(workspacesQuery().queryKey, list({ b: "Checkout" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          queries.setQueryData(workspacesQuery().queryKey, list({ b: "Renamed by an agent" }));
          return new Response(JSON.stringify({ error: "boom" }), { status: 500, headers: { "content-type": "application/json" } });
        }
        return new Response("down", { status: 503 });
      }),
    );
    await createWorkspaceActions(queries).rename("b", "Payments").catch(() => {});
    expect(nameOf(queries, "b")).toBe("Renamed by an agent");
  });
});
