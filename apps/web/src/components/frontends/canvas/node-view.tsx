import {
  connectorAttrs,
  connectorLabelAttrs,
  nodeStyle,
  pathAttrs,
  resolveAsset,
  SHAPE_SVG_CSS,
  SHAPE_TEXT_CSS,
  shapeAttrs,
  textPieces,
  textRunCSS,
  type Document,
  type Node,
} from "@paprika/core";
import { createContext, memo, useCallback, useContext, useLayoutEffect, useSyncExternalStore, type CSSProperties } from "react";
import { useCanvasState } from "./region";
import type { RenderStore } from "./render-index";

export const RenderStoreContext = createContext<RenderStore | null>(null);

function useRenderStore(): RenderStore {
  const store = useContext(RenderStoreContext);
  if (!store) throw new Error("NodeView used outside a Canvas");
  return store;
}

type TextNode = Extract<Node, { type: "text" }>;

function TextRuns({ doc, node }: { doc: Document; node: TextNode }) {
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

const SELECTED = 1;
const HOVERED = 2;
const EDITING = 4;

/**
 * One node of the document as the DOM draws it (`nodeStyle` is the single source of its CSS, shared with the export and the
 * screenshot). It reads its own snapshot, its own flags and its own preview, so only a node whose answer changed renders:
 * a parent never re-renders for a child, and the camera never renders any node.
 */
// The inner function has its own name: inside it, `NodeView` must be the memoized component (a child that was not memoized renders with its parent).
export const NodeView = memo(function NodeViewOf({ id }: { id: string }) {
  const store = useRenderStore();
  const subscribe = useCallback((listener: () => void) => store.subscribe(id, listener), [store, id]);
  const read = useCallback(() => store.snapshot(id), [store, id]);
  const snap = useSyncExternalStore(subscribe, read, read);
  const flags = useCanvasState((s) => (s.selected.has(id) ? SELECTED : 0) | (s.hoveredId === id ? HOVERED : 0) | (s.editingId === id ? EDITING : 0));
  const patch = useCanvasState((s) => s.preview[id]);
  // Once per committed render (a StrictMode double render is not counted twice).
  useLayoutEffect(() => store.countRender(id));
  const node = snap.node;
  if (!node || node.type === "page") return null;
  const doc = store.doc();
  const css = { ...nodeStyle(doc, node) } as CSSProperties;
  if (patch) {
    if (patch.x !== undefined) css.left = patch.x;
    if (patch.y !== undefined) css.top = patch.y;
    if (patch.width !== undefined) css.width = patch.width;
    if (patch.height !== undefined) css.height = patch.height;
    if (patch.rotation !== undefined) css.transform = patch.rotation ? `rotate(${patch.rotation}deg)` : "none";
    if (patch.inert) css.pointerEvents = "none";
  }
  const editing = (flags & EDITING) !== 0;
  const props = {
    "data-paprika-id": node.id,
    "data-paprika-type": node.type,
    "data-selected": flags & SELECTED ? "" : undefined,
    "data-hovered": flags & HOVERED ? "" : undefined,
    style: css,
  };
  switch (node.type) {
    case "frame":
    case "group":
      return (
        <div {...props}>
          {node.children.map((child) => (
            <NodeView key={child} id={child} />
          ))}
        </div>
      );
    case "text":
      if (editing) css.visibility = "hidden";
      return <div {...props}>{node.runs?.length ? <TextRuns doc={doc} node={node} /> : node.text}</div>;
    case "image":
      return <img {...props} src={resolveAsset(doc, node.src)} alt={node.decorative ? "" : node.alt} aria-hidden={node.decorative || undefined} draggable={false} />;
    case "path": {
      const a = pathAttrs(doc, node);
      return (
        <svg {...props} {...a.svg}>
          {a.svgInner ? <g dangerouslySetInnerHTML={{ __html: a.svgInner }} /> : null}
          <path {...a.path} fillRule={a.path.fillRule as "nonzero" | "evenodd"} strokeLinecap={a.path.strokeLinecap as "round"} strokeLinejoin={a.path.strokeLinejoin as "round"} />
        </svg>
      );
    }
    case "shape": {
      const a = shapeAttrs(doc, node);
      return (
        <div {...props}>
          <svg xmlns="http://www.w3.org/2000/svg" width={a.svg.width} height={a.svg.height} style={SHAPE_SVG_CSS as CSSProperties}>
            {a.svgInner ? <g dangerouslySetInnerHTML={{ __html: a.svgInner }} /> : null}
            <path d={a.path.d} fill={a.path.fill} stroke={a.path.stroke} strokeWidth={a.path.strokeWidth} strokeLinejoin="round" strokeDasharray={a.path.strokeDasharray} />
            {a.fold && <path d={a.fold.d} fill={a.fold.fill} />}
          </svg>
          <div style={{ ...(SHAPE_TEXT_CSS as CSSProperties), ...(editing ? { visibility: "hidden" } : null) }}>{node.text}</div>
        </div>
      );
    }
    case "connector": {
      const a = connectorAttrs(doc, node);
      const label = connectorLabelAttrs(doc, node);
      return (
        <svg {...props} style={{ ...css, pointerEvents: "none" }} xmlns="http://www.w3.org/2000/svg" width={node.width} height={node.height}>
          <path d={a.d} fill="none" stroke="transparent" strokeWidth={Math.max(12, (typeof a.strokeWidth === "number" ? a.strokeWidth : 0) + 8)} style={{ pointerEvents: "stroke" }} data-connector-hit="" />
          <path d={a.d} fill="none" stroke={a.stroke} strokeWidth={a.strokeWidth} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={a.strokeDasharray} style={{ pointerEvents: "visibleStroke" }} />
          {label && !editing && (
            <text {...label} style={{ pointerEvents: "none", userSelect: "none" }} data-connector-label="">
              {node.label}
            </text>
          )}
        </svg>
      );
    }
    default:
      return <div {...props} />;
  }
});

/** The roots of the page in view. Renders again only when the list of roots changes. */
export function RootViews() {
  const store = useRenderStore();
  const roots = useSyncExternalStore(store.subscribeRoots, store.roots, store.roots);
  return (
    <>
      {roots.map((id) => (
        <NodeView key={id} id={id} />
      ))}
    </>
  );
}
