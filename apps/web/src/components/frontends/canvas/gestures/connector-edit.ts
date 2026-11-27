import { copyOwner, originOf, round4, type ConnectorEnd, type ConnectorNode } from "@paprika/core";
import type { CanvasRuntime, Gesture, PreviewPatch } from "../types";
import { endAt } from "../vector/links";

export const CONNECTOR_LABELS = { attachStart: "app.canvas.vector.attachStart", attachEnd: "app.canvas.vector.attachEnd", bend: "app.canvas.vector.bendArrow" } as const;
/** An end is grabbed for real only after the pointer went this far (screen px). */
const DRAG_PX = 3;

/** The connector the handles belong to: the only one selected, when it is not locked nor a copy inside an instance. */
export function editableConnector(rt: CanvasRuntime): ConnectorNode | null {
  const sel = rt.selection();
  const node = sel.length === 1 ? rt.doc().nodes[sel[0]!] : undefined;
  return node?.type === "connector" && !node.locked && !copyOwner(rt.doc(), node) ? node : null;
}

type HandleKind = "from" | "to" | "curve";
const kindOf = (target: EventTarget | null): HandleKind | null => {
  const key = target instanceof Element ? target.closest<HTMLElement>("[data-connector-handle]")?.dataset.connectorHandle : undefined;
  return key === "from" || key === "to" || key === "curve" ? key : null;
};

/**
 * The handles of the selected connector: dragging an end attaches it to the node it is released over (or leaves it free at
 * that point); dragging the handle of a curve moves its control point. The connector is routed again on every move.
 */
export const connectorEdit: Gesture = {
  id: "connector-edit",
  accepts: (rt, event) => event.button === 0 && kindOf(event.target) !== null && editableConnector(rt) !== null,
  start: (rt, event) => {
    const kind = kindOf(event.target);
    const conn = editableConnector(rt);
    if (!kind || !conn) return undefined;
    const id = conn.id;
    const doc = rt.doc();
    const origin = originOf(doc, conn.parentId);

    if (kind === "curve") {
      const control = (cx: number, cy: number): PreviewPatch => {
        const p = rt.toWorld(cx, cy);
        return { control: { x: round4(p.x - origin.x), y: round4(p.y - origin.y) } };
      };
      let last = control(event.clientX, event.clientY);
      rt.preview.set({ [id]: last });
      return {
        move: (ev) => {
          last = control(ev.clientX, ev.clientY);
          rt.preview.set({ [id]: last });
        },
        up: () => rt.preview.commit([id], rt.apply([{ op: "update", id, props: { ...last } }], CONNECTOR_LABELS.bend)),
        cancel: () => rt.preview.clear([id]),
      };
    }

    const start = { x: event.clientX, y: event.clientY };
    const patch = (cx: number, cy: number): PreviewPatch => {
      const end: ConnectorEnd = endAt(rt, cx, cy, origin, id);
      return kind === "from" ? { from: end } : { to: end };
    };
    let last = patch(event.clientX, event.clientY);
    let moved = false;
    return {
      move: (ev) => {
        if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_PX) return;
        moved = true;
        last = patch(ev.clientX, ev.clientY);
        rt.preview.set({ [id]: last });
      },
      up: () => {
        if (!moved) {
          rt.preview.clear([id]);
          return;
        }
        rt.preview.commit([id], rt.apply([{ op: "update", id, props: { ...last } }], kind === "from" ? CONNECTOR_LABELS.attachStart : CONNECTOR_LABELS.attachEnd));
      },
      cancel: () => rt.preview.clear([id]),
    };
  },
};
