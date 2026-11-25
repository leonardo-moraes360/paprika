import { z } from "zod";
import { layout, measureText } from "./layout.js";
import { round4 } from "./num.js";
import { parsePath, pathBounds } from "./path.js";
import { isContainer, type Document, type Node } from "./schema.js";

interface LooseNode {
  type: string;
  children?: LooseNode[];
  [key: string]: unknown;
}

export const PLACE_GAP = 80;
export const PLACE_ROW_MAX = 2400;

export const PlaceSide = z.enum(["left", "right", "above", "below"]);
export const PlaceSpecSchema = z.union([
  z.enum(["free", "below", "right", "none"]),
  z.object({ near: z.string().min(1).max(64), side: PlaceSide }),
]);
export type PlaceSpec = z.infer<typeof PlaceSpecSchema>;

export interface SpotBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacementSummary {
  pageId: string | null;
  content: SpotBox;
  next: { x: number; y: number };
}

export interface PlacementIssue {
  rule: string;
  severity: "warning";
  nodeId: string;
  message: string;
}

export function placeNum(n: number): string {
  const r = round4(n);
  if (r === 0) return "0";
  return String(r);
}

function spot(x: number, y: number, w: number, h: number): SpotBox {
  return { x: round4(x), y: round4(y), w: round4(Math.max(0, w)), h: round4(Math.max(0, h)) };
}

export function boxesOverlap(a: SpotBox, b: SpotBox): boolean {
  const eps = 0.5;
  return a.x < b.x + b.w - eps && a.x + a.w > b.x + eps && a.y < b.y + b.h - eps && a.y + a.h > b.y + eps;
}

function unionBoxes(boxes: SpotBox[]): SpotBox | null {
  if (!boxes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return spot(minX, minY, maxX - minX, maxY - minY);
}

function freeOrigin(content: SpotBox | null, w: number, mode: "free" | "right" | "below"): { x: number; y: number } {
  if (!content) return { x: 0, y: 0 };
  if (mode === "below") return { x: round4(content.x), y: round4(content.y + content.h + PLACE_GAP) };
  const x = content.x + content.w + PLACE_GAP;
  const y = content.y;
  if (mode === "free" && x + w > content.x + PLACE_ROW_MAX) {
    return { x: round4(content.x), y: round4(content.y + content.h + PLACE_GAP) };
  }
  return { x: round4(x), y: round4(y) };
}

function nearOrigin(target: SpotBox, side: z.infer<typeof PlaceSide>, w: number, h: number): { x: number; y: number } {
  if (side === "left") return { x: round4(target.x - PLACE_GAP - w), y: round4(target.y) };
  if (side === "above") return { x: round4(target.x), y: round4(target.y - PLACE_GAP - h) };
  if (side === "below") return { x: round4(target.x), y: round4(target.y + target.h + PLACE_GAP) };
  return { x: round4(target.x + target.w + PLACE_GAP), y: round4(target.y) };
}

function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function nearestFree(occupied: SpotBox[], size: { w: number; h: number }, from: { x: number; y: number }): { x: number; y: number } {
  const content = unionBoxes(occupied);
  const candidates: { x: number; y: number }[] = [];
  if (content) {
    candidates.push(freeOrigin(content, size.w, "free"));
    candidates.push(freeOrigin(content, size.w, "right"));
    candidates.push(freeOrigin(content, size.w, "below"));
  } else {
    candidates.push({ x: 0, y: 0 });
  }
  for (const b of occupied) {
    candidates.push(nearOrigin(b, "right", size.w, size.h));
    candidates.push(nearOrigin(b, "below", size.w, size.h));
    candidates.push(nearOrigin(b, "left", size.w, size.h));
    candidates.push(nearOrigin(b, "above", size.w, size.h));
  }
  const fits = (p: { x: number; y: number }) => !occupied.some((b) => boxesOverlap(spot(p.x, p.y, size.w, size.h), b));
  const ok = candidates.filter(fits);
  const pool = ok.length ? ok : candidates;
  let best = pool[0]!;
  let bestD = dist2(best, from);
  for (const p of pool) {
    const d = dist2(p, from);
    const closer = d < bestD - 1e-9;
    const tie = Math.abs(d - bestD) <= 1e-9 && (p.x < best.x - 1e-9 || (Math.abs(p.x - best.x) <= 1e-9 && p.y < best.y - 1e-9));
    if (closer || tie) {
      best = p;
      bestD = d;
    }
  }
  return { x: round4(best.x), y: round4(best.y) };
}

export function contentPageId(doc: Document): string | null {
  const pages = doc.rootIds.filter((id) => doc.nodes[id]?.type === "page");
  if (!pages.length) return null;
  const withContent = pages.find((id) => {
    const p = doc.nodes[id];
    if (!p || !isContainer(p)) return false;
    return p.children.some((c) => {
      const n = doc.nodes[c];
      return !!n && n.type !== "connector" && n.type !== "page" && n.visible !== false;
    });
  });
  return withContent ?? pages[0]!;
}

function pageOf(doc: Document, rootId?: string): string | null {
  if (!rootId) return contentPageId(doc);
  const n = doc.nodes[rootId];
  if (!n) return contentPageId(doc);
  if (n.type === "page") return rootId;
  let cur: Node | undefined = n;
  while (cur) {
    if (cur.type === "page") return cur.id;
    cur = cur.parentId ? doc.nodes[cur.parentId] : undefined;
  }
  return null;
}

function siblingIds(doc: Document, parentId: string | null): string[] {
  if (parentId === null) return doc.rootIds;
  const p = doc.nodes[parentId];
  if (!p || !isContainer(p)) return [];
  return p.children;
}

function boxesUnder(doc: Document, id: string | null): ReturnType<typeof layout> {
  return layout(doc, id && doc.nodes[id] ? { rootId: id } : {});
}

export function placedSiblings(doc: Document, parentId: string | null): { id: string; box: SpotBox }[] {
  const boxes = boxesUnder(doc, parentId);
  let ox = 0;
  let oy = 0;
  if (parentId) {
    const p = boxes[parentId];
    if (p) {
      ox = p.x;
      oy = p.y;
    }
  }
  const out: { id: string; box: SpotBox }[] = [];
  for (const id of siblingIds(doc, parentId)) {
    const n = doc.nodes[id];
    if (!n || n.type === "page" || n.type === "connector" || n.visible === false) continue;
    const b = boxes[id];
    if (!b) continue;
    out.push({ id, box: spot(b.x - ox, b.y - oy, b.width, b.height) });
  }
  return out;
}

function boxInParent(doc: Document, id: string, parentId: string | null): SpotBox | null {
  const n = doc.nodes[id];
  if (!n || n.type === "page" || n.type === "connector") return null;
  const b = boxesUnder(doc, id)[id];
  if (!b) return null;
  let ox = 0;
  let oy = 0;
  if (parentId) {
    const p = boxesUnder(doc, parentId)[parentId];
    if (p) {
      ox = p.x;
      oy = p.y;
    }
  }
  return spot(b.x - ox, b.y - oy, b.width, b.height);
}

export function inputFootprint(node: LooseNode): { w: number; h: number } {
  if (node.type === "text") {
    const text = typeof node.text === "string" ? node.text : "";
    const fontSize = typeof node.fontSize === "number" ? node.fontSize : 16;
    const fontWeight = typeof node.fontWeight === "number" ? node.fontWeight : 400;
    const lineHeight = typeof node.lineHeight === "number" ? node.lineHeight : 1.4;
    const letterSpacing = typeof node.letterSpacing === "number" ? node.letterSpacing : 0;
    const maxWidth = typeof node.width === "number" ? node.width : undefined;
    const m = measureText(text, fontSize, { fontWeight, lineHeight, letterSpacing, maxWidth });
    const w = typeof node.width === "number" ? node.width : m.width;
    const h = typeof node.height === "number" ? node.height : m.height;
    return { w: round4(Math.max(0, w)), h: round4(Math.max(0, h)) };
  }
  if (node.type === "group") {
    let maxX = 0;
    let maxY = 0;
    for (const c of node.children ?? []) {
      const s = inputFootprint(c);
      const x = typeof c.x === "number" ? c.x : 0;
      const y = typeof c.y === "number" ? c.y : 0;
      maxX = Math.max(maxX, x + s.w);
      maxY = Math.max(maxY, y + s.h);
    }
    return { w: round4(maxX), h: round4(maxY) };
  }
  if (node.type === "shape") {
    const note = node.shape === "note";
    const w = typeof node.width === "number" ? node.width : 160;
    const h = typeof node.height === "number" ? node.height : note ? 160 : 80;
    return { w, h };
  }
  if (node.type === "path" && typeof node.d === "string" && (typeof node.width !== "number" || typeof node.height !== "number")) {
    try {
      const b = pathBounds(parsePath(node.d));
      const w = typeof node.width === "number" ? node.width : Math.max(1, Math.ceil(b.x + b.width));
      const h = typeof node.height === "number" ? node.height : Math.max(1, Math.ceil(b.y + b.height));
      return { w, h };
    } catch {
    }
  }
  const w = typeof node.width === "number" ? node.width : 100;
  const h = typeof node.height === "number" ? node.height : 100;
  return { w, h };
}

export function resolvePlace(doc: Document, parentId: string | null, node: LooseNode, place: PlaceSpec): string | null {
  if (place === "none" || node.type === "connector" || node.type === "page") return parentId;
  let parent = parentId;
  if (parent === null) {
    const page = contentPageId(doc);
    if (page) parent = page;
  }
  const size = inputFootprint(node);
  let pos: { x: number; y: number };
  if (typeof place === "object") {
    if (!doc.nodes[place.near]) throw new Error(`node "${place.near}" does not exist`);
    const target = boxInParent(doc, place.near, parent);
    if (!target) throw new Error(`node "${place.near}" has no box to place beside`);
    pos = nearOrigin(target, place.side, size.w, size.h);
  } else {
    const content = unionBoxes(placedSiblings(doc, parent).map((s) => s.box));
    pos = freeOrigin(content, size.w, place);
  }
  node.x = pos.x;
  node.y = pos.y;
  return parent;
}

export function placementSummary(doc: Document, rootId?: string): PlacementSummary {
  const pageId = pageOf(doc, rootId);
  const siblings = placedSiblings(doc, pageId);
  const content = unionBoxes(siblings.map((s) => s.box));
  return {
    pageId,
    content: content ?? { x: 0, y: 0, w: 0, h: 0 },
    next: freeOrigin(content, 0, "free"),
  };
}

export function placementFooter(doc: Document, rootId?: string): string {
  const s = placementSummary(doc, rootId);
  const page = s.pageId ? `page=${s.pageId} ` : "";
  const c = s.content;
  return `content: ${page}x=${placeNum(c.x)} y=${placeNum(c.y)} w=${placeNum(c.w)} h=${placeNum(c.h)}\nnext: x=${placeNum(s.next.x)} y=${placeNum(s.next.y)}`;
}

function labelOf(n: Node): string {
  return n.name || n.id;
}

export function overlapWarnings(doc: Document, created: readonly string[]): string[] {
  const fresh = new Set(created);
  const warnings: string[] = [];
  for (const id of created) {
    const n = doc.nodes[id];
    if (!n || n.type === "page" || n.type === "connector" || n.visible === false) continue;
    const parent = n.parentId;
    if (parent !== null && doc.nodes[parent]?.type !== "page") continue;
    const siblings = placedSiblings(doc, parent);
    const self = siblings.find((s) => s.id === id);
    if (!self) continue;
    const others = siblings.filter((s) => s.id !== id && boxesOverlap(self.box, s.box));
    if (!others.length) continue;
    const other = others.find((s) => !fresh.has(s.id)) ?? others[0]!;
    const spotAt = nearestFree(
      siblings.filter((s) => s.id !== id).map((s) => s.box),
      { w: self.box.w, h: self.box.h },
      { x: self.box.x, y: self.box.y },
    );
    const on = doc.nodes[other.id];
    warnings.push(`${n.type} "${labelOf(n)}" overlaps "${on ? labelOf(on) : other.id}"; nearest free spot is ${placeNum(spotAt.x)},${placeNum(spotAt.y)}`);
  }
  return warnings;
}

function chain(doc: Document, id: string): string[] {
  const out = [id];
  let cur = doc.nodes[id];
  while (cur?.parentId) {
    out.push(cur.parentId);
    cur = doc.nodes[cur.parentId];
  }
  return out;
}

function paintsAfter(doc: Document, a: string, b: string): boolean {
  if (a === b) return false;
  const ca = chain(doc, a);
  const cb = chain(doc, b);
  if (ca.includes(b) || cb.includes(a)) return false;
  const setA = new Set(ca);
  let common: string | null = null;
  for (const id of cb) {
    if (setA.has(id)) {
      common = id;
      break;
    }
  }
  let childA: string;
  let childB: string;
  let list: string[];
  if (common === null) {
    childA = ca[ca.length - 1]!;
    childB = cb[cb.length - 1]!;
    list = doc.rootIds;
  } else {
    const ia = ca.indexOf(common);
    const ib = cb.indexOf(common);
    if (ia <= 0 || ib <= 0) return false;
    childA = ca[ia - 1]!;
    childB = cb[ib - 1]!;
    const p = doc.nodes[common];
    if (!p || !isContainer(p)) return false;
    list = p.children;
  }
  return list.indexOf(childA) > list.indexOf(childB);
}

function descendant(doc: Document, id: string, ancestor: string): boolean {
  let cur = doc.nodes[id];
  while (cur?.parentId) {
    if (cur.parentId === ancestor) return true;
    cur = doc.nodes[cur.parentId];
  }
  return false;
}

function flowParent(doc: Document, id: string): boolean {
  const n = doc.nodes[id];
  const p = n?.parentId ? doc.nodes[n.parentId] : undefined;
  return !!p && p.type === "frame" && !!p.layout && p.layout.mode !== "none";
}

function intersectionArea(a: SpotBox, b: SpotBox): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return w * h;
}

function covers(frame: SpotBox, text: SpotBox): boolean {
  const area = text.w * text.h;
  if (area <= 0) return false;
  return intersectionArea(frame, text) >= area * 0.8 - 1e-6;
}

function absBoxes(doc: Document): Record<string, SpotBox> {
  const boxes = layout(doc);
  const out: Record<string, SpotBox> = {};
  for (const [id, b] of Object.entries(boxes)) out[id] = spot(b.x, b.y, b.width, b.height);
  return out;
}

export function placementLint(doc: Document, ids: readonly string[], opaque: (n: Node) => boolean): PlacementIssue[] {
  const allow = new Set(ids);
  const abs = absBoxes(doc);
  const issues: PlacementIssue[] = [];
  for (const id of ids) {
    const n = doc.nodes[id];
    if (!n || !allow.has(id)) continue;
    if (n.type === "frame" && n.visible !== false && (n.parentId === null || doc.nodes[n.parentId]?.type === "page")) {
      const siblings = placedSiblings(doc, n.parentId);
      const self = siblings.find((s) => s.id === id);
      if (self) {
        const earlier = siblings.filter((s) => {
          if (s.id === id || doc.nodes[s.id]?.type !== "frame") return false;
          const parent = n.parentId ? doc.nodes[n.parentId] : undefined;
          const list = parent && isContainer(parent) ? parent.children : doc.rootIds;
          return list.indexOf(s.id) >= 0 && list.indexOf(s.id) < list.indexOf(id) && boxesOverlap(self.box, s.box);
        });
        for (const other of earlier) {
          const spotAt = nearestFree(
            siblings.filter((s) => s.id !== id).map((s) => s.box),
            { w: self.box.w, h: self.box.h },
            { x: self.box.x, y: self.box.y },
          );
          const on = doc.nodes[other.id];
          issues.push({
            rule: "overlapping-boards",
            severity: "warning",
            nodeId: id,
            message: `overlaps "${on ? labelOf(on) : other.id}"; nearest free spot is ${placeNum(spotAt.x)},${placeNum(spotAt.y)}`,
          });
        }
      }
    }
    if (n.type === "text" && n.visible !== false) {
      const textBox = abs[id];
      if (!textBox) continue;
      for (const oid of Object.keys(doc.nodes)) {
        const o = doc.nodes[oid];
        if (!o || !opaque(o) || flowParent(doc, oid)) continue;
        if (descendant(doc, id, oid) || !paintsAfter(doc, id, oid)) continue;
        const frameBox = abs[oid];
        if (!frameBox || !covers(frameBox, textBox)) continue;
        let other = false;
        for (const sid of Object.keys(abs)) {
          if (sid === id || sid === oid || descendant(doc, sid, oid)) continue;
          const b = abs[sid];
          if (b && boxesOverlap(frameBox, b)) {
            other = true;
            break;
          }
        }
        if (!other) continue;
        issues.push({
          rule: "covered-by-overlay",
          severity: "warning",
          nodeId: id,
          message: `painted above opaque frame "${labelOf(o)}" which covers it; set index: "front" on "${labelOf(o)}"`,
        });
      }
    }
  }
  return issues;
}
