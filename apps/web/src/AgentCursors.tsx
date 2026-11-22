import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Document } from "@paprika/core";
import { useLive } from "./useDocument";
import { AGENT_IDLE_MS, AGENT_TTL_MS, agentPage, toolVerb, type AgentPresence } from "./agents";
import { cx } from "./ui";

/** Caixa que envolve todas as caixas. */
const union = (bs: Box[]): Box => {
  const x = Math.min(...bs.map((b) => b.x));
  const y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
};

/** Name tags use the system font, like a native cursor label. */
const tagFont = "[font:600_11px/16px_system-ui,sans-serif]";

interface View {
  x: number;
  y: number;
  zoom: number;
}

/** Caixa em coordenadas do canvas (mundo), medida do DOM real (segue layout flex e hug). */
export type Box = { x: number; y: number; w: number; h: number };

interface Props {
  doc: Document;
  view: View;
  viewportRef: RefObject<HTMLDivElement | null>;
  /** Muda quando o layout muda sem o documento mudar (arraste em andamento). */
  layoutKey?: unknown;
  pageId?: string | null;
  /** Abre a página onde um agente está (clique no item da lista de presença). */
  onOpenPage?(id: string): void;
  /** Leva a câmera até uma caixa em coordenadas do canvas (clique no item da lista de presença). */
  onFocus?(box: Box): void;
}

/**
 * Cursor e seleção de cada agente presente, como num multiplayer: o cursor desliza até os nós em
 * que o agente agiu por último, com o nome dele e o que está fazendo. Só desenha: nada aqui é
 * clicável (pointer-events: none) e nada vai para o documento.
 */
export function AgentCursors({ doc, view, viewportRef, layoutKey, pageId, onOpenPage, onFocus }: Props) {
  // Presence is read here, not passed down: a presence message re-renders the cursors only.
  const agents = useLive((s) => s.agents);
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

  // Clique num agente de outra página: abre a página e enquadra quando as caixas dele forem medidas lá.
  const pending = useRef<string | null>(null);
  useEffect(() => {
    const bs = pending.current ? boxes[pending.current] : undefined;
    if (!bs?.length) return;
    pending.current = null;
    onFocus?.(union(bs));
  }, [boxes, onFocus]);

  const visible = agents.filter((a) => now - a.at < AGENT_TTL_MS);
  if (!visible.length) return null;
  const z = view.zoom;
  const tipKey = (bs: Box[]) => (bs.length ? bs.map((b) => `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}`).join(";") : "");
  const tips = visible.map((a) => tipKey(boxes[a.agent] ?? []));

  // Fora da página aberta: o nome da página onde o agente está.
  const label = "font-normal not-italic text-muted";
  const where = (a: AgentPresence) => {
    if ((boxes[a.agent]?.length ?? 0) || !a.nodes.length) return <em className={label}>{toolVerb(a.tool)}</em>;
    const p = agentPage(doc, a.nodes);
    if (!p || p.id === pageId) return <em className={label}>em outra página</em>;
    return <em className={label} data-testid="agent-page">em {p.name || "outra página"}</em>;
  };
  /** Clique no item: centraliza o cursor do agente (abrindo a página dele antes, se preciso). */
  const target = (a: AgentPresence): (() => void) | undefined => {
    const bs = boxes[a.agent] ?? [];
    if (bs.length) return onFocus && (() => onFocus(union(bs)));
    const p = agentPage(doc, a.nodes);
    if (!p || p.id === pageId || !onOpenPage) return undefined;
    return () => {
      pending.current = a.agent;
      onOpenPage(p.id);
    };
  };

  return (
    <>
      <div className="pointer-events-none absolute top-0 left-0 z-5 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${z})` }} aria-hidden>
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
            <div key={a.agent} className={cx("transition-opacity duration-600 ease-[ease]", idle && "opacity-45")} style={{ ["--agent" as string]: a.color }} data-agent={a.agent} data-testid="agent-cursor">
              {bs.map((b, i) => (
                <div
                  key={i}
                  className="absolute box-border rounded-xs border-[1.5px] border-(--agent) transition-[left,top,width,height] duration-450 ease-glide motion-reduce:transition-none"
                  style={{ left: b.x, top: b.y, width: b.w, height: b.h, borderWidth: 1.5 / z }} />
              ))}
              {/* "agent-cursor" stays as a hook for the E2E suite. */}
              <div
                className="agent-cursor absolute top-0 left-0 flex origin-top-left items-start transition-[translate] duration-550 ease-glide motion-reduce:transition-none"
                style={{ translate: `${tipX}px ${tipY}px`, scale: `${1 / z}` }}>
                {/* The tip of the arrow is at (1.5, 1.5) of the icon. */}
                <svg className="-mt-[1.5px] -ml-[1.5px] drop-shadow-cursor" width="18" height="20" viewBox="0 0 18 20" aria-hidden>
                  <path className="fill-(--agent) stroke-white stroke-[1.2] [stroke-linejoin:round]" d="M1.5 1.5 L1.5 16.5 L5.6 12.6 L8.4 18.6 L11.1 17.4 L8.4 11.5 L14.2 11.5 Z" />
                </svg>
                <span className={cx("mt-3.5 -ml-0.5 rounded-md bg-(--agent) px-1.75 py-0.5 whitespace-nowrap text-white shadow-tag", tagFont)}>
                  {a.name} <em className={cx("font-normal not-italic opacity-85", !idle && "after:content-['…']")}>{toolVerb(a.tool)}</em>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <ul className="pointer-events-none absolute top-3 right-3 z-6 m-0 flex list-none flex-col items-end gap-1 p-0" aria-label="Agentes no workspace" data-testid="agent-roster">
        {visible.map((a) => {
          const go = target(a);
          const p = !boxes[a.agent]?.length && agentPage(doc, a.nodes);
          return (
            <li key={a.agent} className="flex">
              <button
                type="button"
                className={cx(
                  "m-0 flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--agent)_55%,transparent)] bg-panel py-0.75 pr-2.25 pl-1.75 text-fg transition-opacity duration-600 ease-[ease]",
                  "enabled:pointer-events-auto enabled:cursor-pointer enabled:hover:border-(--agent) focus-visible:outline-2 focus-visible:outline-(--agent)",
                  tagFont,
                  now - a.at > AGENT_IDLE_MS && "opacity-55",
                )}
                style={{ ["--agent" as string]: a.color }}
                disabled={!go}
                onClick={go}
                title={go ? (p ? `Ir até ${a.name} na página ${p.name || "dele"}` : `Ir até o cursor de ${a.name}`) : `${a.name}: ${toolVerb(a.tool)}`}
                data-testid="agent-focus">
                <span className="size-2 rounded-full bg-(--agent)" />
                {a.name}
                {where(a)}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
