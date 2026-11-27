import { newId } from "@paprika/core";
import type { Gesture } from "../types";
import { endAt } from "../vector/links";
import { pageOf } from "../vector/page";
import { readUi, UI_LINK, writeUi } from "../vector/ui";

export const ARROW_LABEL = "history.createArrow";
/** An arrow shorter than this on screen (px) is a click: nothing is made. */
const MIN_PX = 6;

/**
 * The connector tool: pressing starts an arrow at the node under the pointer (or the point), the dashed line follows the
 * pointer, and releasing makes a `{ from, to, route: "elbow" }` connector on the page, unless it is shorter than 6 px or
 * would join a node to itself.
 */
export const connectorCreate: Gesture = {
  id: "connector-create",
  accepts: (rt, event) => event.button === 0 && rt.tool() === "connector",
  start: (rt, event) => {
    const from = endAt(rt, event.clientX, event.clientY);
    const start = rt.toWorld(event.clientX, event.clientY);
    const x0 = event.clientX;
    const y0 = event.clientY;
    writeUi(rt, UI_LINK, { from: start, to: start });
    const clear = () => {
      if (readUi(rt, UI_LINK)) writeUi(rt, UI_LINK, null);
    };
    return {
      move: (ev) => writeUi(rt, UI_LINK, { from: start, to: rt.toWorld(ev.clientX, ev.clientY) }),
      up: (ev) => {
        clear();
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < MIN_PX) return;
        const to = endAt(rt, ev.clientX, ev.clientY);
        if (to.nodeId && to.nodeId === from.nodeId) return;
        const parentId = pageOf(rt);
        if (!parentId) return;
        const id = newId();
        const count = Object.values(rt.doc().nodes).filter((n) => n.type === "connector").length + 1;
        void rt.apply([{ op: "create", node: { type: "connector", id, name: `${rt.text("names.connector")} ${count}`, from, to, route: "elbow" } as never, parentId }], rt.text(ARROW_LABEL)).then((ok) => {
          if (ok) rt.select([id]);
        });
        rt.toolDone();
      },
      cancel: clear,
    };
  },
};
