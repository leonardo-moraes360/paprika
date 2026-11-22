import { parseColor } from "./lint.js";
import { pageRoots, type Document, type Node, type SceneNode } from "./schema.js";
import { modeOf, resolveValue } from "./style.js";

/**
 * Display list for the WASM canvas renderer (`crates/render`, ADR 0002).
 *
 * It is derived from the same node fields `nodeStyle` reads, so the WASM layer paints what the
 * DOM would paint. Layout is not computed here: the caller passes the boxes the browser already
 * resolved (auto layout, `hug`, `fill`), in canvas coordinates and before rotation.
 *
 * Entry layout (25 `f32`): `[kind, x, y, w, h, radius|pathIndex, rotation°, opacity,
 * fill r g b a, strokeWidth, stroke r g b a, shadow dx dy blur spread, shadow r g b a]`,
 * colors in 0..1. `kind`: 0 rect, 1 ellipse, 2 push clip, 3 pop clip, 4 path.
 * Path table: one line per path, `vx vy vw vh fillRule cap join|d`.
 */
export const DISPLAY_STRIDE = 25;
const KIND = { rect: 0, ellipse: 1, pushClip: 2, popClip: 3, path: 4 } as const;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DisplayList {
  data: Float32Array;
  paths: string;
  /** Entries in `data`. */
  count: number;
  /** Node ids whose own paint the WASM layer draws; the DOM must not paint them again. */
  painted: Set<string>;
  /**
   * Shape nodes left to the DOM because the renderer cannot draw them faithfully
   * (gradients or other non-solid colors, a drop shadow on a path).
   */
  domPainted: Set<string>;
}

type RGBA4 = [number, number, number, number];

/** A CSS color (or `$token`) as straight RGBA 0..1; `null` when it is not a solid color. */
export function solidColor(doc: Document, value: string | undefined, mode?: string): RGBA4 | null {
  if (value === undefined) return [0, 0, 0, 0];
  const css = String(resolveValue(doc, value, mode)).trim().toLowerCase();
  if (css === "transparent" || css === "none") return [0, 0, 0, 0];
  const c = parseColor(css);
  return c ? [c.r / 255, c.g / 255, c.b / 255, c.a] : null;
}

type Shape = Exclude<SceneNode, { type: "group" | "text" | "image" | "shape" | "connector" }>;
const SHAPES = new Set<Node["type"]>(["frame", "rect", "ellipse", "path"]);
const isShape = (n: Node): n is Shape => SHAPES.has(n.type);

/** True when the WASM layer can draw this node's own paint exactly as `nodeStyle` would.
 * Diagram `shape` nodes (rect/ellipse/diamond/triangle/note) stay on the DOM. */
export function wasmPaintable(doc: Document, n: Node): boolean {
  if (!isShape(n)) return false;
  if (!solidColor(doc, n.fill, modeOf(doc, n))) return false;
  if (n.stroke && !solidColor(doc, n.stroke.color, modeOf(doc, n))) return false;
  if (n.shadow && (n.type === "path" || !solidColor(doc, n.shadow.color, modeOf(doc, n)))) return false;
  return true;
}

/**
 * `pageId` picks the page the canvas shows (default: the first page, or the whole document when
 * it has no pages). Groups paint nothing: their children are drawn with the group's opacity.
 */
export function displayList(doc: Document, boxes: ReadonlyMap<string, Box>, pageId?: string): DisplayList {
  const out: number[] = [];
  const paths: string[] = [];
  const painted = new Set<string>();
  const domPainted = new Set<string>();

  const emit = (kind: number, n: Shape, b: Box, opacity: number, paint: boolean) => {
    const f = (paint && solidColor(doc, n.fill, modeOf(doc, n))) || [0, 0, 0, 0];
    const s = paint && n.stroke && n.stroke.width > 0 ? solidColor(doc, n.stroke.color, modeOf(doc, n)) : null;
    const sh = paint && n.shadow ? solidColor(doc, n.shadow.color, modeOf(doc, n)) : null;
    out.push(
      kind,
      b.x,
      b.y,
      b.w,
      b.h,
      n.type === "ellipse" || n.type === "path" ? 0 : n.radius,
      n.rotation,
      opacity,
      ...f,
      s ? n.stroke!.width : 0,
      ...(s ?? [0, 0, 0, 0]),
      sh ? n.shadow!.x : 0,
      sh ? n.shadow!.y : 0,
      sh ? n.shadow!.blur : 0,
      sh ? n.shadow!.spread : 0,
      ...(sh ?? [0, 0, 0, 0]),
    );
  };

  const walk = (id: string, parentOpacity: number) => {
    const n = doc.nodes[id];
    const b = boxes.get(id);
    // No box means the DOM did not lay it out (hidden, or not rendered): skip the subtree.
    if (!n || n.type === "page" || !b || !n.visible) return;
    const o = parentOpacity * n.opacity;
    if (n.type === "group") {
      for (const c of n.children) walk(c, o);
      return;
    }
    const paint = wasmPaintable(doc, n);
    if (isShape(n)) (paint ? painted : domPainted).add(id);
    switch (n.type) {
      case "frame":
        if (n.clip) emit(KIND.pushClip, n, b, o, paint);
        else if (paint) emit(KIND.rect, n, b, o, paint);
        for (const c of n.children) walk(c, o);
        if (n.clip) out.push(KIND.popClip, ...new Array<number>(DISPLAY_STRIDE - 1).fill(0));
        break;
      case "rect":
        if (paint) emit(KIND.rect, n, b, o, paint);
        break;
      case "ellipse":
        if (paint) emit(KIND.ellipse, n, b, o, paint);
        break;
      case "path":
        if (paint) {
          const vb = n.viewBox ?? [0, 0, 0, 0];
          paths.push(`${vb.join(" ")} ${n.fillRule} ${n.strokeCap} ${n.strokeJoin}|${n.d.replace(/\s+/g, " ")}`);
          emit(KIND.path, n, b, o, paint);
          out[out.length - DISPLAY_STRIDE + 5] = paths.length - 1;
        }
        break;
      default:
        break; // text and images stay in the DOM layer
    }
  };
  for (const id of pageRoots(doc, pageId)) walk(id, 1);
  return { data: new Float32Array(out), paths: paths.join("\n"), count: out.length / DISPLAY_STRIDE, painted, domPainted };
}
