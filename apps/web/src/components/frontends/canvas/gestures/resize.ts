import type { Gesture } from "../types";
import { boxCorner, OPPOSITE, resizeTurned, resizeUpright, type Lock } from "../transform";
import { isAbsolute, isTransformable } from "../target";
import { cornerOf, originOf, shownBox, watchModifiers } from "./shared";

/**
 * A corner handle of the selected node: the opposite corner stays where it is. Shift keeps the proportion, Shift+Alt makes it a
 * square (1:1), and a turned node is resized along its own axes. The size shows on the node while it runs (the preview), the
 * hint says which lock is on, and one `update` goes out when the pointer is released.
 */
export const resize: Gesture = {
  id: "resize",
  accepts: (rt, event) => event.button === 0 && rt.tool() === "select" && cornerOf(event.target) !== null,
  start: (rt, event) => {
    const corner = cornerOf(event.target)!;
    const doc = rt.doc();
    const selection = rt.selection();
    const node = selection.length === 1 ? doc.nodes[selection[0]!] : undefined;
    if (!isTransformable(doc, node)) return undefined;
    const id = node.id;
    const shown = shownBox(rt, id);
    if (!shown) return undefined;
    const { x: x0, y: y0, width: w0, height: h0, rotation } = shown;
    const absolute = isAbsolute(doc, node);
    const origin = originOf(rt, node.parentId);
    const fixed = boxCorner(x0, y0, w0, h0, rotation, OPPOSITE[corner]);
    const start = { x: event.clientX, y: event.clientY };
    const zoom = rt.view.get().zoom;
    const initial = { width: Math.round(w0), height: Math.round(h0), ...(absolute ? { x: Math.round(x0), y: Math.round(y0) } : {}) };
    let last: { x?: number; y?: number; width: number; height: number } = initial;
    let moved = false;
    const held = { shift: event.shiftKey, alt: event.altKey };
    let at = start;
    const run = () => {
      const lock: Lock = held.shift ? (held.alt ? "square" : "ratio") : null;
      rt.store.actions.setUi("lock", lock);
      let next;
      if (rotation) {
        const world = rt.toWorld(at.x, at.y);
        next = resizeTurned(corner, fixed, { x: world.x - origin.x, y: world.y - origin.y }, rotation, lock, w0 / Math.max(h0, 1e-6), w0, h0);
      } else next = resizeUpright(corner, x0, y0, w0, h0, (at.x - start.x) / zoom, (at.y - start.y) / zoom, lock);
      last = absolute ? next : { width: next.width, height: next.height };
      rt.preview.set({ [id]: last });
    };
    const unwatch = watchModifiers((keys) => {
      held.shift = keys.shift;
      held.alt = keys.alt;
      if (moved) run();
    });
    const finish = () => {
      unwatch();
      rt.store.actions.setUi("lock", null);
    };
    return {
      move: (ev) => {
        moved = true;
        held.shift = ev.shiftKey;
        held.alt = ev.altKey;
        at = { x: ev.clientX, y: ev.clientY };
        run();
      },
      up: () => {
        finish();
        const same = last.width === initial.width && last.height === initial.height && last.x === (initial as { x?: number }).x && last.y === (initial as { y?: number }).y;
        if (!moved || same) {
          rt.preview.clear([id]);
          return;
        }
        rt.preview.commit([id], rt.apply([{ op: "update", id, props: last }], rt.text("select.labels.resize")));
      },
      cancel: () => {
        finish();
        rt.preview.clear([id]);
      },
    };
  },
};
