import { useCallback, useEffect, useRef, useState } from "react";
import type { Document, Op } from "@paprika/core";

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
}

type ServerMsg =
  | { type: "doc"; doc: Document; version: number; actor: string; label: string; kind: string; canUndo: boolean; canRedo: boolean }
  | { type: "ack"; reqId: string; version: number }
  | { type: "error"; reqId?: string; message: string };

function changedIds(prev: Document | null, next: Document): string[] {
  if (!prev) return [];
  const out: string[] = [];
  for (const [id, n] of Object.entries(next.nodes)) {
    const p = prev.nodes[id];
    if (!p || JSON.stringify(p) !== JSON.stringify(n)) out.push(id);
  }
  return out;
}

/** Conexão ao vivo com o servidor: recebe o documento a cada mudança e envia operações do humano. */
export function useDocument() {
  const [state, setState] = useState<DocState>({
    doc: null,
    version: 0,
    connected: false,
    canUndo: false,
    canRedo: false,
    error: null,
    activity: [],
    agentTouched: new Set(),
  });
  const wsRef = useRef<WebSocket | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let flash: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = () => setState((s) => ({ ...s, connected: true, error: null }));
      ws.onclose = () => {
        setState((s) => ({ ...s, connected: false }));
        if (!closed) retry = setTimeout(connect, 1000);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as ServerMsg;
        if (msg.type === "doc") {
          setState((s) => {
            const changed = changedIds(s.doc, msg.doc);
            const fromAgent = msg.actor.startsWith("agent");
            const activity =
              msg.kind === "reload" && msg.actor === "server"
                ? s.activity
                : [{ id: msg.version, actor: msg.actor, label: msg.label, at: Date.now(), changed }, ...s.activity].slice(0, 30);
            if (fromAgent) {
              clearTimeout(flash);
              flash = setTimeout(() => setState((x) => ({ ...x, agentTouched: new Set() })), 1600);
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
        } else if (msg.type === "error") {
          setState((s) => ({ ...s, error: msg.message }));
        }
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      clearTimeout(flash);
      wsRef.current?.close();
    };
  }, []);

  const sendRaw = useCallback((payload: object) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setState((s) => ({ ...s, error: "sem conexão com o servidor" }));
      return;
    }
    ws.send(JSON.stringify({ ...payload, reqId: String(++seq.current) }));
  }, []);

  const apply = useCallback((ops: Op[], label = "") => sendRaw({ type: "ops", ops, label }), [sendRaw]);
  const undo = useCallback(() => sendRaw({ type: "undo" }), [sendRaw]);
  const redo = useCallback(() => sendRaw({ type: "redo" }), [sendRaw]);
  const clearError = useCallback(() => setState((s) => ({ ...s, error: null })), []);

  return { ...state, apply, undo, redo, clearError };
}
