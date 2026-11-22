import { useEffect, useSyncExternalStore } from "react";
import type { Document, Op } from "@paprika/core";
import { applyPresence, type AgentPresence, type PresenceMsg } from "./agents";
import type { TeamStatus } from "./Team";

const OFFLINE = "sem conexão com o servidor";

export interface Activity {
  id: number;
  actor: string;
  label: string;
  at: number;
  changed: string[];
}

export interface DocState {
  doc: Document | null;
  version: number;
  connected: boolean;
  canUndo: boolean;
  canRedo: boolean;
  error: string | null;
  activity: Activity[];
  /** Nós tocados pela última mudança vinda de um agente (para destacar no canvas). */
  agentTouched: Set<string>;
  /** Agentes presentes (cursor e seleção próprios no canvas). */
  agents: AgentPresence[];
  /** Sincronização de time (ADR 0004): undefined = servidor sem --team; null = ainda sem status. */
  team: TeamStatus | null | undefined;
}

type ServerMsg =
  | { type: "doc"; doc: Document; version: number; actor: string; label: string; kind: string; canUndo: boolean; canRedo: boolean }
  | { type: "ack"; reqId: string; version: number }
  | { type: "error"; reqId?: string; message: string }
  | { type: "team"; status: TeamStatus }
  | PresenceMsg;

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

/**
 * Estado ao vivo (documento, presença, atividade, erro) fora do React: o WebSocket escreve aqui e
 * cada componente assina só a fatia que usa (`useLive`), então uma mensagem de presença de agente
 * re-renderiza os cursores, não o editor inteiro.
 */
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
    team: undefined,
  };
  private listeners = new Set<Listener>();
  private ws: WebSocket | null = null;
  private seq = 0;

  getState = (): DocState => this.state;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  /** Troca o estado (mantém as referências das fatias que não mudaram) e avisa os assinantes. */
  set = (update: (s: DocState) => DocState): void => {
    const next = update(this.state);
    if (next === this.state) return;
    this.state = next;
    for (const l of this.listeners) l();
  };

  /** Abre o WebSocket (reconecta a cada 1 s) e devolve a função que fecha. */
  connect = (): (() => void) => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let flash: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;
      // Reconnecting clears only the "offline" error: an error shown before the socket opened (e.g. a
      // workspace URL that does not exist) must stay on screen.
      ws.onclose = () => {
        // A socket replaced by a newer connect() (StrictMode remount) must not mark the new one offline.
        if (this.ws !== ws) return;
        this.set((s) => ({ ...s, connected: false }));
        if (!closed) retry = setTimeout(open, 1000);
      };
      ws.onopen = () => {
        if (this.ws !== ws) return;
        this.set((s) => ({ ...s, connected: true, error: s.error === OFFLINE ? null : s.error }));
      };
      ws.onmessage = (ev) => {
        if (this.ws !== ws) return;
        const msg = JSON.parse(String(ev.data)) as ServerMsg;
        if (msg.type === "doc") {
          this.set((s) => {
            // Another workspace: nothing carries over (its nodes are not "changed", the feed starts over).
            if (s.doc && s.doc.id !== msg.doc.id) {
              clearTimeout(flash);
              return { ...s, doc: msg.doc, version: msg.version, canUndo: msg.canUndo, canRedo: msg.canRedo, activity: [], agentTouched: new Set() };
            }
            const changed = changedIds(s.doc, msg.doc);
            const fromAgent = msg.actor.startsWith("agent");
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
            };
          });
        } else if (msg.type === "team") {
          this.set((s) => ({ ...s, team: msg.status }));
        } else if (msg.type === "presence") {
          this.set((s) => ({ ...s, agents: applyPresence(s.agents, msg) }));
        } else if (msg.type === "error") {
          this.set((s) => ({ ...s, error: msg.message }));
        }
      };
    };
    open();
    // Team mode is on when the server answers /api/team with JSON (without --team the SPA fallback answers HTML).
    fetch("/api/team")
      .then(async (r) => (r.ok && (r.headers.get("content-type") ?? "").includes("json") ? ((await r.json()) as TeamStatus) : undefined))
      .then((team) => team && this.set((s) => ({ ...s, team: s.team ?? team })))
      .catch(() => {});
    return () => {
      closed = true;
      clearTimeout(retry);
      clearTimeout(flash);
      this.ws?.close();
    };
  };

  private sendRaw(payload: object) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this.set((s) => ({ ...s, error: OFFLINE }));
      return;
    }
    ws.send(JSON.stringify({ ...payload, reqId: String(++this.seq) }));
  }

  /** Ações estáveis (mesma referência sempre): podem ir em deps de efeitos sem re-assinar nada. */
  readonly actions = {
    apply: (ops: Op[], label = "") => this.sendRaw({ type: "ops", ops, label }),
    undo: () => this.sendRaw({ type: "undo" }),
    redo: () => this.sendRaw({ type: "redo" }),
    clearError: () => this.set((s) => (s.error === null ? s : { ...s, error: null })),
    /** Mostra um erro local (ex.: agrupar algo que não pode), no mesmo aviso dos erros do servidor. */
    showError: (message: string) => this.set((s) => ({ ...s, error: message })),
  };
}

/** A conexão da aba (uma por página). */
export const liveStore = new LiveStore();

/** Liga a conexão ao vivo enquanto o componente estiver montado (o App, uma vez). */
export function useLiveConnection(store: LiveStore = liveStore): void {
  useEffect(() => store.connect(), [store]);
}

/**
 * Assina uma fatia do estado ao vivo. O seletor deve devolver um valor estável (um campo do estado
 * ou um primitivo): o componente só re-renderiza quando ele muda (`Object.is`).
 */
export function useLive<T>(selector: (s: DocState) => T, store: LiveStore = liveStore): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

/** apply/undo/redo/showError/clearError do store (referências estáveis). */
export function useLiveActions(store: LiveStore = liveStore): LiveStore["actions"] {
  return store.actions;
}

export type LiveActions = LiveStore["actions"];
