import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import {
  anchorsToPath,
  canvasBounds,
  newId,
  nodeStyle,
  parsePath,
  pathAttrs,
  pathBounds,
  serializePath,
  translatePath,
  wasmPaintable,
  type Anchor,
  type Document,
  type Node,
  type Op,
} from "@paprika/core";
import { initialRendererMode, saveRendererMode, useWasmLayer, wasmAvailable, type RendererMode } from "./wasmLayer";

export type Tool = "select" | "frame" | "rect" | "ellipse" | "text" | "pen";

/** Caminho em construção com a caneta, em coordenadas locais do frame pai. */
interface PenDraft {
  parentId: string | null;
  anchors: Anchor[];
  cursor: { x: number; y: number } | null;
}

interface View {
  x: number;
  y: number;
  zoom: number;
}

interface Preview {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

interface Draft {
  parentId: string | null;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Retângulo do pai em coordenadas do viewport, para desenhar o rascunho. */
  originLeft: number;
  originTop: number;
}

interface Props {
  doc: Document;
  selected: string | null;
  onSelect(id: string | null): void;
  tool: Tool;
  onToolDone(): void;
  apply(ops: Op[], label?: string): void;
  agentTouched: Set<string>;
}

const isAbsolute = (doc: Document, n: Node) => {
  const p = n.parentId ? doc.nodes[n.parentId] : undefined;
  return !p || p.type !== "frame" || !p.layout || p.layout.mode === "none";
};

/** Prévia da caneta: o caminho até aqui, a reta até o cursor, âncoras e alças. Desenhada no espaço do pai. */
function PenOverlay({ pen, zoom }: { pen: PenDraft; zoom: number }) {
  const segs = anchorsToPath(pen.anchors, false);
  const last = pen.anchors[pen.anchors.length - 1];
  const r = 4 / zoom;
  return (
    <svg className="pen-overlay" data-testid="pen-overlay" style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, overflow: "visible", pointerEvents: "none" }}>
      {segs.length > 0 && <path d={serializePath(segs)} fill="none" stroke="var(--select)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
      {last && pen.cursor && (
        <line x1={last.x} y1={last.y} x2={pen.cursor.x} y2={pen.cursor.y} stroke="var(--select)" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      )}
      {pen.anchors.map((a, k) => (
        <g key={k}>
          {a.in && <line x1={a.in.x} y1={a.in.y} x2={a.x} y2={a.y} stroke="var(--select)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
          {a.out && <line x1={a.x} y1={a.y} x2={a.out.x} y2={a.out.y} stroke="var(--select)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
          {a.in && <circle cx={a.in.x} cy={a.in.y} r={r * 0.75} fill="var(--select)" />}
          {a.out && <circle cx={a.out.x} cy={a.out.y} r={r * 0.75} fill="var(--select)" />}
          <rect x={a.x - r} y={a.y - r} width={2 * r} height={2 * r} fill="#fff" stroke="var(--select)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </g>
      ))}
    </svg>
  );
}

interface RenderProps {
  doc: Document;
  node: Node;
  preview: Preview | null;
  touched: Set<string>;
  pen: PenDraft | null;
  zoom: number;
  /** The WASM layer is drawing shapes: keep their boxes (layout, hit testing) but not their paint. */
  wasm: boolean;
}

function RenderNode({ doc, node, preview, touched, pen, zoom, wasm }: RenderProps) {
  const css = nodeStyle(doc, node) as CSSProperties;
  const wasmPaints = wasm && wasmPaintable(doc, node);
  if (wasmPaints) {
    // Same box (border width stays, so auto layout does not move), no visible paint.
    if (css.background) css.background = "transparent";
    if (css.border) css.borderColor = "transparent";
    delete css.boxShadow;
    delete css.filter;
  }
  if (preview && preview.id === node.id) {
    if (preview.x !== undefined) css.left = preview.x;
    if (preview.y !== undefined) css.top = preview.y;
    if (preview.width !== undefined) css.width = preview.width;
    if (preview.height !== undefined) css.height = preview.height;
  }
  const props = {
    "data-paprika-id": node.id,
    "data-paprika-type": node.type,
    className: touched.has(node.id) ? "agent-flash" : undefined,
    style: css,
  };
  switch (node.type) {
    case "frame":
      return (
        <div {...props}>
          {node.children.map((c) => {
            const child = doc.nodes[c];
            return child ? <RenderNode key={c} doc={doc} node={child} preview={preview} touched={touched} pen={pen} zoom={zoom} wasm={wasm} /> : null;
          })}
          {pen && pen.parentId === node.id && <PenOverlay pen={pen} zoom={zoom} />}
        </div>
      );
    case "text":
      return <div {...props}>{node.text}</div>;
    case "image":
      return <img {...props} src={node.src} alt={node.alt} draggable={false} />;
    case "path": {
      if (wasmPaints) return <div {...props} />;
      const a = pathAttrs(doc, node);
      return (
        <svg {...props} {...a.svg}>
          <path {...a.path} fillRule={a.path.fillRule as "nonzero" | "evenodd"} strokeLinecap={a.path.strokeLinecap as "round"} strokeLinejoin={a.path.strokeLinejoin as "round"} />
        </svg>
      );
    }
    default:
      return <div {...props} />;
  }
}

export function Canvas({ doc, selected, onSelect, tool, onToolDone, apply, agentTouched }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 40, y: 40, zoom: 1 });
  const [renderer, setRenderer] = useState<RendererMode>(initialRendererMode);
  const [preview, setPreview] = useState<Preview | null>(null);
  const wasmLayer = useWasmLayer({ mode: renderer, doc, view, viewportRef, worldRef, layoutKey: preview });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [frameLabels, setFrameLabels] = useState<{ id: string; name: string; left: number; top: number }[]>([]);
  const fitted = useRef(false);
  const spaceDown = useRef(false);

  const fit = useCallback(() => {
    if (!viewportRef.current) return;
    const vp = viewportRef.current.getBoundingClientRect();
    const b = canvasBounds(doc);
    const zoom = Math.min(1, (vp.width - 120) / Math.max(b.width, 1), (vp.height - 120) / Math.max(b.height, 1));
    const z = Math.max(0.1, zoom);
    setView({ zoom: z, x: (vp.width - b.width * z) / 2 - b.x * z, y: (vp.height - b.height * z) / 2 - b.y * z });
  }, [doc]);

  // Enquadra o conteúdo na primeira carga e sempre que o servidor passa a servir outro documento.
  const fittedDocId = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (fitted.current && fittedDocId.current === doc.id) return;
    fitted.current = true;
    fittedDocId.current = doc.id;
    fit();
  }, [fit, doc.id]);

  // Caixa de seleção e rótulos dos frames: medidos do DOM real, então seguem layout flex e hug.
  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const vpr = vp.getBoundingClientRect();
    const el = selected ? vp.querySelector<HTMLElement>(`[data-paprika-id="${CSS.escape(selected)}"]`) : null;
    if (el) {
      const r = el.getBoundingClientRect();
      setBox({ left: r.left - vpr.left, top: r.top - vpr.top, width: r.width, height: r.height });
    } else setBox(null);
    setFrameLabels(
      doc.rootIds.flatMap((id) => {
        const n = doc.nodes[id];
        const e = vp.querySelector<HTMLElement>(`[data-paprika-id="${CSS.escape(id)}"]`);
        if (!n || n.type !== "frame" || !e) return [];
        const r = e.getBoundingClientRect();
        return [{ id, name: n.name || id, left: r.left - vpr.left, top: r.top - vpr.top }];
      }),
    );
  }, [doc, selected, view, preview]);

  // Caneta (P): clique cria um vértice reto; clicar e arrastar puxa alças bezier simétricas.
  // Clicar no primeiro vértice fecha a forma; Enter, Esc ou duplo clique terminam aberta; Backspace desfaz o último vértice.
  const [pen, setPen] = useState<PenDraft | null>(null);
  const penRef = useRef(pen);
  penRef.current = pen;

  /** Converte coordenadas da tela para o espaço local de um frame (ou do canvas, se null). */
  const localFor = useCallback(
    (parentId: string | null, clientX: number, clientY: number) => {
      const vp = viewportRef.current!;
      const vpr = vp.getBoundingClientRect();
      let left = vpr.left + view.x;
      let top = vpr.top + view.y;
      if (parentId) {
        const el = vp.querySelector<HTMLElement>(`[data-paprika-id="${CSS.escape(parentId)}"]`);
        if (el) {
          const r = el.getBoundingClientRect();
          left = r.left;
          top = r.top;
        }
      }
      return { x: (clientX - left) / view.zoom, y: (clientY - top) / view.zoom };
    },
    [view],
  );

  const finishPen = useCallback(
    (closed: boolean) => {
      const p = penRef.current;
      setPen(null);
      if (!p || p.anchors.length < 2) return;
      const segs = anchorsToPath(p.anchors, closed);
      const b = pathBounds(segs);
      const x = Math.floor(b.x);
      const y = Math.floor(b.y);
      const d = serializePath(translatePath(segs, -x, -y));
      const count = Object.values(doc.nodes).filter((n) => n.type === "path").length + 1;
      const id = newId();
      const node: Record<string, unknown> = {
        type: "path",
        id,
        name: `Vetor ${count}`,
        x,
        y,
        width: Math.max(1, Math.ceil(b.x + b.width) - x),
        height: Math.max(1, Math.ceil(b.y + b.height) - y),
        d,
        stroke: { color: "#1e2336", width: 2 },
      };
      if (closed) node.fill = "#d9d4cf";
      parsePath(d); // falha aqui antes de mandar algo inválido ao servidor
      apply([{ op: "create", node: node as never, parentId: p.parentId }], "desenhar vetor");
      onSelect(id);
      onToolDone();
    },
    [apply, doc, onSelect, onToolDone],
  );

  useEffect(() => {
    if (tool !== "pen") setPen(null);
  }, [tool]);

  // Teclas da caneta têm prioridade (captura) sobre atalhos globais e o pan com Enter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!penRef.current) return;
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        finishPen(false);
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setPen((p) => (p && p.anchors.length > 1 ? { ...p, anchors: p.anchors.slice(0, -1) } : null));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [finishPen]);

  const onPenDown = (e: RPointerEvent<HTMLDivElement>) => {
    let draft = penRef.current;
    if (!draft) {
      // O vetor fica onde foi desenhado: sobe até o frame de layout livre mais próximo (ou o canvas),
      // porque dentro de um frame row/column o x/y do filho seria ignorado pelo fluxo.
      let frameEl = (e.target as HTMLElement).closest<HTMLElement>('[data-paprika-type="frame"]');
      while (frameEl) {
        const f = doc.nodes[frameEl.dataset.paprikaId!];
        if (f?.type === "frame" && (!f.layout || f.layout.mode === "none")) break;
        frameEl = frameEl.parentElement?.closest<HTMLElement>('[data-paprika-type="frame"]') ?? null;
      }
      draft = { parentId: frameEl?.dataset.paprikaId ?? null, anchors: [], cursor: null };
      onSelect(null);
    }
    const parentId = draft.parentId;
    const p0 = localFor(parentId, e.clientX, e.clientY);
    const first = draft.anchors[0];
    if (first && draft.anchors.length >= 3 && Math.hypot(first.x - p0.x, first.y - p0.y) * view.zoom < 8) {
      penRef.current = draft;
      return finishPen(true);
    }
    const anchor: Anchor = { x: Math.round(p0.x * 100) / 100, y: Math.round(p0.y * 100) / 100 };
    const base = draft.anchors;
    const next: PenDraft = { ...draft, anchors: [...base, anchor], cursor: null };
    penRef.current = next;
    setPen(next);
    const move = (ev: PointerEvent) => {
      const p = localFor(parentId, ev.clientX, ev.clientY);
      if (Math.hypot(p.x - anchor.x, p.y - anchor.y) * view.zoom < 3) return;
      const a: Anchor = { ...anchor, out: { x: p.x, y: p.y }, in: { x: 2 * anchor.x - p.x, y: 2 * anchor.y - p.y } };
      const upd: PenDraft = { ...next, anchors: [...base, a] };
      penRef.current = upd;
      setPen(upd);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onPenHover = (e: RPointerEvent<HTMLDivElement>) => {
    const p = penRef.current;
    if (!p || e.buttons) return;
    setPen({ ...p, cursor: localFor(p.parentId, e.clientX, e.clientY) });
  };

  const onPenDouble = () => {
    const p = penRef.current;
    if (!p) return;
    // O duplo clique já adicionou um vértice repetido no segundo clique: descarta antes de terminar.
    const a = p.anchors;
    const [x, y] = [a[a.length - 1], a[a.length - 2]];
    if (x && y && Math.hypot(x.x - y.x, x.y - y.y) * view.zoom < 4) penRef.current = { ...p, anchors: a.slice(0, -1) };
    finishPen(false);
  };

  // Segurar Espaço (ou Enter) arma o pan: cursor vira mão aberta; arrastando, mão fechada.
  const [pan, setPan] = useState<"off" | "ready" | "panning">("off");
  const panRef = useRef(pan);
  panRef.current = pan;
  useEffect(() => {
    const isPanKey = (e: KeyboardEvent) => e.code === "Space" || e.key === "Enter";
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable);
    const down = (e: KeyboardEvent) => {
      if (!isPanKey(e) || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault(); // evita rolar a página ou "clicar" o botão focado
      spaceDown.current = true;
      if (panRef.current === "off") setPan("ready");
    };
    const release = () => {
      spaceDown.current = false;
      if (panRef.current === "ready") setPan("off");
    };
    const up = (e: KeyboardEvent) => {
      if (isPanKey(e)) release();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
    };
  }, []);

  // Wheel precisa ser não-passivo para bloquear o zoom da página.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const px = e.clientX - r.left;
        const py = e.clientY - r.top;
        setView((v) => {
          const zoom = Math.min(8, Math.max(0.1, v.zoom * Math.exp(-e.deltaY * 0.0015)));
          return { zoom, x: px - ((px - v.x) * zoom) / v.zoom, y: py - ((py - v.y) * zoom) / v.zoom };
        });
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, []);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const r = viewportRef.current!.getBoundingClientRect();
      return { x: (clientX - r.left - view.x) / view.zoom, y: (clientY - r.top - view.y) / view.zoom };
    },
    [view],
  );

  const startPan = (e: RPointerEvent) => {
    const sx = e.clientX;
    const sy = e.clientY;
    const start = view;
    setPan("panning");
    const move = (ev: PointerEvent) => setView({ ...start, x: start.x + ev.clientX - sx, y: start.y + ev.clientY - sy });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPan(spaceDown.current ? "ready" : "off");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button === 1 || spaceDown.current) return startPan(e);
    if (e.button !== 0) return;
    if (tool === "pen") return onPenDown(e);
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-paprika-id]");

    if (tool !== "select") {
      const frameEl = (e.target as HTMLElement).closest<HTMLElement>('[data-paprika-type="frame"]');
      const parentId = frameEl?.dataset.paprikaId ?? null;
      const vpr = viewportRef.current!.getBoundingClientRect();
      let originLeft = vpr.left + view.x;
      let originTop = vpr.top + view.y;
      if (frameEl) {
        const fr = frameEl.getBoundingClientRect();
        originLeft = fr.left;
        originTop = fr.top;
      }
      const local = (cx: number, cy: number) => ({ x: (cx - originLeft) / view.zoom, y: (cy - originTop) / view.zoom });
      const p0 = local(e.clientX, e.clientY);
      const d: Draft = { parentId, x0: p0.x, y0: p0.y, x1: p0.x, y1: p0.y, originLeft: originLeft - vpr.left, originTop: originTop - vpr.top };
      setDraft(d);
      const move = (ev: PointerEvent) => {
        const p = local(ev.clientX, ev.clientY);
        d.x1 = p.x;
        d.y1 = p.y;
        setDraft({ ...d });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        setDraft(null);
        const x = Math.round(Math.min(d.x0, d.x1));
        const y = Math.round(Math.min(d.y0, d.y1));
        let w = Math.round(Math.abs(d.x1 - d.x0));
        let h = Math.round(Math.abs(d.y1 - d.y0));
        const clicked = w < 4 && h < 4;
        const kind = tool as Exclude<Tool, "select" | "pen">;
        const defaults = { frame: [390, 844], rect: [120, 80], ellipse: [80, 80], text: [200, 32] } as const;
        if (clicked) [w, h] = defaults[kind];
        const count = Object.values(doc.nodes).filter((n) => n.type === tool).length + 1;
        const names = { frame: "Frame", rect: "Retângulo", ellipse: "Elipse", text: "Texto" } as const;
        const node: Record<string, unknown> & { type: Tool } = { type: kind, name: `${names[kind]} ${count}`, x, y, width: w, height: h };
        if (tool === "frame") node.fill = "#ffffff";
        if (tool === "rect" || tool === "ellipse") node.fill = "#d9d4cf";
        if (tool === "text") Object.assign(node, { text: "Texto", height: "hug" });
        const id = newId();
        apply([{ op: "create", node: { ...node, id } as never, parentId: d.parentId }], `criar ${names[kind].toLowerCase()}`);
        onSelect(id);
        onToolDone();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }

    if (!target) return onSelect(null);
    const id = target.dataset.paprikaId!;
    onSelect(id);
    const node = doc.nodes[id];
    if (!node || node.locked || !isAbsolute(doc, node)) return;
    const start = toWorld(e.clientX, e.clientY);
    let moved = false;
    let last = { x: node.x, y: node.y };
    const move = (ev: PointerEvent) => {
      const p = toWorld(ev.clientX, ev.clientY);
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      if (!moved && Math.hypot(dx, dy) * view.zoom < 3) return;
      moved = true;
      last = { x: Math.round(node.x + dx), y: Math.round(node.y + dy) };
      setPreview({ id, ...last });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPreview(null);
      if (moved) apply([{ op: "update", id, props: last }], "mover");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onResizeDown = (e: RPointerEvent) => {
    e.stopPropagation();
    if (!selected || !box) return;
    const node = doc.nodes[selected];
    if (!node || node.locked) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const w0 = box.width / view.zoom;
    const h0 = box.height / view.zoom;
    let last = { width: Math.round(w0), height: Math.round(h0) };
    const move = (ev: PointerEvent) => {
      last = {
        width: Math.max(1, Math.round(w0 + (ev.clientX - sx) / view.zoom)),
        height: Math.max(1, Math.round(h0 + (ev.clientY - sy) / view.zoom)),
      };
      setPreview({ id: selected, ...last });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPreview(null);
      apply([{ op: "update", id: selected, props: last }], "redimensionar");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const roots = doc.rootIds.map((id) => doc.nodes[id]).filter((n): n is Node => !!n);
  const draftRect = draft && {
    left: draft.originLeft + Math.min(draft.x0, draft.x1) * view.zoom,
    top: draft.originTop + Math.min(draft.y0, draft.y1) * view.zoom,
    width: Math.abs(draft.x1 - draft.x0) * view.zoom,
    height: Math.abs(draft.y1 - draft.y0) * view.zoom,
  };

  return (
    <div
      ref={viewportRef}
      className={`viewport tool-${tool}${pan === "ready" ? " is-pan-ready" : pan === "panning" ? " is-panning" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={pen ? onPenHover : undefined}
      onDoubleClick={pen ? onPenDouble : undefined}
      data-testid="viewport"
    >
      {renderer === "wasm" && <canvas ref={wasmLayer.canvasRef} className="wasm-layer" data-testid="wasm-layer" data-backend={wasmLayer.status.backend} />}
      <div ref={worldRef} className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        {roots.map((n) => (
          <RenderNode key={n.id} doc={doc} node={n} preview={preview} touched={agentTouched} pen={pen} zoom={view.zoom} wasm={wasmLayer.active} />
        ))}
        {pen && pen.parentId === null && <PenOverlay pen={pen} zoom={view.zoom} />}
      </div>
      {frameLabels.map((l) => (
        <div
          key={l.id}
          className={`frame-label${l.id === selected ? " is-selected" : ""}`}
          style={{ left: l.left, top: l.top - 20 }}
          onPointerDown={(e) => {
            e.stopPropagation();
            onSelect(l.id);
          }}
        >
          {l.name}
        </div>
      ))}
      {box && (
        <div className="selection" style={box} data-testid="selection">
          <div className="handle" onPointerDown={onResizeDown} title="Redimensionar" />
          <div className="dims">
            {Math.round(box.width / view.zoom)} × {Math.round(box.height / view.zoom)}
          </div>
        </div>
      )}
      {draftRect && <div className="draft" style={draftRect} />}
      <div className="zoom-pill" onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={() => setView((v) => ({ ...v, zoom: Math.max(0.1, v.zoom / 1.25) }))} aria-label="Diminuir zoom">−</button>
        <span>{Math.round(view.zoom * 100)}%</span>
        <button onClick={() => setView((v) => ({ ...v, zoom: Math.min(8, v.zoom * 1.25) }))} aria-label="Aumentar zoom">+</button>
        <button onClick={fit} aria-label="Enquadrar" title="Enquadrar (Shift+1)">
          ⤢
        </button>
        <button
          className={`renderer-toggle${renderer === "wasm" ? " is-on" : ""}`}
          data-testid="renderer-toggle"
          data-backend={renderer === "wasm" ? wasmLayer.status.backend : "dom"}
          disabled={!wasmAvailable && renderer === "dom"}
          aria-pressed={renderer === "wasm"}
          title={
            renderer === "wasm"
              ? `Renderizador WASM (${wasmLayer.status.backend})${wasmLayer.status.detail ? `: ${wasmLayer.status.detail}` : ""}. Clique para voltar ao DOM.`
              : wasmAvailable
                ? "Renderizador DOM. Clique para desenhar formas com WASM (WebGPU, ou CPU sem GPU)."
                : "Renderizador WASM não compilado (pnpm build com Rust instalado)."
          }
          onClick={() => {
            const next = renderer === "wasm" ? "dom" : "wasm";
            saveRendererMode(next);
            setRenderer(next);
          }}
        >
          {renderer === "dom" ? "DOM" : wasmLayer.status.backend === "webgpu" ? "GPU" : wasmLayer.status.backend === "cpu" ? "CPU" : "WASM"}
        </button>
      </div>
    </div>
  );
}
