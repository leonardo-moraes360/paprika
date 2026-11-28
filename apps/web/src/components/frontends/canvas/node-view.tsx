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
import { hasContentPatch, routedConnector, withPatch } from "./preview-node";
import { createNodeSlices, EDITING, HOVERED, PAINTED, SELECTED, useCanvasStore } from "./region";
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


/** The border `nodeStyle` writes: `<width> <style> <colour>` (the colour may hold spaces). */
const BORDER = /^(\S+) (solid|dashed|dotted|double) (.+)$/;

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
  // The canvas state comes through one listener on the store that tells each node only when ITS slice changed (see `createNodeSlices`):
  // a write to the store costs what changed, not how many nodes the page has.
  // A connector also follows the patches of the nodes it is attached to (and of the connector itself): it is routed again over them.
  const canvas = useCanvasStore();
  const slices = store.slot(canvas, () => createNodeSlices(canvas, store.doc));
  const subscribeSlice = useCallback((listener: () => void) => slices.subscribe(id, listener), [slices, id]);
  const readSlice = useCallback(() => slices.read(id, snap.node), [slices, id, snap.node]);
  const { flags, patch, linked } = useSyncExternalStore(subscribeSlice, readSlice, readSlice);
  const attach = useCallback((el: HTMLElement | null) => (el ? store.attach(id, el) : undefined), [store, id]);
  // Once per committed render (a StrictMode double render is not counted twice).
  useLayoutEffect(() => store.countRender(id));
  const doc = store.doc();
  const held = snap.node;
  if (!held || held.type === "page") return null;
  // What the gesture shows over the node: a path's outline, a connector's route, a frame's gap and padding.
  const node = held.type === "connector" && linked.length > 0 ? routedConnector(doc, held, linked) : hasContentPatch(patch) ? withPatch(held, patch) : held;
  const css = { ...nodeStyle(doc, node) } as CSSProperties;
  // The WASM layer paints this node's fill, border and shadow: the DOM keeps the box (a border keeps its width, so auto layout does not move) and drops the paint.
  const painted = (flags & PAINTED) !== 0;
  if (typeof css.border === "string") {
    // The shorthand is written as its three longhands: a `borderColor` that comes and goes next to a `border` would, when it goes, take the colour of the border with it.
    const edge = BORDER.exec(css.border);
    if (edge) {
      delete css.border;
      css.borderWidth = edge[1];
      css.borderStyle = edge[2];
      css.borderColor = painted ? "transparent" : edge[3];
    }
  }
  if (painted) {
    if (css.background) css.background = "transparent";
    delete css.boxShadow;
    delete css.filter;
  }
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
    ref: attach as never,
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
      if (painted) return <div {...props} />;
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
