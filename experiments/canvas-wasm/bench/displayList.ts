// Flattens a Paprika document into the packed display list read by `src/scene.rs`.
// Layout stays in the browser: when a frame uses auto layout, boxes are measured from a
// hidden DOM built with `nodeStyle` (the same engine as the canvas and the export).
import { nodeStyle, resolveValue, type Document, type Node } from "@paprika/core";

export const STRIDE = 16;
const KIND = { rect: 0, ellipse: 1, pushClip: 2, popClip: 3, path: 4 } as const;

export interface Box { x: number; y: number; w: number; h: number }

const probe = document.createElement("canvas").getContext("2d")!;
const colorCache = new Map<string, [number, number, number, number]>();

/** CSS color → straight RGBA 0..1. Gradients and unknown values come back as `null`. */
export function parseColor(css: string): [number, number, number, number] | null {
  const hit = colorCache.get(css);
  if (hit) return hit;
  if (/gradient|url\(/.test(css)) return null;
  probe.fillStyle = "#000001";
  probe.fillStyle = css;
  const v = String(probe.fillStyle);
  let out: [number, number, number, number] | null = null;
  if (v.startsWith("#")) {
    const n = parseInt(v.slice(1), 16);
    out = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
    if (v === "#000001" && css.trim() !== "#000001") out = null;
  } else {
    const m = v.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const [r, g, b, a = "1"] = m[1]!.split(",").map((s) => s.trim());
      out = [Number(r) / 255, Number(g) / 255, Number(b) / 255, Number(a)];
    }
  }
  if (out) colorCache.set(css, out);
  return out;
}

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

export function flatten(doc: Document, boxes = layoutBoxes(doc)): Flattened {
  const out: number[] = [];
  const paths: string[] = [];
  const skipped: Record<string, number> = {};
  const color = (v: string | undefined) => (v ? parseColor(String(resolveValue(doc, v))) : null);
  const push = (kind: number, n: Node, b: Box, opacity: number) => {
    const f = color(n.fill) ?? [0, 0, 0, 0];
    if (n.fill && !color(n.fill)) skipped.gradient = (skipped.gradient ?? 0) + 1;
    const s = n.stroke ? color(n.stroke.color) : null;
    out.push(kind, b.x, b.y, b.w, b.h, n.type === "ellipse" ? 0 : n.radius, n.rotation, opacity, f[0], f[1], f[2], f[3], s ? n.stroke!.width : 0, s?.[0] ?? 0, s?.[1] ?? 0, s?.[2] ?? 0);
    // The stroke alpha slot carries no color alpha in this layout: Rust uses the node opacity.
  };
  const walk = (id: string, parentOpacity: number) => {
    const n = doc.nodes[id];
    const b = boxes.get(id);
    if (!n || !b || !n.visible) return;
    // CSS opacity composites a group; multiplying per node is an approximation (differs on overlaps).
    const o = parentOpacity * n.opacity;
    switch (n.type) {
      case "frame":
        push(n.clip ? KIND.pushClip : KIND.rect, n, b, o);
        for (const c of n.children) walk(c, o);
        if (n.clip) out.push(KIND.popClip, ...new Array(STRIDE - 1).fill(0));
        break;
      case "rect":
        push(KIND.rect, n, b, o);
        break;
      case "ellipse":
        push(KIND.ellipse, n, b, o);
        break;
      case "path": {
        const vb = n.viewBox ?? [0, 0, 0, 0];
        paths.push(`${vb.join(" ")} ${n.fillRule} ${n.strokeCap} ${n.strokeJoin}|${n.d.replace(/\s+/g, " ")}`);
        push(KIND.path, n, b, o);
        out[out.length - STRIDE + 5] = paths.length - 1; // radius slot = path index
        break;
      }
      default:
        skipped[n.type] = (skipped[n.type] ?? 0) + 1; // text and images: not rendered by the prototype
    }
  };
  for (const id of doc.rootIds) walk(id, 1);
  return { data: new Float32Array(out), paths: paths.join("\n"), count: out.length / STRIDE, skipped };
}
