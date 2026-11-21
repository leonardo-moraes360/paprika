import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Document } from "@paprika/core";
import { AGENT_IDLE_MS, AGENT_TTL_MS, toolVerb, type AgentPresence } from "./agents";
import "./AgentCursors.css";

interface View {
  x: number;
  y: number;
  zoom: number;
}

/** Caixa em coordenadas do canvas (mundo), medida do DOM real (segue layout flex e hug). */
type Box = { x: number; y: number; w: number; h: number };

interface Props {
  doc: Document;
  agents: AgentPresence[];
  view: View;
  viewportRef: RefObject<HTMLDivElement | null>;
  /** Muda quando o layout muda sem o documento mudar (arraste em andamento). */
  layoutKey?: unknown;
  pageId?: string | null;
}

/**
 * Cursor e seleção de cada agente presente, como num multiplayer: o cursor desliza até os nós em
 * que o agente agiu por último, com o nome dele e o que está fazendo. Só desenha: nada aqui é
 * clicável (pointer-events: none) e nada vai para o documento.
 */
export function AgentCursors({ doc, agents, view, viewportRef, layoutKey, pageId }: Props) {
  const viewRef = useRef(view);
  viewRef.current = view;
  const [boxes, setBoxes] = useState<Record<string, Box[]>>({});
  const [now, setNow] = useState(() => Date.now());

  // Relógio para esmaecer e esconder agentes ociosos.
  useEffect(() => {
    if (!agents.length) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(t);
  }, [agents]);

  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const vpr = vp.getBoundingClientRect();
    const v = viewRef.current;
    const next: Record<string, Box[]> = {};
    for (const a of agents) {
      next[a.agent] = a.nodes.flatMap((id) => {
        const el = vp.querySelector<HTMLElement>(`.world [data-paprika-id="${CSS.escape(id)}"]`);
        if (!el) return [];
        const r = el.getBoundingClientRect();
        return [{ x: (r.left - vpr.left - v.x) / v.zoom, y: (r.top - vpr.top - v.y) / v.zoom, w: r.width / v.zoom, h: r.height / v.zoom }];
      });
    }
    setBoxes(next);
  }, [doc, agents, viewportRef, layoutKey, pageId]);

  const visible = agents.filter((a) => now - a.at < AGENT_TTL_MS);
  if (!visible.length) return null;
  const z = view.zoom;
  const tipKey = (bs: Box[]) => (bs.length ? bs.map((b) => `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}`).join(";") : "");
  const tips = visible.map((a) => tipKey(boxes[a.agent] ?? []));

  return (
    <>
      <div className="agent-layer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${z})` }} aria-hidden>
        {visible.map((a, i) => {
          const bs = boxes[a.agent] ?? [];
          if (!bs.length) return null;
          const left = Math.min(...bs.map((b) => b.x));
          const top = Math.min(...bs.map((b) => b.y));
          const right = Math.max(...bs.map((b) => b.x + b.w));
          const bottom = Math.max(...bs.map((b) => b.y + b.h));
          // Ponta do cursor perto do canto inferior direito da seleção: aponta para o nó sem cobri-lo.
          // Dois agentes no mesmo nó: os cursores se escalonam para os nomes não se cobrirem.
          const stack = tips.slice(0, i).filter((t) => t === tipKey(bs)).length;
          const tipX = right - Math.min(12 / z, (right - left) / 4) + (stack * 10) / z;
          const tipY = bottom - Math.min(12 / z, (bottom - top) / 4) + (stack * 24) / z;
          const idle = now - a.at > AGENT_IDLE_MS;
          return (
            <div key={a.agent} className={`agent${idle ? " is-idle" : ""}`} style={{ ["--agent" as string]: a.color }} data-agent={a.agent} data-testid="agent-cursor">
              {bs.map((b, i) => (
                <div key={i} className="agent-box" style={{ left: b.x, top: b.y, width: b.w, height: b.h, borderWidth: 1.5 / z }} />
              ))}
              <div className="agent-cursor" style={{ translate: `${tipX}px ${tipY}px`, scale: `${1 / z}` }}>
                <svg width="18" height="20" viewBox="0 0 18 20" aria-hidden>
                  <path d="M1.5 1.5 L1.5 16.5 L5.6 12.6 L8.4 18.6 L11.1 17.4 L8.4 11.5 L14.2 11.5 Z" />
                </svg>
                <span className="agent-tag">
                  {a.name} <em>{toolVerb(a.tool)}</em>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <ul className="agent-roster" aria-label="Agentes no documento" data-testid="agent-roster">
        {visible.map((a) => (
          <li key={a.agent} className={now - a.at > AGENT_IDLE_MS ? "is-idle" : ""} style={{ ["--agent" as string]: a.color }} title={`${a.name}: ${toolVerb(a.tool)}`}>
            <span className="agent-dot" />
            {a.name}
            <em>{(boxes[a.agent]?.length ?? 0) || !a.nodes.length ? toolVerb(a.tool) : "em outra página"}</em>
          </li>
        ))}
      </ul>
    </>
  );
}
