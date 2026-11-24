import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as RDragEvent, type PointerEvent as RPointerEvent } from "react";
import { Bold, Italic, Link2, Maximize, Minus, Plus } from "lucide-react";
import {
  copyOwner,
  FORMAT,
  importHTML,
  importSVG,
  isContainer,
  isInstance,
  ignoresLayout,
  modeOf,
  resolveLength,
  anchorsToPath,
  canvasBounds,
  isScene,
  layout,
  newId,
  pageRoots,
  nodeGradient,
  resolveAsset,
  nodeStyle,
  textPieces,
  textRunCSS,
  type TextRun,
  parsePath,
  pathAttrs,
  pathBounds,
  connectorAttrs,
  connectorCurveHandle,
  connectorLabelAttrs,
  originOf,
  round4,
  routeConnectors,
  type ConnectorNode,
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
  type Layout,
  type Node,
  type Op,
  type SceneNode,
} from "@paprika/core";
import { clientToPath, PathEditOverlay, pathHit, pathScale, type PathEditState } from "./PathEdit";
import { childrenSelection, cycleSibling, layersUnderPoint } from "./hierarchy";
import { LayerMenu } from "./LayerMenu";
import { initialRendererMode, saveRendererMode, useWasmLayer, wasmAvailable, type RendererMode } from "./wasmLayer";
import { Button } from "./components/ui/button";
import { GradientHandles } from "./GradientHandles";
import { Hint } from "./components/ui/tooltip";
import { InlineName } from "./InlineName";
import { ConnectorLabelEditor } from "./ConnectorLabelEditor";
import { AgentCursors, type Box } from "./AgentCursors";
import { BuildCode } from "./BuildCode";
import { PinLayer } from "./Pins";
import { useT } from "./i18n";
import { cn } from "./lib/cn";
import { cx, ui } from "./ui";
import { boxCorner, knobFromTop, quadHitsRect, resizeBox, type Corner, type Pt } from "./selectionGeom";
import { gapAfterDrag, paddingAfterDrag, padTuple, sameLayout, spacingHandles, worldDeltaToLocal, type SpacingHandleGeom } from "./spacingHandles";

/** Drawing tools show a crosshair over the canvas. */
const CROSSHAIR = new Set<string>(["frame", "rect", "ellipse", "text", "pen"]);

const zoomButton =
  "inline-flex h-6 w-6.5 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-ui-foreground hover:bg-ui-secondary disabled:cursor-default disabled:opacity-40 [&_svg]:size-3.5";

export type Tool = "select" | "frame" | "rect" | "ellipse" | "text" | "pen" | "shape" | "diamond" | "triangle" | "note" | "connector" | "pin";

/** Ferramentas que criam uma forma de diagrama (nó shape), com o tipo de contorno. */
const SHAPE_TOOLS = { shape: "rect", diamond: "diamond", triangle: "triangle", note: "note" } as const;
type ShapeTool = keyof typeof SHAPE_TOOLS;
const isShapeTool = (t: Tool): t is ShapeTool => t in SHAPE_TOOLS;

/** Tamanho padrão ao soltar com um clique (sem arrastar). */
const DRAFT_DEFAULTS = { frame: [390, 844], rect: [120, 80], ellipse: [80, 80], text: [200, 32], shape: [160, 80], diamond: [160, 100], triangle: [160, 140], note: [160, 160] } as const;

type DraftTool = Exclude<Tool, "select" | "pen" | "connector" | "pin">;
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
type Preview = Record<string, { x?: number; y?: number; width?: number; height?: number; rotation?: number; control?: { x: number; y: number }; layout?: Layout }>;

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
      if (k === "control") {
        if (v && typeof v === "object" && "x" in (v as object) && "y" in (v as object)) {
          const c = v as { x: number; y: number };
          cur.control = { x: c.x, y: c.y };
        }
      } else if (k === "layout") {
        const layout = n?.layout;
        if (layout && typeof layout === "object") cur.layout = layout as Layout;
      } else if (typeof v === "number") {
        cur[k] = v;
      }
    }
    out[id] = cur;
  }
  return out;
}

function samePreview(a: Preview, b: Preview): boolean {
  return Object.entries(b).every(([id, props]) =>
    Object.entries(props).every(([k, v]) => {
      if (k === "control") {
        const ac = a[id]?.control;
        const bc = v as { x: number; y: number } | undefined;
        return !!ac && !!bc && ac.x === bc.x && ac.y === bc.y;
      }
      if (k === "layout") return sameLayout(a[id]?.layout, v as Layout | undefined);
      return a[id]?.[k as "x" | "y" | "width" | "height" | "rotation"] === v;
    }),
  );
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
  if (n.type === "page") return false;
  if ("layoutPositioning" in n && n.layoutPositioning === "absolute") return true;
  const p = n.parentId ? doc.nodes[n.parentId] : undefined;
  return !p || p.type !== "frame" || !p.layout || p.layout.mode === "none";
};

const isFlowFrame = (n: Node | undefined): boolean => n?.type === "frame" && !!n.layout && n.layout.mode !== "none";

const isUnder = (doc: Document, id: string, ancestor: string): boolean => {
  for (let p = doc.nodes[id]?.parentId; p; p = doc.nodes[p]?.parentId ?? null) if (p === ancestor) return true;
  return false;
};

const dropAccepts = (doc: Document, parentId: string | null, dragged: ReadonlySet<string>): boolean => {
  if (parentId === null) return true;
  if (dragged.has(parentId)) return false;
  for (const id of dragged) if (isUnder(doc, parentId, id)) return false;
  const n = doc.nodes[parentId];
  if (!isContainer(n) || n.type === "page") return false;
  if (isInstance(n) || copyOwner(doc, n)) return false;
  return true;
};

type DropSpot = {
  parentId: string | null;
  index: number | undefined;
  highlightId: string | null;
  flow: boolean;
};

/** IMAGE_MIME for OS file drops (PAP-B-019 path via data URI create). */
const IMAGE_FILE = /^image\/(png|jpe?g|webp|avif|gif)$/i;

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
                {shape.svgInner ? <g dangerouslySetInnerHTML={{ __html: shape.svgInner }} /> : null}
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
  /** Forma, conector ou texto em edição no próprio canvas. */
  textEdit?: { id: string; onCommit(text: string): void; onCommitRich?(text: string, runs: TextRun[] | null): void; onDone(): void } | null;
  /** Nó em arraste: sem hit-test, para o alvo sob o cursor aparecer. */
  dragging?: boolean;
  dragIds?: ReadonlySet<string>;
}

function RenderNode({ doc, node, preview, touched, pen, zoom, wasm, edit, textEdit, dragging, dragIds }: RenderProps) {
  const css = nodeStyle(doc, node) as CSSProperties;
  const wasmPaints = wasm && wasmPaintable(doc, node);
  if (wasmPaints) {
    // Same box (border width stays, so auto layout does not move), no visible paint.
    if (css.background) css.background = "transparent";
    if (css.border) css.borderColor = "transparent";
    delete css.boxShadow;
    delete css.filter;
  }
  if (dragging) css.pointerEvents = "none";
  const pv = preview?.[node.id];
  if (pv) {
    if (pv.x !== undefined) css.left = pv.x;
    if (pv.y !== undefined) css.top = pv.y;
    if (pv.width !== undefined) css.width = pv.width;
    if (pv.height !== undefined) css.height = pv.height;
    if (pv.rotation !== undefined) css.transform = pv.rotation ? `rotate(${pv.rotation}deg)` : "none";
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
            return child ? (
              <RenderNode
                key={c}
                doc={doc}
                node={child}
                preview={preview}
                touched={touched}
                pen={pen}
                zoom={zoom}
                wasm={wasm}
                edit={edit}
                textEdit={textEdit}
                dragging={!!dragIds?.has(c)}
                dragIds={dragIds}
              />
            ) : null;
          })}
          {pen && pen.parentId === node.id && <PenOverlay pen={pen} zoom={zoom} />}
        </div>
      );
    case "text": {
      const editing =
        textEdit?.id === node.id && textEdit.onCommitRich
          ? { onCommit: textEdit.onCommitRich, onDone: textEdit.onDone }
          : null;
      if (editing) props.style = { ...css, overflow: "visible" };
      return (
        <div {...props}>
          {editing ? (
            <TextRunEditor doc={doc} node={node} onCommit={editing.onCommit} onDone={editing.onDone} />
          ) : node.runs?.length ? (
            <TextRuns doc={doc} node={node} />
          ) : (
            node.text
          )}
        </div>
      );
    }
    case "image":
      return <img {...props} src={resolveAsset(doc, node.src)} alt={node.decorative ? "" : node.alt} aria-hidden={node.decorative || undefined} draggable={false} />;
    case "path": {
      const editing = edit?.id === node.id ? edit : null;
      if (wasmPaints && !editing) return <div {...props} />;
      const a = pathAttrs(doc, node);
      // Em edição, as alças podem sair da caixa do nó.
      if (editing) props.style = { ...css, overflow: "visible" };
      return (
        <svg {...props} {...a.svg}>
          {a.svgInner ? <g dangerouslySetInnerHTML={{ __html: a.svgInner }} /> : null}
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
            {a.svgInner ? <g dangerouslySetInnerHTML={{ __html: a.svgInner }} /> : null}
            <path
              d={a.path.d}
              fill={a.path.fill}
              stroke={a.path.stroke}
              strokeWidth={a.path.strokeWidth}
              strokeLinejoin="round"
              strokeDasharray={a.path.strokeDasharray}
            />
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
          <path d={a.d} fill="none" stroke="transparent" strokeWidth={Math.max(12, (typeof a.strokeWidth === "number" ? a.strokeWidth : 0) + 8)} style={{ pointerEvents: "stroke" }} data-connector-hit="" />
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

function TextRuns({ doc, node }: { doc: Document; node: Extract<Node, { type: "text" }> }) {
  return (
    <>
      {textPieces(node.text, node.runs).map((piece, i) => {
        if (!piece.run) return <span key={i}>{piece.text}</span>;
        const style = textRunCSS(doc, node, piece.run) as CSSProperties;
        if (piece.run.href) {
          return (
            <a key={i} href={piece.run.href} style={style} onClick={(e) => e.preventDefault()}>
              {piece.text}
            </a>
          );
        }
        return (
          <span key={i} style={style}>
            {piece.text}
          </span>
        );
      })}
    </>
  );
}

function runStyled(run: TextRun): boolean {
  return run.fontWeight !== undefined || run.color !== undefined || run.fontSize !== undefined || run.italic === true || !!run.href;
}

function editRange(
  text: string,
  runs: readonly TextRun[] | undefined,
  a: number,
  b: number,
  apply: (run: TextRun | undefined) => TextRun | null,
): TextRun[] | null {
  const next: TextRun[] = [];
  let at = 0;
  const emit = (s: number, e: number, run: TextRun | undefined | null) => {
    if (!run || e <= s) return;
    const copy: TextRun = { ...run, start: s, end: e };
    if (runStyled(copy)) next.push(copy);
  };
  for (const piece of textPieces(text, runs)) {
    const ps = at;
    const pe = at + piece.text.length;
    at = pe;
    const lo = Math.max(ps, a);
    const hi = Math.min(pe, b);
    if (hi <= lo) {
      emit(ps, pe, piece.run);
      continue;
    }
    emit(ps, lo, piece.run);
    emit(lo, hi, apply(piece.run ? { ...piece.run } : undefined));
    emit(hi, pe, piece.run);
  }
  return next.length ? next : null;
}

function markOf(el: HTMLElement): Partial<TextRun> {
  const mark: Partial<TextRun> = {};
  const weight = el.dataset.weight || (el.tagName === "B" || el.tagName === "STRONG" ? "700" : "");
  if (weight) mark.fontWeight = Number(weight);
  const color = el.dataset.color || (el.tagName === "FONT" ? el.getAttribute("color") ?? "" : "");
  if (color) mark.color = color;
  if (el.dataset.size) {
    const size = el.dataset.size;
    mark.fontSize = size.startsWith("$") ? size : Number(size);
  }
  if (el.dataset.italic === "1" || el.tagName === "I" || el.tagName === "EM") mark.italic = true;
  const href = el.getAttribute("href");
  if (href) mark.href = href;
  return mark;
}

function readEditable(root: HTMLElement): { text: string; runs: TextRun[] | null } {
  let text = "";
  const runs: TextRun[] = [];
  let open: { start: number; key: string; mark: Partial<TextRun> } | null = null;
  const close = (at: number) => {
    if (!open) return;
    if (at > open.start) {
      const run = { start: open.start, end: at, ...open.mark } as TextRun;
      if (runStyled(run)) runs.push(run);
    }
    open = null;
  };
  const ensure = (mark: Partial<TextRun>) => {
    const key = JSON.stringify(mark);
    if (open && open.key === key) return;
    close(text.length);
    if (key !== "{}") open = { start: text.length, key, mark };
  };
  const walk = (node: globalThis.Node, mark: Partial<TextRun>) => {
    if (node.nodeType === globalThis.Node.TEXT_NODE) {
      const chunk = (node.textContent ?? "").replace(/\u00a0/g, " ");
      if (!chunk) return;
      ensure(mark);
      text += chunk;
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === "BR") {
      close(text.length);
      text += "\n";
      return;
    }
    if (node !== root && (node.tagName === "DIV" || node.tagName === "P") && text.length > 0 && !text.endsWith("\n")) {
      close(text.length);
      text += "\n";
    }
    const next = { ...mark, ...markOf(node) };
    for (const child of node.childNodes) walk(child, next);
  };
  walk(root, {});
  close(text.length);
  return { text, runs: runs.length ? runs : null };
}

function paintEditable(root: HTMLElement, text: string, runs: readonly TextRun[] | null | undefined) {
  root.replaceChildren();
  for (const piece of textPieces(text, runs ?? undefined)) {
    if (!piece.run) {
      root.append(document.createTextNode(piece.text));
      continue;
    }
    const el = piece.run.href ? document.createElement("a") : document.createElement("span");
    if (piece.run.fontWeight !== undefined) {
      el.dataset.weight = String(piece.run.fontWeight);
      el.style.fontWeight = String(piece.run.fontWeight);
    }
    if (piece.run.color !== undefined) {
      el.dataset.color = String(piece.run.color);
      el.style.color = String(piece.run.color);
    }
    if (piece.run.fontSize !== undefined) {
      el.dataset.size = String(piece.run.fontSize);
      if (typeof piece.run.fontSize === "number") el.style.fontSize = `${piece.run.fontSize}px`;
    }
    if (piece.run.italic) {
      el.dataset.italic = "1";
      el.style.fontStyle = "italic";
    }
    if (piece.run.href) {
      el.setAttribute("href", piece.run.href);
      el.style.textDecoration = "underline";
    }
    el.textContent = piece.text;
    root.append(el);
  }
}

function selectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const before = (node: globalThis.Node, offset: number) => {
    const probe = document.createRange();
    probe.selectNodeContents(root);
    probe.setEnd(node, offset);
    return probe.toString().replace(/\u00a0/g, " ").length;
  };
  const start = before(range.startContainer, range.startOffset);
  const end = before(range.endContainer, range.endOffset);
  return start <= end ? { start, end } : { start: end, end: start };
}

function selectOffsets(root: HTMLElement, start: number, end: number) {
  const range = document.createRange();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let startNode: Text | null = null;
  let startOff = 0;
  let endNode: Text | null = null;
  let endOff = 0;
  while (walker.nextNode()) {
    const current = walker.currentNode as Text;
    const len = current.length;
    if (!startNode && seen + len >= start) {
      startNode = current;
      startOff = start - seen;
    }
    if (!endNode && seen + len >= end) {
      endNode = current;
      endOff = end - seen;
      break;
    }
    seen += len;
  }
  if (!startNode || !endNode) return;
  range.setStart(startNode, startOff);
  range.setEnd(endNode, endOff);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function TextRunEditor({
  doc,
  node,
  onCommit,
  onDone,
}: {
  doc: Document;
  node: Extract<Node, { type: "text" }>;
  onCommit(text: string, runs: TextRun[] | null): void;
  onDone(): void;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const savedSel = useRef<{ start: number; end: number } | null>(null);
  const [size, setSize] = useState(typeof node.fontSize === "number" ? String(node.fontSize) : "16");
  const [color, setColor] = useState(typeof node.color === "string" && node.color.startsWith("#") ? node.color : "#c43d27");
  const [href, setHref] = useState("https://");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    paintEditable(el, node.text, node.runs);
    el.focus();
  }, [node.id, node.text, node.runs]);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    const el = ref.current;
    const next = el ? readEditable(el) : { text: node.text, runs: node.runs ?? null };
    const same = next.text === node.text && JSON.stringify(next.runs) === JSON.stringify(node.runs ?? null);
    if (!same) onCommit(next.text, next.runs);
    onDone();
  };
  const applySel = (apply: (run: TextRun | undefined) => TextRun | null) => {
    const el = ref.current;
    if (!el) return;
    const live = selectionOffsets(el);
    const sel = live && live.start !== live.end ? live : savedSel.current;
    if (!sel || sel.start === sel.end) return;
    const cur = readEditable(el);
    const runs = editRange(cur.text, cur.runs ?? undefined, sel.start, sel.end, apply);
    paintEditable(el, cur.text, runs);
    selectOffsets(el, sel.start, sel.end);
  };
  const hrefOk = /^(https?:\/\/|mailto:|[#/])/.test(href) && !/[\s<>"']/.test(href);
  return (
    <div ref={shell} className="relative" onPointerDown={(e) => e.stopPropagation()}>
      <div
        className="absolute bottom-full left-0 z-10 mb-1 flex items-center gap-1 rounded-md border border-line bg-panel p-1"
        onMouseDown={(e) => {
          const el = ref.current;
          if (el) savedSel.current = selectionOffsets(el);
          if (!(e.target instanceof HTMLElement) || !e.target.closest("input")) e.preventDefault();
        }}
      >
        <button type="button" className={ui.iconBtn} aria-label="Negrito" onClick={() => applySel((run) => {
          const next: TextRun = { start: 0, end: 0, ...(run ?? {}) };
          if (next.fontWeight === 700) delete next.fontWeight;
          else next.fontWeight = 700;
          return runStyled(next) ? next : null;
        })}>
          <Bold aria-hidden className="size-3.5" />
        </button>
        <button type="button" className={ui.iconBtn} aria-label="Itálico" onClick={() => applySel((run) => {
          const next: TextRun = { start: 0, end: 0, ...(run ?? {}) };
          if (next.italic) delete next.italic;
          else next.italic = true;
          return runStyled(next) ? next : null;
        })}>
          <Italic aria-hidden className="size-3.5" />
        </button>
        <input
          aria-label="Tamanho"
          className="h-6 w-12 rounded border border-line bg-panel px-1 text-xs text-fg"
          value={size}
          onChange={(e) => setSize(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const n = Number(size);
            if (!Number.isFinite(n) || n < 1 || n > 1000) return;
            applySel((run) => ({ start: 0, end: 0, ...(run ?? {}), fontSize: n }));
          }}
        />
        <input aria-label="Cor" type="color" className="h-6 w-6 cursor-pointer border-0 bg-transparent p-0" value={color} onChange={(e) => {
          const next = e.target.value;
          setColor(next);
          applySel((run) => ({ start: 0, end: 0, ...(run ?? {}), color: next }));
        }} />
        <input
          aria-label="Link"
          className="h-6 w-36 rounded border border-line bg-panel px-1 text-xs text-fg"
          value={href}
          onChange={(e) => setHref(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (!hrefOk) return;
            applySel((run) => ({ start: 0, end: 0, ...(run ?? {}), href }));
          }}
        />
        <button type="button" className={ui.iconBtn} aria-label="Aplicar link" disabled={!hrefOk} onClick={() => applySel((run) => ({ start: 0, end: 0, ...(run ?? {}), href }))}>
          <Link2 aria-hidden className="size-3.5" />
        </button>
      </div>
      <div
        ref={ref}
        role="textbox"
        aria-label="Texto"
        contentEditable
        suppressContentEditableWarning
        className="min-h-4 whitespace-pre-wrap outline-none"
        onKeyDown={(e) => {
          if (e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key === "Enter")) {
            e.preventDefault();
            finish();
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return;
            const range = sel.getRangeAt(0);
            range.deleteContents();
            const br = document.createTextNode("\n");
            range.insertNode(br);
            range.setStartAfter(br);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }}
        onBlur={(e) => {
          const next = e.relatedTarget;
          if (next instanceof globalThis.Node && shell.current?.contains(next)) return;
          finish();
        }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) e.preventDefault();
        }}
      />
    </div>
  );
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
    if (!preview) return doc;
    const nodes = { ...doc.nodes };
    let changed = false;
    for (const [id, pv] of Object.entries(preview)) {
      if (!nodes[id]) continue;
      nodes[id] = { ...nodes[id], ...pv } as Node;
      changed = true;
    }
    if (!changed) return doc;
    if (!Object.values(nodes).some((n) => n.type === "connector")) return { ...doc, nodes };
    for (const n of Object.values(nodes)) if (n.type === "connector") nodes[n.id] = { ...n };
    const next = { ...doc, nodes };
    try {
      routeConnectors(next);
      return next;
    } catch {
      return { ...doc, nodes };
    }
  }, [doc, preview]);
  const previewDoc = useMemo(() => {
    if (!preview) return doc;
    const nodes = { ...doc.nodes };
    let changed = false;
    for (const [id, pv] of Object.entries(preview)) {
      const n = nodes[id];
      if (!n) continue;
      nodes[id] = { ...n, ...pv } as Node;
      changed = true;
    }
    return changed ? { ...doc, nodes } : doc;
  }, [doc, preview]);
  const placed = useMemo(() => {
    try {
      return layout(previewDoc, pageId ? { rootId: pageId } : {});
    } catch {
      return {};
    }
  }, [previewDoc, pageId]);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  /** Caixa que envolve a seleção, e a de cada nó quando há mais de um. */
  const [box, setBox] = useState<Rect | null>(null);
  const [boxes, setBoxes] = useState<(Rect & { id: string })[]>([]);
  const [quads, setQuads] = useState<{ id: string; width: number; height: number; corners: Pt[] }[]>([]);
  /** Alvo de reparent/reordenação durante o arraste (anel + marcador de inserção). */
  const [dropUi, setDropUi] = useState<{ highlight: Rect | null; marker: Rect | null } | null>(null);
  const [dragIds, setDragIds] = useState<string[] | null>(null);
  const [fileOver, setFileOver] = useState(false);
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
    const toVp = (p: { x: number; y: number }) => ({ x: view.x + p.x * view.zoom, y: view.y + p.y * view.zoom });
    const quadList: { id: string; width: number; height: number; corners: Pt[] }[] = [];
    const rects = selected.flatMap((id) => {
      const n = previewDoc.nodes[id];
      const geom = placed[id];
      const rot = n && n.type !== "group" && n.type !== "connector" && n.type !== "page" ? n.rotation : 0;
      if (geom && rot) {
        const corners = geom.corners.map(toVp);
        quadList.push({ id, width: geom.width, height: geom.height, corners });
        const left = Math.min(...corners.map((p) => p.x));
        const top = Math.min(...corners.map((p) => p.y));
        const right = Math.max(...corners.map((p) => p.x));
        const bottom = Math.max(...corners.map((p) => p.y));
        return [{ id, left, top, width: right - left, height: bottom - top }];
      }
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
    setBoxes(rects.length > 1 ? rects.filter((r) => !quadList.some((q) => q.id === r.id)) : []);
    setQuads(quadList);
    setFrameLabels(
      roots.flatMap((id) => {
        const n = doc.nodes[id];
        const e = vp.querySelector<HTMLElement>(`[data-paprika-id="${CSS.escape(id)}"]`);
        if (!n || n.type !== "frame" || !e) return [];
        const r = e.getBoundingClientRect();
        return [{ id, name: n.name || id, left: r.left - vpr.left, top: r.top - vpr.top }];
      }),
    );
  }, [doc, selected, view, preview, roots, placed, previewDoc]);

  // Caneta (P): clique cria um vértice reto; clicar e arrastar puxa alças bezier simétricas.
  // Clicar no primeiro vértice fecha a forma; Enter, Esc ou duplo clique terminam aberta; Backspace desfaz o último vértice.
  const [pen, setPen] = useState<PenDraft | null>(null);
  const penRef = useRef(pen);
  const [layerMenu, setLayerMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  const layerMenuRef = useRef(layerMenu);
  layerMenuRef.current = layerMenu;
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

  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable);
    const keyboardFocus = (t: EventTarget | null) => t instanceof HTMLElement && t !== document.body && t.matches(":focus-visible");
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || keyboardFocus(e.target)) return;
      if (layerMenuRef.current) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") return;
        if (e.key === "Escape" || e.key === "Tab") {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (e.key === "Escape") setLayerMenu(null);
          return;
        }
        setLayerMenu(null);
        return;
      }
      if (penRef.current || pathEditRef.current) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Enter" && !mod && !e.altKey && !e.shiftKey) {
        if (e.repeat) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
        const kids = childrenSelection(doc, selected);
        if (!kids.length) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        onSelect(kids);
        return;
      }
      if (e.key === "Tab" && !mod && !e.altKey) {
        const next = cycleSibling(doc, selected, e.shiftKey ? -1 : 1);
        if (!next) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        onSelect([next]);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [doc, onSelect, selected]);

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

  const vpRect = useCallback((el: Element): Rect => {
    const vpr = viewportRef.current!.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { left: r.left - vpr.left, top: r.top - vpr.top, width: r.width, height: r.height };
  }, []);

  const flowIndex = useCallback(
    (parentId: string, clientX: number, clientY: number, dragged: ReadonlySet<string>): number => {
      const parent = doc.nodes[parentId];
      if (!parent || !isContainer(parent) || parent.type === "page") return 0;
      const mode = parent.type === "frame" && parent.layout?.mode === "row" ? "row" : "column";
      const kids = parent.children.filter((id) => !dragged.has(id));
      const vp = viewportRef.current!;
      for (let i = 0; i < kids.length; i++) {
        const el = vp.querySelector(`[data-paprika-id="${CSS.escape(kids[i]!)}"]`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const mid = mode === "row" ? r.left + r.width / 2 : r.top + r.height / 2;
        const pos = mode === "row" ? clientX : clientY;
        if (pos < mid) return i;
      }
      return kids.length;
    },
    [doc],
  );

  const resolveDrop = useCallback(
    (clientX: number, clientY: number, dragged: ReadonlySet<string>): DropSpot => {
      const vp = viewportRef.current;
      let highlightId: string | null = null;
      if (vp) {
        const restored: [HTMLElement | SVGElement, string][] = [];
        for (const id of dragged) {
          const el = vp.querySelector<HTMLElement | SVGElement>(`[data-paprika-id="${CSS.escape(id)}"]`);
          if (!el) continue;
          restored.push([el, el.style.pointerEvents]);
          el.style.pointerEvents = "none";
        }
        try {
          for (const el of document.elementsFromPoint(clientX, clientY)) {
            if (!(el instanceof Element) || !vp.contains(el)) continue;
            const host = el.closest<HTMLElement | SVGElement>("[data-paprika-id]");
            if (!host || !vp.contains(host)) continue;
            const id = host.dataset.paprikaId!;
            if (dragged.has(id) || [...dragged].some((d) => isUnder(doc, id, d))) continue;
            const n = doc.nodes[id];
            if (!n) continue;
            if (isContainer(n) && n.type !== "page" && dropAccepts(doc, id, dragged)) {
              highlightId = id;
              break;
            }
            if (n.parentId && dropAccepts(doc, n.parentId, dragged) && isFlowFrame(doc.nodes[n.parentId])) {
              highlightId = n.parentId;
              break;
            }
            if (n.parentId && dropAccepts(doc, n.parentId, dragged) && isContainer(doc.nodes[n.parentId]) && doc.nodes[n.parentId]!.type !== "page") {
              highlightId = n.parentId;
              break;
            }
          }
        } finally {
          for (const [el, prev] of restored) el.style.pointerEvents = prev;
        }
      }
      const parentId = highlightId;
      const flow = isFlowFrame(parentId ? doc.nodes[parentId] : undefined);
      const index = flow && parentId ? flowIndex(parentId, clientX, clientY, dragged) : undefined;
      return { parentId, index, highlightId, flow };
    },
    [doc, flowIndex],
  );

  const paintDropUi = useCallback(
    (spot: DropSpot, dragged: ReadonlySet<string>) => {
      const vp = viewportRef.current;
      if (!vp || !spot.highlightId) {
        setDropUi(null);
        return;
      }
      const host = vp.querySelector(`[data-paprika-id="${CSS.escape(spot.highlightId)}"]`);
      if (!host) {
        setDropUi(null);
        return;
      }
      const highlight = vpRect(host);
      let marker: Rect | null = null;
      if (spot.flow && spot.parentId != null && spot.index !== undefined) {
        const parent = doc.nodes[spot.parentId];
        if (parent && isContainer(parent) && parent.type !== "page") {
          const mode = parent.type === "frame" && parent.layout?.mode === "row" ? "row" : "column";
          const kids = parent.children.filter((id) => !dragged.has(id));
          const pad = 2;
          if (kids.length === 0) {
            marker =
              mode === "row"
                ? { left: highlight.left + 8, top: highlight.top + 8, width: 3, height: Math.max(24, highlight.height - 16) }
                : { left: highlight.left + 8, top: highlight.top + 8, width: Math.max(24, highlight.width - 16), height: 3 };
          } else if (spot.index >= kids.length) {
            const last = vp.querySelector(`[data-paprika-id="${CSS.escape(kids[kids.length - 1]!)}"]`);
            if (last) {
              const r = vpRect(last);
              marker =
                mode === "row"
                  ? { left: r.left + r.width + pad, top: r.top, width: 3, height: r.height }
                  : { left: r.left, top: r.top + r.height + pad, width: r.width, height: 3 };
            }
          } else {
            const next = vp.querySelector(`[data-paprika-id="${CSS.escape(kids[spot.index]!)}"]`);
            if (next) {
              const r = vpRect(next);
              marker =
                mode === "row"
                  ? { left: r.left - pad - 1, top: r.top, width: 3, height: r.height }
                  : { left: r.left, top: r.top - pad - 1, width: r.width, height: 3 };
            }
          }
        }
      }
      setDropUi({ highlight, marker });
    },
    [doc, vpRect],
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
    if (tool === "pin") return; // the pin layer captures its own clicks (Pins.tsx)
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
    const deep = e.ctrlKey && !e.metaKey && !e.shiftKey;
    const id = deep ? target.dataset.paprikaId! : pickTarget(doc, target.dataset.paprikaId!, selected);
    if (additive && !deep) {
      onSelect(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
      return;
    }
    // Arrastar um nó já selecionado move a seleção inteira; senão, seleciona só ele.
    const group = selected.includes(id) ? selected : [id];
    if (!selected.includes(id)) onSelect([id]);
    const shownAt = previewRef.current ?? {};
    const movable = group
      .map((g) => doc.nodes[g])
      .filter((n): n is SceneNode => isScene(n) && n.type !== "connector" && !n.locked && !copyOwner(doc, n))
      .map((n) => ({ ...n, x: shownAt[n.id]?.x ?? n.x, y: shownAt[n.id]?.y ?? n.y }) as SceneNode);
    if (!movable.length) return;
    const dragged = new Set(movable.map((n) => n.id));
    const absOnly = movable.every((n) => isAbsolute(doc, n));
    const ignoreLayoutDrag = movable.every((n) => "layoutPositioning" in n && n.layoutPositioning === "absolute");
    takeOverPreview();
    const start = toWorld(e.clientX, e.clientY);
    let moved = false;
    let last: Preview = {};
    let spot: DropSpot = { parentId: null, index: undefined, highlightId: null, flow: false };
    const move = (ev: PointerEvent) => {
      const p = toWorld(ev.clientX, ev.clientY);
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      if (!moved && Math.hypot(dx, dy) * view.zoom < 3) return;
      if (!moved) setDragIds([...dragged]);
      moved = true;
      spot = resolveDrop(ev.clientX, ev.clientY, dragged);
      if (ignoreLayoutDrag) spot = { ...spot, flow: false };
      paintDropUi(spot, dragged);
      if (!absOnly) return;
      if (spot.highlightId && !spot.flow && movable.some((n) => n.parentId !== spot.highlightId)) {
        const local = localFor(spot.parentId, ev.clientX, ev.clientY);
        last = Object.fromEntries(
          movable.map((n, i) => {
            const el = viewportRef.current?.querySelector(`[data-paprika-id="${CSS.escape(n.id)}"]`);
            const w = el ? el.getBoundingClientRect().width / view.zoom : typeof n.width === "number" ? n.width : 40;
            const h = el ? el.getBoundingClientRect().height / view.zoom : typeof n.height === "number" ? n.height : 40;
            return [n.id, { x: Math.round(local.x - w / 2 + i * 8), y: Math.round(local.y - h / 2 + i * 8) }];
          }),
        );
        setPreview(last);
        return;
      }
      last = Object.fromEntries(movable.map((n) => [n.id, { x: Math.round(n.x + dx), y: Math.round(n.y + dy) }]));
      setPreview(last);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDropUi(null);
      setDragIds(null);
      if (!moved) return;
      spot = resolveDrop(ev.clientX, ev.clientY, dragged);
      if (ignoreLayoutDrag) spot = { ...spot, flow: false };
      const dest = spot.highlightId;
      const ops: Op[] = [];
      if (dest && spot.flow) {
        let index = spot.index ?? 0;
        for (const n of movable) {
          ops.push({ op: "move", id: n.id, parentId: dest, index });
          index += 1;
        }
        apply(ops, movable.every((n) => n.parentId === dest) ? "reordenar" : "reparentear");
        setPreview(null);
        return;
      }
      if (dest && movable.some((n) => n.parentId !== dest)) {
        for (const n of movable) {
          ops.push({ op: "move", id: n.id, parentId: dest });
          const props = last[n.id];
          if (props?.x !== undefined && props?.y !== undefined) ops.push({ op: "update", id: n.id, props: { x: props.x, y: props.y } });
          else {
            const local = localFor(dest, ev.clientX, ev.clientY);
            ops.push({ op: "update", id: n.id, props: { x: Math.round(local.x), y: Math.round(local.y) } });
          }
        }
        if (Object.keys(last).length) commitPreview(last, ops, movable.length > 1 ? `mover ${movable.length} nós` : "reparentear");
        else apply(ops, "reparentear");
        return;
      }
      if (!Object.keys(last).length) return;
      if (!absOnly) {
        setPreview(null);
        return;
      }
      commitPreview(
        last,
        Object.entries(last).map(([nid, props]) => ({ op: "update", id: nid, props })),
        movable.length > 1 ? `mover ${movable.length} nós` : "mover",
      );
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
      const area = { left: l, top: t, right: r, bottom: b };
      return roots.filter((id) => {
        const n = doc.nodes[id];
        const geom = placed[id];
        const rot = n && n.type !== "group" && n.type !== "connector" && n.type !== "page" ? n.rotation : 0;
        if (geom && rot) {
          const corners = geom.corners.map((p) => ({ x: view.x + p.x * view.zoom, y: view.y + p.y * view.zoom }));
          return quadHitsRect(corners, area);
        }
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
    if (node?.type === "text" && !node.locked && (selected.includes(node.id) || pickTarget(doc, node.id, selected) === node.id)) {
      onSelect([node.id]);
      setTextEditId(node.id);
      return;
    }
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
  const sole = quads.length === 1 && selected.length === 1 ? quads[0] : undefined;
  const curveConn = single?.type === "connector" && single.route === "curve" && !single.locked && !copyOwner(doc, single) ? (shown.nodes[single.id] as ConnectorNode) : null;
  const curveHandle = curveConn ? connectorCurveHandle(shown, curveConn) : null;
  const onCurveHandleDown = (e: RPointerEvent) => {
    e.stopPropagation();
    if (!curveConn || !viewportRef.current) return;
    const id = curveConn.id;
    const origin = originOf(doc, curveConn.parentId);
    takeOverPreview();
    let last = {
      control: {
        x: round4((e.clientX - viewportRef.current.getBoundingClientRect().left - view.x) / view.zoom - origin.x),
        y: round4((e.clientY - viewportRef.current.getBoundingClientRect().top - view.y) / view.zoom - origin.y),
      },
    };
    setPreview({ [id]: last });
    const move = (ev: PointerEvent) => {
      const vpr = viewportRef.current!.getBoundingClientRect();
      last = {
        control: {
          x: round4((ev.clientX - vpr.left - view.x) / view.zoom - origin.x),
          y: round4((ev.clientY - vpr.top - view.y) / view.zoom - origin.y),
        },
      };
      setPreview({ [id]: last });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      commitPreview({ [id]: last }, [{ op: "update", id, props: last }], "curvar seta");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const [resizeLock, setResizeLock] = useState<"ratio" | "square" | null>(null);
  const onRotateDown = (e: RPointerEvent) => {
    e.stopPropagation();
    const node = single;
    if (!node || !resizable || !isScene(node) || node.type === "connector" || node.type === "group" || node.locked) return;
    const id = node.id;
    const shownAt = previewRef.current?.[id];
    const x0 = shownAt?.x ?? node.x;
    const y0 = shownAt?.y ?? node.y;
    const w0 = shownAt?.width ?? (typeof node.width === "number" ? node.width : 1);
    const h0 = shownAt?.height ?? (typeof node.height === "number" ? node.height : 1);
    const rot0 = shownAt?.rotation ?? node.rotation;
    const parent = node.parentId ? previewDoc.nodes[node.parentId] : undefined;
    const geom = parent && parent.type !== "page" ? placed[parent.id] : undefined;
    const origin = { x: geom?.x ?? 0, y: geom?.y ?? 0 };
    const center = { x: x0 + w0 / 2, y: y0 + h0 / 2 };
    const local = (cx: number, cy: number) => {
      const w = toWorld(cx, cy);
      return { x: w.x - origin.x, y: w.y - origin.y };
    };
    const start = local(e.clientX, e.clientY);
    const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
    takeOverPreview();
    let last = { rotation: rot0 };
    const held = { shift: e.shiftKey };
    let lastClient = { x: e.clientX, y: e.clientY };
    const applyAt = (cx: number, cy: number) => {
      const p = local(cx, cy);
      let rotation = rot0 + ((Math.atan2(p.y - center.y, p.x - center.x) - startAngle) * 180) / Math.PI;
      if (held.shift) rotation = Math.round(rotation / 15) * 15;
      last = { rotation: Math.round(rotation * 100) / 100 };
      setPreview({ [id]: last });
    };
    const move = (ev: PointerEvent) => {
      held.shift = ev.shiftKey;
      lastClient = { x: ev.clientX, y: ev.clientY };
      applyAt(ev.clientX, ev.clientY);
    };
    const onKey = (ev: KeyboardEvent) => {
      held.shift = ev.shiftKey || ev.getModifierState("Shift");
      applyAt(lastClient.x, lastClient.y);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      commitPreview({ [id]: last }, [{ op: "update", id, props: last }], "girar");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
  };
  const onResizeDown = (corner: Corner) => (e: RPointerEvent) => {
    e.stopPropagation();
    const node = single;
    if (!node || !box || !resizable || node.type === "page" || node.type === "group" || node.type === "connector" || node.locked || !isScene(node)) return;
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
    const rot = shownAt?.rotation ?? node.rotation;
    const parent = node.parentId ? previewDoc.nodes[node.parentId] : undefined;
    const geom = parent && parent.type !== "page" ? placed[parent.id] : undefined;
    const origin = { x: geom?.x ?? 0, y: geom?.y ?? 0 };
    const opposite: Record<Corner, Corner> = { nw: "se", ne: "sw", se: "nw", sw: "ne" };
    const fixed = boxCorner(x0, y0, w0, h0, rot, opposite[corner]);
    let last: { x?: number; y?: number; width: number; height: number } = {
      width: Math.round(w0),
      height: Math.round(h0),
      ...(absolute ? { x: Math.round(x0), y: Math.round(y0) } : {}),
    };
    const held = { shift: e.shiftKey, alt: e.altKey };
    let lastClient = { x: e.clientX, y: e.clientY };
    const applyAt = (clientX: number, clientY: number) => {
      const lock: "ratio" | "square" | null = held.shift ? (held.alt ? "square" : "ratio") : null;
      setResizeLock(lock);
      if (rot) {
        const world = toWorld(clientX, clientY);
        const next = resizeBox(corner, fixed, { x: world.x - origin.x, y: world.y - origin.y }, rot, lock, ratio0, w0, h0);
        last = {
          width: next.width,
          height: next.height,
          ...(absolute ? { x: next.x, y: next.y } : {}),
        };
        setPreview({ [id]: last });
        return;
      }
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

  const spacingModel = useMemo(() => {
    if (!single || single.type !== "frame" || !single.layout || single.layout.mode === "none") return null;
    if (single.locked || isInstance(single) || copyOwner(doc, single)) return null;
    const live = previewDoc.nodes[single.id];
    if (!live || live.type !== "frame" || !live.layout || live.layout.mode === "none") return null;
    const geom = placed[live.id];
    if (!geom) return null;
    const theme = modeOf(previewDoc, live);
    const one = (v: number | string) => resolveLength(previewDoc, v, theme) ?? 0;
    const raw = live.layout.padding;
    const padding = Array.isArray(raw) ? padTuple(raw.map((v) => one(v)) as Layout["padding"]) : padTuple(one(raw));
    const kids = live.children.flatMap((cid) => {
      const n = previewDoc.nodes[cid];
      const g = placed[cid];
      if (!n || !isScene(n) || n.type === "connector" || n.visible === false || ignoresLayout(n) || !g) return [];
      return [{ x: g.x, y: g.y, w: g.width, h: g.height }];
    });
    return {
      id: live.id,
      rotation: live.rotation,
      handles: spacingHandles({ x: geom.x, y: geom.y, w: geom.width, h: geom.height, rotation: live.rotation }, padding, kids, live.layout.mode),
    };
  }, [single, doc, previewDoc, placed]);
  const onSpacingDown = (h: SpacingHandleGeom) => (e: RPointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const id = spacingModel?.id;
    const node = id ? previewDoc.nodes[id] : undefined;
    if (!id || !node || node.type !== "frame" || !node.layout || node.layout.mode === "none" || (h.kind === "padding" && !h.side)) return;
    const theme = modeOf(previewDoc, node);
    const one = (v: number | string) => resolveLength(previewDoc, v, theme) ?? 0;
    const raw = node.layout.padding;
    const startPad = Array.isArray(raw) ? padTuple(raw.map((v) => one(v)) as Layout["padding"]) : padTuple(one(raw));
    const startGap = one(node.layout.gap);
    const rot = node.rotation || 0;
    const baseLayout = node.layout;
    const sx = e.clientX;
    const sy = e.clientY;
    takeOverPreview();
    let last = baseLayout;
    let moved = false;
    const held = { alt: e.altKey };
    let lastClient = { x: e.clientX, y: e.clientY };
    const applyAt = (cx: number, cy: number) => {
      const dx = (cx - sx) / view.zoom;
      const dy = (cy - sy) / view.zoom;
      if (Math.hypot(dx, dy) >= 0.5) moved = true;
      const local = worldDeltaToLocal(dx, dy, rot);
      const layout: Layout = { ...baseLayout };
      if (h.kind === "gap") layout.gap = gapAfterDrag(startGap, h.axis, local.x, local.y);
      else if (h.side) layout.padding = paddingAfterDrag(startPad, h.side, local.x, local.y, held.alt);
      last = layout;
      setPreview({ [id]: { layout } });
    };
    const move = (ev: PointerEvent) => {
      held.alt = ev.altKey;
      lastClient = { x: ev.clientX, y: ev.clientY };
      applyAt(ev.clientX, ev.clientY);
    };
    const onKey = (ev: KeyboardEvent) => {
      held.alt = ev.altKey || ev.getModifierState("Alt");
      applyAt(lastClient.x, lastClient.y);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      const padNow = Array.isArray(last.padding) ? padTuple(last.padding as Layout["padding"]) : padTuple(typeof last.padding === "number" ? last.padding : 0);
      const gapNow = typeof last.gap === "number" ? last.gap : startGap;
      const unchanged = !moved || (h.kind === "gap" ? gapNow === startGap : padNow.every((v, i) => v === startPad[i]));
      if (unchanged) {
        setPreview(null);
        return;
      }
      commitPreview({ [id]: { layout: last } }, [{ op: "update", id, props: { layout: last } }], h.kind === "gap" ? "gap" : "padding");
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
        : editedShape?.type === "text"
          ? {
              id: editedShape.id,
              onCommit: () => {},
              onCommitRich: (text: string, runs: TextRun[] | null) =>
                apply([{ op: "update", id: editedShape.id, props: { text, runs: runs ?? null } }], "editar texto"),
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

  const onFileDragOver = (e: RDragEvent) => {
    if (![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setFileOver(true);
  };

  const importFilesAt = async (files: FileList | File[], clientX: number, clientY: number) => {
    const list = [...files];
    if (!list.length) return;
    const spot = resolveDrop(clientX, clientY, new Set());
    const into = spot.highlightId && !isInstance(doc.nodes[spot.highlightId]!) && !copyOwner(doc, doc.nodes[spot.highlightId]!) ? spot.highlightId : pageId;
    const at = localFor(into, clientX, clientY);
    const ops: Op[] = [];
    const ids: string[] = [];
    let warnings: string[] = [];
    let ox = 0;
    for (const file of list) {
      const name = file.name || "arquivo";
      try {
        if (IMAGE_FILE.test(file.type) || /\.(png|jpe?g|webp|avif|gif)$/i.test(name)) {
          const src = await new Promise<string>((ok, fail) => {
            const r = new FileReader();
            r.onload = () => ok(String(r.result));
            r.onerror = () => fail(r.error ?? new Error("leitura"));
            r.readAsDataURL(file);
          });
          const size = await new Promise<{ w: number; h: number }>((ok, fail) => {
            const img = new Image();
            img.onload = () => ok({ w: img.naturalWidth || 100, h: img.naturalHeight || 100 });
            img.onerror = () => fail(new Error("imagem inválida"));
            img.src = src;
          });
          const max = 480;
          const scale = Math.min(1, max / Math.max(size.w, size.h));
          const id = newId();
          ids.push(id);
          ops.push({
            op: "create",
            parentId: into,
            node: {
              type: "image",
              id,
              name: name.replace(/\.[^.]+$/, "") || "Imagem",
              x: Math.round(at.x + ox),
              y: Math.round(at.y),
              width: Math.max(1, Math.round(size.w * scale)),
              height: Math.max(1, Math.round(size.h * scale)),
              src,
              fit: "contain",
              alt: name,
            },
          });
          ox += Math.round(size.w * scale) + 16;
        } else if (file.type === "image/svg+xml" || /\.svg$/i.test(name) || file.type === "text/html" || /\.html?$/i.test(name)) {
          const text = await file.text();
          const svg = file.type === "image/svg+xml" || /\.svg$/i.test(name) || isSVGText(text.trim());
          const r = svg ? importSVG(text, { x: Math.round(at.x + ox), y: Math.round(at.y) }) : importHTML(text, { x: Math.round(at.x + ox), y: Math.round(at.y) });
          if (!r.nodes.length) throw new Error(r.warnings.join("; ") || "nada para importar");
          warnings = warnings.concat(r.warnings);
          for (const node of r.nodes) {
            const id = newId();
            node.id = id;
            ids.push(id);
            ops.push({ op: "create", parentId: into, node });
          }
          ox += 40;
        } else {
          onError?.(`Formato não suportado: ${name}`);
        }
      } catch (err) {
        onError?.(`Não deu para importar ${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!ops.length) return;
    apply(ops, ops.length > 1 ? `importar ${ops.length} arquivos` : "importar arquivo");
    onSelect(ids);
    if (warnings.length) onError?.(`Importado com avisos: ${warnings.join("; ")}`);
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
        fileOver && "outline outline-2 outline-select outline-offset-[-2px]",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={pen ? onPenHover : undefined}
      onDoubleClick={pen ? onPenDouble : onDeepSelect}
      onContextMenu={(e) => {
        if (tool !== "select" || pen) return;
        if ((e.target as Element).closest?.('[data-testid="layer-menu"]')) return;
        const ids = layersUnderPoint(doc, e.clientX, e.clientY, viewportRef.current);
        if (!ids.length) return;
        e.preventDefault();
        setLayerMenu({ x: e.clientX, y: e.clientY, ids });
      }}
      onDragEnter={onFileDragOver}
      onDragOver={onFileDragOver}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as globalThis.Node)) setFileOver(false);
      }}
      onDrop={(e) => {
        if (![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        setFileOver(false);
        void importFilesAt(e.dataTransfer.files, e.clientX, e.clientY);
      }}
      data-testid="viewport"
      data-file-over={fileOver ? "1" : undefined}
    >
      {layerMenu && (
        <LayerMenu
          doc={doc}
          ids={layerMenu.ids}
          x={layerMenu.x}
          y={layerMenu.y}
          onSelect={(id) => {
            onSelect([id]);
            setLayerMenu(null);
          }}
          onConvert={(() => {
            const id = layerMenu.ids.find((nid) => {
              const n = doc.nodes[nid];
              return !!n && (n.type === "rect" || n.type === "ellipse") && !copyOwner(doc, n);
            });
            if (!id) return undefined;
            return () => {
              apply([{ op: "convert_to_path", ids: [id] }], "converter em caminho");
              onSelect([id]);
              setLayerMenu(null);
            };
          })()}
          onClose={() => setLayerMenu(null)}
        />
      )}
      {renderer === "wasm" && <canvas ref={wasmLayer.canvasRef} className="pointer-events-none absolute inset-0 size-full" data-testid="wasm-layer" data-backend={wasmLayer.status.backend} />}
      <div
        ref={worldRef}
        className={cx("world absolute top-0 left-0 origin-top-left [&_[data-paprika-id]]:select-none", dragIds && "is-node-dragging")}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
        data-dragging={dragIds?.join(",") || undefined}
      >
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
            dragging={!!dragIds?.includes(n.id)}
            dragIds={dragIds ? new Set(dragIds) : undefined}
          />
        ))}
        {curveHandle && (
          <div
            className="pointer-events-auto absolute size-2.5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-[1.5px] border-select bg-white active:cursor-grabbing"
            style={{ left: curveHandle.x, top: curveHandle.y }}
            data-testid="connector-curve-handle"
            title="Arrastar para curvar"
            onPointerDown={onCurveHandleDown}
          />
        )}
        {pen && pen.parentId === null && <PenOverlay pen={pen} zoom={view.zoom} />}
      </div>
      <AgentCursors doc={doc} view={view} viewportRef={viewportRef} layoutKey={preview} pageId={pageId} onOpenPage={onOpenPage} onFocus={focusBox} />
      <BuildCode />
      <PinLayer doc={doc} view={view} viewportRef={viewportRef} pageId={pageId} active={tool === "pin"} onToolDone={onToolDone} layoutKey={preview} onFocus={focusBox} onOpenPage={onOpenPage} onError={onError} />
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
      {quads
        .filter((q) => q !== sole)
        .map((q) => (
          <svg key={q.id} className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
            <polygon points={q.corners.map((p) => `${p.x},${p.y}`).join(" ")} className="fill-none stroke-select" strokeWidth={1} />
          </svg>
        ))}
      {sole && box && (
        <div className="pointer-events-none absolute inset-0" data-testid="selection" data-count={selected.length}>
          <svg className="absolute inset-0 size-full overflow-visible">
            <polygon points={sole.corners.map((p) => `${p.x},${p.y}`).join(" ")} className="fill-none stroke-select" strokeWidth={1.5} />
            {(() => {
              const { mid, knob } = knobFromTop(sole.corners[0]!, sole.corners[1]!, 22);
              return <line x1={mid.x} y1={mid.y} x2={knob.x} y2={knob.y} className="stroke-select" strokeWidth={1.5} />;
            })()}
          </svg>
          {([
            ["nw", "Redimensionar canto superior esquerdo", "cursor-nwse-resize"],
            ["ne", "Redimensionar canto superior direito", "cursor-nesw-resize"],
            ["sw", "Redimensionar canto inferior esquerdo", "cursor-nesw-resize"],
            ["se", "Redimensionar canto inferior direito", "cursor-nwse-resize"],
          ] as const).map(([corner, label, cursor]) => {
            const i = { nw: 0, ne: 1, se: 2, sw: 3 }[corner];
            const p = sole.corners[i]!;
            return (
              <Hint key={corner} label={label}>
                <div
                  className={cx("pointer-events-auto absolute size-[9px] -translate-x-1/2 -translate-y-1/2 border-[1.5px] border-select bg-white", cursor)}
                  style={{ left: p.x, top: p.y }}
                  data-resize={corner}
                  onPointerDown={onResizeDown(corner)}
                />
              </Hint>
            );
          })}
          {(() => {
            const { knob } = knobFromTop(sole.corners[0]!, sole.corners[1]!, 22);
            return (
              <Hint label={m.rotateHint}>
                <div
                  className="pointer-events-auto absolute size-3 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-[1.5px] border-select bg-white active:cursor-grabbing"
                  style={{ left: knob.x, top: knob.y }}
                  data-testid="rotate-handle"
                  aria-label={m.rotate}
                  onPointerDown={onRotateDown}
                />
              </Hint>
            );
          })()}
          <div
            className="absolute -translate-x-1/2 rounded-[3px] bg-select px-1.25 py-px text-2xs font-semibold whitespace-nowrap text-select-ink"
            style={{ left: box.left + box.width / 2, top: box.top + box.height + 6 }}
          >
            {Math.round(sole.width)} × {Math.round(sole.height)}
          </div>
          {resizeLock && (
            <div
              className="absolute -translate-x-1/2 rounded-[3px] bg-select px-1.25 py-px text-2xs font-semibold whitespace-nowrap text-select-ink"
              style={{ left: box.left + box.width / 2, top: box.top + box.height + 28 }}
              data-testid="resize-lock-hint"
              data-lock={resizeLock}
            >
              {resizeLock === "square" ? m.ratioLockAlt : m.ratioLock}
            </div>
          )}
        </div>
      )}
      {box && !sole && (
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
          {single && single.type !== "page" && nodeGradient(single) && !single.locked && !copyOwner(doc, single) && (
            <GradientHandles
              doc={shown}
              node={single}
              width={box.width}
              height={box.height}
              onCommit={(gradient) => apply([{ op: "update", id: single.id, props: { gradient } }], "gradient")}
            />
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
      {spacingModel && (
        <div className="pointer-events-none absolute inset-0" data-testid="spacing-handles">
          {spacingModel.handles.map((h) => {
            const label =
              h.kind === "gap"
                ? m.spacingGap
                : h.side === "right"
                  ? m.spacingPadRight
                  : h.side === "bottom"
                    ? m.spacingPadBottom
                    : h.side === "left"
                      ? m.spacingPadLeft
                      : m.spacingPadTop;
            const vertical = h.axis === "x";
            return (
              <Hint key={h.id} label={h.kind === "gap" ? m.spacingGapHint : m.spacingPadHint}>
                <div
                  className="pointer-events-auto absolute cursor-grab border-[1.5px] border-select bg-white active:cursor-grabbing"
                  style={{
                    left: view.x + h.x * view.zoom,
                    top: view.y + h.y * view.zoom,
                    width: vertical ? 8 : 22,
                    height: vertical ? 22 : 8,
                    borderRadius: 4,
                    transform: `translate(-50%, -50%) rotate(${spacingModel.rotation || 0}deg)`,
                  }}
                  data-spacing={h.id}
                  aria-label={label}
                  onPointerDown={onSpacingDown(h)}
                />
              </Hint>
            );
          })}
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
      {dropUi?.highlight && (
        <div className="pointer-events-none absolute border-2 border-select" style={dropUi.highlight} data-testid="drop-target" />
      )}
      {dropUi?.marker && (
        <div className="pointer-events-none absolute rounded-sm bg-select" style={dropUi.marker} data-testid="drop-marker" />
      )}
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
