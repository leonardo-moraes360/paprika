import { firstPage, newId, type Op } from "@paprika/core";
import { toLocal } from "../geometry";
import { creationNode, draftBox, isDraftTool, isShapeTool, nameKey, nextNumber, type DraftTool } from "../labels";
import type { Gesture } from "../types";

/** What the ghost shows, kept in the overlay bus under `create`: the box in the units of the parent, and where the parent's corner is in the world. */
export type CreateDraft = { tool: DraftTool; x: number; y: number; width: number; height: number; clicked: boolean; origin: { x: number; y: number } };

export const CREATE_KEY = "create";

/**
 * A creation tool (frame, rect, ellipse, text and the diagram shapes): the pointer draws the box, a click that does not drag
 * takes the default size of the tool. The node goes into the frame under the pointer (in that frame's coordinates) or the page,
 * and it is ONE `apply` on release, none before. The ghost is an overlay that reads the draft this writes.
 */
export const create: Gesture = {
  id: "create",
  accepts: (rt, event) => event.button === 0 && !rt.input.space && isDraftTool(rt.tool()),
  start: (rt, event) => {
    const tool = rt.tool() as DraftTool;
    const viewport = rt.viewport();
    if (!viewport) return undefined;
    const doc = rt.doc();
    const frameEl = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-paprika-type="frame"]') : null;
    const frameId = frameEl?.dataset.paprikaId;
    const parentId = frameId && doc.nodes[frameId] ? frameId : (rt.pageId() ?? firstPage(doc)?.id ?? null);
    // Read layout once: where the parent's top-left corner is on the screen (the page's origin when there is no frame under the pointer).
    const vp = viewport.getBoundingClientRect();
    const view = rt.view.get();
    const corner = frameEl && frameId && doc.nodes[frameId] ? frameEl.getBoundingClientRect() : { left: vp.left + view.x, top: vp.top + view.y };
    const local = (clientX: number, clientY: number) => toLocal(rt.view.get(), corner, clientX, clientY);
    const a = local(event.clientX, event.clientY);
    const show = (clientX: number, clientY: number) => {
      const box = draftBox(tool, a, local(clientX, clientY));
      const origin = rt.toWorld(corner.left, corner.top);
      rt.overlay.set(CREATE_KEY, { tool, ...box, origin } satisfies CreateDraft);
      return box;
    };
    show(event.clientX, event.clientY);
    const clear = () => rt.overlay.set(CREATE_KEY, null);
    return {
      move: (e) => void show(e.clientX, e.clientY),
      up: (e) => {
        const box = draftBox(tool, a, local(e.clientX, e.clientY));
        clear();
        const id = newId();
        const name = `${rt.text(nameKey(tool))} ${nextNumber(rt.doc(), tool)}`;
        const node = creationNode(tool, { id, name, x: box.x, y: box.y, width: box.width, height: box.height });
        const label = rt.text("history.create", { name: rt.text(nameKey(tool)).toLowerCase() });
        rt.toolDone();
        void rt.apply([{ op: "create", node: node as never, parentId } as Op], label).then((ok) => {
          if (!ok) return;
          rt.select([id]);
          // A diagram shape opens its text editor, as soon as it is on the page.
          if (isShapeTool(tool)) rt.store.actions.setEditing(id);
        });
      },
      cancel: clear,
    };
  },
};
