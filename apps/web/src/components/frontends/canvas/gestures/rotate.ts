import type { Gesture } from "../types";
import { turnedBy } from "../transform";
import { isTransformable } from "../target";
import { isRotateHandle, originOf, shownBox, watchModifiers } from "./shared";

/** The rotation handle of the selected node: it turns around its centre following the pointer; Shift snaps to 15 degrees. One `update` of `rotation` goes out on release. */
export const rotate: Gesture = {
  id: "rotate",
  accepts: (rt, event) => event.button === 0 && rt.tool() === "select" && isRotateHandle(event.target),
  start: (rt, event) => {
    const doc = rt.doc();
    const selection = rt.selection();
    const node = selection.length === 1 ? doc.nodes[selection[0]!] : undefined;
    if (!isTransformable(doc, node)) return undefined;
    const id = node.id;
    const shown = shownBox(rt, id);
    if (!shown) return undefined;
    const origin = originOf(rt, node.parentId);
    const center = { x: shown.x + shown.width / 2, y: shown.y + shown.height / 2 };
    const angleAt = (cx: number, cy: number) => {
      const p = rt.toWorld(cx, cy);
      return Math.atan2(p.y - origin.y - center.y, p.x - origin.x - center.x);
    };
    const from = angleAt(event.clientX, event.clientY);
    let snap = event.shiftKey;
    let at = { x: event.clientX, y: event.clientY };
    let last = shown.rotation;
    let moved = false;
    const run = () => {
      last = turnedBy(shown.rotation, from, angleAt(at.x, at.y), snap);
      rt.preview.set({ [id]: { rotation: last } });
    };
    const unwatch = watchModifiers((keys) => {
      snap = keys.shift;
      if (moved) run();
    });
    return {
      move: (ev) => {
        moved = true;
        snap = ev.shiftKey;
        at = { x: ev.clientX, y: ev.clientY };
        run();
      },
      up: () => {
        unwatch();
        if (!moved || last === shown.rotation) {
          rt.preview.clear([id]);
          return;
        }
        rt.preview.commit([id], rt.apply([{ op: "update", id, props: { rotation: last } }], rt.text("select.labels.rotate")));
      },
      cancel: () => {
        unwatch();
        rt.preview.clear([id]);
      },
    };
  },
};
