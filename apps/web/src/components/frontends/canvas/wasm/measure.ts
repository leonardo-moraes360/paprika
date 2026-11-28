import type { Box } from "@paprika/core";

const LAYOUT_UNIT = 64;
/** The layout engine's own grain (1/64 px): a box read from the DOM is snapped to it so equal layouts give equal numbers. */
const snap = (v: number) => Math.round(v * LAYOUT_UNIT) / LAYOUT_UNIT;

const pixels = (value: string, fallback: number) => (value.endsWith("px") ? Number.parseFloat(value) : fallback);

/**
 * The exact box of every node in the page, in world units, read from the DOM (`[data-paprika-id]` under `world`). Positions come from the
 * layout and not from the document, so ancestor borders and fractional auto-layout sizes are in. A turned node has an
 * axis-aligned rectangle on screen: its box comes from its centre and its own size, and what is inside it chains through
 * the offsets. Paths take their exact inline style whoever paints them, so the box never flips with the painter.
 * One pass: every read of layout first (`getBoundingClientRect`) and nothing written, so a page of thousands of nodes costs one layout.
 * `zoom` is the scale the world is drawn at (the camera's).
 */
export function measureBoxes(world: HTMLElement, zoom: number): Map<string, Box> {
  const boxes = new Map<string, Box>();
  const wr = world.getBoundingClientRect();
  const k = zoom > 0 ? 1 / zoom : 1;
  const turned = new Map<Element, boolean>([[world, false]]);
  const isTurned = (el: Element | null): boolean => {
    if (!el) return false;
    const hit = turned.get(el);
    if (hit !== undefined) return hit;
    const t = (el as HTMLElement).style?.transform;
    const v = (!!t && t !== "none") || isTurned(el.parentElement);
    turned.set(el, v);
    return v;
  };
  const layout = new Map<Element, Box | null>([[world, { x: 0, y: 0, w: 0, h: 0 }]]);
  const place = (el: HTMLElement): Box | null => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0 && el.offsetParent === null) return null;
    if (!isTurned(el)) return { x: snap((r.left - wr.left) * k), y: snap((r.top - wr.top) * k), w: snap(r.width * k), h: snap(r.height * k) };
    const w = pixels(el.style.width, el.offsetWidth);
    const h = pixels(el.style.height, el.offsetHeight);
    if (!isTurned(el.parentElement)) {
      return { x: snap(((r.left + r.right) / 2 - wr.left) * k - w / 2), y: snap(((r.top + r.bottom) / 2 - wr.top) * k - h / 2), w, h };
    }
    const parent = el.offsetParent as HTMLElement | null;
    const p = parent && box(parent);
    if (!parent || !p) return null;
    return { x: p.x + parent.clientLeft + el.offsetLeft, y: p.y + parent.clientTop + el.offsetTop, w, h };
  };
  const box = (el: HTMLElement): Box | null => {
    const hit = layout.get(el);
    if (hit !== undefined) return hit;
    const v = place(el);
    layout.set(el, v);
    return v;
  };
  for (const el of world.querySelectorAll<Element>("[data-paprika-id]")) {
    const isPath = el.getAttribute("data-paprika-type") === "path";
    if (el instanceof HTMLElement && !isPath) {
      const b = box(el);
      if (b) boxes.set(el.getAttribute("data-paprika-id")!, b);
      continue;
    }
    if ((el instanceof SVGElement || el instanceof HTMLElement) && el.parentElement instanceof HTMLElement) {
      const parent = el.parentElement;
      const p = box(parent);
      const left = Number.parseFloat(el.style.left);
      const top = Number.parseFloat(el.style.top);
      const w = Number.parseFloat(el.style.width);
      const h = Number.parseFloat(el.style.height);
      if (!p || [left, top, w, h].some((n) => Number.isNaN(n))) continue;
      boxes.set(el.getAttribute("data-paprika-id")!, { x: p.x + parent.clientLeft + left, y: p.y + parent.clientTop + top, w, h });
    }
  }
  return boxes;
}
