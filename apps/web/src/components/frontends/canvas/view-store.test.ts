import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createViewStore, SETTLE_MS } from "./view-store";

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] }));
afterEach(() => vi.useRealTimers());

const targets = () => ({ world: document.createElement("div"), overlay: document.createElement("div") });

describe("the view store", () => {
  it("writes transform on the world and the camera variables on the overlay, once per frame however many sets", () => {
    const store = createViewStore();
    const t = targets();
    store.attach(t);
    expect(t.world.style.transform).toMatch(/^translate\(0px(, 0px)?\) scale\(1\)$/);
    const onFrame = vi.fn();
    store.onFrame(onFrame);
    for (let i = 1; i <= 20; i++) store.set((v) => ({ ...v, x: v.x + 1 }));
    expect(t.world.style.transform).toMatch(/^translate\(0px(, 0px)?\) scale\(1\)$/);
    vi.advanceTimersByTime(17);
    expect(t.world.style.transform).toMatch(/^translate\(20px(, 0px)?\) scale\(1\)$/);
    expect(t.overlay.style.getPropertyValue("--view-x")).toBe("20px");
    expect(t.overlay.style.getPropertyValue("--view-y")).toBe("0px");
    expect(t.overlay.style.getPropertyValue("--view-zoom")).toBe("1");
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledWith({ x: 20, y: 0, zoom: 1 });
  });

  it("set(fn) starts from where the camera is going, so steps in one frame add up", () => {
    const store = createViewStore({ x: 5, y: 5, zoom: 2 });
    store.set((v) => ({ ...v, y: v.y + 10 }));
    store.set((v) => ({ ...v, y: v.y + 10 }));
    expect(store.getTarget().y).toBe(25);
    expect(store.get().y).toBe(5);
    store.flush();
    expect(store.get().y).toBe(25);
  });

  it("clamps the zoom to 0.1 to 8", () => {
    const store = createViewStore();
    store.set({ x: 0, y: 0, zoom: 100 }, true);
    expect(store.get().zoom).toBe(8);
    store.set({ x: 0, y: 0, zoom: 0 }, true);
    expect(store.get().zoom).toBe(0.1);
  });

  it("is at rest 140 ms after the last move, and not before", () => {
    const store = createViewStore();
    const settled = vi.fn();
    store.onSettled(settled);
    store.set({ x: 1, y: 0, zoom: 1 }, true);
    vi.advanceTimersByTime(SETTLE_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    store.set({ x: 2, y: 0, zoom: 1 }, true);
    vi.advanceTimersByTime(SETTLE_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith({ x: 2, y: 0, zoom: 1 });
    expect(SETTLE_MS).toBe(140);
  });

  it("a set to the same camera does nothing", () => {
    const store = createViewStore();
    const onFrame = vi.fn();
    store.onFrame(onFrame);
    store.set({ x: 0, y: 0, zoom: 1 });
    vi.advanceTimersByTime(100);
    expect(onFrame).not.toHaveBeenCalled();
  });

  it("a dispose and attach again (a StrictMode remount) keeps the pending frame and the settle", () => {
    const store = createViewStore();
    const settled = vi.fn();
    store.onSettled(settled);
    store.attach(targets());
    store.set({ x: 5, y: 0, zoom: 1 }, true);
    store.set({ x: 9, y: 0, zoom: 1 });
    store.attach(null);
    store.dispose();
    const t = targets();
    store.attach(t);
    vi.advanceTimersByTime(17);
    expect(t.world.style.transform).toMatch(/translate\(9px/);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(settled).toHaveBeenCalledWith({ x: 9, y: 0, zoom: 1 });
  });

  it("paints a camera set before attach, and stops writing after dispose", () => {
    const store = createViewStore();
    store.set({ x: 3, y: 4, zoom: 2 }, true);
    const t = targets();
    store.attach(t);
    expect(t.world.style.transform).toBe("translate(3px, 4px) scale(2)");
    store.dispose();
    store.set({ x: 9, y: 9, zoom: 1 }, true);
    expect(t.world.style.transform).toBe("translate(3px, 4px) scale(2)");
  });
});
