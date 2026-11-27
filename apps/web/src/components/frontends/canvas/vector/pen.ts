import { anchorsToPath, newId, parsePath, pathBounds, serializePath, translatePath, type Anchor, type Op } from "@paprika/core";
import type { Pt, VectorDefaults } from "../types";

/** A press this close (screen px) to the first anchor of a path of three or more points closes it. */
export const PEN_CLOSE_PX = 8;
/** A drag shorter than this (screen px) is a click: the anchor gets no handles. */
export const PEN_DRAG_PX = 3;
/** Two anchors closer than this (screen px) at the end of a double click are one press twice. */
export const PEN_DOUBLE_PX = 4;

/** The path being drawn: where it will live, where that parent's corner is in the world, and its anchors (in the parent's coordinates). */
export type PenDraft = { parentId: string | null; origin: Pt; anchors: Anchor[] };

const hundredths = (n: number) => Math.round(n * 100) / 100;

export const penAnchor = (p: Pt): Anchor => ({ x: hundredths(p.x), y: hundredths(p.y) });

/** A press on the first anchor of a path that already has three points closes it. */
export function closesPath(anchors: readonly Anchor[], p: Pt, zoom: number): boolean {
  const first = anchors[0];
  return !!first && anchors.length >= 3 && Math.hypot(first.x - p.x, first.y - p.y) * zoom < PEN_CLOSE_PX;
}

/** Dragging out of an anchor pulls its outgoing handle to the pointer and mirrors the incoming one. `null` while the drag is still a click. */
export function dragAnchor(anchor: Anchor, p: Pt, zoom: number): Anchor | null {
  if (Math.hypot(p.x - anchor.x, p.y - anchor.y) * zoom < PEN_DRAG_PX) return null;
  return { ...anchor, out: { x: p.x, y: p.y }, in: { x: 2 * anchor.x - p.x, y: 2 * anchor.y - p.y } };
}

/** A double click pressed twice at the same place: the second anchor is the same point, so it goes. */
export function withoutDoublePress(anchors: readonly Anchor[], zoom: number): Anchor[] {
  const last = anchors[anchors.length - 1];
  const before = anchors[anchors.length - 2];
  if (last && before && Math.hypot(last.x - before.x, last.y - before.y) * zoom < PEN_DOUBLE_PX) return anchors.slice(0, -1);
  return [...anchors];
}

/** The `create` op of a finished path (the old canvas' defaults: "Vetor N", a 2 px stroke, a fill only when closed), or `null` under two anchors. */
export function penOps(draft: PenDraft, closed: boolean, existingPaths: number, paint: VectorDefaults, id = newId()): { id: string; ops: Op[] } | null {
  if (draft.anchors.length < 2) return null;
  const segs = anchorsToPath(draft.anchors, closed);
  const b = pathBounds(segs);
  const x = Math.floor(b.x);
  const y = Math.floor(b.y);
  const d = serializePath(translatePath(segs, -x, -y));
  parsePath(d);
  const node: Record<string, unknown> = {
    type: "path",
    id,
    name: `Vetor ${existingPaths + 1}`,
    x,
    y,
    width: Math.max(1, Math.ceil(b.x + b.width) - x),
    height: Math.max(1, Math.ceil(b.y + b.height) - y),
    d,
    stroke: { color: paint.stroke, width: 2 },
  };
  if (closed) node.fill = paint.fill;
  return { id, ops: [{ op: "create", node: node as never, parentId: draft.parentId }] };
}
