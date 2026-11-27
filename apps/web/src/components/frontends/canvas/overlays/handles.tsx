import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { SelectionHandles } from "@/components/ui/selection-handles";
import { SelectionSize } from "@/components/ui/selection-size";
import { boxCorners, type Lock } from "../transform";
import { unionBox } from "../geometry";
import { useOverlayValue } from "../overlay-bus";
import { useCanvasState } from "../region";
import { useCanvasRuntime } from "../runtime";
import { isTransformable } from "../target";
import type { Box, NodeBox } from "../types";
import { useDocVersion } from "./use-doc-version";

/** The bounding box of a node that may be turned (its four corners). */
function boundsOf(box: NodeBox): Box {
  if (!box.rotation) return box;
  const corners = boxCorners(box.x, box.y, box.width, box.height, box.rotation);
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * The handles of the selection (design: four corner squares on the outline and the size under it): one node that is a plain
 * box gets the corners (the outline itself is `selection-outline`'s) (they resize), the turning knob and the size; several, a group or a locked node get the size only.
 * The elements keep their size on screen whatever the zoom (the layer is scaled, so they counter-scale about their own centre),
 * and everything is measured after the commit that moved the node and written to the elements, never to React state.
 */
export function SelectionHandlesOverlay() {
  const rt = useCanvasRuntime();
  const selection = useCanvasState((s) => s.selection);
  const preview = useCanvasState((s) => s.preview);
  const lock = useOverlayValue<Lock>("lock");
  const docVersion = useDocVersion();
  const doc = rt.doc();
  const single = selection.length === 1 ? doc.nodes[selection[0]!] : undefined;
  const handles = isTransformable(doc, single);
  const turn = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const badge = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const place = useCallback(() => {
    const boxes = selection.map((id) => rt.measure(id)).filter((b): b is NodeBox => b !== null);
    const all = unionBox(boxes.map(boundsOf));
    const show = (el: HTMLElement | null, on: boolean) => {
      if (el) el.style.display = on ? "block" : "none";
    };
    show(badge.current, !!all);
    if (all && badge.current) {
      badge.current.style.left = `${all.x + all.width / 2}px`;
      badge.current.style.top = `${all.y + all.height}px`;
      // One box: its own size (turned or not). Several: the box around them all.
      const size = boxes.length === 1 ? boxes[0]! : all;
      if (text.current) text.current.textContent = `${Math.round(size.width)} × ${Math.round(size.height)}`;
    }
    const one = boxes.length === 1 ? boxes[0]! : null;
    show(turn.current, handles && !!one);
    if (one && turn.current && frame.current) {
      turn.current.style.left = `${one.x + one.width / 2}px`;
      turn.current.style.top = `${one.y + one.height / 2}px`;
      turn.current.style.transform = `rotate(${one.rotation}deg) scale(calc(1 / var(--view-zoom)))`;
      frame.current.style.width = `calc(${one.width}px * var(--view-zoom))`;
      frame.current.style.height = `calc(${one.height}px * var(--view-zoom))`;
      frame.current.style.left = `calc(${one.width}px * var(--view-zoom) / -2)`;
      frame.current.style.top = `calc(${one.height}px * var(--view-zoom) / -2)`;
    }
  }, [rt, selection, handles]);
  useLayoutEffect(place, [place, preview, docVersion]);
  // The viewport is attached after its children's first layout pass: a selection that is there from the start is measured once more.
  useEffect(place, [place]);
  if (selection.length === 0) return null;
  return (
    <div data-selection-handles="">
      {handles ? (
        <div ref={turn} className="pointer-events-none absolute hidden size-0 origin-top-left">
          <SelectionHandles ref={frame as never} className="[&>span:first-child]:hidden" rotate={{ label: rt.text("select.rotateHint") }} />
        </div>
      ) : null}
      <div ref={badge} className="pointer-events-none absolute hidden size-0 origin-top-left" style={{ transform: "scale(calc(1 / var(--view-zoom)))" }}>
        <div className="absolute top-2.5 left-0 flex -translate-x-1/2 flex-col items-center gap-1">
          <SelectionSize aria-label={rt.text("select.size")}>
            <span ref={text} />
          </SelectionSize>
          {lock ? (
            <SelectionSize ref={hint as never} data-testid="resize-lock-hint" data-lock={lock}>
              {rt.text(lock === "square" ? "select.ratioLockAlt" : "select.ratioLock")}
            </SelectionSize>
          ) : null}
        </div>
      </div>
    </div>
  );
}
