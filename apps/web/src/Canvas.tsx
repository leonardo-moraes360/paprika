import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import {
  copyOwner,
  importHTML,
  importSVG,
  isInstance,
  anchorsToPath,
  canvasBounds,
  isScene,
  newId,
  pageRoots,
  nodeStyle,
  parsePath,
  pathAttrs,
  pathBounds,
  serializePath,
  translatePath,
  wasmPaintable,
  isSVGText,
  insertAnchor,
  moveAnchor,
  moveHandle,
  nearestOnPath,
  pathEditProps,
  pathToSubpaths,
  removeAnchor,
  toggleSmooth,
  type Anchor,
  type AnchorRef,
  type PathNode,
  type Subpath,
  type Document,
  type Node,
  type Op,
  type SceneNode,
} from "@paprika/core";
import { clientToPath, PathEditOverlay, pathHit, pathScale, type PathEditState } from "./PathEdit";
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

/** Posições/tamanhos provisórios durante um arraste (um ou vários nós). */
type Preview = Record<string, { x?: number; y?: number; width?: number; height?: number }>;

/** Retângulo de seleção (marquee), em coordenadas do viewport. */
interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  additive: boolean;
}

type Rect = { left: number; top: number; width: number; height: number };

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
  selected: string[];
  onSelect(ids: string[]): void;
  /** Página mostrada no canvas (null: documento sem páginas). */
  pageId: string | null;
  tool: Tool;
  onToolDone(): void;
  apply(ops: Op[], label?: string): void;
  agentTouched: Set<string>;
  onError?(message: string): void;
}

const isAbsolute = (doc: Document, n: Node) => {
  const p = n.parentId ? doc.nodes[n.parentId] : undefined;
  return n.type !== "page" && (!p || p.type !== "frame" || !p.layout || p.layout.mode === "none");
};

/**
 * Clicar dentro de um grupo seleciona o grupo mais externo (ou mantém o grupo já selecionado, para
 * poder arrastá-lo). Quando a seleção já está dentro do grupo (um filho selecionado), o clique vai
 * para o próximo nível. O duplo clique entra direto no nó sob o cursor.
 */
export function pickTarget(doc: Document, id: string, selected: readonly string[]): string {
  const groups: string[] = []; // do mais interno ao mais externo
  for (let p = doc.nodes[id]?.parentId; p; p = doc.nodes[p]?.parentId ?? null) if (doc.nodes[p]?.type === "group" || isInstance(doc.nodes[p])) groups.push(p);
  const within = (g: string) =>
    selected.some((s) => {
      for (let cur = doc.nodes[s]?.parentId ?? null; cur; cur = doc.nodes[cur]?.parentId ?? null) if (cur === g) return true;
      return false;
    });
  for (let k = groups.length - 1; k >= 0; k--) {
    const g = groups[k]!;
    if (selected.includes(g) || !within(g)) return g;
  }
  return id;
}

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
  /** Path em edição ponto a ponto, com os subcaminhos a desenhar. */
  edit: { id: string; subs: Subpath[]; sel: AnchorRef | null } | null;
}

function RenderNode({ doc, node, preview, touched, pen, zoom, wasm, edit }: RenderProps) {
  const css = nodeStyle(doc, node) as CSSProperties;
  const wasmPaints = wasm && wasmPaintable(doc, node);
  if (wasmPaints) {
    // Same box (border width stays, so auto layout does not move), no visible paint.
    if (css.background) css.background = "transparent";
    if (css.border) css.borderColor = "transparent";
    delete css.boxShadow;
    delete css.filter;
  }
  const pv = preview?.[node.id];
  if (pv) {
    if (pv.x !== undefined) css.left = pv.x;
    if (pv.y !== undefined) css.top = pv.y;
    if (pv.width !== undefined) css.width = pv.width;
    if (pv.height !== undefined) css.height = pv.height;
  }
  const props = {
    "data-paprika-id": node.id,
    "data-paprika-type": node.type,
    className: touched.has(node.id) ? "agent-flash" : undefined,
    style: css,
  };
  switch (node.type) {
    case "frame":
    case "group":
      return (
        <div {...props}>
          {node.children.map((c) => {
            const child = doc.nodes[c];
            return child ? <RenderNode key={c} doc={doc} node={child} preview={preview} touched={touched} pen={pen} zoom={zoom} wasm={wasm} edit={edit} /> : null;
          })}
          {pen && pen.parentId === node.id && <PenOverlay pen={pen} zoom={zoom} />}
        </div>
      );
    case "text":
      return <div {...props}>{node.text}</div>;
    case "image":
      return <img {...props} src={node.src} alt={node.alt} draggable={false} />;
    case "path": {
      const editing = edit?.id === node.id ? edit : null;
      if (wasmPaints && !editing) return <div {...props} />;
      const a = pathAttrs(doc, node);
      // Em edição, as alças podem sair da caixa do nó.
      if (editing) props.style = { ...css, overflow: "visible" };
      return (
        <svg {...props} {...a.svg}>
          {!wasmPaints && (
            <path {...a.path} fillRule={a.path.fillRule as "nonzero" | "evenodd"} strokeLinecap={a.path.strokeLinecap as "round"} strokeLinejoin={a.path.strokeLinejoin as "round"} />
          )}
          {editing && <PathEditOverlay subs={editing.subs} sel={editing.sel} scale={pathScale(node, zoom)} />}
        </svg>
      );
    }
    default:
      return <div {...props} />;
  }
}

export function Canvas({ doc, selected, onSelect, pageId, tool, onToolDone, apply, agentTouched, onError }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 40, y: 40, zoom: 1 });
  const [renderer, setRenderer] = useState<RendererMode>(initialRendererMode);
  const [preview, setPreview] = useState<Preview | null>(null);
  const wasmLayer = useWasmLayer({ mode: renderer, doc, view, viewportRef, worldRef, layoutKey: preview, pageId });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  /** Caixa que envolve a seleção, e a de cada nó quando há mais de um. */
  const [box, setBox] = useState<Rect | null>(null);
  const [boxes, setBoxes] = useState<(Rect & { id: string })[]>([]);
  const roots = pageRoots(doc, pageId);
  const [frameLabels, setFrameLabels] = useState<{ id: string; name: string; left: number; top: number }[]>([]);
  const fitted = useRef(false);
  const spaceDown = useRef(false);

  const fit = useCallback(() => {
    if (!viewportRef.current) return;
    const vp = viewportRef.current.getBoundingClientRect();
    const b = canvasBounds(doc, pageId ?? undefined);
    const zoom = Math.min(1, (vp.width - 120) / Math.max(b.width, 1), (vp.height - 120) / Math.max(b.height, 1));
    const z = Math.max(0.1, zoom);
    setView({ zoom: z, x: (vp.width - b.width * z) / 2 - b.x * z, y: (vp.height - b.height * z) / 2 - b.y * z });
  }, [doc, pageId]);

  // Enquadra o conteúdo na primeira carga, quando o servidor passa a servir outro documento e ao trocar de página.
  const fittedDocId = useRef<string | null>(null);
  useLayoutEffect(() => {
    const key = `${doc.id}/${pageId ?? ""}`;
    if (fitted.current && fittedDocId.current === key) return;
    fitted.current = true;
    fittedDocId.current = key;
    fit();
  }, [fit, doc.id, pageId]);

  // Caixa de seleção e rótulos dos frames: medidos do DOM real, então seguem layout flex e hug.
  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const vpr = vp.getBoundingClientRect();
    const rects = selected.flatMap((id) => {
      const el = vp.querySelector<HTMLElement>(`[data-paprika-id="${CSS.escape(id)}"]`);
      if (!el) return [];
      const r = el.getBoundingClientRect();
      return [{ id, left: r.left - vpr.left, top: r.top - vpr.top, width: r.width, height: r.height }];
    });
    if (rects.length) {
      const left = Math.min(...rects.map((r) => r.left));
      const top = Math.min(...rects.map((r) => r.top));
      const right = Math.max(...rects.map((r) => r.left + r.width));
      const bottom = Math.max(...rects.map((r) => r.top + r.height));
      setBox({ left, top, width: right - left, height: bottom - top });
    } else setBox(null);
    setBoxes(rects.length > 1 ? rects : []);
    setFrameLabels(
      roots.flatMap((id) => {
        const n = doc.nodes[id];
        const e = vp.querySelector<HTMLElement>(`[data-paprika-id="${CSS.escape(id)}"]`);
        if (!n || n.type !== "frame" || !e) return [];
        const r = e.getBoundingClientRect();
        return [{ id, name: n.name || id, left: r.left - vpr.left, top: r.top - vpr.top }];
      }),
    );
  }, [doc, selected, view, preview, roots]);

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
      onSelect([id]);
      onToolDone();
    },
    [apply, doc, onSelect, onToolDone],
  );

  useEffect(() => {
    if (tool !== "pen") setPen(null);
  }, [tool]);

  // Colar SVG ou HTML vira nós editáveis: dentro do frame selecionado ou na página, no centro da tela.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const plain = e.clipboardData?.getData("text/plain").trim() ?? "";
      const html = e.clipboardData?.getData("text/html") ?? "";
      const svg = isSVGText(plain);
      if (!svg && !html.trim()) return;
      e.preventDefault();
      try {
        const sel = selected.length === 1 ? doc.nodes[selected[0]!] : undefined;
        const into = sel?.type === "frame" && !isInstance(sel) && !copyOwner(doc, sel) ? sel.id : null;
        const vpr = viewportRef.current!.getBoundingClientRect();
        const c = localFor(into, vpr.left + vpr.width / 2, vpr.top + vpr.height / 2);
        const at = { x: Math.round(c.x), y: Math.round(c.y) };
        const r = svg ? importSVG(plain, at) : importHTML(html, at);
        if (!r.nodes.length) throw new Error(r.warnings.join("; ") || "nada para colar");
        const ids = r.nodes.map((n) => (n.id = newId()));
        apply(r.nodes.map((node) => ({ op: "create", parentId: into ?? pageId, node })), svg ? "colar SVG" : "colar HTML");
        onSelect(ids);
        if (r.warnings.length) onError?.(`Colado com avisos: ${r.warnings.join("; ")}`);
      } catch (err) {
        onError?.(`Não deu para colar: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [apply, doc, localFor, onError, onSelect, pageId, selected]);

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
      draft = { parentId: frameEl?.dataset.paprikaId ?? pageId, anchors: [], cursor: null };
      onSelect([]);
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

  // Edição ponto a ponto (duplo clique num path): arrastar âncoras e alças, duplo clique numa
  // âncora alterna canto/suave, duplo clique no contorno insere um ponto, Delete remove o
  // selecionado, Esc ou Enter saem. Cada gesto é uma entrada no histórico.
  const [pathEdit, setPathEdit] = useState<PathEditState | null>(null);
  const pathEditRef = useRef(pathEdit);
  pathEditRef.current = pathEdit;
  const editNode = pathEdit ? doc.nodes[pathEdit.id] : undefined;
  const editPath = editNode?.type === "path" ? editNode : undefined;
  const editSubs = useMemo(() => {
    if (!editPath) return null;
    try {
      return pathToSubpaths(parsePath(editPath.d));
    } catch {
      return null;
    }
  }, [editPath]);
  // O que está na tela: o arraste em curso, senão o último gesto enviado (até o servidor devolver o
  // documento novo), senão o `d` do nó. Gestos rápidos em sequência partem sempre desse estado.
  const shownSubs = pathEdit && editSubs ? (pathEdit.draft ?? pathEdit.sent ?? editSubs) : null;
  const editView = pathEdit && editPath && shownSubs ? { id: pathEdit.id, subs: shownSubs, sel: pathEdit.sel } : null;
  const editSubsRef = useRef(shownSubs);
  editSubsRef.current = shownSubs;
  // O servidor devolve cada gesto na ordem: o `d` do último enviado encerra a espera; um `d`
  // intermediário mantém a prévia; qualquer outro (agente, undo) vale e descarta a prévia.
  const editD = editPath?.d;
  useEffect(() => {
    setPathEdit((cur) => {
      if (!cur?.sent) return cur;
      if (editD !== undefined && cur.pending.slice(0, -1).includes(editD)) return cur;
      return { ...cur, sent: null, pending: [] };
    });
  }, [editD]);

  // Sai da edição quando o nó some (undo, agente), a seleção muda ou outra ferramenta entra.
  useEffect(() => {
    if (!pathEdit) return;
    if (!editPath || !editSubs || tool !== "select" || selected.length !== 1 || selected[0] !== pathEdit.id) setPathEdit(null);
  }, [pathEdit, editPath, editSubs, tool, selected]);

  const commitPath = useCallback(
    (subs: Subpath[], label: string) => {
      const node = pathEditRef.current && doc.nodes[pathEditRef.current.id];
      if (!node || node.type !== "path") return;
      const props = pathEditProps(node, subs, isAbsolute(doc, node));
      if (!props) {
        setPathEdit(null);
        apply([{ op: "delete", id: node.id }], "apagar vetor");
        onSelect([]);
        return;
      }
      setPathEdit((cur) => cur && { ...cur, sent: subs, pending: [...cur.pending, props.d] });
      apply([{ op: "update", id: node.id, props: { ...props } }], label);
    },
    [apply, doc, onSelect],
  );

  const startPathEdit = (node: PathNode) => {
    if (node.locked || copyOwner(doc, node)) return false;
    try {
      parsePath(node.d);
    } catch {
      return false;
    }
    setPathEdit({ id: node.id, sel: null, draft: null, sent: null, pending: [] });
    onSelect([node.id]);
    return true;
  };

  useEffect(() => {
    if (!pathEdit) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable)) return;
      const st = pathEditRef.current;
      const subs = editSubsRef.current;
      if (!st || !subs) return;
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        setPathEdit(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && st.sel) {
        e.preventDefault();
        e.stopPropagation();
        setPathEdit((cur) => cur && { ...cur, sel: null });
        commitPath(removeAnchor(subs, st.sel), "remover ponto");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pathEdit, commitPath]);

  /** Arraste de âncora ou alça. Alt solta a alça oposta (canto); sem Alt ela espelha (suave). */
  const startPathDrag = (e: RPointerEvent, hit: Extract<ReturnType<typeof pathHit>, { ref: AnchorRef }>) => {
    const st = pathEditRef.current;
    const subs0 = editSubsRef.current;
    const svg = st && viewportRef.current?.querySelector<SVGSVGElement>(`svg[data-paprika-id="${CSS.escape(st.id)}"]`);
    if (!st || !subs0 || !svg) return;
    e.stopPropagation();
    const sel = hit.ref;
    setPathEdit({ ...st, sel });
    const sx = e.clientX;
    const sy = e.clientY;
    const p0 = clientToPath(svg, sx, sy);
    const a0 = subs0[sel.sub]?.anchors[sel.index];
    if (!a0) return;
    const origin = hit.kind === "anchor" ? { x: a0.x, y: a0.y } : a0[hit.side]!;
    let moved = false;
    let last: Subpath[] = subs0;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
      moved = true;
      const p = clientToPath(svg, ev.clientX, ev.clientY);
      const to = { x: origin.x + p.x - p0.x, y: origin.y + p.y - p0.y };
      last = hit.kind === "anchor" ? moveAnchor(subs0, sel, to) : moveHandle(subs0, sel, hit.side, to, !ev.altKey);
      setPathEdit((cur) => cur && { ...cur, draft: last });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPathEdit((cur) => cur && { ...cur, draft: null });
      if (moved) commitPath(last, hit.kind === "anchor" ? "mover ponto" : "mover alça");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Duplo clique durante a edição: âncora alterna canto/suave; contorno insere um ponto. */
  const onPathDouble = (e: React.MouseEvent) => {
    const st = pathEditRef.current;
    const subs = editSubsRef.current;
    const hit = pathHit(e.target);
    const svg = st && viewportRef.current?.querySelector<SVGSVGElement>(`svg[data-paprika-id="${CSS.escape(st.id)}"]`);
    if (!st || !subs || !hit || !svg) return false;
    if (hit.kind === "anchor") {
      commitPath(toggleSmooth(subs, hit.ref), "alternar canto/suave");
      setPathEdit((cur) => cur && { ...cur, sel: hit.ref });
    } else if (hit.kind === "outline") {
      const near = nearestOnPath(subs, clientToPath(svg, e.clientX, e.clientY));
      if (near) {
        const r = insertAnchor(subs, near.ref, near.t);
        commitPath(r.subs, "inserir ponto");
        setPathEdit((cur) => cur && { ...cur, sel: r.ref });
      }
    }
    return true;
  };

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
    if (pathEditRef.current) {
      const hit = pathHit(e.target);
      if (hit && hit.kind !== "outline") return startPathDrag(e, hit);
      // Clique no próprio vetor mantém a edição (o duplo clique no contorno insere ponto).
      if (hit || (e.target as Element).closest(`[data-paprika-id="${CSS.escape(pathEditRef.current.id)}"]`)) return;
      setPathEdit(null);
    }
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-paprika-id]");

    if (tool !== "select") {
      const frameEl = (e.target as HTMLElement).closest<HTMLElement>('[data-paprika-type="frame"]');
      const parentId = frameEl?.dataset.paprikaId ?? pageId;
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
        onSelect([id]);
        onToolDone();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }

    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!target) return startMarquee(e, additive);
    const id = pickTarget(doc, target.dataset.paprikaId!, selected);
    if (additive) {
      onSelect(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
      return;
    }
    // Arrastar um nó já selecionado move a seleção inteira; senão, seleciona só ele.
    const group = selected.includes(id) ? selected : [id];
    if (!selected.includes(id)) onSelect([id]);
    const movable = group.map((g) => doc.nodes[g]).filter((n): n is SceneNode => isScene(n) && !n.locked && isAbsolute(doc, n) && !copyOwner(doc, n));
    if (!movable.length) return;
    const start = toWorld(e.clientX, e.clientY);
    let moved = false;
    let last: Preview = {};
    const move = (ev: PointerEvent) => {
      const p = toWorld(ev.clientX, ev.clientY);
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      if (!moved && Math.hypot(dx, dy) * view.zoom < 3) return;
      moved = true;
      last = Object.fromEntries(movable.map((n) => [n.id, { x: Math.round(n.x + dx), y: Math.round(n.y + dy) }]));
      setPreview(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPreview(null);
      if (moved) apply(Object.entries(last).map(([nid, props]) => ({ op: "update", id: nid, props })), movable.length > 1 ? `mover ${movable.length} nós` : "mover");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Marquee: arrastar no vazio seleciona os nós de topo da página que o retângulo toca. */
  const startMarquee = (e: RPointerEvent, additive: boolean) => {
    const vpr = viewportRef.current!.getBoundingClientRect();
    const m: Marquee = { x0: e.clientX - vpr.left, y0: e.clientY - vpr.top, x1: e.clientX - vpr.left, y1: e.clientY - vpr.top, additive };
    const base = additive ? selected : [];
    let dragged = false;
    const hits = () => {
      const [l, r] = [Math.min(m.x0, m.x1), Math.max(m.x0, m.x1)];
      const [t, b] = [Math.min(m.y0, m.y1), Math.max(m.y0, m.y1)];
      return roots.filter((id) => {
        const el = viewportRef.current!.querySelector<HTMLElement>(`[data-paprika-id="${CSS.escape(id)}"]`);
        if (!el) return false;
        const rr = el.getBoundingClientRect();
        const x = rr.left - vpr.left;
        const y = rr.top - vpr.top;
        return x < r && x + rr.width > l && y < b && y + rr.height > t;
      });
    };
    const move = (ev: PointerEvent) => {
      m.x1 = ev.clientX - vpr.left;
      m.y1 = ev.clientY - vpr.top;
      if (!dragged && Math.hypot(m.x1 - m.x0, m.y1 - m.y0) < 3) return;
      dragged = true;
      setMarquee({ ...m });
      onSelect([...new Set([...base, ...hits()])]);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMarquee(null);
      if (!dragged && !additive) onSelect([]);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Duplo clique (fora da caneta) entra no grupo: seleciona o nó exato sob o cursor. */
  const onDeepSelect = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tool !== "select") return;
    if (pathEditRef.current && onPathDouble(e)) return;
    const target = (e.target as Element).closest<HTMLElement | SVGElement>("[data-paprika-id]");
    if (!target) return;
    const node = doc.nodes[target.dataset.paprikaId!];
    // Duplo clique num path já selecionado (ou fora de grupo) entra na edição ponto a ponto.
    if (node?.type === "path" && (selected.includes(node.id) || pickTarget(doc, node.id, selected) === node.id) && startPathEdit(node)) return;
    onSelect([target.dataset.paprikaId!]);
  };

  const single = selected.length === 1 ? doc.nodes[selected[0]!] : undefined;
  const resizable = !!single && single.type !== "group" && single.type !== "page" && !isInstance(single) && !copyOwner(doc, single);
  const onResizeDown = (e: RPointerEvent) => {
    e.stopPropagation();
    const node = single;
    if (!node || !box || !resizable || node.type === "page" || node.locked) return;
    const id = node.id;
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
      setPreview({ [id]: last });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPreview(null);
      apply([{ op: "update", id, props: last }], "redimensionar");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const rootNodes = roots.map((id) => doc.nodes[id]).filter((n): n is Node => !!n);
  const marqueeRect = marquee && {
    left: Math.min(marquee.x0, marquee.x1),
    top: Math.min(marquee.y0, marquee.y1),
    width: Math.abs(marquee.x1 - marquee.x0),
    height: Math.abs(marquee.y1 - marquee.y0),
  };
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
      onDoubleClick={pen ? onPenDouble : onDeepSelect}
      data-testid="viewport"
    >
      {renderer === "wasm" && <canvas ref={wasmLayer.canvasRef} className="wasm-layer" data-testid="wasm-layer" data-backend={wasmLayer.status.backend} />}
      <div ref={worldRef} className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        {rootNodes.map((n) => (
          <RenderNode key={n.id} doc={doc} node={n} preview={preview} touched={agentTouched} pen={pen} zoom={view.zoom} wasm={wasmLayer.active} edit={editView} />
        ))}
        {pen && pen.parentId === null && <PenOverlay pen={pen} zoom={view.zoom} />}
      </div>
      {frameLabels.map((l) => (
        <div
          key={l.id}
          className={`frame-label${selected.includes(l.id) ? " is-selected" : ""}`}
          style={{ left: l.left, top: l.top - 20 }}
          onPointerDown={(e) => {
            e.stopPropagation();
            const additive = e.shiftKey || e.metaKey || e.ctrlKey;
            onSelect(additive ? (selected.includes(l.id) ? selected.filter((s) => s !== l.id) : [...selected, l.id]) : [l.id]);
          }}
        >
          {l.name}
        </div>
      ))}
      {boxes.map((b) => (
        <div key={b.id} className="selection-item" style={{ left: b.left, top: b.top, width: b.width, height: b.height }} />
      ))}
      {box && (
        <div className={`selection${selected.length > 1 ? " is-multi" : ""}`} style={box} data-testid="selection" data-count={selected.length}>
          {resizable && !editView && <div className="handle" onPointerDown={onResizeDown} title="Redimensionar" />}
          <div className="dims">
            {Math.round(box.width / view.zoom)} × {Math.round(box.height / view.zoom)}
          </div>
        </div>
      )}
      {draftRect && <div className="draft" style={draftRect} />}
      {marqueeRect && <div className="marquee" style={marqueeRect} data-testid="marquee" />}
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
