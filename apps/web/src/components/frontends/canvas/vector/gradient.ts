import type { Gradient } from "@paprika/core";

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const round = (n: number, digits = 3) => {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
};

/** Which handle of a gradient: the angle end of a linear one, the centre, the radius or the angle of the others, or one stop. */
export type GradientHandle = { kind: "stop"; index: number } | { kind: "end" } | { kind: "center" } | { kind: "radius" } | { kind: "angle" };

export const handleKey = (h: GradientHandle) => (h.kind === "stop" ? `stop:${h.index}` : h.kind);

export function parseHandle(key: string | undefined): GradientHandle | null {
  if (!key) return null;
  if (key.startsWith("stop:")) {
    const index = Number(key.slice(5));
    return Number.isInteger(index) && index >= 0 ? { kind: "stop", index } : null;
  }
  return key === "end" || key === "center" || key === "radius" || key === "angle" ? { kind: key } : null;
}

/** The two ends of a linear gradient's line across a `w` x `h` box. */
export function gradientEnds(angle: number, w: number, h: number) {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const tx = dx === 0 ? Infinity : w / 2 / Math.abs(dx);
  const ty = dy === 0 ? Infinity : h / 2 / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x1: w / 2 - dx * t, y1: h / 2 - dy * t, x2: w / 2 + dx * t, y2: h / 2 + dy * t };
}

/** The angle, in degrees from the top and clockwise, at which `(x, y)` sees `(cx, cy)`. */
export function angleFrom(x: number, y: number, cx: number, cy: number) {
  const deg = (Math.atan2(x - cx, -(y - cy)) * 180) / Math.PI;
  return round((deg + 360) % 360, 1);
}

export type PlacedHandle = { key: string; handle: GradientHandle; x: number; y: number; color?: string };

/** Where each handle sits in a `w` x `h` box. */
export function placeHandles(g: Gradient, w: number, h: number): PlacedHandle[] {
  const line = gradientEnds(g.angle, w, h);
  const out: PlacedHandle[] = g.stops.map((s, index) => {
    let x = line.x1 + (line.x2 - line.x1) * s.offset;
    let y = line.y1 + (line.y2 - line.y1) * s.offset;
    if (g.type === "radial") {
      x = g.cx * w + g.radius * w * s.offset;
      y = g.cy * h;
    }
    if (g.type === "conic") {
      const rad = ((g.angle + s.offset * 360) * Math.PI) / 180;
      const ring = Math.min(w, h) * 0.28;
      x = g.cx * w + Math.sin(rad) * ring;
      y = g.cy * h - Math.cos(rad) * ring;
    }
    const handle: GradientHandle = { kind: "stop", index };
    return { key: handleKey(handle), handle, x, y, color: s.color };
  });
  if (g.type === "linear") out.push({ key: "end", handle: { kind: "end" }, x: line.x2, y: line.y2 });
  else out.push({ key: "center", handle: { kind: "center" }, x: g.cx * w, y: g.cy * h });
  if (g.type === "radial") out.push({ key: "radius", handle: { kind: "radius" }, x: g.cx * w + g.radius * w, y: g.cy * h });
  if (g.type === "conic") {
    const rad = (g.angle * Math.PI) / 180;
    out.push({ key: "angle", handle: { kind: "angle" }, x: g.cx * w + Math.sin(rad) * Math.min(w, h) * 0.42, y: g.cy * h - Math.cos(rad) * Math.min(w, h) * 0.42 });
  }
  return out;
}

/** The gradient after the handle was dragged to `(x, y)` (in the box, clamped to it by the caller). `base` is the gradient when the drag began. */
export function dragGradient(handle: GradientHandle, base: Gradient, x: number, y: number, w: number, h: number): Gradient {
  switch (handle.kind) {
    case "stop": {
      const next = structuredClone(base);
      let offset: number;
      if (base.type === "linear") {
        const a = gradientEnds(base.angle, w, h);
        const vx = a.x2 - a.x1;
        const vy = a.y2 - a.y1;
        const len2 = vx * vx + vy * vy || 1;
        offset = ((x - a.x1) * vx + (y - a.y1) * vy) / len2;
      } else if (base.type === "radial") {
        offset = (x - base.cx * w) / (base.radius * w || 1);
      } else {
        const ang = angleFrom(x, y, base.cx * w, base.cy * h);
        offset = ((((ang - base.angle) % 360) + 360) % 360) / 360;
      }
      const stop = next.stops[handle.index];
      if (stop) next.stops[handle.index] = { ...stop, offset: round(clamp(offset, 0, 1)) };
      return next;
    }
    case "end":
      return { ...base, angle: angleFrom(x, y, w / 2, h / 2) };
    case "center":
      return { ...base, cx: round(clamp(x / w, 0, 1)), cy: round(clamp(y / h, 0, 1)) };
    case "radius":
      return { ...base, radius: round(clamp(Math.hypot((x - base.cx * w) / w, (y - base.cy * h) / h), 0, 2)) };
    case "angle":
      return { ...base, angle: angleFrom(x, y, base.cx * w, base.cy * h) };
  }
}

/** The gradient after an arrow key moved a handle by one step (`dir` is -1 or +1; `big` is Shift). Stops, centre and radius move by 1 % (10 %), angles by 1 (15) degrees. */
export function nudgeGradient(handle: GradientHandle, base: Gradient, dir: -1 | 1, big: boolean): Gradient {
  const unit = (big ? 0.1 : 0.01) * dir;
  switch (handle.kind) {
    case "stop": {
      const next = structuredClone(base);
      const stop = next.stops[handle.index];
      if (stop) next.stops[handle.index] = { ...stop, offset: round(clamp(stop.offset + unit, 0, 1)) };
      return next;
    }
    case "end":
    case "angle":
      return { ...base, angle: round((((base.angle + (big ? 15 : 1) * dir) % 360) + 360) % 360, 1) };
    case "radius":
      return { ...base, radius: round(clamp(base.radius + unit, 0, 2)) };
    case "center":
      return { ...base, cx: round(clamp(base.cx + unit, 0, 1)) };
  }
}
