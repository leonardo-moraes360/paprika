import { isContainer } from "@paprika/core";
import { elementOf } from "./geometry";
import { dropAccepts, isFlowFrame, isUnder } from "./target";
import type { Box, CanvasRuntime, Pt } from "./types";

/** Where a dragged node would land: into a frame or a group (`parentId`), at a place of an auto-layout flow (`index`), or on the page (`null`). */
export type DropSpot = { parentId: string | null; index: number | undefined; highlightId: string | null; flow: boolean };
/** What the drop looks like while dragging: the container it goes into and, in a flow, the bar between two siblings. World units. */
export type DropUi = { highlight: Box; marker: Box | null };

export const NO_DROP: DropSpot = { parentId: null, index: undefined, highlightId: null, flow: false };

const flowAxis = (rt: CanvasRuntime, parentId: string): "row" | "column" => {
  const parent = rt.doc().nodes[parentId];
  return parent?.type === "frame" && parent.layout?.mode === "row" ? "row" : "column";
};

/** The slot of an auto-layout flow the pointer is over: the number of siblings (not counting the dragged ones) whose middle is before it. */
function flowIndex(rt: CanvasRuntime, parentId: string, clientX: number, clientY: number, dragged: ReadonlySet<string>): number {
  const parent = rt.doc().nodes[parentId];
  const vp = rt.viewport();
  if (!vp || !parent || !isContainer(parent) || parent.type === "page") return 0;
  const row = flowAxis(rt, parentId) === "row";
  const kids = parent.children.filter((id) => !dragged.has(id));
  const pos = row ? clientX : clientY;
  for (let i = 0; i < kids.length; i++) {
    const el = elementOf(vp, kids[i]!);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (pos < (row ? r.left + r.width / 2 : r.top + r.height / 2)) return i;
  }
  return kids.length;
}

/**
 * What is under the pointer that can take the dragged nodes. The dragged ones stop catching the pointer while it is asked, so
 * the node being dragged is never its own target. The first container (or the container of a node) that accepts wins.
 */
export function resolveDrop(rt: CanvasRuntime, clientX: number, clientY: number, dragged: ReadonlySet<string>): DropSpot {
  const vp = rt.viewport();
  const doc = rt.doc();
  let highlightId: string | null = null;
  if (vp && typeof document.elementsFromPoint === "function") {
    const restored: [HTMLElement, string][] = [];
    for (const id of dragged) {
      const el = elementOf(vp, id);
      if (!el) continue;
      restored.push([el, el.style.pointerEvents]);
      el.style.pointerEvents = "none";
    }
    try {
      for (const el of document.elementsFromPoint(clientX, clientY)) {
        const host = el.closest<HTMLElement | SVGElement>("[data-paprika-id]");
        if (!host || !vp.contains(host)) continue;
        const id = host.dataset.paprikaId!;
        if (dragged.has(id) || [...dragged].some((d) => isUnder(doc, id, d))) continue;
        const node = doc.nodes[id];
        if (!node) continue;
        if (isContainer(node) && node.type !== "page" && dropAccepts(doc, id, dragged)) {
          highlightId = id;
          break;
        }
        const parentId = node.parentId;
        if (parentId && dropAccepts(doc, parentId, dragged) && isContainer(doc.nodes[parentId]) && doc.nodes[parentId]!.type !== "page") {
          highlightId = parentId;
          break;
        }
      }
    } finally {
      for (const [el, prev] of restored) el.style.pointerEvents = prev;
    }
  }
  const flow = isFlowFrame(highlightId ? doc.nodes[highlightId] : undefined);
  return { parentId: highlightId, index: flow && highlightId ? flowIndex(rt, highlightId, clientX, clientY, dragged) : undefined, highlightId, flow };
}

/** The highlight of the container and, in a flow, the bar where the node would go (2 px off the sibling, 3 px thick on screen). */
export function dropUi(rt: CanvasRuntime, spot: DropSpot, dragged: ReadonlySet<string>): DropUi | null {
  if (!spot.highlightId) return null;
  const highlight = rt.measure(spot.highlightId);
  if (!highlight) return null;
  let marker: Box | null = null;
  const parent = spot.parentId ? rt.doc().nodes[spot.parentId] : undefined;
  if (spot.flow && spot.index !== undefined && parent && isContainer(parent) && parent.type !== "page") {
    const unit = 1 / rt.view.get().zoom;
    const thick = 3 * unit;
    const pad = 2 * unit;
    const row = flowAxis(rt, parent.id) === "row";
    const kids = parent.children.filter((id) => !dragged.has(id));
    if (kids.length === 0) {
      const inset = 8 * unit;
      marker = row
        ? { x: highlight.x + inset, y: highlight.y + inset, width: thick, height: Math.max(24 * unit, highlight.height - 2 * inset) }
        : { x: highlight.x + inset, y: highlight.y + inset, width: Math.max(24 * unit, highlight.width - 2 * inset), height: thick };
    } else if (spot.index >= kids.length) {
      const r = rt.measure(kids[kids.length - 1]!);
      if (r) marker = row ? { x: r.x + r.width + pad, y: r.y, width: thick, height: r.height } : { x: r.x, y: r.y + r.height + pad, width: r.width, height: thick };
    } else {
      const r = rt.measure(kids[spot.index]!);
      if (r) marker = row ? { x: r.x - pad - unit, y: r.y, width: thick, height: r.height } : { x: r.x, y: r.y - pad - unit, width: r.width, height: thick };
    }
  }
  return { highlight, marker };
}

/** Screen point to the space a child of `parentId` is positioned in: the parent's top-left corner as the origin (the page's is the world's). */
export function localFor(rt: CanvasRuntime, parentId: string | null, clientX: number, clientY: number): Pt {
  const p = rt.toWorld(clientX, clientY);
  const box = parentId ? rt.measure(parentId) : null;
  return box ? { x: p.x - box.x, y: p.y - box.y } : p;
}
