/**
 * Renders some editor regions with a fake server behind them and an editor store the test can drive (flags, selection),
 * since the full editor has no screen yet that sets them. Used by the batch 4 tests; nothing in the app imports it.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { Notifications } from "@/components/notifications";
import { LiveProvider } from "@/data/live/hooks";
import { createQueryClient } from "@/data/query-client";
import { EditorProvider, initialEditorState, useEditorStore, type EditorState } from "@/editor/editor-store";
import { createPerfLog, PerfProvider, RegionProfiler } from "@/perf";
import { createLiveRig, docMessage, makeDocument, type LiveRig } from "./live-harness";

export type EditorHandle = { current: ReturnType<typeof useEditorStore> | null };

function Probe({ handle }: { handle: EditorHandle }) {
  handle.current = useEditorStore();
  return null;
}

export type RegionRigOptions = {
  rig?: LiveRig;
  nodes?: number;
  workspaceId?: string;
  initial?: Partial<EditorState>;
  /** Regions to render, each as `[profiler id, element]`. */
  regions: readonly (readonly [string, ReactNode])[];
  /** Wrap in a router (the notice navigates). */
  router?: boolean;
};

export async function renderRegions({ rig: given, nodes = 60, workspaceId = "doc-1", initial, regions, router }: RegionRigOptions) {
  window.scrollTo = () => {};
  const rig = given ?? createLiveRig();
  const log = createPerfLog();
  const handle: EditorHandle = { current: null };
  const queryClient = createQueryClient();
  const doc = makeDocument(nodes, { id: workspaceId });
  const body = (
    <PerfProvider log={log}>
      <QueryClientProvider client={queryClient}>
        <LiveProvider client={rig.client}>
          <EditorProvider initial={() => initialEditorState(initial)}>
            <Probe handle={handle} />
            {regions.map(([id, element]) => (
              <RegionProfiler key={id} id={id}>
                {element}
              </RegionProfiler>
            ))}
            <Notifications />
          </EditorProvider>
        </LiveProvider>
      </QueryClientProvider>
    </PerfProvider>
  );
  let view: ReturnType<typeof render>;
  if (router) {
    const root = createRootRoute({ component: () => <Outlet /> });
    const index = createRoute({ getParentRoute: () => root, path: "/", component: () => body });
    const home = createRoute({ getParentRoute: () => root, path: "/home", component: () => <div data-testid="home-route" /> });
    const tree = createRouter({ routeTree: root.addChildren([index, home]), history: createMemoryHistory({ initialEntries: ["/"] }) });
    view = render(<RouterProvider router={tree} />);
    await act(async () => {
      await tree.load();
    });
    const socket = await rig.connect();
    return { ...view, rig, socket, doc, log, handle, queryClient, tree };
  }
  view = render(body);
  const socket = await rig.connect();
  return { ...view, rig, socket, doc, log, handle, queryClient, tree: null };
}

/** The server sends the document (the `view` is acked first so nothing waits for it). */
export function serve(rig: LiveRig, doc: ReturnType<typeof makeDocument>, version = 1) {
  rig.deliver(docMessage(doc, version));
}

export type FetchCall = { url: string; method: string; body: unknown };
const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
export { jsonResponse };

/** A fake HTTP server for the test: "METHOD /path" (no query) to a handler that answers `Response`, or `undefined` for 404. */
export function fakeHttp(routes: Record<string, (call: FetchCall) => Response | Promise<Response>>) {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init?: RequestInit) => {
      const call: FetchCall = { url: input, method: init?.method ?? "GET", body: init?.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined };
      calls.push(call);
      const handler = routes[`${call.method} ${input.split("?")[0]}`];
      return Promise.resolve(handler ? handler(call) : jsonResponse({ error: `no route for ${call.method} ${input}` }, 404));
    }),
  );
  return calls;
}
