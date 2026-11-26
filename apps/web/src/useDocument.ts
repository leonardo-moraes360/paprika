import { useEffect, useSyncExternalStore } from "react";
import type { Document, Op } from "@paprika/core";
import { appendBuild, applyPresence, BUILD_TICK_MS, createdInOrder, prefersReducedMotion, stepBuild, type AgentPresence, type BuildReplay, type PresenceMsg } from "./agents";
import { applyDelta, orderCreated, type DeltaMsg } from "./docDelta";
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
  build: BuildReplay[];
  team: TeamStatus | null | undefined;
  workspaceNotice: WorkspaceNotice | null;
}

type ServerMsg =
  | { type: "doc"; doc: Document; version: number; actor: string; label: string; kind: string; canUndo: boolean; canRedo: boolean }
  | DeltaMsg
  | { type: "ack"; reqId: string; version: number }
  | { type: "error"; reqId?: string; message: string }
  | { type: "team"; status: TeamStatus }
  | { type: "pins"; rev: number }
  | { type: "workspaceOp"; op: { actor: string; op: WorkspaceOpKind | "create"; workspaceId: string; workspaceName: string; detail: Record<string, unknown> } }
  | PresenceMsg;

type DocMsg = Extract<ServerMsg, { type: "doc" }>;

function isDocFrame(raw: string): boolean {
  return raw.startsWith('{"type":"doc"') || raw.startsWith('{"type":"delta"');
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
    build: [],
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
    let pending: string[] = [];
    let resyncing = false;
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
        if (pending.length > 0 || this.state.version >= want) return;
        sock.send(JSON.stringify(this.viewMessage(String(++this.seq))));
      }, this.staleResyncMs);
    };
    const kickBuild = () => {
      if (buildTimer || !this.state.build.length) return;
      buildTimer = setInterval(() => {
        if (closed || !this.state.build.length) {
          clearInterval(buildTimer);
          buildTimer = undefined;
          return;
        }
        this.set((s) => ({ ...s, build: stepBuild(s.build, Date.now()) }));
      }, BUILD_TICK_MS);
    };
    const resync = () => {
      if (resyncing) return;
      const sock = this.ws;
      if (closed || !sock || sock.readyState !== WebSocket.OPEN) return;
      resyncing = true;
      sock.send(JSON.stringify(this.viewMessage(String(++this.seq))));
    };
    const record = (s: DocState, doc: Document, msg: DocMsg | DeltaMsg, changed: () => string[], created: () => string[]): DocState => {
      const fromAgent = msg.actor.startsWith("agent");
      const quiet = msg.kind === "reload" && msg.actor === "server";
      const ids = quiet ? [] : changed();
      const build = appendBuild(s.build, msg.actor, fromAgent && msg.kind !== "reload" && !prefersReducedMotion() ? created() : [], Date.now());
      const activity = quiet ? s.activity : [{ id: msg.version, actor: msg.actor, label: msg.label, at: Date.now(), changed: ids }, ...s.activity].slice(0, 30);
      if (fromAgent) {
        clearTimeout(flash);
        flash = setTimeout(() => this.set((x) => ({ ...x, agentTouched: new Set() })), 1600);
      }
      return {
        ...s,
        doc,
        version: msg.version,
        canUndo: msg.canUndo,
        canRedo: msg.canRedo,
        activity,
        agentTouched: fromAgent ? new Set(ids) : s.agentTouched,
        build,
      };
    };
    const applyDoc = (s: DocState, msg: DocMsg): DocState => {
      resyncing = false;
      if (s.doc && s.doc.id !== msg.doc.id) {
        clearTimeout(flash);
        return { ...s, doc: msg.doc, version: msg.version, canUndo: msg.canUndo, canRedo: msg.canRedo, activity: [], agentTouched: new Set(), build: [] };
      }
      return record(s, msg.doc, msg, () => changedIds(s.doc, msg.doc), () => createdInOrder(s.doc, msg.doc));
    };
    const flushDoc = () => {
      if (docRaf) cancelAnimationFrame(docRaf);
      docRaf = 0;
      if (docTimer) clearTimeout(docTimer);
      docTimer = undefined;
      const raws = pending;
      pending = [];
      if (raws.length === 0 || closed) return;
      let from = 0;
      for (let i = raws.length - 1; i >= 0; i--) {
        if (raws[i]!.startsWith('{"type":"doc"')) {
          from = i;
          break;
        }
      }
      const msgs = raws.slice(from).map((r) => JSON.parse(r) as DocMsg | DeltaMsg);
      const owned = new Set<object>();
      let mismatch = false;
      this.set((s) => {
        let cur = s;
        for (let i = 0; i < msgs.length; i++) {
          const m = msgs[i]!;
          if (m.type === "doc") {
            cur = applyDoc(cur, m);
            owned.clear();
            continue;
          }
          if (!cur.doc || cur.doc.id !== m.id || m.base !== cur.version) {
            if (cur.doc && cur.doc.id === m.id && m.version <= cur.version) continue;
            mismatch = true;
            break;
          }
          const r = applyDelta(cur.doc, m, owned);
          cur = record(cur, r.doc, m, () => r.changed, () => orderCreated(r.doc, r.created));
        }
        return cur;
      });
      if (mismatch) resync();
      kickBuild();
    };
    const queueDoc = (raw: string) => {
      pending.push(raw);
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
        resyncing = false;
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
        if (msg.type === "doc" || msg.type === "delta") {
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
      pending = [];
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
