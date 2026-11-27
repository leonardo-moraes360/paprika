/**
 * Test utilities shared by every batch: a fake `/ws`, a document of N nodes, and an editor rendered with its providers.
 * Nothing here is imported by the app (the architecture test keeps `test/` out of the network rule on purpose).
 */
import type { Document, Node } from "@paprika/core";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider, type AnyRootRoute, type AnyRoute } from "@tanstack/react-router";
import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { Notifications } from "@/components/notifications";
import { DocLintTransportProvider, nullTransport, type TransportFactory } from "@/data/lint";
import { createQueryClient } from "@/data/query-client";
import { LiveProvider } from "@/data/live/hooks";
import { createLiveClient, type FlushScheduler, type LiveClient, type LiveClientOptions } from "@/data/live/live-store";
import type { ClientMessage, DeltaMessage, DocMessage, ServerMessage } from "@/data/live/protocol";
import type { SocketFactory, SocketLike } from "@/data/live/socket";
import { createPerfLog, PerfProvider, type PerfLog } from "@/perf";
import { WorkspaceRoute } from "@/editor/workspace-route";

/** A `WebSocket` stand-in: nothing happens until the test says so. */
export class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: SocketLike["onopen"] = null;
  onclose: SocketLike["onclose"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onerror: SocketLike["onerror"] = null;
  readonly sent: ClientMessage[] = [];
  closed = false;
  /** Answer every request that carries a `reqId` with an `ack` (version = `ackVersion`). */
  autoAck = false;
  ackVersion = 1;

  constructor(readonly url: string) {}

  send(data: string) {
    const message = JSON.parse(data) as ClientMessage;
    this.sent.push(message);
    if (this.autoAck && message.reqId !== undefined && message.type !== "hello") {
      queueMicrotask(() => this.receive({ type: "ack", reqId: message.reqId as string, version: this.ackVersion }));
    }
  }

  close() {
    this.closed = true;
    this.readyState = 3;
  }

  /** The server accepts the connection. */
  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  /** The server (or the network) drops the connection. */
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }

  /** A frame from the server: an object is serialized, a string goes as is (use it for exact `doc`/`delta` prefixes). */
  receive(message: ServerMessage | string) {
    this.onmessage?.({ data: typeof message === "string" ? message : JSON.stringify(message) });
  }

  sentOf<T extends ClientMessage["type"]>(type: T) {
    return this.sent.filter((m): m is Extract<ClientMessage, { type: T }> => m.type === type);
  }

  /** The `reqId` of the last request of this type. */
  lastReqId(type: ClientMessage["type"]) {
    return this.sent.filter((m) => m.type === type).at(-1)?.reqId;
  }

  ack(reqId: string | undefined, version: number, extra: Record<string, unknown> = {}) {
    this.receive({ type: "ack", reqId: reqId as string, version, ...extra });
  }
}

export type FakeSockets = { factory: SocketFactory; sockets: FakeSocket[]; readonly last: FakeSocket };

export function createFakeSockets(): FakeSockets {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    factory: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    get last() {
      const socket = sockets.at(-1);
      if (!socket) throw new Error("no socket was created yet");
      return socket;
    },
  };
}

/** A scheduler the test drives: frames queue until `flush()` (no timers, no animation frames). */
export function manualScheduler() {
  let queued: (() => void) | null = null;
  const schedule: FlushScheduler = (flush) => {
    queued = flush;
    return () => {
      if (queued === flush) queued = null;
    };
  };
  return {
    schedule,
    get pending() {
      return queued !== null;
    },
    flush: () => {
      const run = queued;
      queued = null;
      run?.();
    },
  };
}

export type LiveRig = {
  client: LiveClient;
  sockets: FakeSockets;
  scheduler: ReturnType<typeof manualScheduler>;
  /** Start the client, let the microtask create the socket and open it. */
  connect: () => Promise<FakeSocket>;
  /** Send frames and apply them as one batch (what the next animation frame would do). */
  deliver: (...messages: (ServerMessage | string)[]) => void;
  /** Send frames that are handled at once (acks, presence, errors, workspace ops), without flushing the document batch. */
  push: (...messages: (ServerMessage | string)[]) => void;
};

export function createLiveRig(options: LiveClientOptions = {}): LiveRig {
  const sockets = createFakeSockets();
  const scheduler = manualScheduler();
  const client = createLiveClient({ socketFactory: sockets.factory, schedule: scheduler.schedule, url: "ws://test/ws", fetchTeam: () => Promise.resolve(null), ...options });
  return {
    client,
    sockets,
    scheduler,
    connect: async () => {
      client.start();
      await Promise.resolve();
      const socket = sockets.last;
      act(() => socket.open());
      return socket;
    },
    push: (...messages) => {
      act(() => {
        for (const message of messages) sockets.last.receive(message);
      });
    },
    deliver: (...messages) => {
      act(() => {
        for (const message of messages) sockets.last.receive(message);
        scheduler.flush();
      });
    },
  };
}

type Bag = Record<string, unknown>;

export type SyntheticDocumentOptions = { id?: string; name?: string; pageCount?: number; perFrame?: number };

/**
 * A document of exactly `nodeCount` nodes: pages, each with frames of `perFrame` rects (ids `n<index>`, rects `n<index>`).
 * Shaped like the server's documents, but not validated by the core schema.
 */
export function makeDocument(nodeCount: number, options: SyntheticDocumentOptions = {}): Document {
  const { id = "doc-1", name = "Synthetic", pageCount = 1, perFrame = 50 } = options;
  const nodes: Record<string, Node> = {};
  const rootIds: string[] = [];
  let count = 0;
  const add = (node: Bag) => {
    nodes[node.id as string] = { rotation: 0, opacity: 1, visible: true, locked: false, ...node } as unknown as Node;
    count += 1;
  };
  for (let p = 0; p < pageCount && count < nodeCount; p += 1) {
    const page: Bag = { id: `page-${p}`, name: `Page ${p + 1}`, parentId: null, type: "page", children: [] };
    add(page);
    rootIds.push(page.id as string);
    while (count < nodeCount && (page.children as string[]).length * (perFrame + 1) < Math.ceil(nodeCount / pageCount)) {
      const frame: Bag = { id: `frame-${p}-${(page.children as string[]).length}`, name: "Frame", parentId: page.id, type: "frame", x: 0, y: 0, width: 400, height: 400, children: [], fill: "#ffffff", radius: 0 };
      add(frame);
      (page.children as string[]).push(frame.id as string);
      for (let r = 0; r < perFrame && count < nodeCount; r += 1) {
        const rect: Bag = { id: `n${count}`, name: `Rect ${count}`, parentId: frame.id, type: "rect", x: r * 4, y: 0, width: 20, height: 20, fill: "#c43d27", radius: 0 };
        add(rect);
        (frame.children as string[]).push(rect.id as string);
      }
    }
  }
  return { format: "paprika/1", id, name, tokens: {}, rootIds, nodes } as unknown as Document;
}

export const docMessage = (doc: Document, version = 1, extra: Partial<DocMessage> = {}): DocMessage => ({
  type: "doc",
  doc,
  version,
  actor: "server",
  label: "",
  kind: "reload",
  canUndo: false,
  canRedo: false,
  ...extra,
});

export const deltaMessage = (doc: Document, version: number, patch: Partial<DeltaMessage> = {}): DeltaMessage => ({
  type: "delta",
  id: doc.id,
  version,
  base: version - 1,
  actor: "user",
  label: "edit",
  kind: "ops",
  canUndo: true,
  canRedo: false,
  ...patch,
});

/** A delta that sets one property of one node. */
export function nodeDelta(doc: Document, nodeId: string, props: Bag, version: number, extra: Partial<DeltaMessage> = {}): DeltaMessage {
  const node = doc.nodes[nodeId] as Node;
  return deltaMessage(doc, version, { nodes: { set: { [nodeId]: { ...node, ...props } as Node } }, ...extra });
}

export type EditorRigOptions = { nodes?: number; workspaceId?: string; client?: LiveRig; log?: PerfLog; path?: string; /** The lint transport of the editor; default none (no lint result arrives, so nothing commits when one would). */ lint?: TransportFactory; extraRoutes?: (root: AnyRootRoute) => AnyRoute[] };

/**
 * The workspace route (`/w/$workspaceId`) with a fake server behind it: providers, router at `/w/<id>`, a perf log.
 * Resolves once the editor is on screen. `/` renders a marker `<div data-testid="overview-route" />` unless `extraRoutes` is given.
 */
export async function renderEditorRig(options: EditorRigOptions = {}) {
  const { nodes = 100, workspaceId = "doc-1", log = createPerfLog(), lint = nullTransport } = options;
  window.scrollTo = () => {};
  const rig = options.client ?? createLiveRig();
  const doc = makeDocument(nodes, { id: workspaceId });
  const queryClient = createQueryClient();
  const root = createRootRoute({
    component: () => (
      <PerfProvider log={log}>
        <QueryClientProvider client={queryClient}>
          <LiveProvider client={rig.client}>
            <DocLintTransportProvider transport={lint}>
              <Outlet />
            </DocLintTransportProvider>
            <Notifications />
          </LiveProvider>
        </QueryClientProvider>
      </PerfProvider>
    ),
  });
  const workspace = createRoute({
    getParentRoute: () => root,
    path: "/w/$workspaceId",
    component: function Workspace() {
      return <WorkspaceRoute id={workspace.useParams().workspaceId} />;
    },
  });
  const home = createRoute({ getParentRoute: () => root, path: "/", component: () => <div data-testid="overview-route" /> });
  const router = createRouter({
    routeTree: root.addChildren([workspace, home, ...(options.extraRoutes?.(root) ?? [])]),
    history: createMemoryHistory({ initialEntries: [options.path ?? `/w/${workspaceId}`] }),
  });
  const view = render(<RouterProvider router={router} />);
  const socket = await (async () => {
    await act(async () => {
      await router.load();
    });
    return rig.connect();
  })();
  return { ...view, rig, socket, doc, log, router, queryClient };
}

/** The server's side of opening: the view is acked and the document arrives. Call after `renderEditorRig`. */
export function serveDocument(rig: LiveRig, doc: Document, version = 1) {
  const socket = rig.sockets.last;
  const reqId = socket.lastReqId("view");
  rig.deliver(docMessage(doc, version));
  act(() => socket.ack(reqId, version));
}

export const withProviders = (ui: ReactNode, rig: LiveRig) => (
  <QueryClientProvider client={createQueryClient()}>
    <LiveProvider client={rig.client}>{ui}</LiveProvider>
  </QueryClientProvider>
);
