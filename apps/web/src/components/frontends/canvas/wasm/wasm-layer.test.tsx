import { applyOps, DISPLAY_STRIDE, type Document, type Op } from "@paprika/core";
import { act, fireEvent, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { everyKindDocument, stubLayout, testDefaults } from "@/test/canvas-fixtures";
import { fakeWasm } from "@/test/fake-wasm";
import { Canvas, createCanvasFeed } from "../index";
import type { CanvasRendererStatus } from "./types";

/**
 * The WASM layer with a stand-in for the renderer module (`test/fake-wasm.ts`): what it asks the module, when it hands the
 * nodes over and back, and what the owner is told. The real module is checked in the browser (see the report of batch 5).
 */

let restore: () => void;
let observers: { callback: ResizeObserverCallback; target?: Element }[] = [];
const realObserver = globalThis.ResizeObserver;
beforeEach(() => {
  restore = stubLayout();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
  observers = [];
  globalThis.ResizeObserver = class {
    entry: { callback: ResizeObserverCallback; target?: Element };
    constructor(callback: ResizeObserverCallback) {
      this.entry = { callback };
      observers.push(this.entry);
    }
    observe(target: Element) {
      this.entry.target = target;
    }
    unobserve() {}
    disconnect() {
      observers = observers.filter((o) => o !== this.entry);
    }
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  restore();
  vi.useRealTimers();
  globalThis.ResizeObserver = realObserver;
});

const elapse = (ms = 20) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

function mount(options: { doc?: Document; renderer?: "dom" | "cpu" | "gpu"; loader?: typeof fakeWasm.loader | null; strict?: boolean; selection?: string[] } = {}) {
  const feed = createCanvasFeed({ doc: options.doc ?? everyKindDocument(), pageId: "page", renderer: options.renderer ?? "cpu", selection: options.selection ?? [] });
  const statuses: CanvasRendererStatus[] = [];
  const errors: string[] = [];
  const onApply = vi.fn(() => Promise.resolve(true));
  const tree = (
    <Canvas
      feed={feed}
      defaults={testDefaults}
      wasm={options.loader === undefined ? fakeWasm.loader : options.loader}
      onSelect={(ids) => feed.update({ selection: ids })}
      onApply={onApply}
      onRendererStatus={(s) => void statuses.push(s)}
      onRendererError={(m) => void errors.push(m)}
    />
  );
  const view = render(options.strict ? <StrictMode>{tree}</StrictMode> : tree);
  const world = view.getByTestId("canvas-world");
  const viewport = view.getByTestId("viewport");
  return { ...view, feed, statuses, errors, onApply, world, viewport, overlays: view.getByTestId("canvas-overlays") };
}

const node = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-paprika-id="${id}"]`) as HTMLElement;
const layer = (root: HTMLElement) => root.querySelector<HTMLCanvasElement>('[data-testid="wasm-layer"]');
const nodeRenders = (world: HTMLElement) => (world as unknown as { __paprikaNodeRenders: number }).__paprikaNodeRenders;
const measures = (world: HTMLElement) => (world as unknown as { __paprikaMeasures?: number }).__paprikaMeasures ?? 0;
/** Whether the DOM still paints the node's background (jsdom writes a transparent one as `none`). */
const domPaints = (el: HTMLElement) => /rgb|#|gradient/.test(el.style.background);
const backends = (statuses: CanvasRendererStatus[]) => statuses.map((s) => s.backend);
/** The record of one node in the display list: the scene keeps them in paint order, so the test finds it by its box. */
const records = (data: Float32Array) => Array.from({ length: data.length / DISPLAY_STRIDE }, (_, i) => Array.from(data.slice(i * DISPLAY_STRIDE, (i + 1) * DISPLAY_STRIDE)));
const centre = (el: HTMLElement) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

describe("the module is missing", () => {
  it("a build without the renderer reports it, keeps the DOM painting and never touches a canvas context", async () => {
    const { world, statuses, viewport, errors } = mount({ loader: null });
    await elapse();
    expect(backends(statuses)).toEqual(["unavailable"]);
    expect(errors).toEqual([]);
    expect(layer(viewport)).toHaveAttribute("data-backend", "unavailable");
    expect(domPaints(node(world, "btn"))).toBe(true);
    expect(world.dataset.wasmActive).toBeUndefined();
  });

  it("the DOM renderer never loads the module nor mounts the canvas", async () => {
    const { viewport, world } = mount({ renderer: "dom" });
    await elapse();
    expect(fakeWasm.loads).toBe(0);
    expect(layer(viewport)).toBeNull();
    expect(domPaints(node(world, "btn"))).toBe(true);
  });
});

describe("loading and the backend", () => {
  it("says loading while the renderer is made, then the backend that draws, and writes both on the canvas for the server's screenshot", async () => {
    fakeWasm.hold = true;
    const { viewport, statuses } = mount();
    await elapse();
    expect(backends(statuses)).toEqual(["loading"]);
    expect(layer(viewport)).toHaveAttribute("data-backend", "loading");
    fakeWasm.release();
    await elapse();
    expect(backends(statuses)).toEqual(["loading", "cpu"]);
    const canvas = layer(viewport)!;
    expect(canvas).toHaveAttribute("data-backend", "cpu");
    expect(canvas.dataset.detail).toBe("no adapter · forced by mode=cpu");
    expect(canvas.dataset.creates).toBe("1");
    expect(canvas).toHaveAttribute("aria-hidden", "true");
  });

  it("reports webgpu with the adapter when the module has a hardware one", async () => {
    const { viewport, statuses } = mount({ renderer: "gpu" });
    await elapse();
    expect(statuses.at(-1)).toEqual({ backend: "webgpu", detail: "fake adapter" });
    expect(layer(viewport)).toHaveAttribute("data-backend", "webgpu");
  });

  it("the canvas takes the pixel size of the viewport and sits under the world", async () => {
    const { viewport, world } = mount();
    await elapse();
    const canvas = layer(viewport)!;
    expect([canvas.width, canvas.height]).toEqual([1000, 800]);
    expect(canvas.nextElementSibling).toBe(world);
    expect(canvas.className).toContain("pointer-events-none");
  });

  it("draws the camera in device pixels, background transparent", async () => {
    const { viewport } = mount();
    await elapse();
    const r = fakeWasm.last!;
    expect(r.renders.length).toBeGreaterThan(0);
    const [tx, ty, zoom] = r.renders.at(-1)!;
    expect(Number.isFinite(tx) && Number.isFinite(ty)).toBe(true);
    expect(zoom).toBeGreaterThan(0);
    expect(zoom).toBeLessThanOrEqual(1);
    expect(layer(viewport)).not.toBeNull();
  });
});

describe("the handover from the DOM", () => {
  it("a node the layer paints drops fill, border and shadow in the DOM, the others keep theirs, and the world says the layer is active", async () => {
    const doc = applyOps(everyKindDocument(), [
      { op: "create", parentId: "page", node: { type: "frame", id: "framed", name: "Framed", x: 400, y: 600, width: 80, height: 60, fill: "#336699", stroke: { color: "#ff0000", width: 3 }, shadow: { x: 0, y: 2, blur: 6, spread: 0, color: "rgba(0,0,0,0.3)" } } },
    ] as unknown as Op[]).doc;
    const { world } = mount({ doc });
    await elapse();
    expect(world.dataset.wasmActive).toBe("1");
    expect(domPaints(node(world, "btn"))).toBe(false);
    expect(node(world, "btn").style.boxShadow).toBe("");
    expect(node(world, "framed").style.borderColor).toMatch(/transparent|rgba\(0, 0, 0, 0\)/);
    expect(node(world, "framed").style.boxShadow).toBe("");
    // A text is never the layer's: it keeps its paint and its colour.
    expect(node(world, "title").style.color).not.toBe("");
    expect(node(world, "arrow")).not.toBeNull();
    // The scene holds what the layer paints: at least the button.
    expect(records(fakeWasm.last!.scenes.at(-1)!.data).length).toBeGreaterThan(0);
  });

  it("a path the layer paints is an empty box in the DOM (no svg path, the layer draws it); one it cannot draw keeps its svg", async () => {
    const doc = applyOps(everyKindDocument(), [
      { op: "create", parentId: "page", node: { type: "path", id: "solo", name: "Solo", x: 700, y: 700, width: 50, height: 50, d: "M0 0 L50 0 L25 50 Z", fill: "#112233" } },
      { op: "create", parentId: "page", node: { type: "path", id: "dashed", name: "Dashed", x: 800, y: 700, width: 50, height: 50, d: "M0 0 L50 50", stroke: { color: "#222222", width: 2, style: "dashed" } } },
    ] as unknown as Op[]).doc;
    const { world } = mount({ doc });
    await elapse();
    const solo = node(world, "solo");
    expect(solo.tagName.toLowerCase()).toBe("div");
    expect(solo.querySelector("path")).toBeNull();
    expect(node(world, "dashed").querySelector("path")).not.toBeNull();
  });

  it("the scene is on the canvas BEFORE the DOM stops painting: the first draw comes first", async () => {
    const order: string[] = [];
    let firstFrame: { domPainted: boolean; active: string | undefined } | undefined;
    const { world } = mount();
    fakeWasm.onRender = () => {
      firstFrame ??= { domPainted: domPaints(node(world, "btn")), active: world.dataset.wasmActive };
    };
    // Watch the world: it turns `active` only after a successful draw.
    const observer = new MutationObserver(() => order.push(`active=${world.dataset.wasmActive}`));
    observer.observe(world, { attributes: true, attributeFilter: ["data-wasm-active"] });
    await elapse();
    observer.disconnect();
    expect(fakeWasm.last!.renders.length).toBeGreaterThan(0);
    expect(fakeWasm.last!.scenes.length).toBeGreaterThan(0);
    expect(world.dataset.wasmActive).toBe("1");
    // At the first frame the DOM still had its paint and the world was not yet active.
    expect(firstFrame).toEqual({ domPainted: true, active: undefined });
  });

  it("only the painted nodes render again when WASM is switched on: the text, the image and the connector do not", async () => {
    const { world, feed } = mount({ renderer: "dom" });
    await elapse();
    const before = nodeRenders(world);
    feed.update({ renderer: "cpu" });
    await elapse();
    const rendered = nodeRenders(world) - before;
    const painted = Object.values(fakeWasm.last!.scenes.at(-1)!.data).length / DISPLAY_STRIDE;
    expect(rendered).toBeGreaterThan(0);
    // One render per painted node (the scene also has clip pushes and pops), and never one per node of the page.
    expect(rendered).toBeLessThanOrEqual(painted);
    expect(rendered).toBeLessThan(world.querySelectorAll("[data-paprika-id]").length);
  });
});

describe("going back and forth", () => {
  it("a node with a border keeps the colour of that border after WASM paints it and DOM takes it back (no `borderColor` is left behind a `border`)", async () => {
    const doc = applyOps(everyKindDocument(), [{ op: "update", id: "btn", props: { stroke: { color: "#ff0000", width: 6 } } } as Op]).doc;
    const { world, feed, errors } = mount({ doc, renderer: "dom" });
    await elapse();
    const colour = () => node(world, "btn").style.borderColor;
    const before = colour();
    expect(before).toMatch(/rgb\(255, 0, 0\)|#ff0000/);
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let round = 0; round < 2; round++) {
      feed.update({ renderer: "cpu" });
      await elapse();
      expect(colour()).toBe("transparent");
      feed.update({ renderer: "dom" });
      await elapse();
      expect(colour()).toBe(before);
      expect(node(world, "btn").style.borderWidth).toBe("6px");
      expect(node(world, "btn").style.borderStyle).toBe("solid");
    }
    // React warns when a style property is removed while its shorthand is set: that was the sign of the bug.
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("Removing a style property"))).toHaveLength(0);
    warn.mockRestore();
    expect(errors).toEqual([]);
  });

  it("DOM gives every node its paint back at once, and WASM again does not make a new renderer", async () => {
    const { world, viewport, feed } = mount();
    await elapse();
    expect(domPaints(node(world, "btn"))).toBe(false);
    const loaded = fakeWasm.loads;
    feed.update({ renderer: "dom" });
    await elapse();
    expect(domPaints(node(world, "btn"))).toBe(true);
    expect(world.dataset.wasmActive).toBe("0");
    // The canvas stays mounted but hidden, and its renderer (its device) is alive.
    expect(layer(viewport)!.className).toContain("invisible");
    expect(fakeWasm.last!.freed).toBe(false);
    const drawsAtRest = fakeWasm.last!.renders.length;
    fireEvent.wheel(viewport, { deltaX: 5, deltaY: 5 });
    await elapse();
    expect(fakeWasm.last!.renders.length).toBe(drawsAtRest);
    feed.update({ renderer: "cpu" });
    await elapse();
    // (The test runs in StrictMode, which boots twice at the start and frees the first; the toggles add nothing.)
    expect(fakeWasm.loads).toBe(loaded);
    expect(fakeWasm.renderers.filter((r) => !r.freed)).toHaveLength(1);
    expect(layer(viewport)!.dataset.creates).toBe("1");
    expect(layer(viewport)!.className).not.toContain("invisible");
    expect(domPaints(node(world, "btn"))).toBe(false);
    expect(fakeWasm.last!.renders.length).toBeGreaterThan(drawsAtRest);
  });

  it("freeing: unmounting the canvas frees the renderer", async () => {
    const { unmount } = mount();
    await elapse();
    const r = fakeWasm.last!;
    unmount();
    expect(r.freed).toBe(true);
  });

  it("StrictMode mounts the canvas twice and no renderer is left over", async () => {
    const { world, viewport } = mount({ strict: true });
    await elapse();
    expect(layer(viewport)).toHaveAttribute("data-backend", "cpu");
    expect(fakeWasm.renderers.filter((r) => !r.freed)).toHaveLength(1);
    expect(domPaints(node(world, "btn"))).toBe(false);
  });
});

describe("a failure goes back to the DOM and says so", () => {
  it("the module cannot load: error once, the DOM keeps painting, and asking again tries again", async () => {
    fakeWasm.failCreate = "no adapter and no 2d context";
    const { world, viewport, statuses, errors, feed } = mount();
    await elapse();
    expect(backends(statuses)).toEqual(["loading", "error"]);
    expect(statuses.at(-1)?.detail).toBe("no adapter and no 2d context");
    expect(errors).toEqual(["no adapter and no 2d context"]);
    expect(layer(viewport)).toHaveAttribute("data-backend", "error");
    expect(domPaints(node(world, "btn"))).toBe(true);
    expect(world.dataset.wasmActive).toBe("0");
    // The owner takes the choice back to DOM and the person picks WASM again: a new try.
    feed.update({ renderer: "dom" });
    await elapse();
    fakeWasm.failCreate = null;
    feed.update({ renderer: "cpu" });
    await elapse();
    expect(backends(statuses).slice(-2)).toEqual(["loading", "cpu"]);
    expect(errors).toHaveLength(1);
    expect(domPaints(node(world, "btn"))).toBe(false);
  });

  it("a render that throws frees the renderer and gives every node back, once", async () => {
    const { world, viewport, errors } = mount();
    await elapse();
    expect(domPaints(node(world, "btn"))).toBe(false);
    const r = fakeWasm.last!;
    fakeWasm.failRender = "injected render error";
    fireEvent.wheel(viewport, { deltaX: 4, deltaY: 4 });
    await elapse();
    fireEvent.wheel(viewport, { deltaX: 4, deltaY: 4 });
    await elapse();
    expect(errors).toEqual(["injected render error"]);
    expect(r.freed).toBe(true);
    expect(domPaints(node(world, "btn"))).toBe(true);
    expect(world.dataset.wasmActive).toBe("0");
    expect(layer(viewport)).toHaveAttribute("data-backend", "error");
  });

  it("a lost WebGPU device (reported after the frame) gives the nodes back", async () => {
    const { world, errors, statuses } = mount({ renderer: "gpu" });
    await elapse();
    expect(statuses.at(-1)?.backend).toBe("webgpu");
    expect(domPaints(node(world, "btn"))).toBe(false);
    fakeWasm.deviceError = "device lost";
    const { viewport } = { viewport: world.parentElement as HTMLElement };
    fireEvent.wheel(viewport, { deltaX: 4, deltaY: 4 });
    await elapse();
    expect(errors).toEqual(["device lost"]);
    expect(domPaints(node(world, "btn"))).toBe(true);
  });

  it("a failure while WASM is off is not held against the next try, and a failed boot is not repeated by itself", async () => {
    fakeWasm.failCreate = "boom";
    const { feed } = mount();
    await elapse(200);
    const loaded = fakeWasm.loads;
    feed.update({ tool: "rect" });
    feed.update({ zoom: 2 });
    await elapse(200);
    expect(fakeWasm.loads).toBe(loaded);
  });
});

describe("the scene follows the page", () => {
  it("measures the boxes ONCE per animation frame however many changes arrive in it, and not at all for a camera frame", async () => {
    const { world, feed, viewport } = mount();
    await elapse();
    const base = measures(world);
    expect(base).toBeGreaterThan(0);
    fireEvent.wheel(viewport, { deltaX: 8, deltaY: 8 });
    await elapse();
    expect(measures(world)).toBe(base);
    const doc = feed.get().doc!;
    const edit = (x: number, n: number): Document => ({ ...doc, nodes: { ...doc.nodes, btn: { ...doc.nodes.btn!, x } as never } }) as Document;
    const scenes = fakeWasm.last!.scenes.length;
    feed.update({ doc: edit(101, 1) });
    feed.update({ doc: edit(102, 2) });
    feed.update({ doc: edit(103, 3) });
    await elapse();
    expect(measures(world)).toBe(base + 1);
    expect(fakeWasm.last!.scenes.length).toBe(scenes + 1);
  });

  it("a node that is no longer paintable goes back to the DOM with the same update", async () => {
    const { world, feed } = mount();
    await elapse();
    expect(domPaints(node(world, "btn"))).toBe(false);
    const doc = feed.get().doc!;
    // A dashed stroke is CSS only (`WASM_FALLBACK_RULES`).
    const dashed = { ...doc, nodes: { ...doc.nodes, btn: { ...doc.nodes.btn!, stroke: { color: "#000000", width: 2, style: "dashed", position: "inside" } } } } as unknown as Document;
    feed.update({ doc: dashed });
    await elapse();
    expect(domPaints(node(world, "btn"))).toBe(true);
  });

  it("the canvas follows a resize of the viewport inside the observer's callback, not a frame later", async () => {
    const { viewport } = mount();
    await elapse();
    const canvas = layer(viewport)!;
    const r = fakeWasm.last!;
    const drawn = r.renders.length;
    const watching = observers.filter((o) => o.target === viewport);
    expect(watching.length).toBeGreaterThan(0);
    const rect = viewport.getBoundingClientRect.bind(viewport);
    viewport.getBoundingClientRect = () => ({ ...rect(), width: 640, height: 480, right: 640, bottom: 480 }) as DOMRect;
    for (const o of watching) o.callback([], {} as ResizeObserver);
    expect([canvas.width, canvas.height]).toEqual([640, 480]);
    expect(r.resizes.at(-1)).toEqual([640, 480]);
    expect(r.renders.length).toBeGreaterThan(drawn);
  });
});

describe("what a gesture shows", () => {
  it("a node being moved is drawn by the layer where the pointer holds it, before any op exists", async () => {
    const { world, onApply } = mount();
    await elapse();
    const btn = node(world, "btn");
    const at = centre(btn);
    const before = records(fakeWasm.last!.scenes.at(-1)!.data).find((r) => r[3] === 120 && r[4] === 40)!;
    fireEvent.pointerDown(btn, { button: 0, pointerId: 1, clientX: at.x, clientY: at.y });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: at.x + 30, clientY: at.y + 10 });
    await elapse();
    const during = records(fakeWasm.last!.scenes.at(-1)!.data).find((r) => r[3] === 120 && r[4] === 40)!;
    expect(onApply).not.toHaveBeenCalled();
    expect(during[1]).toBeGreaterThan(before[1]!);
    expect(during[2]).toBeGreaterThan(before[2]!);
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("a node being turned is drawn turned by the layer (the rotation comes from the preview, not the document)", async () => {
    const { world, overlays } = mount({ selection: ["btn"] });
    await elapse();
    const c = centre(node(world, "btn"));
    const knob = overlays.querySelector<HTMLElement>("[data-rotate-handle]") as HTMLElement;
    fireEvent.pointerDown(knob, { button: 0, pointerId: 1, clientX: c.x, clientY: c.y - 50 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: c.x + 50, clientY: c.y });
    await elapse();
    const turned = records(fakeWasm.last!.scenes.at(-1)!.data).find((r) => r[3] === 120 && r[4] === 40)!;
    expect(turned[6]).toBe(90);
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("a cancelled gesture puts the layer back where the document has the node", async () => {
    const { world } = mount();
    await elapse();
    const btn = node(world, "btn");
    const at = centre(btn);
    const start = records(fakeWasm.last!.scenes.at(-1)!.data).find((r) => r[3] === 120 && r[4] === 40)!;
    fireEvent.pointerDown(btn, { button: 0, pointerId: 1, clientX: at.x, clientY: at.y });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: at.x + 40, clientY: at.y });
    await elapse();
    fireEvent.pointerCancel(window, { pointerId: 1 });
    await elapse();
    const end = records(fakeWasm.last!.scenes.at(-1)!.data).find((r) => r[3] === 120 && r[4] === 40)!;
    expect(end[1]).toBe(start[1]);
  });
  it("asks the module for the mode of the request: cpu for cpu, gpu for gpu", async () => {
    const { viewport } = mount({ renderer: "gpu" });
    await elapse();
    expect(fakeWasm.asked).toEqual(["gpu"]);
    expect(layer(viewport)).toHaveAttribute("data-mode", "gpu");
  });

  it("going from cpu to gpu frees the renderer, hands the nodes to the DOM and boots the other one on a new canvas", async () => {
    const { world, viewport, feed } = mount({ renderer: "cpu" });
    await elapse();
    const first = layer(viewport) as HTMLCanvasElement;
    expect(fakeWasm.asked).toEqual(["cpu"]);
    feed.update({ renderer: "gpu" });
    await elapse();
    expect(fakeWasm.asked).toEqual(["cpu", "gpu"]);
    expect(fakeWasm.renderers[0]?.freed).toBe(true);
    const second = layer(viewport) as HTMLCanvasElement;
    expect(second).not.toBe(first);
    expect(second).toHaveAttribute("data-backend", "webgpu");
    expect(fakeWasm.renderers.filter((r) => !r.freed)).toHaveLength(1);
    expect(domPaints(node(world, "btn"))).toBe(false);
  });

  it("while the other backend boots the DOM paints, with no frame of the new one yet", async () => {
    const { world, feed } = mount({ renderer: "cpu" });
    await elapse();
    fakeWasm.hold = true;
    feed.update({ renderer: "gpu" });
    await elapse();
    expect(world.dataset.wasmActive).toBe("0");
    expect(domPaints(node(world, "btn"))).toBe(true);
    fakeWasm.hold = false;
    fakeWasm.release();
    await elapse();
    expect(world.dataset.wasmActive).toBe("1");
  });

  it("a gpu that cannot start reports the failure with the mode and does not try again", async () => {
    fakeWasm.failGpu = "no WebGPU adapter";
    const { statuses, errors, world } = mount({ renderer: "gpu" });
    await elapse();
    expect(errors).toEqual(["no WebGPU adapter"]);
    expect(statuses.at(-1)).toEqual({ backend: "error", detail: "no WebGPU adapter" });
    expect(fakeWasm.asked).toEqual(["gpu"]);
    expect(domPaints(node(world, "btn"))).toBe(true);
  });
});
