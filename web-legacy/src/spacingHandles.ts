import type { Layout } from "@paprika/core";

export type Side = "top" | "right" | "bottom" | "left";
export type Axis = "x" | "y";

export interface WorldBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpacingHandleGeom {
  id: string;
  kind: "padding" | "gap";
  side?: Side;
  axis: Axis;
  x: number;
  y: number;
}

type Pad = [number, number, number, number];

const SIDES: Side[] = ["top", "right", "bottom", "left"];

function clampLen(n: number): number {
  return Math.max(0, Math.min(100_000, Math.round(n)));
}

export function padTuple(padding: Layout["padding"] | undefined): Pad {
  if (Array.isArray(padding) && padding.length === 4) {
    return padding.map((v) => (typeof v === "number" ? v : 0)) as Pad;
  }
  const n = typeof padding === "number" ? padding : 0;
  return [n, n, n, n];
}

export function packPadding(p: Pad): number | Pad {
  return p[0] === p[1] && p[1] === p[2] && p[2] === p[3] ? p[0] : [p[0], p[1], p[2], p[3]];
}

export function paddingAfterDrag(start: Pad, side: Side, localDx: number, localDy: number, alt: boolean): number | Pad {
  const i = SIDES.indexOf(side);
  const delta = side === "top" ? localDy : side === "bottom" ? -localDy : side === "left" ? localDx : -localDx;
  const next = clampLen(start[i]! + delta);
  if (alt) return next;
  const pad: Pad = [start[0], start[1], start[2], start[3]];
  pad[i] = next;
  return packPadding(pad);
}

export function gapAfterDrag(start: number, axis: Axis, localDx: number, localDy: number): number {
  return clampLen(start + (axis === "x" ? localDx : localDy));
}

export function worldDeltaToLocal(dx: number, dy: number, rotationDeg: number): { x: number; y: number } {
  if (!rotationDeg) return { x: dx, y: dy };
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
}

function rotateAround(p: { x: number; y: number }, c: { x: number; y: number }, rotationDeg: number): { x: number; y: number } {
  if (!rotationDeg) return p;
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

function paddingValuesEqual(a: Layout["padding"] | undefined, b: Layout["padding"] | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return a === b;
}

export function sameLayout(a: Layout | undefined, b: Layout | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.mode === b.mode && a.gap === b.gap && a.align === b.align && a.justify === b.justify && !!a.wrap === !!b.wrap && paddingValuesEqual(a.padding, b.padding);
}

export function spacingHandles(
  frame: WorldBox & { rotation?: number },
  padding: Pad,
  children: WorldBox[],
  mode: "row" | "column",
): SpacingHandleGeom[] {
  const [pt, pr, pb, pl] = padding;
  const handles: SpacingHandleGeom[] = [
    { id: "padding-top", kind: "padding", side: "top", axis: "y", x: frame.x + frame.w / 2, y: frame.y + pt },
    { id: "padding-right", kind: "padding", side: "right", axis: "x", x: frame.x + frame.w - pr, y: frame.y + frame.h / 2 },
    { id: "padding-bottom", kind: "padding", side: "bottom", axis: "y", x: frame.x + frame.w / 2, y: frame.y + frame.h - pb },
    { id: "padding-left", kind: "padding", side: "left", axis: "x", x: frame.x + pl, y: frame.y + frame.h / 2 },
  ];
  const lines: WorldBox[][] = [];
  for (const child of children) {
    const line = lines.at(-1);
    const prev = line?.at(-1);
    const wrapped = !!prev && (mode === "row" ? child.x < prev.x - 0.5 : child.y < prev.y - 0.5);
    if (!line || wrapped) lines.push([child]);
    else line.push(child);
  }
  let n = 0;
  const pushGap = (x: number, y: number, axis: Axis) => {
    handles.push({ id: `gap-${n++}`, kind: "gap", axis, x, y });
  };
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i]!;
      const b = line[i + 1]!;
      if (mode === "row") pushGap((a.x + a.w + b.x) / 2, (Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2, "x");
      else pushGap((Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2, (a.y + a.h + b.y) / 2, "y");
    }
  }
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i]!;
    const b = lines[i + 1]!;
    if (mode === "row") {
      const bottom = Math.max(...a.map((c) => c.y + c.h));
      const top = Math.min(...b.map((c) => c.y));
      const left = Math.min(...a.map((c) => c.x), ...b.map((c) => c.x));
      const right = Math.max(...a.map((c) => c.x + c.w), ...b.map((c) => c.x + c.w));
      pushGap((left + right) / 2, (bottom + top) / 2, "y");
    } else {
      const right = Math.max(...a.map((c) => c.x + c.w));
      const left = Math.min(...b.map((c) => c.x));
      const top = Math.min(...a.map((c) => c.y), ...b.map((c) => c.y));
      const bottom = Math.max(...a.map((c) => c.y + c.h), ...b.map((c) => c.y + c.h));
      pushGap((right + left) / 2, (top + bottom) / 2, "x");
    }
  }
  const origin = { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
  const rot = frame.rotation ?? 0;
  if (!rot) return handles;
  return handles.map((h) => {
    const p = rotateAround(h, origin, rot);
    return { ...h, x: p.x, y: p.y };
  });
}
