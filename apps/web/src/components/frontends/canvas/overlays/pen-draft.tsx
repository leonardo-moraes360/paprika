import { anchorsToPath, serializePath, type Anchor } from "@paprika/core";
import { useEffect, useMemo, useRef } from "react";
import { finishPen } from "../gestures/pen";
import { useOverlayValue } from "../overlay-bus";
import { useCanvasState } from "../region";
import { useCanvasRuntime } from "../runtime";
import { withoutDoublePress, type PenDraft } from "../vector/pen";
import { typing } from "../vector/page";
import { readUi, UI_PEN, writeUi } from "../vector/ui";

/** Keeps its size on screen: the element is moved to its point and scaled back by the camera. */
const pin = (x: number, y: number) => ({ transform: `translate(${x}px, ${y}px) scale(calc(1 / var(--view-zoom, 1)))` });
/** A stroke of `n` screen px whatever the zoom. */
const stroke = (n: number) => ({ strokeWidth: `calc(${n}px / var(--view-zoom, 1))` });

function Anchors({ anchors }: { anchors: readonly Anchor[] }) {
  return anchors.map((a, k) => (
    <g key={k}>
      {a.in && <line x1={a.in.x} y1={a.in.y} x2={a.x} y2={a.y} className="stroke-select-brand" style={stroke(1)} />}
      {a.out && <line x1={a.x} y1={a.y} x2={a.out.x} y2={a.out.y} className="stroke-select-brand" style={stroke(1)} />}
      {a.in && <circle r={3} className="fill-select-brand" style={pin(a.in.x, a.in.y)} />}
      {a.out && <circle r={3} className="fill-select-brand" style={pin(a.out.x, a.out.y)} />}
      <rect x={-4} y={-4} width={8} height={8} data-pen-anchor={k} className="fill-panel stroke-select-brand" style={{ ...pin(a.x, a.y), strokeWidth: 1.5 }} />
    </g>
  ));
}

/**
 * The path being drawn with the pen: its outline, its anchors and handles, and the elastic line from the last anchor to the
 * cursor. It also owns the pen's keys and its double click, which end or shorten the draft. The elastic line is written to the
 * DOM as the cursor moves, so the cursor never goes through state.
 */
export function PenDraftOverlay() {
  const rt = useCanvasRuntime();
  const draft: PenDraft | null = useOverlayValue<PenDraft>(UI_PEN);
  const tool = useCanvasState((s) => s.tool);
  const elastic = useRef<SVGLineElement>(null);
  const active = draft !== null;

  // Leaving the tool drops the draft.
  useEffect(() => {
    if (tool !== "pen" && readUi(rt, "pen")) writeUi(rt, "pen", null);
  }, [rt, tool]);

  // Enter and Esc end the path; Backspace and Delete take the last point back. The shortcuts stand aside from a key that was handled (`defaultPrevented`), so this runs first and does not stop the event.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const current = readUi(rt, UI_PEN);
      if (!current || e.defaultPrevented || e.isComposing || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        finishPen(rt, false, current);
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        writeUi(rt, UI_PEN, current.anchors.length > 1 ? { ...current, anchors: current.anchors.slice(0, -1) } : null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [rt, active]);

  // A double click ends the path (the two presses of it added the same point twice: one of them goes).
  useEffect(() => {
    const viewport = rt.viewport();
    if (!viewport || !active) return;
    const onDouble = () => {
      const current = readUi(rt, UI_PEN);
      if (!current) return;
      finishPen(rt, false, { ...current, anchors: withoutDoublePress(current.anchors, rt.view.get().zoom) });
    };
    viewport.addEventListener("dblclick", onDouble);
    return () => viewport.removeEventListener("dblclick", onDouble);
  }, [rt, active]);

  // The elastic line follows the cursor (written to the element; nothing renders).
  useEffect(() => {
    const viewport = rt.viewport();
    if (!viewport || !active) return;
    const onMove = (e: PointerEvent) => {
      const line = elastic.current;
      const current = readUi(rt, UI_PEN);
      if (!line || !current || e.buttons !== 0) return;
      const p = rt.toWorld(e.clientX, e.clientY);
      line.setAttribute("x2", String(p.x - current.origin.x));
      line.setAttribute("y2", String(p.y - current.origin.y));
      line.style.visibility = "visible";
    };
    const onLeave = () => {
      if (elastic.current) elastic.current.style.visibility = "hidden";
    };
    viewport.addEventListener("pointermove", onMove);
    viewport.addEventListener("pointerleave", onLeave);
    return () => {
      viewport.removeEventListener("pointermove", onMove);
      viewport.removeEventListener("pointerleave", onLeave);
    };
  }, [rt, active]);

  const outline = useMemo(() => (draft && draft.anchors.length > 1 ? serializePath(anchorsToPath([...draft.anchors], false)) : ""), [draft]);
  if (!draft) return null;
  const last = draft.anchors[draft.anchors.length - 1];
  return (
    <svg data-testid="pen-overlay" aria-hidden="true" className="pointer-events-none absolute top-0 left-0 size-px overflow-visible">
      <g transform={`translate(${draft.origin.x} ${draft.origin.y})`}>
        {outline && <path d={outline} fill="none" className="stroke-select-brand" style={stroke(1.5)} />}
        {last && (
          <line
            ref={elastic}
            x1={last.x}
            y1={last.y}
            x2={last.x}
            y2={last.y}
            data-testid="pen-elastic"
            className="stroke-select-brand"
            style={{ ...stroke(1), strokeDasharray: "calc(4px / var(--view-zoom, 1)) calc(3px / var(--view-zoom, 1))" }}
          />
        )}
        <Anchors anchors={draft.anchors} />
      </g>
    </svg>
  );
}
