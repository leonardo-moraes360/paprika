import { afterEach, describe, expect, it, vi } from "vitest";
import { measureBoxes } from "./measure";

/** jsdom has no layout: each element answers with the rectangle the test gives it (client px, as the browser would after the world's transform). */
const rects = new Map<Element, { left: number; top: number; width: number; height: number }>();
function el(tag: string, id: string | null, parent: HTMLElement, rect: { left: number; top: number; width: number; height: number }, style: Partial<CSSStyleDeclaration> = {}, type = "frame") {
  const node = document.createElement(tag);
  if (id) {
    node.dataset.paprikaId = id;
    node.dataset.paprikaType = type;
  }
  Object.assign(node.style, style);
  rects.set(node, rect);
  parent.append(node);
  return node;
}

afterEach(() => {
  rects.clear();
  vi.restoreAllMocks();
});

function world(rect = { left: 100, top: 50, width: 0, height: 0 }) {
  const w = document.createElement("div");
  rects.set(w, rect);
  document.body.append(w);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const r = rects.get(this) ?? { left: 0, top: 0, width: 0, height: 0 };
    return { ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => ({}) } as DOMRect;
  });
  return w;
}

describe("measureBoxes", () => {
  it("gives each node its box in world units: relative to the world, divided by the zoom", () => {
    const w = world();
    const a = el("div", "a", w, { left: 140, top: 90, width: 200, height: 100 });
    el("div", "b", a, { left: 160, top: 110, width: 40, height: 20 });
    const boxes = measureBoxes(w, 2);
    expect(boxes.get("a")).toEqual({ x: 20, y: 20, w: 100, h: 50 });
    expect(boxes.get("b")).toEqual({ x: 30, y: 30, w: 20, h: 10 });
  });

  it("keeps the fractions the layout engine has, in 1/64 px", () => {
    const w = world();
    el("div", "a", w, { left: 100 + 7.5 + 1 / 3, top: 50, width: 60.3, height: 10 });
    const a = measureBoxes(w, 1).get("a")!;
    expect(a.x).toBe(Math.round((7.5 + 1 / 3) * 64) / 64);
    expect(a.w).toBe(Math.round(60.3 * 64) / 64);
  });

  it("a turned node has its centre and its own size, not the rectangle that surrounds it on screen", () => {
    const w = world();
    // 100 x 40 at (50, 30) in the world, turned 90 degrees around its centre (100, 50): on screen it covers 40 x 100.
    el("div", "t", w, { left: 100 + 80, top: 50 + 0, width: 40, height: 100 }, { width: "100px", height: "40px", transform: "rotate(90deg)" });
    expect(measureBoxes(w, 1).get("t")).toEqual({ x: 50, y: 30, w: 100, h: 40 });
  });

  it("a path takes its exact inline style, placed in its parent, whoever paints it", () => {
    const w = world();
    const frame = el("div", "f", w, { left: 110, top: 60, width: 300, height: 200 });
    // The layer paints it: an empty box with the style of the path, a rectangle that may be anything on screen.
    el("div", "p", frame, { left: 0, top: 0, width: 0, height: 0 }, { left: "12.5px", top: "7px", width: "24px", height: "24px" }, "path");
    expect(measureBoxes(w, 1).get("p")).toEqual({ x: 10 + 12.5, y: 10 + 7, w: 24, h: 24 });
  });

  it("reads the layout of every node once and writes nothing: one rectangle per node and one for the world", () => {
    const w = world();
    for (let i = 0; i < 50; i++) el("div", `n${i}`, w, { left: 100 + i, top: 50, width: 10, height: 10 });
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect");
    const before = w.outerHTML;
    measureBoxes(w, 1);
    expect(spy).toHaveBeenCalledTimes(51);
    expect(w.outerHTML).toBe(before);
  });

  it("leaves out a node with no box at all (display: none)", () => {
    const w = world();
    el("div", "gone", w, { left: 0, top: 0, width: 0, height: 0 });
    expect(measureBoxes(w, 1).has("gone")).toBe(false);
  });
});
