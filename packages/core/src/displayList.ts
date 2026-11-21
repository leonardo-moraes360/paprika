import { parseColor } from "./lint.js";
import type { Document, Node } from "./schema.js";
import { resolveValue } from "./style.js";

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
export function solidColor(doc: Document, value: string | undefined): RGBA4 | null {
  if (value === undefined) return [0, 0, 0, 0];
  const css = String(resolveValue(doc, value)).trim().toLowerCase();
  if (css === "transparent" || css === "none") return [0, 0, 0, 0];
  const c = parseColor(css);
  return c ? [c.r / 255, c.g / 255, c.b / 255, c.a] : null;
}

const SHAPES = new Set<Node["type"]>(["frame", "rect", "ellipse", "path"]);

/** True when the WASM layer can draw this node's own paint exactly as `nodeStyle` would. */
export function wasmPaintable(doc: Document, n: Node): boolean {
  if (!SHAPES.has(n.type)) return false;
  if (!solidColor(doc, n.fill)) return false;
  if (n.stroke && !solidColor(doc, n.stroke.color)) return false;
  if (n.shadow && (n.type === "path" || !solidColor(doc, n.shadow.color))) return false;
  return true;
}

export function displayList(doc: Document, boxes: ReadonlyMap<string, Box>): DisplayList {
  const out: number[] = [];
  const paths: string[] = [];
  const painted = new Set<string>();
  const domPainted = new Set<string>();

  const emit = (kind: number, n: Node, b: Box, opacity: number, paint: boolean) => {
    const f = (paint && solidColor(doc, n.fill)) || [0, 0, 0, 0];
    const s = paint && n.stroke && n.stroke.width > 0 ? solidColor(doc, n.stroke.color) : null;
    const sh = paint && n.shadow ? solidColor(doc, n.shadow.color) : null;
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
    if (!n || !b || !n.visible) return;
    const o = parentOpacity * n.opacity;
    const paint = wasmPaintable(doc, n);
    if (SHAPES.has(n.type)) (paint ? painted : domPainted).add(id);
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
  for (const id of doc.rootIds) walk(id, 1);
  return { data: new Float32Array(out), paths: paths.join("\n"), count: out.length / DISPLAY_STRIDE, painted, domPainted };
}
