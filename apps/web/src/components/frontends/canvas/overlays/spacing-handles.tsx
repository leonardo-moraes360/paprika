import { ignoresLayout, isScene } from "@paprika/core";
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { elementOf } from "../geometry";
import { shownFrame, spacingFrame, startOf, stepSpacing } from "../gestures/spacing-handle";
import { useCanvasState } from "../region";
import { useCanvasRuntime } from "../runtime";
import { spacingHandles, type LocalBox, type SpacingHandle } from "../vector/spacing";
import { placeBox } from "./place";
import { ring } from "./stroke";
import { useDocVersion } from "./use-doc-version";

const EDGE = ring(1.5, "var(--color-select-brand)");
const px = (n: number) => `calc(${n}px / var(--view-zoom, 1))`;

type Model = { w: number; h: number; handles: SpacingHandle[]; values: Record<string, number> };

const sameModel = (a: Model | null, b: Model | null) => a === b || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b));

/**
 * The spacing handles of the selected frame with auto-layout: one bar per padding side and one in each gap between neighbours
 * (and between lines, with wrap). They sit in the frame's own coordinates, read from the DOM after each commit (so they follow
 * a layout that is being previewed and a frame that is turned). Dragging is `gestures/spacing-handle.ts`; the arrow keys step a
 * focused handle by 1 px (10 with Shift); Alt makes a padding the same on all four sides.
 */
export function SpacingHandles() {
  // The handles are the select tool's: with another tool armed a press on them would make something, so they are not drawn.
  const select = useCanvasState((s) => s.tool === "select");
  return select ? <SpacingHandlesShown /> : null;
}

function SpacingHandlesShown() {
  const rt = useCanvasRuntime();
  const { t } = useTranslation();
  const id = useCanvasState((s) => (s.selection.length === 1 ? s.selection[0]! : null));
  const patch = useCanvasState((s) => (id === null ? undefined : s.preview[id]));
  const version = useDocVersion();
  const box = useRef<HTMLDivElement>(null);
  const [model, setModel] = useState<Model | null>(null);
  const held = useRef<Model | null>(null);

  useLayoutEffect(() => {
    const frame = id ? shownFrame(rt, id) : null;
    const viewport = rt.viewport();
    const el = frame && viewport ? elementOf(viewport, frame.id) : null;
    const spacing = frame && startOf(rt, frame);
    const outer = frame ? rt.measure(frame.id) : null;
    let next: Model | null = null;
    if (frame && el && spacing && outer) {
      const doc = rt.doc();
      const kids: LocalBox[] = [];
      for (const childId of frame.children) {
        const child = doc.nodes[childId];
        if (!child || !isScene(child) || child.type === "connector" || child.visible === false || ignoresLayout(child)) continue;
        const childEl = el.querySelector<HTMLElement>(`:scope > [data-paprika-id="${CSS.escape(childId)}"]`);
        if (childEl) kids.push({ x: childEl.offsetLeft, y: childEl.offsetTop, w: childEl.offsetWidth, h: childEl.offsetHeight });
      }
      const handles = spacingHandles({ w: outer.width, h: outer.height }, spacing.padding, kids, frame.layout.mode === "row" ? "row" : "column");
      const [pt, pr, pb, pl] = spacing.padding;
      const values: Record<string, number> = { "padding-top": pt, "padding-right": pr, "padding-bottom": pb, "padding-left": pl };
      for (const h of handles) if (h.kind === "gap") values[h.id] = spacing.gap;
      next = { w: outer.width, h: outer.height, handles, values };
    }
    placeBox(box.current, next ? outer : null);
    // Nothing is set unless it changed: a selection that has no spacing handles commits nothing more.
    if (sameModel(held.current, next)) return;
    held.current = next;
    setModel(next);
  // `model === null`: the box is not there until the first model, so it is placed again once it is.
  }, [rt, id, patch, version, model === null]);

  if (!id || !model || !spacingFrame(rt, id)) return null;
  const label = (h: SpacingHandle) =>
    h.kind === "gap"
      ? t("frontends.canvas.vector.spacingGap")
      : h.side === "right"
        ? t("frontends.canvas.vector.spacingPadRight")
        : h.side === "bottom"
          ? t("frontends.canvas.vector.spacingPadBottom")
          : h.side === "left"
            ? t("frontends.canvas.vector.spacingPadLeft")
            : t("frontends.canvas.vector.spacingPadTop");
  const onKey = (h: SpacingHandle) => (e: KeyboardEvent) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (dir === 0 || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    stepSpacing(rt, { frame: id, kind: h.kind, side: h.side, axis: h.axis }, dir * (e.shiftKey ? 10 : 1), e.altKey);
  };
  return (
    <div ref={box} data-testid="spacing-handles" className="pointer-events-none absolute hidden" style={{ transformOrigin: "center" }}>
      {model.handles.map((h) => {
        const vertical = h.axis === "x";
        return (
          <div
            key={h.id}
            role="slider"
            tabIndex={0}
            aria-label={label(h)}
            aria-valuemin={0}
            aria-valuenow={model.values[h.id] ?? 0}
            aria-orientation={vertical ? "horizontal" : "vertical"}
            title={h.kind === "gap" ? t("frontends.canvas.vector.spacingGapHint") : t("frontends.canvas.vector.spacingPadHint")}
            data-spacing={h.id}
            data-spacing-kind={h.kind}
            data-spacing-axis={h.axis}
            data-spacing-side={h.side}
            data-spacing-frame={id}
            onKeyDown={onKey(h)}
            className="pointer-events-auto absolute cursor-grab bg-panel outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-select-brand active:cursor-grabbing"
            style={{ left: h.x, top: h.y, width: px(vertical ? 8 : 22), height: px(vertical ? 22 : 8), borderRadius: px(4), ...EDGE, transform: "translate(-50%, -50%)" }}
          />
        );
      })}
    </div>
  );
}
