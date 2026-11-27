import { deepEqual } from "../render-index";
import { gradientEnds, handleKey, nudgeGradient, placeHandles, type GradientHandle } from "../vector/gradient";
import { nodeGradient } from "@paprika/core";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { commitGradient, gradientNode, shownGradient, showLive } from "../gestures/gradient-handle";
import { useOverlayValue } from "../overlay-bus";
import { useCanvasState } from "../region";
import { useCanvasRuntime } from "../runtime";
import { readUi, UI_GRADIENT, writeUi, type GradientUi } from "../vector/ui";
import { placeBox } from "./place";
import { useDocVersion } from "./use-doc-version";

const MIN_SIDE = 8;
const size = "calc(12px / var(--view-zoom, 1))";
const line = (n: number) => ({ strokeWidth: `calc(${n}px / var(--view-zoom, 1))` });

type Size = { w: number; h: number };

/**
 * The handles of the gradient of the selected node: the angle (linear), the centre and radius (radial), the angle and centre
 * (conic) and one per stop. Only while the node is not turned (as in the old canvas), and sized in the world, so they follow
 * the camera. Dragging is `gestures/gradient-handle.ts`; the arrow keys move a focused handle by a step and send it.
 */
export function GradientHandles() {
  const rt = useCanvasRuntime();
  const { t } = useTranslation();
  const id = useCanvasState((s) => (s.selection.length === 1 ? s.selection[0]! : null));
  const draft: GradientUi | null = useOverlayValue<GradientUi>(UI_GRADIENT);
  const patch = useCanvasState((s) => (id === null ? undefined : s.preview[id]));
  const version = useDocVersion();
  const box = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<Size | null>(null);
  const held = useRef<Size | null>(null);
  const node = id ? gradientNode(rt, id) : null;
  const base = node ? nodeGradient(node) : undefined;

  useLayoutEffect(() => {
    const measured = id && node ? rt.measure(id) : null;
    placeBox(box.current, measured);
    const next: Size | null = !measured || measured.width < MIN_SIDE || measured.height < MIN_SIDE ? null : { w: measured.width, h: measured.height };
    // Nothing is set unless it changed: a selection that has no gradient handles commits nothing more.
    if (held.current?.w === next?.w && held.current?.h === next?.h) return;
    held.current = next;
    setDims(next);
  }, [rt, id, node, patch, version, dims]);

  // The draft goes once the document shows it, or once it changed after the server took the update.
  useEffect(() => {
    if (!draft) return;
    const current = readUi(rt, UI_GRADIENT);
    if (current !== draft) return;
    if ((base && deepEqual(base, draft.gradient)) || (draft.acked && version !== draft.at)) writeUi(rt, UI_GRADIENT, null);
  }, [rt, draft, base, version]);

  // A draft of a node that is no longer the selected one is stale.
  useEffect(() => {
    if (draft && draft.id !== id) writeUi(rt, UI_GRADIENT, null);
  }, [rt, draft, id]);

  if (!id || !node || !base || !dims) return null;
  const g = draft && draft.id === id ? draft.gradient : base;
  const handles = placeHandles(g, dims.w, dims.h);
  const labels: Record<GradientHandle["kind"], string> = {
    stop: t("frontends.canvas.vector.gradientStop"),
    end: t("frontends.canvas.vector.gradientEnd"),
    center: t("frontends.canvas.vector.gradientCenter"),
    radius: t("frontends.canvas.vector.gradientRadius"),
    angle: t("frontends.canvas.vector.gradientAngle"),
  };
  const ends = gradientEnds(g.angle, dims.w, dims.h);
  const onKey = (handle: GradientHandle) => (e: KeyboardEvent) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (dir === 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const live = showLive(rt, id);
    const next = nudgeGradient(handle, shownGradient(rt, id) ?? base, dir, e.shiftKey);
    live.write(next);
    commitGradient(rt, id, next, live.restore);
  };
  return (
    <div ref={box} data-gradient-handles="" data-gradient-type={g.type} className="pointer-events-none absolute hidden" style={{ transformOrigin: "center" }}>
      {(g.type === "linear" || g.type === "radial") && (
        <svg aria-hidden="true" className="absolute inset-0 size-full overflow-visible">
          {g.type === "linear" ? (
            <line x1={ends.x1} y1={ends.y1} x2={ends.x2} y2={ends.y2} className="stroke-select-brand" style={line(1.5)} />
          ) : (
            <line x1={g.cx * dims.w} y1={g.cy * dims.h} x2={g.cx * dims.w + g.radius * dims.w} y2={g.cy * dims.h} className="stroke-select-brand" style={line(1.5)} />
          )}
        </svg>
      )}
      {handles.map((h) => (
        <button
          key={h.key}
          type="button"
          aria-label={labels[h.handle.kind]}
          title={labels[h.handle.kind]}
          data-gradient-handle={handleKey(h.handle)}
          data-gradient-node={id}
          data-testid={h.handle.kind === "stop" ? "gradient-stop" : `gradient-${h.handle.kind}`}
          data-index={h.handle.kind === "stop" ? h.handle.index : undefined}
          onKeyDown={onKey(h.handle)}
          className="pointer-events-auto absolute cursor-grab rounded-full border-select-brand bg-panel active:cursor-grabbing"
          style={{ left: h.x, top: h.y, width: size, height: size, borderWidth: "calc(2px / var(--view-zoom, 1))", transform: "translate(-50%, -50%)", ...(h.color ? { background: h.color } : null) }}
        />
      ))}
    </div>
  );
}
