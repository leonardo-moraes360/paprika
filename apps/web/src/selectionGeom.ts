export type Pt = { x: number; y: number };
export type Corner = "nw" | "ne" | "sw" | "se";

const SIGN: Record<Corner, { x: number; y: number }> = {
  nw: { x: -1, y: -1 },
  ne: { x: 1, y: -1 },
  se: { x: 1, y: 1 },
  sw: { x: -1, y: 1 },
};

const OPPOSITE: Record<Corner, Corner> = { nw: "se", ne: "sw", se: "nw", sw: "ne" };

function axes(rotation: number) {
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: { x: cos, y: sin }, y: { x: -sin, y: cos } };
}

function dot(a: Pt, b: Pt) {
  return a.x * b.x + a.y * b.y;
}

export function boxCorner(x: number, y: number, w: number, h: number, rotation: number, corner: Corner): Pt {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const s = SIGN[corner];
  const dx = (s.x * w) / 2;
  const dy = (s.y * h) / 2;
  const { x: ax, y: ay } = axes(rotation);
  return { x: cx + dx * ax.x + dy * ay.x, y: cy + dx * ax.y + dy * ay.y };
}

export function resizeBox(
  corner: Corner,
  fixed: Pt,
  pointer: Pt,
  rotation: number,
  lock: "ratio" | "square" | null,
  ratio0: number,
  w0: number,
  h0: number,
): { x: number; y: number; width: number; height: number } {
  const ax = axes(rotation);
  const dragged = SIGN[corner];
  const anchor = SIGN[OPPOSITE[corner]];
  const xSign = Math.sign(dragged.x - anchor.x) || 1;
  const ySign = Math.sign(dragged.y - anchor.y) || 1;
  const v = { x: pointer.x - fixed.x, y: pointer.y - fixed.y };
  let width = Math.max(1, dot(v, ax.x) / xSign);
  let height = Math.max(1, dot(v, ax.y) / ySign);
  if (lock === "square") {
    const dw = Math.abs(width - w0);
    const dh = Math.abs(height - h0);
    const side = Math.max(1, dw >= dh ? width : height);
    width = side;
    height = side;
  } else if (lock === "ratio") {
    const dw = Math.abs(width - w0);
    const dh = Math.abs(height - h0);
    if (dw >= dh) height = Math.max(1, width / Math.max(ratio0, 1e-6));
    else width = Math.max(1, height * ratio0);
  }
  const cx = fixed.x + (width / 2) * xSign * ax.x.x + (height / 2) * ySign * ax.y.x;
  const cy = fixed.y + (width / 2) * xSign * ax.x.y + (height / 2) * ySign * ax.y.y;
  return {
    x: Math.round(cx - width / 2),
    y: Math.round(cy - height / 2),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function pointInQuad(p: Pt, corners: readonly Pt[]): boolean {
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

function orientations(a: Pt, b: Pt, c: Pt) {
  const v = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(v) < 1e-6) return 0;
  return Math.sign(v);
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt) {
  return orientations(a, b, c) !== orientations(a, b, d) && orientations(c, d, a) !== orientations(c, d, b);
}

export function quadHitsRect(corners: readonly Pt[], rect: { left: number; top: number; right: number; bottom: number }): boolean {
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
    const a = corners[i]!;
    const b = corners[(i + 1) % corners.length]!;
    for (let j = 0; j < rc.length; j++) {
      if (segmentsCross(a, b, rc[j]!, rc[(j + 1) % rc.length]!)) return true;
    }
  }
  return false;
}

export function knobFromTop(tl: Pt, tr: Pt, gap: number): { mid: Pt; knob: Pt } {
  const mid = { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 };
  const dx = tr.x - tl.x;
  const dy = tr.y - tl.y;
  const len = Math.hypot(dx, dy) || 1;
  return { mid, knob: { x: mid.x + (dy / len) * gap, y: mid.y - (dx / len) * gap } };
}
