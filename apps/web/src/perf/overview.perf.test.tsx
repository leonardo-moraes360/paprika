import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveProvider } from "@/data/live";
import { createQueryClient } from "@/data/query-client";
import { OverviewContainer } from "@/overview/overview-container";
import { createPerfLog, PerfProvider } from "@/perf";
import { createLiveRig, docMessage, makeDocument, nodeDelta } from "@/test/live-harness";

const COUNT = 200;
const workspaces = Array.from({ length: COUNT }, (_, i) => ({
  id: `w${i}`,
  name: `Workspace ${i}`,
  nodes: 10 + i,
  updatedAt: 1_700_000_000_000,
  active: i === 0,
  cover: null,
  archived: false,
  folderId: "",
  preview: [{ x: 0, y: 0, w: 10, h: 10, fill: "#c43d27" }],
}));

afterEach(() => vi.unstubAllGlobals());

async function mount() {
  // The list never changes here: the server answers the same body each time (structural sharing keeps the objects).
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ active: "w0", workspaces, folders: [] }), { status: 200, headers: { "content-type": "application/json" } }))));
  window.scrollTo = () => {};
  const rig = createLiveRig();
  const log = createPerfLog();
  const queryClient = createQueryClient();
  const root = createRootRoute({
    component: () => (
      <PerfProvider log={log}>
        <QueryClientProvider client={queryClient}>
          <LiveProvider client={rig.client}>
            <Outlet />
          </LiveProvider>
        </QueryClientProvider>
      </PerfProvider>
    ),
  });
  const home = createRoute({ getParentRoute: () => root, path: "/", component: OverviewContainer });
  const router = createRouter({ routeTree: root.addChildren([home]), history: createMemoryHistory({ initialEntries: ["/"] }) });
  render(<RouterProvider router={router} />);
  await screen.findByText("Workspace 199");
  await rig.connect();
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  return { rig, log, queryClient };
}

describe("overview commits with 200 workspaces", () => {
  it("renders every card of the list", async () => {
    await mount();
    expect(document.querySelectorAll("li[data-workspace-id]")).toHaveLength(COUNT);
  });

  it("deltas of the active document, in a burst, commit nothing in the grid", async () => {
    const { rig, log } = await mount();
    const doc = makeDocument(500, { id: "w0" });
    rig.deliver(docMessage(doc, 1));
    log.reset();
    const target = Object.keys(doc.nodes)[10] as string;
    rig.deliver(...Array.from({ length: 200 }, (_, i) => nodeDelta(doc, target, { x: i }, 2 + i)));
    rig.push({ type: "presence", agent: "s:1", actor: "agent:claude", tool: "update_nodes", nodes: [target], idle: 0 });
    expect(rig.client.store.state.version).toBe(201);
    expect(log.commits("overview")).toBe(0);
    expect(log.commits("overview-notice")).toBe(0);
  });

  it("control: a list change commits the grid; an agent's workspace notice commits only the notice", async () => {
    const { rig, log, queryClient } = await mount();
    log.reset();
    await act(async () => {
      queryClient.setQueryData(["workspaces", "all"], { active: "w0", workspaces: workspaces.slice(0, 50), folders: [] });
    });
    await waitFor(() => expect(document.querySelectorAll("li[data-workspace-id]")).toHaveLength(50));
    expect(log.commits("overview")).toBeGreaterThan(0);
    log.reset();
    rig.push({ type: "workspaceOp", op: { at: 1, actor: "agent:claude", op: "open", workspaceId: "w3", workspaceName: "Workspace 3", detail: {} } });
    expect(log.commits("overview-notice")).toBeGreaterThan(0);
    expect(log.commits("overview")).toBe(0);
  });
});
