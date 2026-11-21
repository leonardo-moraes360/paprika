// Flattens a Paprika document into the packed display list read by `src/scene.rs`.
// Layout stays in the browser: when a frame uses auto layout, boxes are measured from a
// hidden DOM built with `nodeStyle` (the same engine as the canvas and the export).
import { DISPLAY_STRIDE, displayList, nodeStyle, type Document, type Node } from "@paprika/core";

export const STRIDE = DISPLAY_STRIDE;

export interface Box { x: number; y: number; w: number; h: number }

const hasAutoLayout = (doc: Document) =>
  Object.values(doc.nodes).some((n) => n.type === "frame" && n.layout && n.layout.mode !== "none");

/** Absolute (document-space) box of every node, before rotation. */
export function layoutBoxes(doc: Document): Map<string, Box> {
  const boxes = new Map<string, Box>();
  if (!hasAutoLayout(doc)) {
    const walk = (id: string, ox: number, oy: number) => {
      const n = doc.nodes[id];
      if (!n) return;
      const w = typeof n.width === "number" ? n.width : 0;
      const h = typeof n.height === "number" ? n.height : 0;
      const b = { x: ox + n.x, y: oy + n.y, w, h };
      boxes.set(id, b);
      if (n.type === "frame") for (const c of n.children) walk(c, b.x, b.y);
    };
    for (const id of doc.rootIds) walk(id, 0, 0);
    return boxes;
  }
  // Auto layout ("hug", "fill", flex): let the browser solve it once, then read offsets.
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-100000px;top:0;visibility:hidden;contain:layout";
  document.body.append(host);
  const els = new Map<string, HTMLElement>();
  const build = (n: Node): HTMLElement => {
    const el = document.createElement(n.type === "image" ? "img" : "div");
    Object.assign(el.style, nodeStyle(doc, n) as Record<string, string>);
    if (n.type === "text") el.textContent = n.text;
    if (n.type === "frame") for (const c of n.children) { const k = doc.nodes[c]; if (k) el.append(build(k)); }
    els.set(n.id, el);
    return el;
  };
  for (const id of doc.rootIds) { const n = doc.nodes[id]; if (n) host.append(build(n)); }
  const abs = (el: HTMLElement): [number, number] => {
    let x = 0, y = 0;
    for (let e: HTMLElement | null = el; e && e !== host; e = e.offsetParent as HTMLElement | null) { x += e.offsetLeft; y += e.offsetTop; }
    return [x, y];
  };
  for (const [id, el] of els) { const [x, y] = abs(el); boxes.set(id, { x, y, w: el.offsetWidth, h: el.offsetHeight }); }
  host.remove();
  return boxes;
}

export interface Flattened { data: Float32Array; paths: string; count: number; skipped: Record<string, number> }

/** The app's display list (`@paprika/core`), plus what the WASM layer leaves to the DOM. */
export function flatten(doc: Document, boxes = layoutBoxes(doc)): Flattened {
  const list = displayList(doc, boxes);
  const skipped: Record<string, number> = {};
  for (const n of Object.values(doc.nodes)) if (n.type === "text" || n.type === "image") skipped[n.type] = (skipped[n.type] ?? 0) + 1;
  if (list.domPainted.size) skipped.domPainted = list.domPainted.size;
  return { data: list.data, paths: list.paths, count: list.count, skipped };
}
