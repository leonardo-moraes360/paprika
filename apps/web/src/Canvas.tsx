import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import {
  copyOwner,
  FORMAT,
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
  connectorAttrs,
  connectorLabelAttrs,
  routeConnectors,
  shapeAttrs,
  shapeDefaults,
  SHAPE_SVG_CSS,
  SHAPE_TEXT_CSS,
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
  type ConnectorEnd,
  type PathNode,
  type ShapeNode,
  type Subpath,
  type Document,
  type Node,
  type Op,
  type SceneNode,
} from "@paprika/core";
import { clientToPath, PathEditOverlay, pathHit, pathScale, type PathEditState } from "./PathEdit";
import { initialRendererMode, saveRendererMode, useWasmLayer, wasmAvailable, type RendererMode } from "./wasmLayer";
import { Button } from "./components/ui/button";
import { Hint } from "./components/ui/tooltip";
import { InlineName } from "./InlineName";
import { ConnectorLabelEditor } from "./ConnectorLabelEditor";
import { AgentCursors, type Box } from "./AgentCursors";
import { useT } from "./i18n";
import { cn } from "./lib/cn";
import { cx, ui } from "./ui";

/** Drawing tools show a crosshair over the canvas. */
const CROSSHAIR = new Set<string>(["frame", "rect", "ellipse", "text", "pen"]);

const zoomButton =
  "inline-flex h-6 w-6.5 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-ui-foreground hover:bg-ui-secondary disabled:cursor-default disabled:opacity-40 [&_svg]:size-3.5";

export type Tool = "select" | "frame" | "rect" | "ellipse" | "text" | "pen" | "shape" | "diamond" | "triangle" | "note" | "connector";

/** Ferramentas que criam uma forma de diagrama (nó shape), com o tipo de contorno. */
const SHAPE_TOOLS = { shape: "rect", diamond: "diamond", triangle: "triangle", note: "note" } as const;
type ShapeTool = keyof typeof SHAPE_TOOLS;
const isShapeTool = (t: Tool): t is ShapeTool => t in SHAPE_TOOLS;

/** Tamanho padrão ao soltar com um clique (sem arrastar). */
const DRAFT_DEFAULTS = { frame: [390, 844], rect: [120, 80], ellipse: [80, 80], text: [200, 32], shape: [160, 80], diamond: [160, 100], triangle: [160, 140], note: [160, 160] } as const;

type DraftTool = Exclude<Tool, "select" | "pen" | "connector">;
const isDraftTool = (t: Tool): t is DraftTool => t !== "select" && t !== "pen" && t !== "connector";

const GHOST_ID = "draft-ghost";
const GHOST_OPACITY = 0.45;

/** Seta em construção: ponta inicial e cursor, em coordenadas do viewport. */
interface LinkDraft {
  from: ConnectorEnd;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

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

/** How long a dropped preview waits for the server before giving way to what the server has. */
const PENDING_MS = 3000;

/** The document's current value of each prop the preview sets (`undefined` when the node is gone). */
function snapshot(doc: Document, pv: Preview): Preview {
  const out: Preview = {};
  for (const [id, props] of Object.entries(pv)) {
    const n = doc.nodes[id] as Record<string, unknown> | undefined;
    const cur: Preview[string] = {};
    for (const k of Object.keys(props) as (keyof Preview[string])[]) {
      const v = n?.[k];
      cur[k] = typeof v === "number" ? v : undefined;
    }
    out[id] = cur;
  }
  return out;
}

function samePreview(a: Preview, b: Preview): boolean {
  return Object.entries(b).every(([id, props]) => Object.entries(props).every(([k, v]) => a[id]?.[k as keyof Preview[string]] === v));
}

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
  /** Abre outra página (ex.: a de um agente na lista de presença). */
  onOpenPage?(id: string): void;
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
      {segs.length > 0 && <path d={serializePath(segs)} fill="none" stroke="var(--color-select)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
      {last && pen.cursor && (
        <line x1={last.x} y1={last.y} x2={pen.cursor.x} y2={pen.cursor.y} stroke="var(--color-select)" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      )}
      {pen.anchors.map((a, k) => (
        <g key={k}>
          {a.in && <line x1={a.in.x} y1={a.in.y} x2={a.x} y2={a.y} stroke="var(--color-select)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
          {a.out && <line x1={a.x} y1={a.y} x2={a.out.x} y2={a.out.y} stroke="var(--color-select)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
          {a.in && <circle cx={a.in.x} cy={a.in.y} r={r * 0.75} fill="var(--color-select)" />}
          {a.out && <circle cx={a.out.x} cy={a.out.y} r={r * 0.75} fill="var(--color-select)" />}
          <rect x={a.x - r} y={a.y - r} width={2 * r} height={2 * r} fill="#fff" stroke="var(--color-select)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </g>
      ))}
    </svg>
  );
}

/** Nó provisório com os mesmos padrões do create ao soltar a ferramenta. */
function draftGhostNode(tool: DraftTool, w: number, h: number): Node {
  const base = {
    id: GHOST_ID,
    name: "",
    parentId: null as string | null,
    x: 0,
    y: 0,
    width: w,
    height: h,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    radius: 0,
  };
  if (tool === "frame") return { ...base, type: "frame", fill: "#ffffff", children: [], clip: true };
  if (tool === "rect") return { ...base, type: "rect", fill: "#d9d4cf" };
  if (tool === "ellipse") return { ...base, type: "ellipse", fill: "#d9d4cf" };
  if (tool === "text") {
    return {
      ...base,
      type: "text",
      text: "Texto",
      color: "#111111",
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 1.4,
      letterSpacing: 0,
      textAlign: "left",
      height: "hug",
    };
  }
  const kind = SHAPE_TOOLS[tool];
  const defaults = shapeDefaults(kind);
  return {
    ...base,
    type: "shape",
    shape: kind,
    text: "",
    color: "#1e2336",
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: 16,
    fontWeight: 500,
    lineHeight: 1.3,
    textAlign: kind === "note" ? "left" : "center",
    ...defaults,
    width: w,
    height: h,
  } as ShapeNode;
}

/** Fantasma semi-transparente do nó real enquanto a ferramenta de criação arrasta (ou no clique). */
function DraftGhost({
  tool,
  draft,
  zoom,
  tokens,
  modes,
}: {
  tool: DraftTool;
  draft: Draft;
  zoom: number;
  tokens: Document["tokens"];
  modes: Document["modes"];
}) {
  let w = Math.abs(draft.x1 - draft.x0);
  let h = Math.abs(draft.y1 - draft.y0);
  const clicked = w < 4 && h < 4;
  if (clicked) [w, h] = DRAFT_DEFAULTS[tool];
  const x = clicked ? draft.x0 : Math.min(draft.x0, draft.x1);
  const y = clicked ? draft.y0 : Math.min(draft.y0, draft.y1);
  const node = draftGhostNode(tool, Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  const ghostDoc: Document = {
    format: FORMAT,
    id: "ghost",
    name: "",
    tokens,
    modes,
    rootIds: [GHOST_ID],
    nodes: { [GHOST_ID]: node },
  };
  const css = nodeStyle(ghostDoc, node, { asRoot: true }) as CSSProperties;
  const left = draft.originLeft + x * zoom;
  const top = draft.originTop + y * zoom;
  const shape = node.type === "shape" ? shapeAttrs(ghostDoc, node) : null;
  return (
    <div
      data-testid="draft-ghost"
      data-ghost-tool={tool}
      aria-hidden
      className="pointer-events-none absolute overflow-visible"
      style={{ left, top, width: Math.round(w) * zoom, height: Math.round(h) * zoom }}
    >
      <div className="pointer-events-none origin-top-left" style={{ width: Math.round(w), height: Math.round(h), transform: `scale(${zoom})` }}>
        <div style={{ ...css, position: "relative", left: 0, top: 0, opacity: GHOST_OPACITY }}>
          {node.type === "text" ? node.text : null}
          {shape && node.type === "shape" ? (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" width={shape.svg.width} height={shape.svg.height} style={SHAPE_SVG_CSS as CSSProperties}>
                <path d={shape.path.d} fill={shape.path.fill} stroke={shape.path.stroke} strokeWidth={shape.path.strokeWidth} strokeLinejoin="round" />
                {shape.fold && <path d={shape.fold.d} fill={shape.fold.fill} />}
              </svg>
              <div style={SHAPE_TEXT_CSS as CSSProperties}>{node.text}</div>
            </>
          ) : null}
        </div>
      </div>
    </div>
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
  /** Forma com o texto em edição no próprio canvas. */
  textEdit?: { id: string; onCommit(text: string): void; onDone(): void } | null;
}

function RenderNode({ doc, node, preview, touched, pen, zoom, wasm, edit, textEdit }: RenderProps) {
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
    // "agent-flash" stays as a hook for the E2E suite.
    className: touched.has(node.id) ? "agent-flash outline-2! outline-solid! outline-accent! outline-offset-1 animate-flash" : undefined,
    style: css,
  };
  switch (node.type) {
    case "frame":
    case "group":
      return (
        <div {...props}>
          {node.children.map((c) => {
            const child = doc.nodes[c];
            return child ? <RenderNode key={c} doc={doc} node={child} preview={preview} touched={touched} pen={pen} zoom={zoom} wasm={wasm} edit={edit} textEdit={textEdit} /> : null;
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
    case "shape": {
      const a = shapeAttrs(doc, node);
      const editing = textEdit?.id === node.id ? textEdit : null;
      return (
        <div {...props}>
          <svg xmlns="http://www.w3.org/2000/svg" width={a.svg.width} height={a.svg.height} style={SHAPE_SVG_CSS as CSSProperties}>
            <path d={a.path.d} fill={a.path.fill} stroke={a.path.stroke} strokeWidth={a.path.strokeWidth} strokeLinejoin="round" />
            {a.fold && <path d={a.fold.d} fill={a.fold.fill} />}
          </svg>
          {editing ? (
            <ShapeTextEditor text={node.text} onCommit={editing.onCommit} onDone={editing.onDone} />
          ) : (
            <div style={SHAPE_TEXT_CSS as CSSProperties}>{node.text}</div>
          )}
        </div>
      );
    }
    case "connector": {
      const a = connectorAttrs(doc, node);
      const label = connectorLabelAttrs(doc, node);
      // O <svg> não pega clique: só o traço (e uma faixa invisível mais larga em volta dele).
      const editing = textEdit?.id === node.id ? textEdit : null;
      return (
        <svg {...props} style={{ ...css, pointerEvents: "none", ...(editing && { overflow: "visible" }) }} xmlns="http://www.w3.org/2000/svg" width={node.width} height={node.height}>
          <path d={a.d} fill="none" stroke="transparent" strokeWidth={Math.max(12, a.strokeWidth + 8)} style={{ pointerEvents: "stroke" }} data-connector-hit="" />
          <path
            d={a.d}
            fill="none"
            stroke={a.stroke}
            strokeWidth={a.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={a.strokeDasharray}
            style={{ pointerEvents: "visibleStroke" }}
          />
          {label && !editing && (
            <text {...label} style={{ pointerEvents: "none", userSelect: "none" }} data-connector-label="">
              {node.label}
            </text>
          )}
          {editing && <ConnectorLabelEditor doc={doc} node={node} onCommit={editing.onCommit} onDone={editing.onDone} />}
        </svg>
      );
    }
    default:
      return <div {...props} />;
  }
}

/** Texto de uma forma editado no lugar: Enter quebra linha, Esc ou Ctrl+Enter (ou sair do campo) confirma. */
function ShapeTextEditor({ text, onCommit, onDone }: { text: string; onCommit(text: string): void; onDone(): void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    const value = ref.current?.value ?? text;
    if (value !== text) onCommit(value);
    onDone();
  };
  return (
    <textarea
      ref={ref}
      // Edited in place: inherits the shape's typography.
      className="relative m-0 field-sizing-content w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-inherit outline-1 outline-select outline-dashed [font:inherit] [letter-spacing:inherit] [line-height:inherit] [text-align:inherit]"
      data-testid="shape-text-editor"
      aria-label="Texto da forma"
      defaultValue={text}
      rows={Math.max(1, text.split("\n").length)}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          finish();
        }
      }}
    />
  );
}

export function Canvas({ doc, selected, onSelect, pageId, tool, onToolDone, apply, agentTouched, onOpenPage, onError }: Props) {
  const m = useT();
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 40, y: 40, zoom: 1 });
  const [renderer, setRenderer] = useState<RendererMode>(initialRendererMode);
  const [preview, setPreview] = useState<Preview | null>(null);
  const previewRef = useRef<Preview | null>(null);
  previewRef.current = preview;
  /**
   * After a drop the preview stays on screen until the server echoes the change (or gives up):
   * clearing it right away showed the old position/size for a frame or two (the "flick").
   */
  const pending = useRef<{ base: Preview; timer: ReturnType<typeof setTimeout> } | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  /** A new drag takes over: its own preview starts from where the pending one left the nodes. */
  const takeOverPreview = useCallback(() => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
  }, []);
  const settle = useCallback(() => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
    setPreview(null);
  }, []);
  /** Ends a drag: keeps `last` on screen and sends the ops; the next document that touches those props clears it. */
  const commitPreview = useCallback(
    (last: Preview, ops: Op[], label: string) => {
      if (pending.current) clearTimeout(pending.current.timer);
      const base = snapshot(docRef.current, last);
      if (samePreview(base, last)) {
        pending.current = null;
        setPreview(null);
      } else {
        pending.current = { base, timer: setTimeout(settle, PENDING_MS) };
        setPreview(last);
      }
      apply(ops, label);
    },
    [apply, settle],
  );
  useEffect(() => {
    if (pending.current && !samePreview(snapshot(doc, pending.current.base), pending.current.base)) settle();
  }, [doc, settle]);
  useEffect(() => () => clearTimeout(pending.current?.timer), []);
  const wasmLayer = useWasmLayer({ mode: renderer, doc, view, viewportRef, worldRef, layoutKey: preview, pageId });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [link, setLink] = useState<LinkDraft | null>(null);
  /** Forma com o texto em edição (duplo clique, ou logo depois de criada). */
  const [textEditId, setTextEditId] = useState<string | null>(null);
  // Durante um arraste, os conectores seguem as posições provisórias das formas.
  const shown = useMemo(() => {
    if (!preview || !Object.values(doc.nodes).some((n) => n.type === "connector")) return doc;
    const nodes = { ...doc.nodes };
    for (const [id, pv] of Object.entries(preview)) if (nodes[id]) nodes[id] = { ...nodes[id], ...pv } as Node;
    for (const n of Object.values(nodes)) if (n.type === "connector") nodes[n.id] = { ...n };
    const next = { ...doc, nodes };
    try {
      routeConnectors(next);
      return next;
    } catch {
      return doc;
    }
  }, [doc, preview]);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  /** Caixa que envolve a seleção, e a de cada nó quando há mais de um. */
  const [box, setBox] = useState<Rect | null>(null);
  const [boxes, setBoxes] = useState<(Rect & { id: string })[]>([]);
  const roots = pageRoots(doc, pageId);
  const [renaming, setRenaming] = useState<string | null>(null);
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

  // Centraliza uma caixa do mundo (ex.: o cursor de um agente), afastando o zoom só se ela não couber.
  const focusBox = useCallback((b: Box) => {
    const vp = viewportRef.current?.getBoundingClientRect();
    if (!vp) return;
    setView((v) => {
      const z = Math.max(0.1, Math.min(v.zoom, (vp.width - 120) / Math.max(b.w, 1), (vp.height - 120) / Math.max(b.h, 1)));
      return { zoom: z, x: vp.width / 2 - (b.x + b.w / 2) * z, y: vp.height / 2 - (b.y + b.h / 2) * z };
    });
  }, []);

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
    // A control reached by keyboard (Tab shows its focus ring) keeps Enter/Space to activate it (WCAG 2.1.1).
    // After a mouse click the control has focus without :focus-visible, so the keys still pan.
    const keyboardFocus = (t: EventTarget | null) => t instanceof HTMLElement && t !== document.body && t.matches(":focus-visible");
    const down = (e: KeyboardEvent) => {
      if (!isPanKey(e) || typing(e.target) || keyboardFocus(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
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

  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable);
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || (e.key !== "PageUp" && e.key !== "PageDown") || e.altKey) return;
      const nodes = selected
        .map((id) => doc.nodes[id])
        .filter((n): n is SceneNode => !!isScene(n) && !n.locked && !copyOwner(doc, n));
      if (!nodes.length) return;
      e.preventDefault();
      const mod = e.metaKey || e.ctrlKey;
      const index = e.key === "PageUp" ? (mod ? "front" : "forward") : mod ? "back" : "backward";
      const label = { front: "trazer para frente", forward: "avançar", back: "enviar para fundo", backward: "recuar" }[index];
      apply(
        nodes.map((n) => ({ op: "update", id: n.id, props: { index } })),
        label,
      );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [apply, doc, selected]);

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

    if (tool === "connector") return startLink(e);
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
        const kind = tool as DraftTool;
        if (clicked) [w, h] = DRAFT_DEFAULTS[kind];
        const names = { frame: "Frame", rect: "Retângulo", ellipse: "Elipse", text: "Texto", shape: "Caixa", diamond: "Decisão", triangle: "Triângulo", note: "Nota" } as const;
        const count = isShapeTool(kind)
          ? Object.values(doc.nodes).filter((n) => n.type === "shape" && n.shape === SHAPE_TOOLS[kind]).length + 1
          : Object.values(doc.nodes).filter((n) => n.type === tool).length + 1;
        const node: Record<string, unknown> = { type: kind, name: `${names[kind]} ${count}`, x, y, width: w, height: h };
        if (tool === "frame") node.fill = "#ffffff";
        if (tool === "rect" || tool === "ellipse") node.fill = "#d9d4cf";
        if (tool === "text") Object.assign(node, { text: "Texto", height: "hug" });
        // Formas de diagrama: o resto (preenchimento, borda, fonte) vem dos padrões de cada tipo.
        if (isShapeTool(kind)) Object.assign(node, { type: "shape", shape: SHAPE_TOOLS[kind] });
        const id = newId();
        apply([{ op: "create", node: { ...node, id } as never, parentId: d.parentId }], `criar ${names[kind].toLowerCase()}`);
        onSelect([id]);
        onToolDone();
        if (isShapeTool(kind)) setTextEditId(id);
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
    const shownAt = previewRef.current ?? {};
    const movable = group
      .map((g) => doc.nodes[g])
      .filter((n): n is SceneNode => isScene(n) && n.type !== "connector" && !n.locked && isAbsolute(doc, n) && !copyOwner(doc, n))
      // A node dropped a moment ago may still be waiting for the server: drag it from where it is shown.
      .map((n) => ({ ...n, x: shownAt[n.id]?.x ?? n.x, y: shownAt[n.id]?.y ?? n.y }) as SceneNode);
    if (!movable.length) return;
    takeOverPreview();
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
      if (!moved) return;
      commitPreview(last, Object.entries(last).map(([nid, props]) => ({ op: "update", id: nid, props })), movable.length > 1 ? `mover ${movable.length} nós` : "mover");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Nó sob o ponto em que uma seta pode se prender (não conectores, não páginas). */
  const attachableAt = (clientX: number, clientY: number): string | null => {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      const host = el.closest<HTMLElement | SVGElement>("[data-paprika-id]");
      if (!host || !viewportRef.current?.contains(host)) continue;
      const n = doc.nodes[host.dataset.paprikaId!];
      if (n && n.type !== "connector" && n.type !== "page") return n.id;
    }
    return null;
  };

  /** Ferramenta seta: arrastar de um nó (ou de um ponto livre) até outro; a seta fica presa às formas. */
  const startLink = (e: RPointerEvent) => {
    const vpr = viewportRef.current!.getBoundingClientRect();
    const end = (cx: number, cy: number): ConnectorEnd => {
      const id = attachableAt(cx, cy);
      if (id) return { nodeId: id };
      const p = toWorld(cx, cy);
      return { x: Math.round(p.x), y: Math.round(p.y) };
    };
    const l: LinkDraft = { from: end(e.clientX, e.clientY), x0: e.clientX - vpr.left, y0: e.clientY - vpr.top, x1: e.clientX - vpr.left, y1: e.clientY - vpr.top };
    setLink(l);
    const move = (ev: PointerEvent) => {
      l.x1 = ev.clientX - vpr.left;
      l.y1 = ev.clientY - vpr.top;
      setLink({ ...l });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setLink(null);
      if (Math.hypot(l.x1 - l.x0, l.y1 - l.y0) < 6) return; // clique sem arrastar: nada a ligar
      const to = end(ev.clientX, ev.clientY);
      if (to.nodeId && to.nodeId === l.from.nodeId) return;
      const id = newId();
      const count = Object.values(doc.nodes).filter((n) => n.type === "connector").length + 1;
      apply([{ op: "create", node: { type: "connector", id, name: `Seta ${count}`, from: l.from, to, route: "elbow" }, parentId: pageId }], "criar seta");
      onSelect([id]);
      onToolDone();
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
    // Duplo clique numa forma de diagrama edita o texto dela.
    if (node?.type === "shape" && !node.locked && !copyOwner(doc, node) && (selected.includes(node.id) || pickTarget(doc, node.id, selected) === node.id)) {
      onSelect([node.id]);
      setTextEditId(node.id);
      return;
    }
    if (node?.type === "connector" && !node.locked && !copyOwner(doc, node) && (selected.includes(node.id) || pickTarget(doc, node.id, selected) === node.id)) {
      onSelect([node.id]);
      setTextEditId(node.id);
      return;
    }
    onSelect([target.dataset.paprikaId!]);
  };

  const single = selected.length === 1 ? doc.nodes[selected[0]!] : undefined;
  const resizable = !!single && single.type !== "group" && single.type !== "page" && single.type !== "connector" && !isInstance(single) && !copyOwner(doc, single);
  const [resizeLock, setResizeLock] = useState<"ratio" | "square" | null>(null);
  const onResizeDown = (corner: "nw" | "ne" | "sw" | "se") => (e: RPointerEvent) => {
    e.stopPropagation();
    const node = single;
    if (!node || !box || !resizable || node.type === "page" || node.locked || !isScene(node)) return;
    const id = node.id;
    const sx = e.clientX;
    const sy = e.clientY;
    takeOverPreview();
    const shownAt = previewRef.current?.[id];
    const x0 = shownAt?.x ?? node.x;
    const y0 = shownAt?.y ?? node.y;
    const w0 = shownAt?.width ?? (typeof node.width === "number" ? node.width : box.width / view.zoom);
    const h0 = shownAt?.height ?? (typeof node.height === "number" ? node.height : box.height / view.zoom);
    const ratio0 = w0 / Math.max(h0, 1e-6);
    const absolute = isAbsolute(doc, node);
    let last: { x?: number; y?: number; width: number; height: number } = {
      width: Math.round(w0),
      height: Math.round(h0),
      ...(absolute ? { x: Math.round(x0), y: Math.round(y0) } : {}),
    };
    const held = { shift: e.shiftKey, alt: e.altKey };
    let lastClient = { x: e.clientX, y: e.clientY };
    const applyAt = (clientX: number, clientY: number) => {
      const dx = (clientX - sx) / view.zoom;
      const dy = (clientY - sy) / view.zoom;
      let left = x0;
      let top = y0;
      let right = x0 + w0;
      let bottom = y0 + h0;
      if (corner === "nw" || corner === "sw") left = x0 + dx;
      if (corner === "ne" || corner === "se") right = x0 + w0 + dx;
      if (corner === "nw" || corner === "ne") top = y0 + dy;
      if (corner === "sw" || corner === "se") bottom = y0 + h0 + dy;
      if (right - left < 1) {
        if (corner === "nw" || corner === "sw") left = right - 1;
        else right = left + 1;
      }
      if (bottom - top < 1) {
        if (corner === "nw" || corner === "ne") top = bottom - 1;
        else bottom = top + 1;
      }
      const lock: "ratio" | "square" | null = held.shift ? (held.alt ? "square" : "ratio") : null;
      setResizeLock(lock);
      if (lock) {
        let width = right - left;
        let height = bottom - top;
        const dw = Math.abs(width - w0);
        const dh = Math.abs(height - h0);
        if (lock === "square") {
          const side = Math.max(1, dw >= dh ? width : height);
          width = side;
          height = side;
        } else if (dw >= dh) {
          height = Math.max(1, width / ratio0);
        } else {
          width = Math.max(1, height * ratio0);
        }
        if (corner === "nw" || corner === "sw") left = right - width;
        else right = left + width;
        if (corner === "nw" || corner === "ne") top = bottom - height;
        else bottom = top + height;
      }
      last = {
        width: Math.round(right - left),
        height: Math.round(bottom - top),
        ...(absolute ? { x: Math.round(left), y: Math.round(top) } : {}),
      };
      setPreview({ [id]: last });
    };
    const move = (ev: PointerEvent) => {
      if (ev.shiftKey) held.shift = true;
      if (ev.altKey) held.alt = true;
      lastClient = { x: ev.clientX, y: ev.clientY };
      applyAt(ev.clientX, ev.clientY);
    };
    const onKey = (ev: KeyboardEvent) => {
      held.shift = ev.shiftKey || ev.getModifierState("Shift");
      held.alt = ev.altKey || ev.getModifierState("Alt");
      applyAt(lastClient.x, lastClient.y);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      setResizeLock(null);
      commitPreview({ [id]: last }, [{ op: "update", id, props: last }], "redimensionar");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
  };

  const editedShape = textEditId ? doc.nodes[textEditId] : undefined;
  const textEdit =
    editedShape?.type === "shape"
      ? {
          id: editedShape.id,
          onCommit: (text: string) => apply([{ op: "update", id: editedShape.id, props: { text } }], "editar texto"),
          onDone: () => setTextEditId(null),
        }
      : editedShape?.type === "connector"
        ? {
            id: editedShape.id,
            onCommit: (text: string) => apply([{ op: "update", id: editedShape.id, props: { label: text.trim() ? text.trim() : null } }], "editar rótulo"),
            onDone: () => setTextEditId(null),
          }
        : null;

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
      className={cx(
        // "viewport" and "is-pan-*" stay as hooks for the E2E suite.
        "viewport absolute inset-0 touch-none overflow-hidden bg-canvas bg-[radial-gradient(rgba(0,0,0,0.09)_1px,transparent_1px)] bg-size-[20px_20px] scheme-light",
        CROSSHAIR.has(tool) && "cursor-crosshair",
        // Pan: open hand while the key is held, closed hand while dragging; wins over nodes and tools.
        pan === "ready" && "is-pan-ready cursor-grab! **:cursor-grab!",
        pan === "panning" && "is-panning cursor-grabbing! **:cursor-grabbing!",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={pen ? onPenHover : undefined}
      onDoubleClick={pen ? onPenDouble : onDeepSelect}
      data-testid="viewport"
    >
      {renderer === "wasm" && <canvas ref={wasmLayer.canvasRef} className="pointer-events-none absolute inset-0 size-full" data-testid="wasm-layer" data-backend={wasmLayer.status.backend} />}
      <div ref={worldRef} className="world absolute top-0 left-0 origin-top-left [&_[data-paprika-id]]:select-none" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        {rootNodes.map((n) => (
          <RenderNode
            key={n.id}
            doc={shown}
            node={shown.nodes[n.id] ?? n}
            preview={preview}
            touched={agentTouched}
            pen={pen}
            zoom={view.zoom}
            wasm={wasmLayer.active}
            edit={editView}
            textEdit={textEdit}
          />
        ))}
        {pen && pen.parentId === null && <PenOverlay pen={pen} zoom={view.zoom} />}
      </div>
      <AgentCursors doc={doc} view={view} viewportRef={viewportRef} layoutKey={preview} pageId={pageId} onOpenPage={onOpenPage} onFocus={focusBox} />
      {frameLabels.map((l) => (
        <Hint key={l.id} label={renaming === l.id ? undefined : "Duplo clique para renomear"}>
          <div
            className={cx("absolute cursor-default text-xs whitespace-nowrap", selected.includes(l.id) ? "text-select" : "text-label")}
            style={{ left: l.left, top: l.top - 20 }}
            data-frame-label={l.id}
            onPointerDown={(e) => {
              e.stopPropagation();
              const additive = e.shiftKey || e.metaKey || e.ctrlKey;
              onSelect(additive ? (selected.includes(l.id) ? selected.filter((s) => s !== l.id) : [...selected, l.id]) : [l.id]);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setRenaming(l.id);
            }}
          >
            {renaming === l.id ? (
              <InlineName
                className={cx(ui.renameInput, "pointer-events-auto h-[18px] w-[180px]")}
                label="Nome do frame"
                value={doc.nodes[l.id]?.name ?? ""}
                onCommit={(name) => apply([{ op: "update", id: l.id, props: { name } }], "renomear frame")}
                onDone={() => setRenaming(null)}
              />
            ) : (
              l.name
            )}
          </div>
        </Hint>
      ))}
      {boxes.map((b) => (
        <div key={b.id} className="pointer-events-none absolute border border-select opacity-70" style={{ left: b.left, top: b.top, width: b.width, height: b.height }} />
      ))}
      {box && (
        <div className={cx("pointer-events-none absolute border-[1.5px] border-select", selected.length > 1 && "border-dashed")} style={box} data-testid="selection" data-count={selected.length}>
          {resizable && !editView && (
            <>
              <Hint label="Redimensionar canto superior esquerdo">
                <div className="pointer-events-auto absolute -top-1.25 -left-1.25 size-[9px] cursor-nwse-resize border-[1.5px] border-select bg-white" data-resize="nw" onPointerDown={onResizeDown("nw")} />
              </Hint>
              <Hint label="Redimensionar canto superior direito">
                <div className="pointer-events-auto absolute -top-1.25 -right-1.25 size-[9px] cursor-nesw-resize border-[1.5px] border-select bg-white" data-resize="ne" onPointerDown={onResizeDown("ne")} />
              </Hint>
              <Hint label="Redimensionar canto inferior esquerdo">
                <div className="pointer-events-auto absolute -bottom-1.25 -left-1.25 size-[9px] cursor-nesw-resize border-[1.5px] border-select bg-white" data-resize="sw" onPointerDown={onResizeDown("sw")} />
              </Hint>
              <Hint label="Redimensionar canto inferior direito">
                <div className="pointer-events-auto absolute -right-1.25 -bottom-1.25 size-[9px] cursor-nwse-resize border-[1.5px] border-select bg-white" data-resize="se" onPointerDown={onResizeDown("se")} />
              </Hint>
            </>
          )}
          <div className="absolute top-[calc(100%+6px)] left-1/2 -translate-x-1/2 rounded-[3px] bg-select px-1.25 py-px text-2xs font-semibold whitespace-nowrap text-select-ink">
            {Math.round(box.width / view.zoom)} × {Math.round(box.height / view.zoom)}
          </div>
          {resizeLock && (
            <div
              className="absolute top-[calc(100%+28px)] left-1/2 -translate-x-1/2 rounded-[3px] bg-select px-1.25 py-px text-2xs font-semibold whitespace-nowrap text-select-ink"
              data-testid="resize-lock-hint"
              data-lock={resizeLock}
            >
              {resizeLock === "square" ? m.ratioLockAlt : m.ratioLock}
            </div>
          )}
        </div>
      )}
      {draft && isDraftTool(tool) && (
        <>
          {draftRect && Math.abs(draft.x1 - draft.x0) >= 4 && Math.abs(draft.y1 - draft.y0) >= 4 && (
            <div className="pointer-events-none absolute border border-dashed border-select bg-select/10" style={draftRect} aria-hidden />
          )}
          <DraftGhost tool={tool} draft={draft} zoom={view.zoom} tokens={doc.tokens} modes={doc.modes} />
        </>
      )}
      {link && (
        <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" data-testid="link-draft">
          <line className="stroke-select stroke-2 [stroke-dasharray:5_4]" x1={link.x0} y1={link.y0} x2={link.x1} y2={link.y1} />
          <circle className="fill-select" cx={link.x1} cy={link.y1} r={4} />
        </svg>
      )}
      {marqueeRect && <div className="pointer-events-none absolute border border-select bg-select/8" style={marqueeRect} data-testid="marquee" />}
      <div className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-lg border border-ui-border bg-ui-card p-0.5" onPointerDown={(e) => e.stopPropagation()}>
        <Hint label={m.zoomOut}>
          <Button variant="ghost" className={zoomButton} onClick={() => setView((v) => ({ ...v, zoom: Math.max(0.1, v.zoom / 1.25) }))} aria-label={m.zoomOut}>
            <Minus size={14} aria-hidden />
          </Button>
        </Hint>
        <span className="min-w-11 text-center text-ui-muted-foreground">{Math.round(view.zoom * 100)}%</span>
        <Hint label={m.zoomIn}>
          <Button variant="ghost" className={zoomButton} onClick={() => setView((v) => ({ ...v, zoom: Math.min(8, v.zoom * 1.25) }))} aria-label={m.zoomIn}>
            <Plus size={14} aria-hidden />
          </Button>
        </Hint>
        <Hint label={m.zoomFitHint}>
          <Button variant="ghost" className={zoomButton} onClick={fit} aria-label={m.zoomFit}>
            <Maximize size={14} aria-hidden />
          </Button>
        </Hint>
        <Hint
          label={
            renderer === "wasm"
              ? `Renderizador WASM (${wasmLayer.status.backend})${wasmLayer.status.detail ? `: ${wasmLayer.status.detail}` : ""}. Clique para voltar ao DOM.`
              : wasmAvailable
                ? "Renderizador DOM. Clique para desenhar formas com WASM (WebGPU, ou CPU sem GPU)."
                : "Renderizador WASM não compilado (pnpm build com Rust instalado)."
          }
        >
          <Button
            variant="ghost"
            className={cn(
              "h-6 cursor-pointer rounded-md border-0 bg-transparent px-1.5 text-xs font-semibold tracking-[0.02em] hover:bg-ui-secondary disabled:cursor-not-allowed disabled:opacity-40",
              renderer === "wasm" ? "text-accent" : "text-ui-muted-foreground",
            )}
            data-testid="renderer-toggle"
            data-backend={renderer === "wasm" ? wasmLayer.status.backend : "dom"}
            disabled={!wasmAvailable && renderer === "dom"}
            aria-pressed={renderer === "wasm"}
            onClick={() => {
              const next = renderer === "wasm" ? "dom" : "wasm";
              saveRendererMode(next);
              setRenderer(next);
            }}
          >
            {renderer === "dom" ? "DOM" : wasmLayer.status.backend === "webgpu" ? "GPU" : wasmLayer.status.backend === "cpu" ? "CPU" : "WASM"}
          </Button>
        </Hint>
      </div>
    </div>
  );
}
