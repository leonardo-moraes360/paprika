import { resolveLength, type Document, type FrameNode, type Layout } from "@paprika/core";

export type Side = "top" | "right" | "bottom" | "left";
export type Axis = "x" | "y";
export type Pad = [number, number, number, number];
export type LocalBox = { x: number; y: number; w: number; h: number };

/** One handle of a frame with auto-layout, in the frame's own coordinates (the origin is its top-left corner, before any rotation). */
export type SpacingHandle = { id: string; kind: "padding" | "gap"; side?: Side; axis: Axis; x: number; y: number };

const SIDES: Side[] = ["top", "right", "bottom", "left"];

const clampLen = (n: number) => Math.max(0, Math.min(100_000, Math.round(n)));

export function padTuple(padding: Layout["padding"] | undefined): Pad {
  if (Array.isArray(padding) && padding.length === 4) return padding.map((v) => (typeof v === "number" ? v : 0)) as Pad;
  const n = typeof padding === "number" ? padding : 0;
  return [n, n, n, n];
}

export const packPadding = (p: Pad): number | Pad => (p[0] === p[1] && p[1] === p[2] && p[2] === p[3] ? p[0] : [p[0], p[1], p[2], p[3]]);

/** The four paddings of a frame in pixels (tokens and modes resolved), and its gap. */
export function spacingOf(doc: Document, frame: FrameNode, mode: string | undefined): { padding: Pad; gap: number } | null {
  const layout = frame.layout;
  if (!layout || layout.mode === "none") return null;
  const one = (v: number | string) => resolveLength(doc, v, mode) ?? 0;
  const raw = layout.padding;
  const padding = Array.isArray(raw) ? padTuple(raw.map((v) => one(v)) as Layout["padding"]) : padTuple(one(raw));
  return { padding, gap: one(layout.gap) };
}

/** The padding after the handle of `side` moved by `(dx, dy)` along the frame's own axes. `all` (Alt) sets the four sides to the same value. */
export function paddingAfterDrag(start: Pad, side: Side, dx: number, dy: number, all: boolean): number | Pad {
  const i = SIDES.indexOf(side);
  const delta = side === "top" ? dy : side === "bottom" ? -dy : side === "left" ? dx : -dx;
  const next = clampLen(start[i]! + delta);
  if (all) return next;
  const pad: Pad = [start[0], start[1], start[2], start[3]];
  pad[i] = next;
  return packPadding(pad);
}

export const gapAfterDrag = (start: number, axis: Axis, dx: number, dy: number): number => clampLen(start + (axis === "x" ? dx : dy));

/** A move in the world turned into one along the frame's own axes (a frame rotated by `rotationDeg`). */
export function worldDeltaToLocal(dx: number, dy: number, rotationDeg: number): { x: number; y: number } {
  if (!rotationDeg) return { x: dx, y: dy };
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
}

export function samePadding(a: Layout["padding"] | undefined, b: Layout["padding"] | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return a === b;
}

/**
 * The handles of a frame: one per padding side, one between each two neighbours of a line and, with wrap, one between each
 * two lines. `children` are the boxes of the children that take part in the layout, in order, in the frame's coordinates.
 */
export function spacingHandles(frame: { w: number; h: number }, padding: Pad, children: readonly LocalBox[], mode: "row" | "column"): SpacingHandle[] {
  const [pt, pr, pb, pl] = padding;
  const handles: SpacingHandle[] = [
    { id: "padding-top", kind: "padding", side: "top", axis: "y", x: frame.w / 2, y: pt },
    { id: "padding-right", kind: "padding", side: "right", axis: "x", x: frame.w - pr, y: frame.h / 2 },
    { id: "padding-bottom", kind: "padding", side: "bottom", axis: "y", x: frame.w / 2, y: frame.h - pb },
    { id: "padding-left", kind: "padding", side: "left", axis: "x", x: pl, y: frame.h / 2 },
  ];
  const lines: LocalBox[][] = [];
  for (const child of children) {
    const line = lines.at(-1);
    const prev = line?.at(-1);
    const wrapped = !!prev && (mode === "row" ? child.x < prev.x - 0.5 : child.y < prev.y - 0.5);
    if (!line || wrapped) lines.push([child]);
    else line.push(child);
  }
  let n = 0;
  const pushGap = (x: number, y: number, axis: Axis) => void handles.push({ id: `gap-${n++}`, kind: "gap", axis, x, y });
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
  return handles;
}

/** The layout after a handle moved by a world delta. */
export function layoutAfterDrag(base: Layout, start: { padding: Pad; gap: number }, handle: Pick<SpacingHandle, "kind" | "side" | "axis">, world: { dx: number; dy: number }, rotation: number, all: boolean): Layout | null {
  const local = worldDeltaToLocal(world.dx, world.dy, rotation);
  if (handle.kind === "gap") return { ...base, gap: gapAfterDrag(start.gap, handle.axis, local.x, local.y) };
  if (!handle.side) return null;
  return { ...base, padding: paddingAfterDrag(start.padding, handle.side, local.x, local.y, all) };
}

/** True when a layout's gap (for a gap handle) or paddings (for a padding one) are those the drag began with. */
export function unchangedSpacing(kind: "padding" | "gap", layout: Layout, start: { padding: Pad; gap: number }): boolean {
  if (kind === "gap") return (typeof layout.gap === "number" ? layout.gap : start.gap) === start.gap;
  const now = Array.isArray(layout.padding) ? padTuple(layout.padding as Layout["padding"]) : padTuple(typeof layout.padding === "number" ? layout.padding : 0);
  return now.every((v, i) => v === start.padding[i]);
}

/** The layout after the arrow keys changed one handle's value by `delta` px (a gap, or the padding of one side; `all` sets the four paddings). */
export function layoutAfterStep(base: Layout, start: { padding: Pad; gap: number }, handle: Pick<SpacingHandle, "kind" | "side">, delta: number, all: boolean): Layout | null {
  if (handle.kind === "gap") return { ...base, gap: clampLen(start.gap + delta) };
  if (!handle.side) return null;
  const i = SIDES.indexOf(handle.side);
  const next = clampLen(start.padding[i]! + delta);
  if (all) return { ...base, padding: next };
  const pad: Pad = [start.padding[0], start.padding[1], start.padding[2], start.padding[3]];
  pad[i] = next;
  return { ...base, padding: packPadding(pad) };
}
