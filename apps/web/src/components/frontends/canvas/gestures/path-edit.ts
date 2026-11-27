import { copyOwner, moveAnchor, moveHandle, parsePath, pathEditProps, type PathNode, type Subpath } from "@paprika/core";
import type { CanvasRuntime, Gesture, PreviewPatch } from "../types";
import { withPatch } from "../preview-node";
import { isAbsolute, pathHit, screenMatrix, subpathsOf, toSvgPoint } from "../vector/path-edit";
import { readUi, UI_PATH_EDIT, writeUi } from "../vector/ui";

/** The history labels of path editing (i18n keys the owner turns into text). */
export const PATH_LABELS = {
  movePoint: "app.canvas.vector.movePoint",
  moveHandle: "app.canvas.vector.moveHandle",
  toggleSmooth: "app.canvas.vector.toggleSmooth",
  insertPoint: "app.canvas.vector.insertPoint",
  removePoint: "app.canvas.vector.removePoint",
  deleteVector: "app.canvas.vector.deleteVector",
} as const;

/** A press moves a point only after the pointer went this far (screen px). */
const DRAG_PX = 3;

/** Puts a path in edit mode (not a locked one, a copy inside an instance, or one whose outline does not parse). */
export function startPathEdit(rt: CanvasRuntime, node: PathNode): boolean {
  if (node.locked || copyOwner(rt.doc(), node)) return false;
  try {
    parsePath(node.d);
  } catch {
    return false;
  }
  writeUi(rt, UI_PATH_EDIT, { id: node.id, sel: null, draft: null });
  rt.select([node.id]);
  return true;
}

/**
 * Sends an edited outline: the path shows it at once (a preview patch kept until the document has it) and one `update` goes out.
 * A path left without segments is deleted instead.
 */
export function commitPath(rt: CanvasRuntime, subs: Subpath[], label: string) {
  const state = readUi(rt, UI_PATH_EDIT);
  const node = state && rt.doc().nodes[state.id];
  if (!state || !node || node.type !== "path") return;
  const props = pathEditProps(node, subs, isAbsolute(rt.doc(), node));
  if (!props) {
    writeUi(rt, UI_PATH_EDIT, null);
    rt.select([]);
    void rt.apply([{ op: "delete", id: node.id }], PATH_LABELS.deleteVector);
    return;
  }
  rt.preview.set({ [node.id]: props as PreviewPatch });
  writeUi(rt, UI_PATH_EDIT, { ...state, draft: null });
  rt.preview.commit([node.id], rt.apply([{ op: "update", id: node.id, props: { ...props } }], label));
}

/** A press on an anchor or a handle of the path in edit mode selects it, and dragging it moves it (Alt lets a handle go without its twin). */
export const pathEditDrag: Gesture = {
  id: "path-edit-drag",
  accepts: (rt, event) => {
    if (event.button !== 0 || rt.tool() !== "select" || !readUi(rt, UI_PATH_EDIT)) return false;
    const hit = pathHit(event.target);
    return !!hit && hit.kind !== "outline";
  },
  start: (rt, event) => {
    const state = readUi(rt, UI_PATH_EDIT);
    const hit = pathHit(event.target);
    const svg = (event.target as Element).closest<SVGSVGElement>("svg[data-path-edit]");
    const node = state && rt.doc().nodes[state.id];
    const matrix = svg && screenMatrix(svg);
    if (!state || !hit || hit.kind === "outline" || !matrix || !node || node.type !== "path") return undefined;
    const subs0: Subpath[] = state.draft ?? subsFor(rt, state.id);
    const sel = hit.ref;
    writeUi(rt, UI_PATH_EDIT, { ...state, sel });
    const anchor = subs0[sel.sub]?.anchors[sel.index];
    if (!anchor) return undefined;
    const { clientX: sx, clientY: sy } = event;
    const p0 = toSvgPoint(matrix, sx, sy);
    const origin = hit.kind === "anchor" ? { x: anchor.x, y: anchor.y } : anchor[hit.side]!;
    let moved = false;
    let last: Subpath[] = subs0;
    return {
      move: (ev) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_PX) return;
        moved = true;
        const p = toSvgPoint(matrix, ev.clientX, ev.clientY);
        const to = { x: origin.x + p.x - p0.x, y: origin.y + p.y - p0.y };
        last = hit.kind === "anchor" ? moveAnchor(subs0, sel, to) : moveHandle(subs0, sel, hit.side, to, !ev.altKey);
        const current = readUi(rt, UI_PATH_EDIT);
        if (current) writeUi(rt, UI_PATH_EDIT, { ...current, draft: last });
      },
      up: () => {
        const current = readUi(rt, UI_PATH_EDIT);
        if (moved) commitPath(rt, last, hit.kind === "anchor" ? PATH_LABELS.movePoint : PATH_LABELS.moveHandle);
        else if (current?.draft) writeUi(rt, UI_PATH_EDIT, { ...current, draft: null });
      },
      cancel: () => {
        const current = readUi(rt, UI_PATH_EDIT);
        if (current?.draft) writeUi(rt, UI_PATH_EDIT, { ...current, draft: null });
      },
    };
  },
};

/** The outline the edit layer is showing (the document's, with the preview over it). */
export function subsFor(rt: CanvasRuntime, id: string): Subpath[] {
  const node = rt.doc().nodes[id];
  if (!node || node.type !== "path") return [];
  const patch = rt.store.state.preview[id];
  return subpathsOf((patch ? withPatch(node, patch) : node).d) ?? [];
}

/** The rest of a press in the edit layer (the outline, or the path itself) does nothing: the node stays selected and in edit mode. */
export const pathEditHold: Gesture = {
  id: "path-edit-hold",
  accepts: (rt, event) => {
    const state = readUi(rt, UI_PATH_EDIT);
    if (event.button !== 0 || rt.tool() !== "select" || !state) return false;
    if (pathHit(event.target)) return true;
    return rt.nodeAt(event.target) === state.id;
  },
  start: () => undefined,
};
