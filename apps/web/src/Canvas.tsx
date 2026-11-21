import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { canvasBounds, newId, nodeStyle, type Document, type Node, type Op } from "@paprika/core";

export type Tool = "select" | "frame" | "rect" | "ellipse" | "text";

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

function RenderNode({ doc, node, preview, touched }: { doc: Document; node: Node; preview: Preview | null; touched: Set<string> }) {
  const css = nodeStyle(doc, node) as CSSProperties;
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
            return child ? <RenderNode key={c} doc={doc} node={child} preview={preview} touched={touched} /> : null;
          })}
        </div>
      );
    case "text":
      return <div {...props}>{node.text}</div>;
    case "image":
      return <img {...props} src={node.src} alt={node.alt} draggable={false} />;
    default:
      return <div {...props} />;
  }
}

export function Canvas({ doc, selected, onSelect, tool, onToolDone, apply, agentTouched }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 40, y: 40, zoom: 1 });
  const [preview, setPreview] = useState<Preview | null>(null);
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

  // Enquadra o conteúdo na primeira carga.
  useLayoutEffect(() => {
    if (fitted.current) return;
    fitted.current = true;
    fit();
  }, [fit]);

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

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) spaceDown.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDown.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
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
    const move = (ev: PointerEvent) => setView({ ...start, x: start.x + ev.clientX - sx, y: start.y + ev.clientY - sy });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button === 1 || spaceDown.current) return startPan(e);
    if (e.button !== 0) return;
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
        const defaults = { frame: [390, 844], rect: [120, 80], ellipse: [80, 80], text: [200, 32] } as const;
        if (clicked) [w, h] = defaults[tool];
        const count = Object.values(doc.nodes).filter((n) => n.type === tool).length + 1;
        const names = { frame: "Frame", rect: "Retângulo", ellipse: "Elipse", text: "Texto" } as const;
        const node: Record<string, unknown> & { type: Tool } = { type: tool, name: `${names[tool]} ${count}`, x, y, width: w, height: h };
        if (tool === "frame") node.fill = "#ffffff";
        if (tool === "rect" || tool === "ellipse") node.fill = "#d9d4cf";
        if (tool === "text") Object.assign(node, { text: "Texto", height: "hug" });
        const id = newId();
        apply([{ op: "create", node: { ...node, id } as never, parentId: d.parentId }], `criar ${names[tool].toLowerCase()}`);
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
      className={`viewport tool-${tool}`}
      onPointerDown={onPointerDown}
      data-testid="viewport"
    >
      <div className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        {roots.map((n) => (
          <RenderNode key={n.id} doc={doc} node={n} preview={preview} touched={agentTouched} />
        ))}
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
      </div>
    </div>
  );
}
