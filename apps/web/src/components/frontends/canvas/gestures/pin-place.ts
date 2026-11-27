import { isInstance, type Document } from "@paprika/core";
import { elementOf } from "../geometry";
import type { CanvasRuntime, Box, Gesture } from "../types";

/** Pixels of screen the pointer must travel before a press becomes a dragged area (a smaller one is a click). */
export const PIN_DRAG_PX = 4;
export const PIN_DRAG_KEY = "pin-drag";

const rounded = (a: { x: number; y: number }, b: { x: number; y: number }): Box => ({
  x: Math.round(Math.min(a.x, b.x)),
  y: Math.round(Math.min(a.y, b.y)),
  width: Math.round(Math.abs(b.x - a.x)),
  height: Math.round(Math.abs(b.y - a.y)),
});

/** The node under a point: the topmost one, lifted to its outermost group or instance (a pin points at the thing a person sees). A page is nothing. */
export function nodeUnder(rt: CanvasRuntime, doc: Document, clientX: number, clientY: number): string | null {
  const viewport = rt.viewport();
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    if (viewport && !viewport.contains(el)) continue;
    const hit = el.closest("[data-paprika-id]");
    const found = hit?.getAttribute("data-paprika-id");
    if (!found || !doc.nodes[found]) continue;
    let id = found;
    for (let parent = doc.nodes[id]?.parentId; parent; parent = doc.nodes[parent]?.parentId ?? null) {
      const node = doc.nodes[parent];
      if (node?.type === "group" || (node && isInstance(node))) id = parent;
    }
    return doc.nodes[id]?.type === "page" ? null : id;
  }
  return null;
}

/** The screen box of a node's element (the bounding box when it is turned) as a box in world units. */
function worldBox(rt: CanvasRuntime, el: HTMLElement): Box {
  const r = el.getBoundingClientRect();
  const a = rt.toWorld(r.left, r.top);
  const zoom = rt.view.get().zoom;
  return { x: Math.round(a.x), y: Math.round(a.y), width: Math.round(r.width / zoom), height: Math.round(r.height / zoom) };
}

/**
 * The pin tool ("Point for the AI"): a click on an element points at it, a drag marks an area, a click on nothing a spot. While
 * the area is being dragged only the overlay draws it (a value of the overlay bus); the point goes out once, on release.
 */
export const pinPlace: Gesture = {
  id: "pin-place",
  accepts: (rt, event) => event.button === 0 && rt.tool() === "pin",
  start: (rt, event) => {
    event.preventDefault();
    const p0 = rt.toWorld(event.clientX, event.clientY);
    const x0 = event.clientX;
    const y0 = event.clientY;
    let moved = false;
    const clear = () => rt.overlay.set(PIN_DRAG_KEY, null);
    return {
      move: (e) => {
        if (!moved && Math.hypot(e.clientX - x0, e.clientY - y0) < PIN_DRAG_PX) return;
        moved = true;
        rt.overlay.set(PIN_DRAG_KEY, rounded(p0, rt.toWorld(e.clientX, e.clientY)));
      },
      up: (e) => {
        clear();
        if (moved) {
          rt.pinPoint({ nodeId: null, region: rounded(p0, rt.toWorld(e.clientX, e.clientY)) });
          return;
        }
        const id = nodeUnder(rt, rt.doc(), e.clientX, e.clientY);
        const viewport = rt.viewport();
        const el = id && viewport ? elementOf(viewport, id) : null;
        if (id && el) rt.pinPoint({ nodeId: id, region: worldBox(rt, el) });
        else rt.pinPoint({ nodeId: null, region: { x: Math.round(p0.x), y: Math.round(p0.y), width: 0, height: 0 } });
      },
      cancel: clear,
    };
  },
};
