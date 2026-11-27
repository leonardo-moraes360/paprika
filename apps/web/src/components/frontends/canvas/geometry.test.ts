import { describe, expect, it } from "vitest";
import { elementOf, fitView, focusView, gridCell, gridStyle, measureElement, nodeIdOf, toLocal, toScreen, toWorld, unionBox, wheelPan, wheelZoom, zoomAround } from "./geometry";

describe("camera math", () => {
  it("zoomAround keeps the world point under the screen point", () => {
    const v = { x: 40, y: -20, zoom: 1.5 };
    const next = zoomAround(v, 300, 200, 3);
    expect((300 - v.x) / v.zoom).toBeCloseTo((300 - next.x) / next.zoom, 9);
    expect((200 - v.y) / v.zoom).toBeCloseTo((200 - next.y) / next.zoom, 9);
    expect(next.zoom).toBe(3);
    expect(zoomAround(v, 0, 0, 99).zoom).toBe(8);
    expect(zoomAround(v, 0, 0, 0).zoom).toBe(0.1);
  });

  it("wheelZoom scales by exp(-dy * 0.0015)", () => {
    expect(wheelZoom({ x: 0, y: 0, zoom: 1 }, 0, 0, -100).zoom).toBeCloseTo(Math.exp(0.15), 9);
    expect(wheelZoom({ x: 0, y: 0, zoom: 1 }, 0, 0, 100).zoom).toBeCloseTo(Math.exp(-0.15), 9);
  });

  it("wheelPan moves the world against the wheel; Shift swaps a vertical wheel to the horizontal axis", () => {
    const v = { x: 0, y: 0, zoom: 1 };
    expect(wheelPan(v, 5, 7, false)).toEqual({ x: -5, y: -7, zoom: 1 });
    expect(wheelPan(v, 0, 7, true)).toEqual({ x: -7, y: 0, zoom: 1 });
    expect(wheelPan(v, 3, 7, true)).toEqual({ x: -3, y: -7, zoom: 1 });
  });

  it("fitView centres the bounds, leaves 120 px, never above 100 % nor below 10 %", () => {
    expect(fitView({ x: 100, y: 50, width: 200, height: 100 }, { width: 1000, height: 800 })).toEqual({ zoom: 1, x: 400 - 100, y: 350 - 50 });
    const big = fitView({ x: 0, y: 0, width: 2000, height: 100 }, { width: 1120, height: 800 });
    expect(big.zoom).toBeCloseTo(0.5, 9);
    expect(fitView({ x: 0, y: 0, width: 1e9, height: 1 }, { width: 1000, height: 800 }).zoom).toBe(0.1);
  });

  it("focusView centres a box and only shrinks the zoom to fit it", () => {
    const v = focusView({ x: 100, y: 100, width: 50, height: 50 }, { width: 1000, height: 800 }, { x: 0, y: 0, zoom: 2 });
    expect(v.zoom).toBe(2);
    expect(v.x).toBe(500 - 125 * 2);
    expect(focusView({ x: 0, y: 0, width: 4000, height: 10 }, { width: 1000, height: 800 }, { x: 0, y: 0, zoom: 2 }).zoom).toBeCloseTo(880 / 4000, 9);
  });

  it("converts screen, world and a parent's local space", () => {
    const v = { x: 30, y: 10, zoom: 2 };
    const origin = { left: 100, top: 50 };
    const w = toWorld(v, origin, 260, 150);
    expect(w).toEqual({ x: 65, y: 45 });
    expect(toScreen(v, origin, w)).toEqual({ x: 260, y: 150 });
    // a parent whose top-left corner is at screen (200, 100): the point (260,150) is (30, 25) in its units
    expect(toLocal(v, { left: 200, top: 100 }, 260, 150)).toEqual({ x: 30, y: 25 });
  });

  it("unionBox", () => {
    expect(unionBox([])).toBeNull();
    expect(unionBox([{ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: -5, width: 5, height: 5 }])).toEqual({ x: 0, y: -5, width: 25, height: 15 });
  });

  it("the grid is 20 px at 100 % and steps to a coarser one instead of turning into a haze", () => {
    expect(gridCell(1)).toBe(20);
    expect(gridCell(2)).toBe(40);
    expect(gridCell(0.1)).toBe(10);
    expect(gridCell(0.4)).toBe(40);
    expect(gridStyle({ x: 45, y: -3, zoom: 1 })).toEqual({ size: "20px 20px", position: "5px -3px" });
  });
});

describe("the DOM side", () => {
  it("finds a node by id even with quotes in the id, and the id of an event target", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div data-paprika-id=\'a"b\'><span id="inner"></span></div>';
    expect(elementOf(root, 'a"b')).not.toBeNull();
    expect(nodeIdOf(root.querySelector("#inner"))).toBe('a"b');
    expect(nodeIdOf(root)).toBeNull();
    expect(nodeIdOf(null)).toBeNull();
  });

  it("measures a box in world units from the bounding rect, and a turned node by its own size around the same centre", () => {
    const el = document.createElement("div");
    const rect = { left: 130, top: 80, width: 100, height: 50 };
    el.getBoundingClientRect = () => ({ ...rect, right: 230, bottom: 130, x: 130, y: 80, toJSON: () => ({}) });
    const view = { x: 10, y: 20, zoom: 2 };
    expect(measureElement(el, { left: 100, top: 50 }, view)).toEqual({ x: 10, y: 5, width: 50, height: 25, rotation: 0 });
    Object.defineProperty(el, "offsetWidth", { value: 40 });
    Object.defineProperty(el, "offsetHeight", { value: 10 });
    expect(measureElement(el, { left: 100, top: 50 }, view, 30)).toEqual({ x: 10 + 25 - 20, y: 5 + 12.5 - 5, width: 40, height: 10, rotation: 30 });
  });
});
