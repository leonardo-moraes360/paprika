import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { gradientCSS, modeOf, nodeGradient, type Document, type Gradient, type Node } from "@paprika/core";
import { useT } from "./i18n";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function round(n: number, d = 3) {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

function ends(angle: number, w: number, h: number) {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const tx = dx === 0 ? Infinity : w / 2 / Math.abs(dx);
  const ty = dy === 0 ? Infinity : h / 2 / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x1: w / 2 - dx * t, y1: h / 2 - dy * t, x2: w / 2 + dx * t, y2: h / 2 + dy * t };
}

function angleFrom(x: number, y: number, cx: number, cy: number) {
  const deg = (Math.atan2(x - cx, -(y - cy)) * 180) / Math.PI;
  return round((deg + 360) % 360, 1);
}

export function GradientHandles({
  doc,
  node,
  width,
  height,
  onCommit,
}: {
  doc: Document;
  node: Node;
  width: number;
  height: number;
  onCommit(gradient: Gradient): void;
}) {
  const m = useT();
  const base = nodeGradient(node);
  const [draft, setDraft] = useState<Gradient | null>(null);
  const g = draft ?? base;
  if (!g || !base || width < 8 || height < 8) return null;
  if ("rotation" in node && Math.abs(node.rotation) > 0.5) return null;
  const live = (next: Gradient) => {
    if (node.type === "frame" || node.type === "rect" || node.type === "ellipse" || node.type === "text" || node.type === "image") {
      const el = document.querySelector<HTMLElement>(`[data-paprika-id="${CSS.escape(node.id)}"]`);
      if (el) el.style.background = gradientCSS(doc, next, modeOf(doc, node), false);
    }
  };
  const drag = (apply: (x: number, y: number, current: Gradient) => Gradient) => (e: ReactPointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const host = (e.currentTarget as HTMLElement).closest("[data-gradient-handles]") as HTMLElement | null;
    if (!host) return;
    const move = (ev: PointerEvent) => {
      const box = host.getBoundingClientRect();
      const x = clamp(ev.clientX - box.left, 0, box.width);
      const y = clamp(ev.clientY - box.top, 0, box.height);
      const sx = (x / box.width) * width;
      const sy = (y / box.height) * height;
      const next = apply(sx, sy, base);
      setDraft(next);
      live(next);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const box = host.getBoundingClientRect();
      const x = clamp(ev.clientX - box.left, 0, box.width);
      const y = clamp(ev.clientY - box.top, 0, box.height);
      setDraft(null);
      onCommit(apply((x / box.width) * width, (y / box.height) * height, base));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const line = ends(g.angle, width, height);
  const stops = g.stops.map((s, index) => {
    let x = line.x1 + (line.x2 - line.x1) * s.offset;
    let y = line.y1 + (line.y2 - line.y1) * s.offset;
    if (g.type === "radial") {
      x = g.cx * width + g.radius * width * s.offset;
      y = g.cy * height;
    }
    if (g.type === "conic") {
      const rad = ((g.angle + s.offset * 360) * Math.PI) / 180;
      const ring = Math.min(width, height) * 0.28;
      x = g.cx * width + Math.sin(rad) * ring;
      y = g.cy * height - Math.cos(rad) * ring;
    }
    return { index, x, y, color: s.color, offset: s.offset };
  });
  const knob = "pointer-events-auto absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-select bg-white";
  return (
    <div className="absolute inset-0" data-gradient-handles="" data-gradient-type={g.type}>
      {g.type === "linear" && (
        <svg className="absolute inset-0 size-full overflow-visible" aria-hidden>
          <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="var(--color-select)" strokeWidth={1.5} />
        </svg>
      )}
      {g.type === "radial" && (
        <svg className="absolute inset-0 size-full overflow-visible" aria-hidden>
          <line x1={g.cx * width} y1={g.cy * height} x2={g.cx * width + g.radius * width} y2={g.cy * height} stroke="var(--color-select)" strokeWidth={1.5} />
        </svg>
      )}
      {stops.map((s) => (
        <button
          key={s.index}
          type="button"
          className={knob}
          style={{ left: s.x, top: s.y, background: s.color }}
          aria-label={m.gradientHandleStop}
          data-testid="gradient-stop"
          data-index={s.index}
          onPointerDown={drag((x, y, current) => {
            const next = structuredClone(current);
            let offset = s.offset;
            if (current.type === "linear") {
              const a = ends(current.angle, width, height);
              const vx = a.x2 - a.x1;
              const vy = a.y2 - a.y1;
              const len2 = vx * vx + vy * vy || 1;
              offset = ((x - a.x1) * vx + (y - a.y1) * vy) / len2;
            } else if (current.type === "radial") {
              const reach = current.radius * width || 1;
              offset = (x - current.cx * width) / reach;
            } else {
              const ang = angleFrom(x, y, current.cx * width, current.cy * height);
              offset = (((ang - current.angle) % 360) + 360) % 360 / 360;
            }
            next.stops[s.index] = { ...next.stops[s.index]!, offset: round(clamp(offset, 0, 1)) };
            return next;
          })}
        />
      ))}
      {g.type === "linear" && (
        <button
          type="button"
          className={knob}
          style={{ left: line.x2, top: line.y2 }}
          aria-label={m.gradientHandleEnd}
          data-testid="gradient-end"
          onPointerDown={drag((x, y, current) => ({ ...current, angle: angleFrom(x, y, width / 2, height / 2) }))}
        />
      )}
      {g.type !== "linear" && (
        <button
          type="button"
          className={knob}
          style={{ left: g.cx * width, top: g.cy * height }}
          aria-label={m.gradientHandleCenter}
          data-testid="gradient-center"
          onPointerDown={drag((x, y, current) => ({ ...current, cx: round(clamp(x / width, 0, 1)), cy: round(clamp(y / height, 0, 1)) }))}
        />
      )}
      {g.type === "radial" && (
        <button
          type="button"
          className={knob}
          style={{ left: g.cx * width + g.radius * width, top: g.cy * height }}
          aria-label={m.gradientHandleRadius}
          data-testid="gradient-radius"
          onPointerDown={drag((x, y, current) => ({
            ...current,
            radius: round(clamp(Math.hypot((x - current.cx * width) / width, (y - current.cy * height) / height), 0, 2)),
          }))}
        />
      )}
      {g.type === "conic" && (
        <button
          type="button"
          className={knob}
          style={{
            left: g.cx * width + Math.sin((g.angle * Math.PI) / 180) * Math.min(width, height) * 0.42,
            top: g.cy * height - Math.cos((g.angle * Math.PI) / 180) * Math.min(width, height) * 0.42,
          }}
          aria-label={m.gradientHandleAngle}
          data-testid="gradient-angle"
          onPointerDown={drag((x, y, current) => ({ ...current, angle: angleFrom(x, y, current.cx * width, current.cy * height) }))}
        />
      )}
    </div>
  );
}
