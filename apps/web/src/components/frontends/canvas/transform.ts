import type { Pt } from "./types";

/** Pure maths of the resize, the rotation and the marquee (world units; angles in degrees, as the document stores them). */
export type Corner = "nw" | "ne" | "sw" | "se";
export type Lock = "ratio" | "square" | null;

/** Screen px of pointer travel before a press becomes a move or a marquee (the old canvas used the same). */
export const DRAG_THRESHOLD = 3;
/** The step a turn snaps to while Shift is held. */
export const ROTATE_STEP = 15;

const SIGN: Record<Corner, Pt> = { nw: { x: -1, y: -1 }, ne: { x: 1, y: -1 }, se: { x: 1, y: 1 }, sw: { x: -1, y: 1 } };
export const OPPOSITE: Record<Corner, Corner> = { nw: "se", ne: "sw", se: "nw", sw: "ne" };

function axes(rotation: number) {
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: { x: cos, y: sin }, y: { x: -sin, y: cos } };
}

const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;

/** The corner of a box turned by `rotation` around its centre. */
export function boxCorner(x: number, y: number, w: number, h: number, rotation: number, corner: Corner): Pt {
  const s = SIGN[corner];
  const { x: ax, y: ay } = axes(rotation);
  const dx = (s.x * w) / 2;
  const dy = (s.y * h) / 2;
  return { x: x + w / 2 + dx * ax.x + dy * ay.x, y: y + h / 2 + dx * ax.y + dy * ay.y };
}

/** The four corners in the order nw, ne, se, sw. */
export const boxCorners = (x: number, y: number, w: number, h: number, rotation: number): Pt[] => (["nw", "ne", "se", "sw"] as const).map((c) => boxCorner(x, y, w, h, rotation, c));

/** Applies a lock to a size that changed from (`w0`, `h0`): the axis that moved more leads. */
export function lockSize(lock: Lock, width: number, height: number, w0: number, h0: number, ratio0: number): { width: number; height: number } {
  if (!lock) return { width, height };
  const dw = Math.abs(width - w0);
  const dh = Math.abs(height - h0);
  if (lock === "square") {
    const side = Math.max(1, dw >= dh ? width : height);
    return { width: side, height: side };
  }
  return dw >= dh ? { width, height: Math.max(1, width / Math.max(ratio0, 1e-6)) } : { width: Math.max(1, height * ratio0), height };
}

/** A turned node: the corner opposite the dragged one stays where it is (`fixed`, in the parent's space), the pointer gives the new size along the node's own axes. */
export function resizeTurned(corner: Corner, fixed: Pt, pointer: Pt, rotation: number, lock: Lock, ratio0: number, w0: number, h0: number) {
  const ax = axes(rotation);
  const dragged = SIGN[corner];
  const anchor = SIGN[OPPOSITE[corner]];
  const xSign = Math.sign(dragged.x - anchor.x) || 1;
  const ySign = Math.sign(dragged.y - anchor.y) || 1;
  const v = { x: pointer.x - fixed.x, y: pointer.y - fixed.y };
  const { width, height } = lockSize(lock, Math.max(1, dot(v, ax.x) / xSign), Math.max(1, dot(v, ax.y) / ySign), w0, h0, ratio0);
  const cx = fixed.x + (width / 2) * xSign * ax.x.x + (height / 2) * ySign * ax.y.x;
  const cy = fixed.y + (width / 2) * xSign * ax.x.y + (height / 2) * ySign * ax.y.y;
  return { x: Math.round(cx - width / 2), y: Math.round(cy - height / 2), width: Math.round(width), height: Math.round(height) };
}

/** An upright node: the corner opposite the dragged one stays; `dx`, `dy` is the pointer travel in world units. */
export function resizeUpright(corner: Corner, x0: number, y0: number, w0: number, h0: number, dx: number, dy: number, lock: Lock) {
  const west = corner === "nw" || corner === "sw";
  const north = corner === "nw" || corner === "ne";
  let left = x0;
  let top = y0;
  let right = x0 + w0;
  let bottom = y0 + h0;
  if (west) left = x0 + dx;
  else right = x0 + w0 + dx;
  if (north) top = y0 + dy;
  else bottom = y0 + h0 + dy;
  if (right - left < 1) {
    if (west) left = right - 1;
    else right = left + 1;
  }
  if (bottom - top < 1) {
    if (north) top = bottom - 1;
    else bottom = top + 1;
  }
  const { width, height } = lockSize(lock, right - left, bottom - top, w0, h0, w0 / Math.max(h0, 1e-6));
  if (lock) {
    if (west) left = right - width;
    else right = left + width;
    if (north) top = bottom - height;
    else bottom = top + height;
  }
  return { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) };
}

/** The rotation after the pointer went from angle `from` to angle `to` around the centre; Shift snaps to 15 degrees. */
export function turnedBy(rot0: number, from: number, to: number, snap: boolean): number {
  let rotation = rot0 + ((to - from) * 180) / Math.PI;
  if (snap) rotation = Math.round(rotation / ROTATE_STEP) * ROTATE_STEP;
  return Math.round(rotation * 100) / 100;
}

function pointInQuad(p: Pt, corners: readonly Pt[]): boolean {
  let prev = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % corners.length]!;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(cross) < 1e-6) continue;
    const s = Math.sign(cross);
    if (prev && s !== prev) return false;
    prev = s;
  }
  return prev !== 0;
}

function orientation(a: Pt, b: Pt, c: Pt) {
  const v = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  return Math.abs(v) < 1e-6 ? 0 : Math.sign(v);
}

const segmentsCross = (a: Pt, b: Pt, c: Pt, d: Pt) => orientation(a, b, c) !== orientation(a, b, d) && orientation(c, d, a) !== orientation(c, d, b);

export type Rect = { left: number; top: number; right: number; bottom: number };

/** Does a (turned) quad touch a rectangle: a corner inside, the rectangle's corner inside the quad, or two edges crossing. */
export function quadHitsRect(corners: readonly Pt[], rect: Rect): boolean {
  const inside = (p: Pt) => p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom;
  if (corners.some(inside)) return true;
  const rc = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
  if (rc.some((p) => pointInQuad(p, corners))) return true;
  for (let i = 0; i < corners.length; i++) {
    for (let j = 0; j < rc.length; j++) if (segmentsCross(corners[i]!, corners[(i + 1) % corners.length]!, rc[j]!, rc[(j + 1) % rc.length]!)) return true;
  }
  return false;
}

/** Does a node's box (turned or not) touch the marquee rectangle. */
export function boxHitsRect(box: { x: number; y: number; width: number; height: number; rotation: number }, rect: Rect): boolean {
  if (box.rotation) return quadHitsRect(boxCorners(box.x, box.y, box.width, box.height, box.rotation), rect);
  return box.x < rect.right && box.x + box.width > rect.left && box.y < rect.bottom && box.y + box.height > rect.top;
}
