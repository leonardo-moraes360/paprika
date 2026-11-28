import { parsePath, pathToSubpaths, type AnchorRef, type Document, type Node, type PathNode, type Subpath } from "@paprika/core";
import type { Pt } from "../types";

/** What a press in the edit layer landed on. */
export type PathHit = { kind: "anchor"; ref: AnchorRef } | { kind: "handle"; ref: AnchorRef; side: "in" | "out" } | { kind: "outline" };

const HIT = "[data-path-anchor], [data-path-handle], [data-path-outline]";

/** The anchor, handle or outline an event target is (the edit layer marks its elements with `data-path-*`). */
export function pathHit(target: EventTarget | null): PathHit | null {
  const el = target instanceof Element ? target.closest<SVGElement>(HIT) : null;
  if (!el) return null;
  if (el.dataset.pathOutline !== undefined) return { kind: "outline" };
  const [sub, index, side] = (el.dataset.pathAnchor ?? el.dataset.pathHandle ?? "").split(":");
  const ref = { sub: Number(sub), index: Number(index) };
  if (!Number.isInteger(ref.sub) || !Number.isInteger(ref.index)) return null;
  return el.dataset.pathHandle !== undefined ? { kind: "handle", ref, side: side === "in" ? "in" : "out" } : { kind: "anchor", ref };
}

/** The subpaths of a path's `d`, or `null` when it does not parse. */
export function subpathsOf(d: string): Subpath[] | null {
  try {
    return pathToSubpaths(parsePath(d));
  } catch {
    return null;
  }
}

/** A path placed by its own x and y (not by a parent's auto-layout): editing it may move its box. */
export function isAbsolute(doc: Document, node: Node): boolean {
  if (node.type === "page") return false;
  if ("layoutPositioning" in node && node.layoutPositioning === "absolute") return true;
  const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
  return !parent || parent.type !== "frame" || !parent.layout || parent.layout.mode === "none";
}

/** How many of the path's own units one pixel of the node box is (a path with a `viewBox` is scaled to fit its box). */
export function viewBoxScale(node: Pick<PathNode, "viewBox" | "width" | "height">): number {
  if (!node.viewBox || typeof node.width !== "number" || typeof node.height !== "number") return 1;
  return Math.min(node.width / node.viewBox[2], node.height / node.viewBox[3]);
}

export type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };

/** Screen (client) point to the coordinates of an SVG element, from its `getScreenCTM()` taken once (the element may change while a point is dragged). */
export function toSvgPoint(m: Matrix, clientX: number, clientY: number): Pt {
  const det = m.a * m.d - m.b * m.c || 1;
  const x = clientX - m.e;
  const y = clientY - m.f;
  return { x: (m.d * x - m.c * y) / det, y: (-m.b * x + m.a * y) / det };
}

export function screenMatrix(svg: SVGGraphicsElement): Matrix | null {
  const m = svg.getScreenCTM?.();
  return m ? { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f } : null;
}
