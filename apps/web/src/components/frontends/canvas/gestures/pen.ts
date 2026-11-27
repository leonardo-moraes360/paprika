import type { CanvasRuntime, Gesture, Pt } from "../types";
import { pageOf } from "../vector/page";
import { closesPath, dragAnchor, penAnchor, penOps, type PenDraft } from "../vector/pen";
import { readUi, UI_PEN, writeUi } from "../vector/ui";

/** The history label of a finished path (an i18n key the owner turns into text). */
export const PEN_LABEL = "app.canvas.vector.draw";

/** Where a point of the path being drawn is, in its parent's coordinates. */
const localPoint = (rt: CanvasRuntime, origin: Pt, clientX: number, clientY: number): Pt => {
  const p = rt.toWorld(clientX, clientY);
  return { x: p.x - origin.x, y: p.y - origin.y };
};
export { localPoint as penPoint };

/** A new path lives in the frame under the pointer when that frame places its children by x and y, else on the page. */
function parentAt(rt: CanvasRuntime, target: EventTarget | null): { parentId: string | null; origin: Pt } {
  const doc = rt.doc();
  let el = target instanceof Element ? target.closest<HTMLElement>('[data-paprika-type="frame"]') : null;
  while (el) {
    const frame = doc.nodes[el.dataset.paprikaId ?? ""];
    if (frame?.type === "frame" && (!frame.layout || frame.layout.mode === "none")) break;
    el = el.parentElement?.closest<HTMLElement>('[data-paprika-type="frame"]') ?? null;
  }
  const id = el?.dataset.paprikaId ?? null;
  const box = id ? rt.measure(id) : null;
  return { parentId: id ?? pageOf(rt), origin: box ? { x: box.x, y: box.y } : { x: 0, y: 0 } };
}

/**
 * Ends the path being drawn: with two anchors or more it becomes a node (closed, it gets a fill), with fewer the draft is just
 * dropped. The tool is done at once, as in the old canvas; the new path is selected once the server took it.
 */
export function finishPen(rt: CanvasRuntime, closed: boolean, draft = readUi(rt, "pen")) {
  writeUi(rt, "pen", null);
  if (!draft || draft.anchors.length < 2) return;
  const paint = rt.vectorDefaults();
  if (!paint) return;
  let made: ReturnType<typeof penOps>;
  try {
    const paths = Object.values(rt.doc().nodes).filter((n) => n.type === "path").length;
    made = penOps(draft, closed, paths, paint);
  } catch {
    return;
  }
  if (!made) return;
  const { id, ops } = made;
  rt.toolDone();
  void rt.apply(ops, PEN_LABEL).then((ok) => {
    if (ok) rt.select([id]);
  });
}

/**
 * The pen: a press adds an anchor, dragging out of it pulls mirrored bezier handles (past 3 px), a press on the first anchor of
 * a path of three or more points closes it (within 8 px). The draft is in `region.ui` for the overlay; Enter, Esc and the double
 * click end it, Backspace and Delete take the last point back (`overlays/pen-draft.tsx`).
 */
export const pen: Gesture = {
  id: "pen",
  accepts: (rt, event) => event.button === 0 && rt.tool() === "pen",
  start: (rt, event) => {
    let draft: PenDraft | null = readUi(rt, "pen");
    if (!draft) {
      draft = { ...parentAt(rt, event.target), anchors: [] };
      rt.select([]);
    }
    const { origin } = draft;
    const zoom = rt.view.get().zoom;
    const p0 = localPoint(rt, origin, event.clientX, event.clientY);
    if (closesPath(draft.anchors, p0, zoom)) {
      finishPen(rt, true, draft);
      return undefined;
    }
    const anchor = penAnchor(p0);
    const base = draft.anchors;
    const started: PenDraft = { ...draft, anchors: [...base, anchor] };
    writeUi(rt, "pen", started);
    return {
      move: (ev) => {
        const pulled = dragAnchor(anchor, localPoint(rt, origin, ev.clientX, ev.clientY), rt.view.get().zoom);
        if (pulled) writeUi(rt, "pen", { ...started, anchors: [...base, pulled] });
      },
    };
  },
};
