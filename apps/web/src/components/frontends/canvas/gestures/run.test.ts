import { describe, expect, it, vi } from "vitest";
import { gestures } from "./index";
import { startGesture } from "./run";
import type { CanvasRuntime, Gesture } from "../types";

const rt = { input: { space: false }, tool: () => "select" } as unknown as CanvasRuntime;
const down = (init: PointerEventInit = {}) => new PointerEvent("pointerdown", { pointerId: 1, button: 0, ...init });
const fire = (type: string, init: PointerEventInit = {}) => window.dispatchEvent(new PointerEvent(type, { pointerId: 1, ...init }));

describe("gesture dispatch", () => {
  it("lists the gestures in order: pan before the click that selects", () => {
    expect(gestures.map((g) => g.id)).toEqual(["pan", "select-click"]);
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
