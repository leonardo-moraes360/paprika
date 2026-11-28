import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { stubLayout } from "@/test/canvas-fixtures";
import { renderEditorRig, serveDocument } from "@/test/live-harness";

let restoreLayout: () => void;
beforeAll(() => {
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [] });
});
beforeEach(() => {
  restoreLayout = stubLayout();
});
afterEach(() => {
  restoreLayout();
  vi.useRealTimers();
});

describe("the pin tool on the canvas of the editor", () => {
  it("the form for a pin dragged over an area has the focus when the pointer is released, before the next key can arrive: what is typed right after goes to it, not to the canvas shortcuts", async () => {
    const view = await renderEditorRig({ nodes: 30 });
    serveDocument(view.rig, view.doc);
    await screen.findByRole("banner");
    await screen.findByRole("tree", { name: "Layer tree" });
    fireEvent.keyDown(document.body, { key: "i" });
    const viewport = await screen.findByTestId("viewport");
    expect(viewport.dataset.tool).toBe("pin");
    // The events of a real pointer arrive one task at a time, outside React's `act`: the update a release causes is not flushed for the test.
    const env = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const before = env.IS_REACT_ACT_ENVIRONMENT;
    env.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      const fire = (target: EventTarget, type: string, x: number, y: number) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 7, clientX: x, clientY: y }));
      fire(viewport, "pointerdown", 100, 100);
      fire(window, "pointermove", 140, 130);
      fire(window, "pointermove", 220, 200);
      fire(window, "pointerup", 220, 200);
      // Nothing was awaited: this is the instant the next key would be dispatched.
      const holder = document.activeElement;
      expect(holder?.tagName, "the field of the form must hold the focus when the next key arrives").toBe("TEXTAREA");
      expect(holder?.closest('[data-testid="new-pin-form"]')).not.toBeNull();
      // A letter that is a shortcut of the canvas (r: rectangle) goes into the field and changes no tool.
      const key = new KeyboardEvent("keydown", { key: "r", bubbles: true, cancelable: true });
      holder?.dispatchEvent(key);
      expect(viewport.dataset.tool).toBe("pin");
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = before;
      await act(async () => undefined);
    }
  });
});
