import { dropUi, localFor, resolveDrop, sameDropUi, type DropSpot, type DropUi } from "../drop";
import { DRAG_THRESHOLD } from "../transform";
import { isAbsolute, isDeep, isToggle, movableNodes, pickTarget } from "../target";
import type { Gesture, PreviewPatch } from "../types";
import type { Op } from "@paprika/core";
import { cornerOf, isRotateHandle } from "./shared";

/**
 * A press on a node: it selects it (the group or the instance it belongs to; Ctrl takes the node itself) and, once the pointer
 * travels 3 px, moves the selection with a preview. Over a frame or a group it reparents; over an auto-layout flow it reorders,
 * with the container lit and a bar where the node goes. One set of ops goes out on release (`update` of `x`, `y`; or `move`).
 * A press with Shift or Cmd toggles the node in the selection instead (`select-click`).
 */
export const move: Gesture = {
  id: "move",
  accepts: (rt, event) => event.button === 0 && rt.tool() === "select" && !isToggle(event) && rt.nodeAt(event.target) !== null && cornerOf(event.target) === null && !isRotateHandle(event.target),
  start: (rt, event) => {
    const doc = rt.doc();
    const selected = rt.selection();
    const hit = rt.nodeAt(event.target)!;
    const id = isDeep(event) ? hit : pickTarget(doc, hit, selected);
    const group = selected.includes(id) ? selected : [id];
    if (!selected.includes(id)) rt.select([id]);
    const shown = rt.store.state.preview;
    const movable = movableNodes(doc, group).map((n) => ({ id: n.id, parentId: n.parentId, x: shown[n.id]?.x ?? n.x, y: shown[n.id]?.y ?? n.y, node: n }));
    if (movable.length === 0) return undefined;
    const dragged = new Set(movable.map((n) => n.id));
    const absOnly = movable.every(({ node }) => isAbsolute(doc, node));
    const ignoreFlow = movable.every(({ node }) => "layoutPositioning" in node && node.layoutPositioning === "absolute");
    const origin = rt.toWorld(event.clientX, event.clientY);
    const zoom = rt.view.get().zoom;
    let moved = false;
    let shownDrop: DropUi | null = null;
    let last: Record<string, { x: number; y: number }> = {};
    let sizes: Map<string, { width: number; height: number }> | null = null;
    const spotAt = (cx: number, cy: number): DropSpot => {
      const spot = resolveDrop(rt, cx, cy, dragged);
      return ignoreFlow ? { ...spot, flow: false } : spot;
    };
    const show = (patches: Record<string, { x: number; y: number }>) => {
      const out: Record<string, PreviewPatch> = {};
      for (const [key, value] of Object.entries(patches)) out[key] = { ...value, inert: true };
      rt.preview.set(out);
    };
    const finish = () => rt.overlay.set("drop", null);
    return {
      move: (ev) => {
        const p = rt.toWorld(ev.clientX, ev.clientY);
        const dx = p.x - origin.x;
        const dy = p.y - origin.y;
        if (!moved && Math.hypot(dx, dy) * zoom < DRAG_THRESHOLD) return;
        moved = true;
        const spot = spotAt(ev.clientX, ev.clientY);
        const ui = dropUi(rt, spot, dragged);
        // The same container and bar as a moment ago is not a change: a store update tells every node of the page.
        if (!sameDropUi(shownDrop, ui)) rt.overlay.set("drop", (shownDrop = ui));
        if (!absOnly) return;
        if (spot.highlightId && !spot.flow && movable.some((n) => n.parentId !== spot.highlightId)) {
          // Into another container, with no flow: the node is centred on the pointer, in that container's space.
          const local = localFor(rt, spot.parentId, ev.clientX, ev.clientY);
          sizes ??= new Map(
            movable.map(({ id: nid, node }) => {
              const box = rt.measure(nid);
              const own = node as { width?: unknown; height?: unknown };
              return [nid, { width: box?.width ?? (typeof own.width === "number" ? own.width : 40), height: box?.height ?? (typeof own.height === "number" ? own.height : 40) }];
            }),
          );
          last = Object.fromEntries(movable.map((n, i) => [n.id, { x: Math.round(local.x - sizes!.get(n.id)!.width / 2 + i * 8), y: Math.round(local.y - sizes!.get(n.id)!.height / 2 + i * 8) }]));
        } else last = Object.fromEntries(movable.map((n) => [n.id, { x: Math.round(n.x + dx), y: Math.round(n.y + dy) }]));
        show(last);
      },
      up: (ev) => {
        finish();
        if (!moved) return;
        const spot = spotAt(ev.clientX, ev.clientY);
        const dest = spot.highlightId;
        const ids = movable.map((n) => n.id);
        const ops: Op[] = [];
        if (dest && spot.flow) {
          let index = spot.index ?? 0;
          for (const n of movable) ops.push({ op: "move", id: n.id, parentId: dest, index: index++ });
          rt.preview.clear(ids);
          void rt.apply(ops, rt.text(movable.every((n) => n.parentId === dest) ? "history.reorder" : "history.reparent"));
          return;
        }
        if (dest && movable.some((n) => n.parentId !== dest)) {
          for (const n of movable) {
            ops.push({ op: "move", id: n.id, parentId: dest });
            const props = last[n.id];
            if (props) ops.push({ op: "update", id: n.id, props: { x: props.x, y: props.y } });
            else {
              const local = localFor(rt, dest, ev.clientX, ev.clientY);
              ops.push({ op: "update", id: n.id, props: { x: Math.round(local.x), y: Math.round(local.y) } });
            }
          }
          const label = rt.text(movable.length > 1 ? "history.moveMany" : "history.reparent", { count: movable.length });
          if (Object.keys(last).length) rt.preview.commit(ids, rt.apply(ops, label));
          else void rt.apply(ops, label);
          return;
        }
        if (Object.keys(last).length === 0 || !absOnly) {
          rt.preview.clear(ids);
          return;
        }
        const updates: Op[] = Object.entries(last).map(([nid, props]) => ({ op: "update", id: nid, props }));
        rt.preview.commit(Object.keys(last), rt.apply(updates, rt.text(movable.length > 1 ? "history.moveMany" : "history.move", { count: movable.length })));
      },
      cancel: () => {
        finish();
        rt.preview.clear(movable.map((n) => n.id));
      },
    };
  },
};

