import type { Box, NodeBox, Pt, View } from "./types";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
/** Room left around the page when it is fitted, in px. */
export const FIT_MARGIN = 120;
/** The wheel zoom: one notch of 100 units scales by about 14 %. */
export const WHEEL_ZOOM_RATE = 0.0015;
/** The cell of the grid in world units: 20 px at 100 %, as in the design. */
export const GRID = 20;

export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

export const sameView = (a: View, b: View) => a.x === b.x && a.y === b.y && a.zoom === b.zoom;

/** The CSS the world element carries. */
export const viewTransform = (v: View) => `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;

/** Zoom to `next` keeping the world point under the screen point (`px`, `py`, relative to the viewport) where it is. */
export function zoomAround(v: View, px: number, py: number, next: number): View {
  const zoom = clampZoom(next);
  return { zoom, x: px - ((px - v.x) * zoom) / v.zoom, y: py - ((py - v.y) * zoom) / v.zoom };
}

/** A wheel step with Ctrl/Cmd held (the pinch of a trackpad arrives the same way). */
export const wheelZoom = (v: View, px: number, py: number, deltaY: number): View => zoomAround(v, px, py, v.zoom * Math.exp(-deltaY * WHEEL_ZOOM_RATE));

/** A plain wheel step moves the world; Shift turns a vertical wheel into a horizontal move (when the wheel has no horizontal part). */
export function wheelPan(v: View, deltaX: number, deltaY: number, shift: boolean): View {
  const swap = shift && deltaX === 0;
  return { ...v, x: v.x - (swap ? deltaY : deltaX), y: v.y - (swap ? 0 : deltaY) };
}

/** The camera that shows `bounds` whole, centred, at no more than 100 % and no less than the minimum zoom. */
export function fitView(bounds: Box, viewport: { width: number; height: number }): View {
  const zoom = Math.max(MIN_ZOOM, Math.min(1, (viewport.width - FIT_MARGIN) / Math.max(bounds.width, 1), (viewport.height - FIT_MARGIN) / Math.max(bounds.height, 1)));
  return { zoom, x: (viewport.width - bounds.width * zoom) / 2 - bounds.x * zoom, y: (viewport.height - bounds.height * zoom) / 2 - bounds.y * zoom };
}

/** The camera of a page with nothing on it: the stand-in box of `canvasBounds` (800 by 600) centred at 100 %, not shrunk to fit the room around it. */
export function emptyView(viewport: { width: number; height: number }): View {
  return { zoom: 1, x: (viewport.width - 800) / 2, y: (viewport.height - 600) / 2 };
}

/** The camera that centres `box`, shrinking the zoom only as far as needed for it to fit (an agent or a pin to look at). */
export function focusView(box: Box, viewport: { width: number; height: number }, v: View): View {
  const zoom = Math.max(MIN_ZOOM, Math.min(v.zoom, (viewport.width - FIT_MARGIN) / Math.max(box.width, 1), (viewport.height - FIT_MARGIN) / Math.max(box.height, 1)));
  return { zoom, x: viewport.width / 2 - (box.x + box.width / 2) * zoom, y: viewport.height / 2 - (box.y + box.height / 2) * zoom };
}

/** Screen (client) to world. `origin` is the viewport's top-left corner on the screen. */
export const toWorld = (v: View, origin: { left: number; top: number }, clientX: number, clientY: number): Pt => ({ x: (clientX - origin.left - v.x) / v.zoom, y: (clientY - origin.top - v.y) / v.zoom });

/** World to screen (client). */
export const toScreen = (v: View, origin: { left: number; top: number }, p: Pt): Pt => ({ x: origin.left + v.x + p.x * v.zoom, y: origin.top + v.y + p.y * v.zoom });

/** Screen to the coordinates a node of a parent whose top-left corner is at `parentOrigin` (screen) would use as `x`, `y`. */
export const toLocal = (v: View, parentOrigin: { left: number; top: number }, clientX: number, clientY: number): Pt => ({ x: (clientX - parentOrigin.left) / v.zoom, y: (clientY - parentOrigin.top) / v.zoom });

export function unionBox(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const b of boxes) {
    left = Math.min(left, b.x);
    top = Math.min(top, b.y);
    right = Math.max(right, b.x + b.width);
    bottom = Math.max(bottom, b.y + b.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The grid follows the camera; below 10 px a cell it steps to a 5x coarser grid so it never turns into a haze. */
export function gridCell(zoom: number): number {
  let cell = GRID * zoom;
  while (cell < 10) cell *= 5;
  return cell;
}

export const gridStyle = (v: View) => {
  const cell = gridCell(v.zoom);
  return { size: `${cell}px ${cell}px`, position: `${v.x % cell}px ${v.y % cell}px` };
};

/** The box a turned node covers (the bounding box of its rotated rectangle); a node that is not turned covers its own box. */
export function coveredBox(box: NodeBox): Box {
  if (!box.rotation) return { x: box.x, y: box.y, width: box.width, height: box.height };
  const a = (box.rotation * Math.PI) / 180;
  const width = Math.abs(box.width * Math.cos(a)) + Math.abs(box.height * Math.sin(a));
  const height = Math.abs(box.width * Math.sin(a)) + Math.abs(box.height * Math.cos(a));
  return { x: box.x + box.width / 2 - width / 2, y: box.y + box.height / 2 - height / 2, width, height };
}

/** The selector of a node's element. The id goes through an attribute selector, so quotes and backslashes are escaped. */
export const nodeSelector = (id: string) => `[data-paprika-id="${id.replace(/["\\]/g, "\\$&")}"]`;

export const elementOf = (root: ParentNode, id: string): HTMLElement | null => root.querySelector<HTMLElement>(nodeSelector(id));

/** The id of the node an element belongs to (the nearest `data-paprika-id` above it), or `null`. */
export function nodeIdOf(target: EventTarget | null): string | null {
  return target instanceof Element ? (target.closest("[data-paprika-id]")?.getAttribute("data-paprika-id") ?? null) : null;
}

/**
 * The box of an element in world units, from the DOM (like the old canvas: the browser knows the size of a hugging text or
 * an auto-layout child). It reads layout, so call it for the few nodes you need, once per frame, and read everything before you write anything.
 * A turned node: the centre of its bounding box is the centre of the node, and `offsetWidth/Height` are its own size.
 */
export function measureElement(el: HTMLElement, origin: { left: number; top: number }, v: View, rotation = 0): NodeBox {
  const r = el.getBoundingClientRect();
  const left = (r.left - origin.left - v.x) / v.zoom;
  const top = (r.top - origin.top - v.y) / v.zoom;
  const width = r.width / v.zoom;
  const height = r.height / v.zoom;
  if (!rotation) return { x: left, y: top, width, height, rotation: 0 };
  const w = el.offsetWidth || width;
  const h = el.offsetHeight || height;
  const cx = left + width / 2;
  const cy = top + height / 2;
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h, rotation };
}

export const sameBox = (a: NodeBox | null, b: NodeBox | null) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.rotation === b.rotation);
