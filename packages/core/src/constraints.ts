import { round4 } from "./num.js";
import { isContainer, isScene, ignoresLayout, type Document, type FrameNode, type GroupNode, type Node, type SceneNode, type Size } from "./schema.js";
import { isInstance } from "./component.js";
import { layout, type LayoutBox } from "./layout.js";

const EPS = 1e-3;
const MAX = 100_000;

type HMode = "left" | "right" | "center" | "scale";
type VMode = "top" | "bottom" | "center" | "scale";

function numSize(v: Size | number | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function clampSize(v: number): number {
  return round4(Math.min(MAX, Math.max(0, v)));
}

function modes(n: Node): { h: HMode; v: VMode } {
  if ("constraints" in n && n.constraints) return { h: n.constraints.horizontal, v: n.constraints.vertical };
  return { h: "left", v: "top" };
}

function inFlow(parent: FrameNode, child: Node): boolean {
  const mode = parent.layout?.mode ?? "none";
  if (mode !== "row" && mode !== "column") return false;
  return !ignoresLayout(child);
}

function adjustable(n: Node | undefined): n is Exclude<SceneNode, { type: "connector" }> {
  return !!n && isScene(n) && n.type !== "connector" && n.sourceId === undefined;
}

function setSize(n: Exclude<SceneNode, { type: "connector" }>, key: "width" | "height", v: number) {
  (n as unknown as Record<string, unknown>)[key] = v;
}

function moveAxis(pos: number, size: number | null, oldP: number, newP: number, mode: HMode | VMode): { pos: number; size: number | null } {
  const d = newP - oldP;
  if (Math.abs(d) <= EPS) return { pos, size };
  if (mode === "left" || mode === "top") return { pos, size };
  if (mode === "right" || mode === "bottom") return { pos: round4(pos + d), size };
  if (mode === "center") return { pos: round4(pos + d / 2), size };
  if (oldP <= EPS) return { pos, size };
  const r = newP / oldP;
  return { pos: round4(pos * r), size: size == null ? null : clampSize(size * r) };
}

function scaleBox(n: Exclude<SceneNode, { type: "connector" }>, rw: number, rh: number) {
  if (Math.abs(rw - 1) > EPS) n.x = round4(n.x * rw);
  if (Math.abs(rh - 1) > EPS) n.y = round4(n.y * rh);
  if (n.type === "group") return;
  const w = numSize(n.width);
  const h = numSize(n.height);
  if (w != null && Math.abs(rw - 1) > EPS) setSize(n, "width", clampSize(w * rw));
  if (h != null && Math.abs(rh - 1) > EPS) setSize(n, "height", clampSize(h * rh));
}

function scaleGroupContents(doc: Document, g: GroupNode, rw: number, rh: number) {
  for (const cid of g.children) {
    const child = doc.nodes[cid];
    if (!adjustable(child)) continue;
    scaleBox(child, rw, rh);
    if (child.type === "group") scaleGroupContents(doc, child, rw, rh);
  }
}

function adjust(doc: Document, parent: FrameNode, cid: string, oldW: number, oldH: number, newW: number, newH: number) {
  const child = doc.nodes[cid];
  if (!adjustable(child) || inFlow(parent, child)) return;
  const { h, v } = modes(child);
  const nx = moveAxis(child.x, numSize(child.type === "group" ? undefined : child.width), oldW, newW, h);
  const ny = moveAxis(child.y, numSize(child.type === "group" ? undefined : child.height), oldH, newH, v);
  child.x = nx.pos;
  child.y = ny.pos;
  if (child.type !== "group" && !isInstance(child)) {
    if (h === "scale" && nx.size != null) setSize(child, "width", nx.size);
    if (v === "scale" && ny.size != null) setSize(child, "height", ny.size);
  } else if (child.type === "group" && (h === "scale" || v === "scale")) {
    const rw = h === "scale" && oldW > EPS ? newW / oldW : 1;
    const rh = v === "scale" && oldH > EPS ? newH / oldH : 1;
    scaleGroupContents(doc, child, rw, rh);
  }
}

type Snap = { w: number | null; h: number | null };

function snapOf(n: Node): Snap {
  if (!isScene(n)) return { w: null, h: null };
  return { w: numSize(n.width), h: numSize(n.height) };
}

export function applyConstraints(before: Document, draft: Document): void {
  const base = new Map<string, Snap>();
  for (const n of Object.values(before.nodes)) if (isScene(n)) base.set(n.id, snapOf(n));
  for (const n of Object.values(draft.nodes)) {
    if (!isScene(n)) continue;
    const now = snapOf(n);
    const prev = base.get(n.id);
    if (!prev) {
      base.set(n.id, now);
      continue;
    }
    if (prev.w == null) prev.w = now.w;
    if (prev.h == null) prev.h = now.h;
  }
  const visit = (id: string) => {
    const n = draft.nodes[id];
    if (!n) return;
    if (n.type === "frame" && !isInstance(n) && n.sourceId === undefined) {
      const old = base.get(id);
      const nw = numSize(n.width);
      const nh = numSize(n.height);
      const widthChanged = old?.w != null && nw != null && Math.abs(nw - old.w) > EPS;
      const heightChanged = old?.h != null && nh != null && Math.abs(nh - old.h) > EPS;
      if (widthChanged || heightChanged) {
        const oldW = widthChanged ? old!.w! : (nw ?? 0);
        const newW = widthChanged ? nw! : oldW;
        const oldH = heightChanged ? old!.h! : (nh ?? 0);
        const newH = heightChanged ? nh! : oldH;
        for (const cid of n.children) adjust(draft, n, cid, oldW, oldH, newW, newH);
      }
    }
    if (isContainer(n)) for (const c of n.children) visit(c);
  };
  for (const id of draft.rootIds) visit(id);
  followLayout(before, draft);
}

function layoutAll(doc: Document): Record<string, LayoutBox> {
  const pages = doc.rootIds.filter((id) => doc.nodes[id]?.type === "page");
  if (!pages.length) return layout(doc);
  const out: Record<string, LayoutBox> = {};
  for (const id of pages) Object.assign(out, layout(doc, { rootId: id }));
  return out;
}

function pinned(doc: Document, f: FrameNode): boolean {
  return f.children.some((cid) => {
    const c = doc.nodes[cid];
    if (!adjustable(c) || inFlow(f, c)) return false;
    const { h, v } = modes(c);
    return h !== "left" || v !== "top";
  });
}

/**
 * Frames whose own size is not numeric (fill, hug) still change size when an ancestor is resized or
 * their content changes. Their pinned non-flow children follow the delta of the laid-out size.
 */
function followLayout(before: Document, draft: Document): void {
  const candidates: FrameNode[] = [];
  for (const n of Object.values(draft.nodes)) {
    if (n.type !== "frame" || isInstance(n) || n.sourceId !== undefined) continue;
    const prev = before.nodes[n.id];
    if (!prev || !isScene(prev)) continue;
    if ((numSize(n.width) == null && numSize(prev.width) == null) || (numSize(n.height) == null && numSize(prev.height) == null)) {
      if (pinned(draft, n)) candidates.push(n);
    }
  }
  if (!candidates.length) return;
  const was = layoutAll(before);
  const now = layoutAll(draft);
  const done = new Set<string>();
  const visit = (id: string) => {
    const n = draft.nodes[id];
    if (!n) return;
    if (candidates.includes(n as FrameNode) && !done.has(id)) {
      done.add(id);
      const fr = n as FrameNode;
      const prev = before.nodes[id] as SceneNode;
      const a = was[id];
      const b = now[id];
      if (a && b) {
        const dynW = numSize(fr.width) == null && numSize(prev.width) == null;
        const dynH = numSize(fr.height) == null && numSize(prev.height) == null;
        const wc = dynW && Math.abs(b.width - a.width) > EPS;
        const hc = dynH && Math.abs(b.height - a.height) > EPS;
        if (wc || hc) {
          const oldW = wc ? a.width : b.width;
          const oldH = hc ? a.height : b.height;
          for (const cid of fr.children) adjust(draft, fr, cid, oldW, oldH, b.width, b.height);
        }
      }
    }
    if (isContainer(n)) for (const c of n.children) visit(c);
  };
  for (const id of draft.rootIds) visit(id);
}
