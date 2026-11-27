import { insertAnchor, nearestOnPath, pathAttrs, removeAnchor, serializePath, subpathsToPath, toggleSmooth, type PathNode, type Subpath } from "@paprika/core";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { commitPath, PATH_LABELS, startPathEdit, subsFor } from "../gestures/path-edit";
import { withPatch } from "../preview-node";
import { useCanvasState } from "../region";
import { useCanvasRuntime } from "../runtime";
import { pathHit, screenMatrix, subpathsOf, toSvgPoint, viewBoxScale } from "../vector/path-edit";
import { typing } from "../vector/page";
import { readUi, UI_PATH_EDIT, writeUi, type PathEditUi } from "../vector/ui";
import { placeBox } from "./place";
import { useDocVersion } from "./use-doc-version";

/** A stroke of `n` screen px, and a mark that keeps its size on screen, in the path's own units (the camera and the `viewBox` scale are divided out). */
const UNIT = "(var(--view-zoom, 1) * var(--path-scale, 1))";
const stroke = (n: number) => ({ strokeWidth: `calc(${n}px / ${UNIT})` });
const pin = (x: number, y: number) => ({ transform: `translate(${x}px, ${y}px) scale(calc(1 / ${UNIT}))` });

/**
 * The edit layer of a path: its outline (a wide invisible stroke takes the clicks), every anchor and handle, the selected
 * anchor filled. It sits over the node, in the node's own coordinates, so a `viewBox` is honoured. The gestures are in
 * `gestures/path-edit.ts`; this component keeps the mode (entering by double click, leaving by Esc, Enter or by the
 * selection changing) and the double clicks inside it (toggle smooth, insert a point).
 */
export function PathEditOverlay() {
  const rt = useCanvasRuntime();
  const { t } = useTranslation();
  const state: PathEditUi | null = useCanvasState((s) => (s.ui[UI_PATH_EDIT] as PathEditUi | null | undefined) ?? null);
  const id = state?.id ?? null;
  const patch = useCanvasState((s) => (id === null ? undefined : s.preview[id]));
  const tool = useCanvasState((s) => s.tool);
  const selection = useCanvasState((s) => s.selection);
  const version = useDocVersion();
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const active = id !== null;

  const doc = rt.doc();
  const held = id ? doc.nodes[id] : undefined;
  const node = held?.type === "path" ? (patch ? withPatch(held, patch) : held) : null;
  const subs: Subpath[] | null = useMemo(() => (state?.draft ?? (node ? subpathsOf(node.d) : null)), [state?.draft, node]);

  // The edit mode ends when what it edits is not there, not alone in the selection, or the tool changed.
  useEffect(() => {
    if (!active) return;
    if (!node || !subs || tool !== "select" || selection.length !== 1 || selection[0] !== id) writeUi(rt, UI_PATH_EDIT, null);
  }, [rt, active, node, subs, tool, selection, id]);

  useLayoutEffect(() => {
    placeBox(box.current, id ? rt.measure(id) : null);
  }, [rt, id, patch, version, state?.draft]);

  // Esc and Enter leave; Delete and Backspace take the selected point away. A handled key is marked (`defaultPrevented`) so the shortcuts stand aside.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const current = readUi(rt, UI_PATH_EDIT);
      if (!current || e.defaultPrevented || e.isComposing || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        writeUi(rt, UI_PATH_EDIT, null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && current.sel) {
        e.preventDefault();
        const from = subsFor(rt, current.id);
        writeUi(rt, UI_PATH_EDIT, { ...current, sel: null });
        commitPath(rt, removeAnchor(from, current.sel), PATH_LABELS.removePoint);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [rt, active]);

  // A double click enters the mode on a selected path, and inside the mode toggles a point or inserts one.
  useEffect(() => {
    const viewport = rt.viewport();
    if (!viewport) return;
    const onDouble = (e: MouseEvent) => {
      if (rt.tool() !== "select") return;
      const current = readUi(rt, UI_PATH_EDIT);
      if (current) {
        const hit = pathHit(e.target);
        const el = (e.target as Element).closest<SVGSVGElement>("svg[data-path-edit]");
        const matrix = el && screenMatrix(el);
        if (!hit || !matrix) return;
        const from = subsFor(rt, current.id);
        if (hit.kind === "anchor") {
          commitPath(rt, toggleSmooth(from, hit.ref), PATH_LABELS.toggleSmooth);
          writeUi(rt, UI_PATH_EDIT, { ...(readUi(rt, UI_PATH_EDIT) ?? current), sel: hit.ref });
        } else if (hit.kind === "outline") {
          const near = nearestOnPath(from, toSvgPoint(matrix, e.clientX, e.clientY));
          if (!near) return;
          const inserted = insertAnchor(from, near.ref, near.t);
          commitPath(rt, inserted.subs, PATH_LABELS.insertPoint);
          writeUi(rt, UI_PATH_EDIT, { ...(readUi(rt, UI_PATH_EDIT) ?? current), sel: inserted.ref });
        }
        return;
      }
      const target = rt.nodeAt(e.target);
      const found = target ? rt.doc().nodes[target] : undefined;
      if (found?.type === "path" && rt.selection().includes(found.id)) startPathEdit(rt, found);
    };
    viewport.addEventListener("dblclick", onDouble);
    return () => viewport.removeEventListener("dblclick", onDouble);
  }, [rt]);

  if (!id || !node || !subs) return null;
  const outline = serializePath(subpathsToPath(subs));
  const attrs = pathAttrs(doc, node as PathNode).svg;
  const marker = "fill-panel stroke-select-brand";
  return (
    <div ref={box} data-path-edit-box={id} className="pointer-events-none absolute hidden" style={{ transformOrigin: "center" }}>
      <svg
        ref={svg}
        data-path-edit=""
        data-testid="path-edit"
        {...attrs}
        width="100%"
        height="100%"
        className="absolute inset-0 overflow-visible"
        style={{ "--path-scale": viewBoxScale(node) } as React.CSSProperties}
      >
        {outline && <path d={outline} fill="none" stroke="transparent" data-path-outline="" className="pointer-events-auto cursor-copy" style={{ ...stroke(10), pointerEvents: "stroke" }} />}
        {outline && <path d={outline} fill="none" className="stroke-select-brand" style={{ ...stroke(1.5), pointerEvents: "none" }} />}
        {subs.map((sub, si) =>
          sub.anchors.map((a, k) => {
            const selected = state?.sel?.sub === si && state.sel.index === k;
            return (
              <g key={`${si}:${k}`}>
                {(["in", "out"] as const).map((side) => {
                  const h = a[side];
                  if (!h) return null;
                  return (
                    <g key={side}>
                      <line x1={a.x} y1={a.y} x2={h.x} y2={h.y} className="stroke-select-brand" style={{ ...stroke(1), pointerEvents: "none" }} />
                      <circle
                        r={3.2}
                        data-path-handle={`${si}:${k}:${side}`}
                        role="img"
                        aria-label={t("frontends.canvas.vector.pathHandle")}
                        className={`${marker} cursor-move`}
                        style={{ ...pin(h.x, h.y), strokeWidth: 1.5, pointerEvents: "all" }}
                      />
                    </g>
                  );
                })}
                <rect
                  x={-4}
                  y={-4}
                  width={8}
                  height={8}
                  data-path-anchor={`${si}:${k}`}
                  data-selected={selected || undefined}
                  role="img"
                  aria-label={t("frontends.canvas.vector.pathAnchor")}
                  className={`${selected ? "fill-select-brand" : "fill-panel"} stroke-select-brand cursor-move`}
                  style={{ ...pin(a.x, a.y), strokeWidth: 1.5, pointerEvents: "all" }}
                />
              </g>
            );
          }),
        )}
      </svg>
    </div>
  );
}
