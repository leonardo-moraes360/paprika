import { useEffect, useSyncExternalStore } from "react";
import type { Document, Op } from "@paprika/core";
import { appendBuild, applyPresence, BUILD_STEP_MS, createdInOrder, stepBuild, type AgentPresence, type BuildReplay, type PresenceMsg } from "./agents";
import { catalogs } from "./i18n/messages";
import { t } from "./i18n/store";
import type { TeamStatus } from "./Team";
import { queryClient } from "./api";
import { initialRendererMode, onRendererMode, type RendererMode } from "./wasmLayer";

const offlineMessages = new Set(Object.values(catalogs).map((m) => m.offline));

export interface Activity {
  id: number;
  actor: string;
  label: string;
  at: number;
  changed: string[];
}

export type WorkspaceOpKind = "rename" | "open" | "delete";

export interface WorkspaceNotice {
  id: number;
  actor: string;
  op: WorkspaceOpKind;
  workspaceName: string;
  detail: Record<string, unknown>;
}

export interface DocState {
  doc: Document | null;
  version: number;
  connected: boolean;
  canUndo: boolean;
  canRedo: boolean;
  error: string | null;
  activity: Activity[];
  agentTouched: Set<string>;
  agents: AgentPresence[];
  build: BuildReplay | null;
  team: TeamStatus | null | undefined;
  workspaceNotice: WorkspaceNotice | null;
}

type ServerMsg =
  | { type: "doc"; doc: Document; version: number; actor: string; label: string; kind: string; canUndo: boolean; canRedo: boolean }
  | { type: "ack"; reqId: string; version: number }
  | { type: "error"; reqId?: string; message: string }
  | { type: "team"; status: TeamStatus }
  | { type: "pins"; rev: number }
  | { type: "workspaceOp"; op: { actor: string; op: WorkspaceOpKind | "create"; workspaceId: string; workspaceName: string; detail: Record<string, unknown> } }
  | PresenceMsg;

type DocMsg = Extract<ServerMsg, { type: "doc" }>;

function isDocFrame(raw: string): boolean {
  return raw.startsWith('{"type":"doc"');
}

function changedIds(prev: Document | null, next: Document): string[] {
  if (!prev) return [];
  const out: string[] = [];
  for (const [id, n] of Object.entries(next.nodes)) {
    const p = prev.nodes[id];
    if (!p || JSON.stringify(p) !== JSON.stringify(n)) out.push(id);
  }
  return out;
}

type Listener = () => void;

export class LiveStore {
  private state: DocState = {
    doc: null,
    version: 0,
    connected: false,
    canUndo: false,
    canRedo: false,
    error: null,
    activity: [],
    agentTouched: new Set(),
    agents: [],
    build: null,
    team: undefined,
    workspaceNotice: null,
  };
  private listeners = new Set<Listener>();
  private ws: WebSocket | null = null;
  private seq = 0;
  private noticeSeq = 0;
  private viewId: string | null = null;
  private viewWaiters = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();

  getState = (): DocState => this.state;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  set = (update: (s: DocState) => DocState): void => {
    const next = update(this.state);
    if (next === this.state) return;
    this.state = next;
    for (const l of this.listeners) l();
  };

  view = (id: string | null): Promise<void> => {
    this.viewId = id;
    return new Promise<void>((resolve, reject) => {
      const ws = this.ws;
      const reqId = String(++this.seq);
      this.viewWaiters.set(reqId, { resolve, reject });
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(this.viewMessage(reqId)));
      else this.pendingView = reqId;
    });
  };
  private pendingView: string | null = null;
  staleResyncMs = 1500;
  onViewDeleted: (() => void) | null = null;
  private viewMessage = (reqId: string) => (this.viewId ? { type: "view", workspaceId: this.viewId, reqId } : { type: "view", reqId });

  connect = (): (() => void) => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let flash: ReturnType<typeof setTimeout> | undefined;
    let pendingDoc: string | null = null;
    let docRaf = 0;
    let docTimer: ReturnType<typeof setTimeout> | undefined;
    let buildTimer: ReturnType<typeof setInterval> | undefined;
    let staleTimer: ReturnType<typeof setTimeout> | undefined;
    let staleVersion = 0;
    const checkStale = (version: number) => {
      if (version <= this.state.version || version <= staleVersion) return;
      staleVersion = version;
      clearTimeout(staleTimer);
      staleTimer = setTimeout(() => {
        staleTimer = undefined;
        const want = staleVersion;
        staleVersion = 0;
        const sock = this.ws;
        if (closed || !sock || sock.readyState !== WebSocket.OPEN) return;
        if (pendingDoc !== null || this.state.version >= want) return;
        sock.send(JSON.stringify(this.viewMessage(String(++this.seq))));
      }, this.staleResyncMs);
    };
    const kickBuild = () => {
      if (buildTimer || !this.state.build) return;
      buildTimer = setInterval(() => {
        if (closed || !this.state.build) {
          clearInterval(buildTimer);
          buildTimer = undefined;
          return;
        }
        this.set((s) => ({ ...s, build: stepBuild(s.build) }));
      }, BUILD_STEP_MS);
    };
    const applyDoc = (msg: DocMsg) => {
      this.set((s) => {
        if (s.doc && s.doc.id !== msg.doc.id) {
          clearTimeout(flash);
          return { ...s, doc: msg.doc, version: msg.version, canUndo: msg.canUndo, canRedo: msg.canRedo, activity: [], agentTouched: new Set(), build: null };
        }
        const changed = changedIds(s.doc, msg.doc);
        const fromAgent = msg.actor.startsWith("agent");
        const created = fromAgent && msg.kind !== "reload" ? createdInOrder(s.doc, msg.doc) : [];
        const build = appendBuild(s.build, msg.actor, created);
        const activity =
          msg.kind === "reload" && msg.actor === "server"
            ? s.activity
            : [{ id: msg.version, actor: msg.actor, label: msg.label, at: Date.now(), changed }, ...s.activity].slice(0, 30);
        if (fromAgent) {
          clearTimeout(flash);
          flash = setTimeout(() => this.set((x) => ({ ...x, agentTouched: new Set() })), 1600);
        }
        return {
          ...s,
          doc: msg.doc,
          version: msg.version,
          canUndo: msg.canUndo,
          canRedo: msg.canRedo,
          activity,
          agentTouched: fromAgent ? new Set(changed) : s.agentTouched,
          build,
        };
      });
      kickBuild();
    };
    const flushDoc = () => {
      if (docRaf) cancelAnimationFrame(docRaf);
      docRaf = 0;
      if (docTimer) clearTimeout(docTimer);
      docTimer = undefined;
      const raw = pendingDoc;
      pendingDoc = null;
      if (!raw || closed) return;
      applyDoc(JSON.parse(raw) as DocMsg);
    };
    const queueDoc = (raw: string) => {
      pendingDoc = raw;
      if (docRaf || docTimer) return;
      docRaf = requestAnimationFrame(flushDoc);
      docTimer = setTimeout(flushDoc, 50);
    };
    const reportRenderer = (renderer: RendererMode) => {
      const sock = this.ws;
      if (!sock || sock.readyState !== WebSocket.OPEN) return;
      sock.send(JSON.stringify({ type: "hello", renderer, reqId: String(++this.seq) }));
    };
    const stopRenderer = onRendererMode(reportRenderer);
    const open = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.set((s) => ({ ...s, connected: false }));
        if (!closed) retry = setTimeout(open, 1000);
      };
      ws.onopen = () => {
        if (this.ws !== ws) return;
        this.set((s) => ({ ...s, connected: true, error: s.error && offlineMessages.has(s.error) ? null : s.error }));
        reportRenderer(initialRendererMode());
        const reqId = this.pendingView ?? String(++this.seq);
        this.pendingView = null;
        ws.send(JSON.stringify(this.viewMessage(reqId)));
      };
      ws.onmessage = (ev) => {
        if (this.ws !== ws) return;
        const raw = String(ev.data);
        if (isDocFrame(raw)) {
          queueDoc(raw);
          return;
        }
        const msg = JSON.parse(raw) as ServerMsg;
        if (msg.type === "doc") {
          queueDoc(raw);
        } else if (msg.type === "team") {
          this.set((s) => ({ ...s, team: msg.status }));
        } else if (msg.type === "workspaceOp") {
          const { op } = msg;
          const kind = op.op;
          if (kind === "delete" && op.workspaceId === this.state.doc?.id) this.onViewDeleted?.();
          if (kind === "create" || !op.actor.startsWith("agent")) return;
          this.set((s) =>
            kind === "rename" && s.doc?.id !== op.workspaceId
              ? s
              : { ...s, workspaceNotice: { id: ++this.noticeSeq, actor: op.actor, op: kind, workspaceName: op.workspaceName, detail: op.detail ?? {} } },
          );
        } else if (msg.type === "pins") {
          void queryClient.invalidateQueries({ queryKey: ["pins"] });
        } else if (msg.type === "presence") {
          this.set((s) => ({ ...s, agents: applyPresence(s.agents, msg) }));
        } else if (msg.type === "ack") {
          checkStale(msg.version);
          this.viewWaiters.get(msg.reqId)?.resolve();
          this.viewWaiters.delete(msg.reqId);
        } else if (msg.type === "error") {
          const waiter = msg.reqId ? this.viewWaiters.get(msg.reqId) : undefined;
          if (waiter && msg.reqId) {
            this.viewWaiters.delete(msg.reqId);
            waiter.reject(new Error(msg.message));
          } else this.set((s) => ({ ...s, error: msg.message }));
        }
      };
    };
    open();
    fetch("/api/team")
      .then(async (r) => (r.ok && (r.headers.get("content-type") ?? "").includes("json") ? ((await r.json()) as TeamStatus) : undefined))
      .then((team) => team && this.set((s) => ({ ...s, team: s.team ?? team })))
      .catch(() => {});
    return () => {
      closed = true;
      stopRenderer();
      clearTimeout(retry);
      clearTimeout(flash);
      clearTimeout(staleTimer);
      if (docRaf) cancelAnimationFrame(docRaf);
      docRaf = 0;
      if (docTimer) clearTimeout(docTimer);
      docTimer = undefined;
      if (buildTimer) clearInterval(buildTimer);
      buildTimer = undefined;
      pendingDoc = null;
      this.ws?.close();
    };
  };

  private sendRaw(payload: object) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this.set((s) => ({ ...s, error: t().offline }));
      return;
    }
    ws.send(JSON.stringify({ ...payload, reqId: String(++this.seq) }));
  }

  readonly actions = {
    apply: (ops: Op[], label = "") => this.sendRaw({ type: "ops", ops, label }),
    undo: () => this.sendRaw({ type: "undo" }),
    redo: () => this.sendRaw({ type: "redo" }),
    dismissWorkspaceNotice: () => this.set((s) => (s.workspaceNotice === null ? s : { ...s, workspaceNotice: null })),
    clearError: () => this.set((s) => (s.error === null ? s : { ...s, error: null })),
    showError: (message: string) => this.set((s) => ({ ...s, error: message })),
  };
}

export const liveStore = new LiveStore();

export function useLiveConnection(store: LiveStore = liveStore): void {
  useEffect(() => store.connect(), [store]);
}

export function useLive<T>(selector: (s: DocState) => T, store: LiveStore = liveStore): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

export function useLiveActions(store: LiveStore = liveStore): LiveStore["actions"] {
  return store.actions;
}

export type LiveActions = LiveStore["actions"];
