import { describe, expect, it, vi } from "vitest";
import { everyKindDocument } from "@/test/canvas-fixtures";
import { createOverlayBus } from "../overlay-bus";
import { UI_PATH_EDIT, writeUi } from "../vector/ui";
import { gestures } from "./index";
import { startGesture } from "./run";
import type { CanvasRuntime, CanvasTool, Gesture } from "../types";

const rt = { input: { space: false }, tool: () => "select" } as unknown as CanvasRuntime;
const down = (init: PointerEventInit = {}) => new PointerEvent("pointerdown", { pointerId: 1, button: 0, ...init });
const fire = (type: string, init: PointerEventInit = {}) => window.dispatchEvent(new PointerEvent(type, { pointerId: 1, ...init }));

describe("gesture dispatch", () => {
  it("lists the gestures in the order of precedence", () => {
    expect(gestures.map((g) => g.id)).toEqual(["pan", "eyedropper", "pin-place", "connector-edit", "gradient-handle", "spacing-handle", "pen", "path-edit-drag", "path-edit-hold", "resize", "rotate", "create", "connector-create", "move", "marquee", "select-click"]);
    expect(new Set(gestures.map((g) => g.id)).size).toBe(gestures.length);
  });

  it("starts the first gesture that accepts and never asks the rest", () => {
    const second = vi.fn(() => true);
    const first: Gesture = { id: "a", accepts: () => true, start: () => ({}) };
    startGesture(rt, [first, { id: "b", accepts: second, start: () => ({}) }], down());
    expect(second).not.toHaveBeenCalled();
  });

  it("skips a gesture that does not accept, and does nothing when none does", () => {
    const start = vi.fn(() => ({}));
    expect(startGesture(rt, [{ id: "a", accepts: () => false, start }], down())).toBeNull();
    expect(start).not.toHaveBeenCalled();
  });

  it("follows the pointer on the window until it is released, then lets go", () => {
    const move = vi.fn();
    const up = vi.fn();
    startGesture(rt, [{ id: "a", accepts: () => true, start: () => ({ move, up }) }], down());
    fire("pointermove", { clientX: 5 });
    fire("pointermove", { clientX: 6 });
    fire("pointerup");
    fire("pointermove", { clientX: 7 });
    expect(move).toHaveBeenCalledTimes(2);
    expect(up).toHaveBeenCalledTimes(1);
  });

  it("ignores another pointer", () => {
    const move = vi.fn();
    startGesture(rt, [{ id: "a", accepts: () => true, start: () => ({ move }) }], down());
    fire("pointermove", { pointerId: 2 });
    expect(move).not.toHaveBeenCalled();
    fire("pointerup");
  });

  it("cancel runs on pointercancel and when the canvas stops it, once", () => {
    const cancel = vi.fn();
    const g: Gesture = { id: "a", accepts: () => true, start: () => ({ cancel }) };
    startGesture(rt, [g], down());
    fire("pointercancel");
    expect(cancel).toHaveBeenCalledTimes(1);
    const stop = startGesture(rt, [g], down());
    stop?.();
    stop?.();
    fire("pointerup");
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("a gesture with nothing to follow (a click) leaves no listeners", () => {
    expect(startGesture(rt, [{ id: "a", accepts: () => true, start: () => undefined }], down())).toBeNull();
  });
});

/**
 * The order of `gestures/index.ts` IS the precedence. Each case is a press whose target would be taken by two or more gestures,
 * and says which one must win: the press goes through the real list with a runtime that answers like the canvas does.
 */
describe("gesture precedence", () => {
  const doc = everyKindDocument();
  type State = { tool?: CanvasTool; space?: boolean; sampling?: boolean; selection?: string[]; pathEdit?: string };
  const winner = (target: Element, state: State = {}, init: PointerEventInit = {}) => {
    const overlay = createOverlayBus();
    const probe = {
      input: { space: state.space ?? false },
      tool: () => state.tool ?? "select",
      sampling: () => state.sampling ?? false,
      selection: () => state.selection ?? [],
      doc: () => doc,
      overlay,
      nodeAt: (t: EventTarget | null) => {
        const id = t instanceof Element ? t.closest("[data-paprika-id]")?.getAttribute("data-paprika-id") : null;
        return id && doc.nodes[id] ? id : null;
      },
    } as unknown as CanvasRuntime;
    if (state.pathEdit) writeUi(probe, UI_PATH_EDIT, { id: state.pathEdit, sel: null, draft: null });
    const event = down(init);
    Object.defineProperty(event, "target", { value: target });
    return gestures.find((g) => g.accepts(probe, event))?.id ?? null;
  };
  const html = (markup: string) => {
    const host = document.createElement("div");
    host.innerHTML = markup;
    return host;
  };
  const world = html(`
    <div data-paprika-id="btn"><span id="btn-body"></span>
      <div data-handle="se"><i id="resize-with-gradient" data-gradient-handle></i></div>
    </div>
    <div data-paprika-id="squiggle"><svg id="squiggle-body"></svg><i id="anchor" data-path-anchor="0:0"></i></div>
    <div data-paprika-id="arrow"></div>
    <div data-paprika-id="home"><b id="spacing" data-spacing data-spacing-kind="gap" data-spacing-frame="home"></b></div>
    <i id="corner" data-handle="nw"></i><i id="rotor" data-rotate-handle></i><i id="end" data-connector-handle="to"></i>
    <p id="empty"></p>`);
  const at = (id: string) => world.querySelector(`#${id}`) as Element;
  const node = (id: string) => world.querySelector(`[data-paprika-id="${id}"]`) as Element;

  it("pan beats everything: the middle button over a handle, or Space held over a node", () => {
    expect(winner(at("corner"), {}, { button: 1 })).toBe("pan");
    expect(winner(node("btn"), { space: true })).toBe("pan");
    expect(winner(node("btn"), { space: true, sampling: true, tool: "pen" })).toBe("pan");
  });

  it("the armed eyedropper takes the press over a handle and over a node", () => {
    expect(winner(at("corner"), { sampling: true })).toBe("eyedropper");
    expect(winner(node("btn"), { sampling: true })).toBe("eyedropper");
  });

  it("the pin tool points at the node under it: the node is not moved or selected", () => {
    expect(winner(node("btn"), { tool: "pin" })).toBe("pin-place");
  });

  it("the pen draws over a node: the node is not moved, selected or marquee'd", () => {
    expect(winner(node("btn"), { tool: "pen" })).toBe("pen");
    expect(winner(at("empty"), { tool: "pen" })).toBe("pen");
  });

  it("the handle of a gradient beats the resize corner it sits in, and a spacing handle beats the frame under it", () => {
    expect(winner(at("resize-with-gradient"))).toBe("gradient-handle");
    expect(winner(at("spacing"))).toBe("spacing-handle");
    expect(winner(at("corner"))).toBe("resize");
  });

  it("the end of the selected arrow is grabbed before the arrow (or a node) is moved", () => {
    expect(winner(at("end"), { selection: ["arrow"] })).toBe("connector-edit");
    // not the handle of a connector that is not the selection
    expect(winner(at("end"), { selection: ["btn"] })).not.toBe("connector-edit");
  });

  it("in the edit mode of a path: a point is dragged, the rest of the path is held (not moved), another node still moves", () => {
    expect(winner(at("anchor"), { pathEdit: "squiggle" })).toBe("path-edit-drag");
    expect(winner(at("squiggle-body"), { pathEdit: "squiggle" })).toBe("path-edit-hold");
    expect(winner(node("btn"), { pathEdit: "squiggle" })).toBe("move");
    // out of the mode the same press moves the path
    expect(winner(at("squiggle-body"))).toBe("move");
  });

  it("the resize corner and the rotate handle come before the move of the node they belong to", () => {
    expect(winner(at("corner"))).toBe("resize");
    expect(winner(at("rotor"))).toBe("rotate");
  });

  it("a creation tool draws over a node and over a handle; the connector tool starts an arrow instead of moving the node", () => {
    expect(winner(node("btn"), { tool: "rect" })).toBe("create");
    expect(winner(at("empty"), { tool: "frame" })).toBe("create");
    expect(winner(node("btn"), { tool: "connector" })).toBe("connector-create");
  });

  it("with the selection tool: a node moves, the empty page is a marquee, Shift on a node is the click that toggles, a right press is nothing", () => {
    expect(winner(node("btn"))).toBe("move");
    expect(winner(at("empty"))).toBe("marquee");
    expect(winner(node("btn"), {}, { shiftKey: true })).toBe("select-click");
    expect(winner(node("btn"), {}, { button: 2 })).toBeNull();
  });
});
