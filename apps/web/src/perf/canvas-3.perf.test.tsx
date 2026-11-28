import { applyOps, createDocument, type Document, type Op } from "@paprika/core";
import { act, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Canvas, createCanvasFeed } from "@/components/frontends/canvas";
import { stubLayout, testDefaults } from "@/test/canvas-fixtures";

/**
 * Vectors and handles with a page of 5 000 nodes (plan, section 4): editing a path, dragging a connector end, a gradient handle
 * or a spacing handle renders only the nodes the gesture changes (counted on the world), and sends ONE apply when it ends.
 * Durations are jsdom's and information only; the browser's are in the report.
 */
const NODES = 5000;
const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function bigDocument(): Document {
  const ops: Op[] = [
    { op: "add_page", id: "page", name: "Page" } as unknown as Op,
    { op: "create", parentId: "page", node: { type: "path", id: "vec", name: "Vec", x: 100, y: 100, width: 200, height: 120, d: "M0 100 C40 0 160 0 200 100 L100 120 Z", fill: "paper", stroke: { color: "ink", width: 2 } } },
    { op: "create", parentId: "page", node: { type: "rect", id: "grad", name: "Grad", x: 400, y: 100, width: 240, height: 140, fill: "paper", gradient: { type: "linear", angle: 90, cx: 0.5, cy: 0.5, radius: 0.5, stops: [{ color: "red", offset: 0 }, { color: "blue", offset: 1 }] } } },
    { op: "create", parentId: "page", node: { type: "frame", id: "flow", name: "Flow", x: 100, y: 400, width: 360, height: 160, layout: { mode: "row", gap: 16, padding: 20, align: "start", justify: "start" } } },
    { op: "create", parentId: "flow", node: { type: "rect", id: "k1", name: "K1", width: 80, height: 60 } },
    { op: "create", parentId: "flow", node: { type: "rect", id: "k2", name: "K2", width: 80, height: 60 } },
    { op: "create", parentId: "page", node: { type: "shape", id: "sa", name: "A", x: 600, y: 400, width: 140, height: 70, text: "A", shape: "rect" } },
    { op: "create", parentId: "page", node: { type: "shape", id: "sb", name: "B", x: 600, y: 650, width: 140, height: 70, text: "B", shape: "rect" } },
    { op: "create", parentId: "page", node: { type: "connector", id: "arrow", from: { nodeId: "sa" }, to: { nodeId: "sb" }, route: "elbow" } },
    { op: "create", parentId: "page", node: { type: "frame", id: "bulk", name: "Bulk", x: 2000, y: 0, width: 4000, height: 4000 } },
  ];
  const doc = applyOps(createDocument("Big", "doc-3"), ops).doc;
  const filler: Op[] = [];
  for (let i = 0; i < NODES - Object.keys(doc.nodes).length; i++) filler.push({ op: "create", parentId: "bulk", node: { type: "rect", id: `r${i}`, name: `R${i}`, x: (i % 70) * 50, y: Math.floor(i / 70) * 50, width: 40, height: 40, fill: "paper" } } as unknown as Op);
  return applyOps(doc, filler).doc;
}

let restore: () => void;
beforeEach(() => {
  restore = stubLayout();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
  (SVGElement.prototype as unknown as { getScreenCTM: () => typeof identity }).getScreenCTM = () => identity;
  for (const key of ["offsetLeft", "offsetTop", "offsetWidth", "offsetHeight"] as const) {
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get(this: HTMLElement) {
        const w = Number.parseFloat(this.style.width) || 0;
        const h = Number.parseFloat(this.style.height) || 0;
        if (key === "offsetWidth") return w;
        if (key === "offsetHeight") return h;
        if (this.parentElement?.dataset.paprikaId !== "flow") return 0;
        const index = [...this.parentElement.children].indexOf(this);
        return key === "offsetLeft" ? 20 + index * 96 : 20;
      },
    });
  }
});
afterEach(() => {
  restore();
  for (const key of ["offsetLeft", "offsetTop", "offsetWidth", "offsetHeight"]) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
  delete (SVGElement.prototype as unknown as Record<string, unknown>).getScreenCTM;
  vi.useRealTimers();
});

const frames = (n = 1) => act(() => void vi.advanceTimersByTime(17 * n));
const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(20)));

function mount(selection: string[], tool: "select" | "pen" = "select") {
  const doc = bigDocument();
  const feed = createCanvasFeed({ doc, pageId: "page", tool });
  const onApply = vi.fn(async () => true);
  const view = render(<Canvas feed={feed} onSelect={(ids) => feed.update({ selection: ids })} onApply={onApply} onToolDone={() => feed.update({ tool: "select" })} onError={() => {}} defaults={{ ...testDefaults, vector: { stroke: "ink", fill: "paper" } }} />);
  frames(2);
  if (selection.length) act(() => feed.update({ selection }));
  const scoped = within(view.container);
  const world = scoped.getByTestId("canvas-world");
  const viewport = scoped.getByTestId("viewport");
  const m = /translate\(([-\d.e]+)px(?:,\s*([-\d.e]+)px)?\)\s*scale\(([-\d.e]+)\)/.exec(world.style.transform) ?? [];
  const cam = { x: Number(m[1] ?? 0), y: Number(m[2] ?? 0), zoom: Number(m[3] ?? 1) };
  const at = (x: number, y: number) => ({ clientX: cam.x + x * cam.zoom, clientY: cam.y + y * cam.zoom });
  const renders = () => (world as unknown as { __paprikaNodeRenders: number }).__paprikaNodeRenders;
  return { ...view, feed, onApply, world, viewport, at, renders };
}

let pointer = 0;
const drag = (target: Element, from: { clientX: number; clientY: number }, steps: { clientX: number; clientY: number }[], init: PointerEventInit = {}) => {
  pointer += 1;
  const id = pointer;
  fireEvent.pointerDown(target, { button: 0, pointerId: id, ...from, ...init });
  for (const p of steps) {
    fireEvent.pointerMove(window, { pointerId: id, ...p, ...init });
    frames();
  }
  fireEvent.pointerUp(window, { pointerId: id, ...steps.at(-1)!, ...init });
  return id;
};
const ramp = (from: { clientX: number; clientY: number }, dx: number, dy: number, n = 20) =>
  Array.from({ length: n }, (_, i) => ({ clientX: from.clientX + (dx * (i + 1)) / n, clientY: from.clientY + (dy * (i + 1)) / n }));

describe("vectors and handles with 5 000 nodes", () => {
  it("dragging a path anchor renders only the path, and applies once at the end", async () => {
    const m = mount(["vec"]);
    const vec = m.world.querySelector('[data-paprika-id="vec"]') as HTMLElement;
    fireEvent.doubleClick(vec);
    frames();
    const anchor = m.container.querySelector('[data-path-anchor="0:2"]') as Element;
    expect(anchor).not.toBeNull();
    const from = { clientX: 100, clientY: 120 };
    const before = m.renders();
    drag(anchor, from, ramp(from, 60, 30));
    expect(m.onApply).toHaveBeenCalledTimes(1);
    await flush();
    const rendered = m.renders() - before;
    process.stderr.write(`[perf canvas-3 jsdom] path anchor drag, 20 moves: ${rendered} node renders of ${NODES}\n`);
    expect(rendered).toBeLessThanOrEqual(3);
    m.unmount();
  }, 30_000);

  it("dragging a connector end renders only the connectors that follow it", async () => {
    const m = mount(["arrow"]);
    const handle = m.container.querySelector('[data-connector-handle="to"]') as Element;
    expect(handle).not.toBeNull();
    const from = m.at(670, 650);
    const before = m.renders();
    drag(handle, from, ramp(from, 80, 100));
    await flush();
    const rendered = m.renders() - before;
    process.stderr.write(`[perf canvas-3 jsdom] connector end drag, 20 moves: ${rendered} node renders of ${NODES}\n`);
    expect(m.onApply.mock.calls.length).toBeLessThanOrEqual(1);
    // one render of the connector per move (it is routed again over the shown ends), and no other node
    expect(rendered).toBeLessThanOrEqual(21);
    m.unmount();
  }, 30_000);

  it("dragging a gradient stop renders no other node than the shape and applies once", async () => {
    const m = mount(["grad"]);
    const stop = m.container.querySelector('[data-gradient-handle^="stop"]') as Element;
    expect(stop).not.toBeNull();
    const from = m.at(520, 100);
    const before = m.renders();
    drag(stop, from, ramp(from, 0, 60));
    await flush();
    const rendered = m.renders() - before;
    process.stderr.write(`[perf canvas-3 jsdom] gradient stop drag, 20 moves: ${rendered} node renders of ${NODES}\n`);
    expect(m.onApply.mock.calls.length).toBeLessThanOrEqual(1);
    expect(rendered).toBeLessThanOrEqual(3);
    m.unmount();
  }, 30_000);

  it("dragging the gap handle renders only the frame and its children, and applies once", async () => {
    const m = mount(["flow"]);
    const handle = m.container.querySelector('[data-spacing-kind="gap"]') as Element;
    expect(handle).not.toBeNull();
    const from = m.at(200, 450);
    const before = m.renders();
    drag(handle, from, ramp(from, 20, 0));
    await flush();
    const rendered = m.renders() - before;
    process.stderr.write(`[perf canvas-3 jsdom] gap drag, 20 moves: ${rendered} node renders of ${NODES}\n`);
    expect(m.onApply.mock.calls.length).toBeLessThanOrEqual(1);
    // the frame once per move (its children keep their memoized render); no other node
    expect(rendered).toBeLessThanOrEqual(21);
    m.unmount();
  }, 30_000);

  it("drawing with the pen renders no node until it ends, and creates once", async () => {
    const m = mount([], "pen");
    const before = m.renders();
    for (const [x, y] of [[1000, 1000], [1100, 1000], [1100, 1100]] as const) {
      fireEvent.pointerDown(m.viewport, { button: 0, pointerId: 90, ...m.at(x, y) });
      fireEvent.pointerUp(window, { pointerId: 90, ...m.at(x, y) });
      for (let i = 0; i < 20; i++) fireEvent.pointerMove(m.viewport, { buttons: 0, ...m.at(x + i, y + i) });
    }
    expect(m.renders() - before).toBe(0);
    fireEvent.keyDown(window, { key: "Enter" });
    await flush();
    expect(m.onApply).toHaveBeenCalledTimes(1);
    m.unmount();
  }, 30_000);
});
