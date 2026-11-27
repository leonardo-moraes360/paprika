import type { Document, Op } from "@paprika/core";
import { createStore, type Store } from "@tanstack/react-store";
import { fetchTeamStatus } from "../api";
import { applyDelta } from "./doc-delta";
import {
  isFullDocFrame,
  type AckMessage,
  type ClientMessage,
  type DeltaMessage,
  type DocMessage,
  type PresenceMessage,
  type RawTeamStatus,
  type RendererMode,
  type ServerMessage,
  type StepResult,
  type WorkspaceNotice,
  type WorkspaceOp,
} from "./protocol";
import { isOfflineError, LiveOfflineError, LiveSocket, type SocketFactory } from "./socket";

export type Activity = {
  /** Version of the document that this entry produced. */
  id: number;
  actor: string;
  label: string;
  /** The server's kind of step (`ops`, `undo`, `redo`, `reload`...), as the message brought it. */
  kind: string;
  at: number;
  /** The nodes a delta created, kept per entry so a batch of steps from several actors can still be told apart; absent for a full snapshot. */
  created?: string[];
};

export type { WorkspaceNotice };

/** Last presence of one agent, in order of arrival (the adapters give it a name and a tone). `at` is when it was last active. */
export type AgentPresence = {
  agent: string;
  actor: string;
  tool: string;
  nodes: string[];
  at: number;
};

export type LiveState = {
  doc: Document | null;
  version: number;
  connected: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** An `error` frame with no `reqId` (a request that has a `reqId` rejects its own promise instead). */
  error: string | null;
  activity: Activity[];
  agents: AgentPresence[];
  /** `undefined` until known, `null` without team mode, otherwise the raw sidecar status. */
  team: RawTeamStatus | null | undefined;
  workspaceNotice: WorkspaceNotice | null;
  /** Last `pins` revision announced by the server (only a notice: pins themselves come from `/api/pins`). */
  pinsRev: number;
};

export type LiveEvent = { type: "workspaceOp"; op: WorkspaceOp } | { type: "pins"; rev: number };

export type LiveActions = {
  /** Resolves with the version when the server acks the ops, rejects with the server's message or `LiveOfflineError`. */
  apply: (ops: Op[], label?: string) => Promise<number>;
  undo: () => Promise<number>;
  redo: () => Promise<number>;
  undoOwn: () => Promise<StepResult | undefined>;
  redoOwn: () => Promise<StepResult | undefined>;
  undoStep: (step: number) => Promise<StepResult | undefined>;
  redoStep: (step: number) => Promise<StepResult | undefined>;
  /** Reports which renderer the page uses (`hello`); sent again after every reconnection. */
  setRenderer: (renderer: RendererMode) => void;
  dismissWorkspaceNotice: () => void;
  clearError: () => void;
  showError: (message: string) => void;
};

export type FlushScheduler = (flush: () => void) => () => void;

export type LiveClientOptions = {
  url?: string | (() => string);
  socketFactory?: SocketFactory;
  /** Reconnection delays, see `reconnectDelays`. */
  delays?: readonly number[];
  /** Groups the frames that arrive together into one state update. Default: next animation frame, at most 50 ms. */
  schedule?: FlushScheduler;
  /** How long a version announced by an ack may stay unseen before the client asks for a snapshot (default 1500 ms). */
  staleResyncMs?: number;
  fetchTeam?: () => Promise<RawTeamStatus | null | undefined>;
  now?: () => number;
};

export type LiveClient = {
  readonly store: Store<LiveState>;
  readonly actions: LiveActions;
  /** Idempotent and StrictMode safe: the socket is created in a microtask, only if `stop` did not come first. */
  start: () => void;
  stop: () => void;
  /** Asks the server to send this workspace (`null`: the active one). Resolves on the ack, rejects with the server's message. */
  view: (workspaceId: string | null) => Promise<void>;
  subscribe: (listener: (event: LiveEvent) => void) => () => void;
};

export const STALE_RESYNC_MS = 1500;
export const FLUSH_FALLBACK_MS = 50;
export const AGENT_TTL_MS = 120_000;
export const MAX_ACTIVITY = 30;
/** The workspace operations of an agent that become a notice (the adapter in `adapters/notice` has a sentence for exactly these). */
const NOTICE_OPS: ReadonlySet<string> = new Set(["delete", "open", "rename"]);

export function frameScheduler(): FlushScheduler {
  return (flush) => {
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      cancel();
      flush();
    };
    const cancel = () => {
      if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
      raf = 0;
      clearTimeout(timer);
      timer = undefined;
    };
    if (typeof requestAnimationFrame === "function") raf = requestAnimationFrame(run);
    timer = setTimeout(run, FLUSH_FALLBACK_MS);
    return cancel;
  };
}

export function initialLiveState(): LiveState {
  return {
    doc: null,
    version: 0,
    connected: false,
    canUndo: false,
    canRedo: false,
    error: null,
    activity: [],
    agents: [],
    team: undefined,
    workspaceNotice: null,
    pinsRev: 0,
  };
}

/** Merges a presence frame into the roster: updates the agent in place, appends a new one, drops the ones past the TTL. */
export function applyPresence(list: AgentPresence[], message: PresenceMessage, now: number): AgentPresence[] {
  const at = now - Math.max(0, message.idle || 0);
  const live = list.filter((a) => now - a.at < AGENT_TTL_MS || a.agent === message.agent);
  const previous = live.find((a) => a.agent === message.agent);
  if (previous) {
    return live.map((a) => (a === previous ? { ...a, tool: message.tool, nodes: message.nodes.length ? message.nodes : a.nodes, at: Math.max(a.at, at) } : a));
  }
  return [...live, { agent: message.agent, actor: message.actor, tool: message.tool, nodes: message.nodes, at }];
}

type Deferred = { resolve: () => void; reject: (error: Error) => void };

/** One per app (`LiveProvider` makes it): nothing here is created at import time. */
export function createLiveClient(options: LiveClientOptions = {}): LiveClient {
  const store = createStore<LiveState>(initialLiveState());
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? frameScheduler();
  const staleResyncMs = options.staleResyncMs ?? STALE_RESYNC_MS;
  const fetchTeam = options.fetchTeam ?? (() => fetchTeamStatus());
  const listeners = new Set<(event: LiveEvent) => void>();
  const emit = (event: LiveEvent) => {
    for (const listener of [...listeners]) listener(event);
  };

  let viewId: string | null = null;
  let renderer: RendererMode | null = null;
  let noticeSeq = 0;
  let pending: string[] = [];
  /** Presence frames of the frame in progress, each with the time it arrived (`idle` counts back from it). */
  let pendingPresence: { message: PresenceMessage; at: number }[] = [];
  let cancelFlush: (() => void) | null = null;
  let resyncing = false;
  let staleTimer: ReturnType<typeof setTimeout> | undefined;
  let staleVersion = 0;
  const queuedViews: Deferred[] = [];

  const set = (update: (state: LiveState) => LiveState) => {
    const prev = store.state;
    const next = update(prev);
    if (next !== prev) store.setState(() => next);
  };

  const viewMessage = (): ClientMessage => (viewId ? { type: "view", workspaceId: viewId } : { type: "view" });

  /** The view request on its way: a second `view` for the same workspace joins it instead of asking for another snapshot. */
  let inflight: { id: string | null; waiters: Deferred[] } | null = null;
  /** Whether anyone has asked for a workspace (`view`) in this client's life: until then the server decides (the active one, after its short wait). */
  let asked = false;
  /** The workspace (`null`: the active one) the server confirmed on THIS connection: asking for it again would only download the same document again. */
  let ackedView: { id: string | null } | null = null;

  const sendView = (waiters: Deferred[]) => {
    const entry = { id: viewId, waiters };
    inflight = entry;
    ackedView = null;
    const settle = () => {
      if (inflight === entry) inflight = null;
    };
    socket.request(viewMessage()).then(
      () => {
        // Only the latest request says what the server is showing now: the late ack of an earlier one (a quick a, then b) does not.
        if (inflight === entry) ackedView = { id: entry.id };
        settle();
        for (const waiter of entry.waiters) waiter.resolve();
      },
      (error: unknown) => {
        settle();
        ackedView = null;
        if (isOfflineError(error) && socket.isRunning) {
          queuedViews.push(...entry.waiters);
          return;
        }
        // A refused workspace is not the one to ask for on the next connection: go back to following the active one.
        if (!isOfflineError(error) && viewId === entry.id) viewId = null;
        for (const waiter of entry.waiters) waiter.reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  };

  const resync = () => {
    if (resyncing || !socket.isOpen) return;
    resyncing = true;
    socket.request(viewMessage()).catch(() => {
      resyncing = false;
    });
  };

  const armStale = (wait: number) => {
    clearTimeout(staleTimer);
    staleTimer = setTimeout(() => {
      staleTimer = undefined;
      const want = staleVersion;
      if (!socket.isOpen || store.state.version >= want) {
        staleVersion = 0;
        return;
      }
      // Frames are still waiting for the next batch: they may be the version, look again once they were applied.
      if (pending.length > 0) {
        armStale(staleResyncMs);
        return;
      }
      staleVersion = 0;
      socket.request(viewMessage()).catch(() => {});
    }, wait);
  };

  /** The ack of a request announces a version of the workspace that request left from; one for another workspace says nothing about this one. */
  const checkStale = (version: number, docId: string | null) => {
    if ((store.state.doc?.id ?? null) !== docId) return;
    if (version <= store.state.version || version <= staleVersion) return;
    staleVersion = version;
    armStale(staleResyncMs);
  };

  const record = (state: LiveState, doc: Document, message: DocMessage | DeltaMessage, created?: string[]): LiveState => {
    const quiet = message.kind === "reload" && message.actor === "server";
    const entry: Activity = { id: message.version, actor: message.actor, label: message.label, kind: message.kind, at: now(), ...(created ? { created } : {}) };
    return {
      ...state,
      doc,
      version: message.version,
      canUndo: message.canUndo,
      canRedo: message.canRedo,
      activity: quiet ? state.activity : [entry, ...state.activity].slice(0, MAX_ACTIVITY),
    };
  };

  const applyDoc = (state: LiveState, message: DocMessage): LiveState => {
    resyncing = false;
    if (state.doc && state.doc.id !== message.doc.id) {
      return { ...state, doc: message.doc, version: message.version, canUndo: message.canUndo, canRedo: message.canRedo, activity: [] };
    }
    // The same version again (the overview's `open` broadcast, then the answer to `view`): nothing changed, so the document, its nodes
    // and the activity stay as they are and only what the frame says about undo and redo is taken.
    if (state.doc && state.version === message.version) {
      return state.canUndo === message.canUndo && state.canRedo === message.canRedo ? state : { ...state, canUndo: message.canUndo, canRedo: message.canRedo };
    }
    return record(state, message.doc, message);
  };

  const flush = () => {
    cancelFlush?.();
    cancelFlush = null;
    const raws = pending;
    pending = [];
    const presences = pendingPresence;
    pendingPresence = [];
    if (raws.length === 0 && presences.length === 0) return;
    // A full snapshot supersedes everything queued before it.
    let from = 0;
    for (let i = raws.length - 1; i >= 0; i -= 1) {
      if (isFullDocFrame(raws[i] as string)) {
        from = i;
        break;
      }
    }
    const messages = raws.slice(from).map((raw) => JSON.parse(raw) as DocMessage | DeltaMessage);
    const owned = new Set<object>();
    let mismatch = false;
    set((state) => {
      let current = state;
      for (const message of messages) {
        if (message.type === "doc") {
          current = applyDoc(current, message);
          owned.clear();
          continue;
        }
        // A delta of another workspace (late, after a `view` switched to this one) says nothing about this document: drop it, no snapshot needed.
        if (current.doc && current.doc.id !== message.id) continue;
        if (!current.doc || message.base !== current.version) {
          if (current.doc && message.version <= current.version) continue;
          mismatch = true;
          break;
        }
        const result = applyDelta(current.doc, message, owned);
        current = record(current, result.doc, message, result.created);
      }
      // Who is where: every presence of the frame, in order, in the same update as the document (one commit per region, not one per message).
      if (presences.length > 0) {
        let agents = current.agents;
        for (const { message, at } of presences) agents = applyPresence(agents, message, at);
        current = { ...current, agents };
      }
      return current;
    });
    if (mismatch) resync();
  };

  const queueFlush = () => {
    if (!cancelFlush) cancelFlush = schedule(flush);
  };

  const queueDoc = (raw: string) => {
    pending.push(raw);
    queueFlush();
  };

  const onMessage = (message: ServerMessage) => {
    switch (message.type) {
      case "team":
        set((s) => ({ ...s, team: message.status }));
        break;
      case "workspaceOp": {
        const { op } = message;
        emit({ type: "workspaceOp", op });
        if (!NOTICE_OPS.has(op.op) || !op.actor.startsWith("agent")) break;
        set((s) =>
          op.op === "rename" && s.doc?.id !== op.workspaceId
            ? s
            : { ...s, workspaceNotice: { id: ++noticeSeq, actor: op.actor, op: op.op, workspaceName: op.workspaceName, detail: op.detail ?? {} } },
        );
        break;
      }
      case "pins":
        set((s) => ({ ...s, pinsRev: message.rev }));
        emit({ type: "pins", rev: message.rev });
        break;
      case "presence":
        // Not applied here: a hundred reports in one frame (an agent reading node after node) would be a hundred updates of the store.
        pendingPresence.push({ message, at: now() });
        queueFlush();
        break;
      case "error":
        set((s) => ({ ...s, error: message.message }));
        break;
      default:
        break;
    }
  };

  const reportRenderer = () => {
    if (renderer) socket.send({ type: "hello", renderer, reqId: socket.nextReqId() });
  };

  const socket: LiveSocket = new LiveSocket({
    url: options.url ?? (() => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`),
    factory: options.socketFactory,
    delays: options.delays,
    handlers: {
      onOpen: () => {
        set((s) => ({ ...s, connected: true }));
        reportRenderer();
        resyncing = false;
        ackedView = null;
        // Nobody has asked yet (the socket opens before the route mounts): the server sends the active workspace after a short wait
        // unless a `view` comes first, so sending one here with no id would only bring a document that the route's own `view` replaces.
        if (asked || queuedViews.length > 0) sendView(queuedViews.splice(0));
      },
      onClose: () => {
        resyncing = false;
        ackedView = null;
        set((s) => (s.connected ? { ...s, connected: false } : s));
      },
      onDocFrame: queueDoc,
      onMessage,
    },
  });

  const request = async (message: ClientMessage): Promise<AckMessage> => {
    const docId = store.state.doc?.id ?? null;
    const ack = await socket.request(message);
    checkStale(ack.version, docId);
    return ack;
  };

  const actions: LiveActions = {
    apply: async (ops, label = "") => (await request({ type: "ops", ops, label })).version,
    undo: async () => (await request({ type: "undo" })).version,
    redo: async () => (await request({ type: "redo" })).version,
    undoOwn: async () => (await request({ type: "undo", mode: "own" })).step,
    redoOwn: async () => (await request({ type: "redo", mode: "own" })).step,
    undoStep: async (step) => (await request({ type: "undo", mode: "step", step })).step,
    redoStep: async (step) => (await request({ type: "redo", mode: "step", step })).step,
    setRenderer: (mode) => {
      // The same mode again (an editor that mounts again) says nothing new: reconnections already repeat it.
      if (renderer === mode) return;
      renderer = mode;
      reportRenderer();
    },
    dismissWorkspaceNotice: () => set((s) => (s.workspaceNotice === null ? s : { ...s, workspaceNotice: null })),
    clearError: () => set((s) => (s.error === null ? s : { ...s, error: null })),
    showError: (message) => set((s) => ({ ...s, error: message })),
  };

  let wanted = false;
  let started = false;
  let teamAbort: AbortController | null = null;

  return {
    store,
    actions,
    start: () => {
      wanted = true;
      queueMicrotask(() => {
        if (!wanted || started) return;
        started = true;
        socket.start();
        const abort = new AbortController();
        teamAbort = abort;
        void fetchTeam().then((team) => {
          // `undefined`: the server did not say (an error, no answer): nothing is known, so the state stays as it is.
          if (abort.signal.aborted || team === undefined) return;
          set((s) => (s.team !== undefined ? s : { ...s, team }));
        });
      });
    },
    stop: () => {
      wanted = false;
      if (!started) return;
      started = false;
      teamAbort?.abort();
      teamAbort = null;
      clearTimeout(staleTimer);
      staleTimer = undefined;
      staleVersion = 0;
      cancelFlush?.();
      cancelFlush = null;
      pending = [];
      pendingPresence = [];
      for (const waiter of queuedViews.splice(0)) waiter.reject(new LiveOfflineError());
      socket.stop();
      set((s) => (s.connected ? { ...s, connected: false } : s));
    },
    view: (workspaceId) => {
      viewId = workspaceId;
      asked = true;
      return new Promise<void>((resolve, reject) => {
        const waiter: Deferred = { resolve, reject };
        if (!socket.isOpen) queuedViews.push(waiter);
        else if (inflight && inflight.id === workspaceId) inflight.waiters.push(waiter);
        else if (!inflight && ackedView && ackedView.id === workspaceId) resolve();
        else sendView([waiter]);
      });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
