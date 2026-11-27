import { copyOwner, gradientCSS, modeOf, nodeGradient, type Gradient, type Node } from "@paprika/core";
import { elementOf } from "../geometry";
import { deepEqual } from "../render-index";
import type { CanvasRuntime, Gesture } from "../types";
import { dragGradient, parseHandle } from "../vector/gradient";
import { readUi, UI_GRADIENT, writeUi } from "../vector/ui";

export const GRADIENT_LABEL = "history.gradient";

/** The node types whose element takes its gradient as a CSS `background`, so a drag can show it by writing the element's style. */
const LIVE = new Set(["frame", "rect", "ellipse", "text", "image"]);

/** The gradient handles are only for an unrotated node with a gradient that is not locked nor a copy inside an instance, as in the old canvas. */
export function gradientNode(rt: CanvasRuntime, id: string): Node | null {
  const node = rt.doc().nodes[id];
  if (!node || node.type === "page" || !nodeGradient(node) || node.locked || copyOwner(rt.doc(), node)) return null;
  return "rotation" in node && Math.abs(node.rotation) > 0.5 ? null : node;
}

/** The gradient being shown: the one dragged (or waiting for its echo), else the node's. */
export function shownGradient(rt: CanvasRuntime, id: string): Gradient | null {
  const draft = readUi(rt, UI_GRADIENT);
  const node = rt.doc().nodes[id];
  return draft && draft.id === id ? draft.gradient : node && node.type !== "page" ? (nodeGradient(node) ?? null) : null;
}

/** Writes the gradient to the element's own style (no render), and gives back what puts the element as it was. */
export function showLive(rt: CanvasRuntime, id: string) {
  const node = rt.doc().nodes[id];
  const viewport = rt.viewport();
  const el = viewport && node && LIVE.has(node.type) ? elementOf(viewport, id) : null;
  const before = el?.style.background ?? "";
  return {
    write: (gradient: Gradient) => {
      if (el && node) el.style.background = gradientCSS(rt.doc(), gradient, modeOf(rt.doc(), node), false);
    },
    restore: () => {
      if (el) el.style.background = before;
    },
  };
}

/** One `update` with the new gradient; the handles keep showing it until the document does (or the server refuses). */
export function commitGradient(rt: CanvasRuntime, id: string, gradient: Gradient, restore?: () => void) {
  const draft = { id, gradient, acked: false, at: 0 };
  writeUi(rt, UI_GRADIENT, draft);
  void rt.apply([{ op: "update", id, props: { gradient } }], rt.text(GRADIENT_LABEL)).then((ok) => {
    if (readUi(rt, UI_GRADIENT) !== draft) return;
    if (ok) writeUi(rt, UI_GRADIENT, { ...draft, acked: true, at: rt.index.docVersion() });
    else {
      writeUi(rt, UI_GRADIENT, null);
      restore?.();
    }
  });
}

/**
 * Dragging a handle of the selected node's gradient (the angle, the centre, the radius, a stop). While it moves, the node's own
 * element is painted with the gradient directly (nothing renders); on release one `update` with the whole gradient goes out.
 */
export const gradientHandle: Gesture = {
  id: "gradient-handle",
  accepts: (rt, event) => event.button === 0 && event.target instanceof Element && event.target.closest("[data-gradient-handle]") !== null,
  start: (rt, event) => {
    const el = (event.target as Element).closest<HTMLElement>("[data-gradient-handle]");
    const handle = parseHandle(el?.dataset.gradientHandle);
    const id = el?.dataset.gradientNode;
    if (!handle || !id || !gradientNode(rt, id)) return undefined;
    const base = shownGradient(rt, id);
    const box = rt.measure(id);
    if (!base || !box) return undefined;
    const live = showLive(rt, id);
    const at = (cx: number, cy: number) => {
      const p = rt.toWorld(cx, cy);
      const x = Math.min(box.width, Math.max(0, p.x - box.x));
      const y = Math.min(box.height, Math.max(0, p.y - box.y));
      return dragGradient(handle, base, x, y, box.width, box.height);
    };
    return {
      move: (ev) => {
        const next = at(ev.clientX, ev.clientY);
        writeUi(rt, UI_GRADIENT, { id, gradient: next, acked: false, at: 0 });
        live.write(next);
      },
      up: (ev) => {
        const next = at(ev.clientX, ev.clientY);
        if (deepEqual(next, base)) {
          writeUi(rt, UI_GRADIENT, null);
          live.restore();
          return;
        }
        live.write(next);
        commitGradient(rt, id, next, live.restore);
      },
      cancel: () => {
        writeUi(rt, UI_GRADIENT, null);
        live.restore();
      },
    };
  },
};
