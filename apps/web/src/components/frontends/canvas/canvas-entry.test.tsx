import { type Document } from "@paprika/core";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { everyKindDocument, stubLayout, testDefaults } from "@/test/canvas-fixtures";
import { Canvas, createCanvasFeed, createCollabStore, type CanvasAgent, type CanvasPin } from "./index";

let restore: () => void;
let under: Element[] = [];
beforeAll(() => {
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => under });
});
beforeEach(() => {
  restore = stubLayout();
  under = [];
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
});
afterEach(() => {
  restore();
  vi.useRealTimers();
});

const frames = (n = 1) => act(() => void vi.advanceTimersByTime(17 * n));

function mount(extra: Partial<Parameters<typeof createCanvasFeed>[0]> = {}, props: Partial<Parameters<typeof Canvas>[0]> = {}, doc: Document = everyKindDocument()) {
  const feed = createCanvasFeed({ doc, pageId: "page", ...extra });
  const collab = createCollabStore();
  const onSelect = vi.fn((ids: readonly string[]) => feed.update({ selection: ids }));
  const handlers = { onPinPoint: vi.fn(), onPinSelect: vi.fn(), onSample: vi.fn(), onInput: vi.fn() };
  const view = render(<Canvas feed={feed} collab={collab} defaults={testDefaults} onSelect={onSelect} {...handlers} {...props} />);
  const viewport = view.getByTestId("viewport");
  const world = view.getByTestId("canvas-world");
  const overlays = view.getByTestId("canvas-overlays");
  return { ...view, feed, collab, onSelect, ...handlers, viewport, world, overlays };
}

const node = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-paprika-id="${id}"]`) as HTMLElement;
const transform = (el: HTMLElement) => {
  const m = /translate\(([-\d.e]+)px(?:,\s*([-\d.e]+)px)?\)\s*scale\(([-\d.e]+)\)/.exec(el.style.transform);
  return { x: Number(m?.[1]), y: Number(m?.[2] ?? 0), zoom: Number(m?.[3]) };
};

const agent = (over: Partial<CanvasAgent> = {}): CanvasAgent => ({ id: "a1", name: "claude", tone: "agent-1", tool: "update_nodes", verb: "editing", activity: "writing", nodes: ["title"], idle: false, ...over });
const pin = (over: Partial<CanvasPin> = {}): CanvasPin => ({ id: "p1", number: 1, status: "open", nodeId: "box", pageId: "page", region: { x: 0, y: 0, width: 5, height: 5 }, label: "Pin 1", ...over });

describe("the pin tool", () => {
  it("a click on an element points at it, lifted to its group, with its box in world units", () => {
    const { world, onPinPoint, onSelect } = mount({ tool: "pin" });
    under = [node(world, "dot")];
    fireEvent.pointerDown(node(world, "dot"), { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(onPinPoint).toHaveBeenCalledTimes(1);
    expect(onPinPoint.mock.calls[0]?.[0].nodeId).toBe("pair");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("a click on a frame gives its own box", () => {
    const { world, onPinPoint } = mount({ tool: "pin" });
    under = [node(world, "box")];
    fireEvent.pointerDown(node(world, "box"), { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(onPinPoint).toHaveBeenCalledWith({ nodeId: "box", region: expect.objectContaining({ x: 600, y: 80 }) });
  });

  it("a drag marks an area: only the overlay draws it while it moves, and the point goes out once, on release", () => {
    const { viewport, world, overlays, onPinPoint } = mount({ tool: "pin" });
    const zoom = transform(world).zoom;
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 102, clientY: 101 });
    expect(overlays.querySelector("[data-testid='pin-drag']")).toBeNull();
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 200, clientY: 160 });
    const drag = overlays.querySelector<HTMLElement>("[data-testid='pin-drag']") as HTMLElement;
    expect(drag.style.width).toBe(`${Math.round(100 / zoom)}px`);
    expect(onPinPoint).not.toHaveBeenCalled();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 200, clientY: 160 });
    expect(onPinPoint).toHaveBeenCalledTimes(1);
    expect(onPinPoint.mock.calls[0]?.[0]).toMatchObject({ nodeId: null, region: { width: Math.round(100 / zoom), height: Math.round(60 / zoom) } });
    expect(overlays.querySelector("[data-testid='pin-drag']")).toBeNull();
  });

  it("a click on nothing marks a spot of size 0", () => {
    const { viewport, onPinPoint } = mount({ tool: "pin" });
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 50, clientY: 50 });
    expect(onPinPoint.mock.calls[0]?.[0]).toMatchObject({ nodeId: null, region: { width: 0, height: 0 } });
  });

  it("does nothing with another tool", () => {
    const { viewport, onPinPoint } = mount({ tool: "select" });
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(onPinPoint).not.toHaveBeenCalled();
  });
});

describe("the pins on the canvas", () => {
  it("draws a numbered badge and an outline for each pin on the page, and none for a pin of another page", () => {
    const { collab, overlays } = mount();
    act(() => collab.set({ pins: [pin(), pin({ id: "p2", number: 2, nodeId: null, region: { x: 10, y: 20, width: 50, height: 40 } }), pin({ id: "p3", number: 3, pageId: "other" })] }));
    expect([...overlays.querySelectorAll("[data-pin]")].map((el) => el.getAttribute("data-pin"))).toEqual(["1", "2"]);
    const outline = overlays.querySelector("[data-pin='1'] div") as HTMLElement;
    expect(outline.style).toMatchObject({ left: "600px", top: "80px", display: "block" });
    const area = overlays.querySelector("[data-pin='2'] div") as HTMLElement;
    expect(area.style).toMatchObject({ left: "10px", top: "20px", width: "50px", height: "40px" });
  });

  it("a badge is a button that names the pin and selects it without touching the selection", () => {
    const { collab, overlays, onPinSelect, onSelect } = mount();
    act(() => collab.set({ pins: [pin()] }));
    const badge = overlays.querySelector("[data-testid='pin-badge']") as HTMLElement;
    expect(badge).toHaveAttribute("aria-label", "Pin 1");
    fireEvent.pointerDown(badge, { button: 0, pointerId: 1 });
    fireEvent.click(badge);
    expect(onPinSelect).toHaveBeenCalledWith("p1");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("a pin that is resolved leaves the canvas when the owner drops it, and the one selected in the list is marked", () => {
    const { collab, overlays } = mount();
    act(() => collab.set({ pins: [pin()], pinId: "p1" }));
    expect(overlays.querySelector("[data-testid='pin-badge']")).toHaveAttribute("aria-pressed", "true");
    act(() => collab.set({ pins: [] }));
    expect(overlays.querySelector("[data-pin]")).toBeNull();
  });

  it("follows its node when the node moves", () => {
    const { collab, overlays, feed } = mount();
    act(() => collab.set({ pins: [pin()] }));
    const doc = everyKindDocument();
    const moved = { ...doc, nodes: { ...doc.nodes, box: { ...doc.nodes.box, x: 700 } } } as Document;
    act(() => feed.update({ doc: moved }));
    expect((overlays.querySelector("[data-pin='1'] div") as HTMLElement).style.left).toBe("700px");
  });

  it("shows the draft of the pin being written: its outline and the number it will have", () => {
    const { collab, overlays } = mount();
    act(() => collab.set({ pinDraft: { nodeId: null, region: { x: 5, y: 6, width: 70, height: 80 }, number: 4 } }));
    const draft = overlays.querySelector("[data-testid='pin-draft']") as HTMLElement;
    expect(draft).toHaveTextContent("4");
    expect((draft.firstElementChild as HTMLElement).style).toMatchObject({ left: "5px", width: "70px" });
  });
});

describe("the eyedropper", () => {
  it("reads the colour of the layer under the click instead of selecting it", () => {
    const { world, viewport, onSample, onSelect } = mount({ sampling: true });
    expect(viewport).toHaveAttribute("data-sampling");
    under = [node(world, "turned")];
    fireEvent.pointerDown(node(world, "turned"), { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    expect(onSample).toHaveBeenCalledWith("#c43d27");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("takes the first layer that paints a colour, text its colour, and says nothing found for the page", () => {
    const { world, viewport, onSample } = mount({ sampling: true });
    under = [node(world, "pair"), node(world, "title")];
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 1 });
    expect(onSample).toHaveBeenLastCalledWith(expect.any(String));
    under = [];
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 2 });
    expect(onSample).toHaveBeenLastCalledWith(null);
  });

  it("disarms when the owner says so", () => {
    const { viewport, feed } = mount({ sampling: true });
    act(() => feed.update({ sampling: false }));
    expect(viewport).not.toHaveAttribute("data-sampling");
  });
});

const clipboard = (init: { plain?: string; html?: string; files?: File[] }) => {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  const files = init.files ?? [];
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => (type === "text/plain" ? (init.plain ?? "") : type === "text/html" ? (init.html ?? "") : ""), files, items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })) },
  });
  return event;
};

describe("paste", () => {
  it("hands SVG text to the owner at the middle of the view, on the page, and takes the event", () => {
    const { onInput, world } = mount();
    const event = clipboard({ plain: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>' });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    const { x, y, zoom } = transform(world);
    expect(onInput).toHaveBeenCalledWith(expect.objectContaining({ kind: "paste", parentId: null, at: { x: Math.round((500 - x) / zoom), y: Math.round((400 - y) / zoom) } }));
  });

  it("goes into the selected frame, in its coordinates", () => {
    const { onInput, world } = mount({ selection: ["home"] });
    window.dispatchEvent(clipboard({ html: "<p>hi</p>" }));
    const home = node(world, "home").getBoundingClientRect();
    const zoom = transform(world).zoom;
    expect(onInput.mock.calls[0]?.[0]).toMatchObject({ parentId: "home", at: { x: Math.round((500 - home.left) / zoom), y: Math.round((400 - home.top) / zoom) } });
  });

  it("a component instance, or a node that is not a frame, is not a destination", () => {
    const a = mount({ selection: ["btn-copy"] });
    window.dispatchEvent(clipboard({ html: "<p>hi</p>" }));
    expect(a.onInput.mock.calls[0]?.[0].parentId).toBeNull();
    a.unmount();
    const b = mount({ selection: ["title"] });
    window.dispatchEvent(clipboard({ html: "<p>hi</p>" }));
    expect(b.onInput.mock.calls[0]?.[0].parentId).toBeNull();
  });

  it("carries a picture of the clipboard", () => {
    const { onInput } = mount();
    const file = new File(["x"], "shot.png", { type: "image/png" });
    window.dispatchEvent(clipboard({ files: [file] }));
    expect(onInput.mock.calls[0]?.[0].files).toEqual([file]);
  });

  it("leaves plain text, and a paste into a text field, alone", () => {
    const { onInput } = mount();
    const plain = clipboard({ plain: "just words" });
    window.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    const field = document.createElement("textarea");
    document.body.append(field);
    const inField = clipboard({ html: "<p>hi</p>" });
    field.dispatchEvent(inField);
    expect(inField.defaultPrevented).toBe(false);
    expect(onInput).not.toHaveBeenCalled();
    field.remove();
  });
});

describe("dropping files", () => {
  const dataTransfer = (files: File[]) => ({ types: ["Files"], files, dropEffect: "none" });
  /** jsdom has no `DragEvent`: a plain event with the fields the canvas reads. */
  const drop = (target: Element, files: File[], clientX: number, clientY: number) => {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperties(event, { dataTransfer: { value: dataTransfer(files) }, clientX: { value: clientX }, clientY: { value: clientY } });
    act(() => void target.dispatchEvent(event));
  };

  it("highlights the canvas while files are over it, and stops when they leave", () => {
    const { viewport } = mount();
    fireEvent.dragEnter(viewport, { dataTransfer: dataTransfer([]) });
    expect(viewport).toHaveAttribute("data-file-over");
    // `outline-none` sets the outline style to none and `outline-2` only the width: the style has to come back with the highlight, or nothing shows (checked in the browser)
    expect(viewport.className).toContain("data-[file-over]:outline-solid");
    expect(viewport.className).toContain("data-[file-over]:outline-select-brand");
    fireEvent.dragLeave(viewport, { dataTransfer: dataTransfer([]) });
    expect(viewport).not.toHaveAttribute("data-file-over");
  });

  it("ignores a drag that carries no files", () => {
    const { viewport } = mount();
    fireEvent.dragOver(viewport, { dataTransfer: { types: ["text/plain"] } });
    expect(viewport).not.toHaveAttribute("data-file-over");
  });

  it("hands the files to the owner with the frame under the drop and the point in its coordinates", () => {
    const { viewport, world, onInput } = mount();
    const files = [new File(["x"], "a.svg", { type: "image/svg+xml" })];
    under = [node(world, "plain")];
    drop(viewport, files, 300, 250);
    expect(viewport).not.toHaveAttribute("data-file-over");
    const home = node(world, "home").getBoundingClientRect();
    const zoom = transform(world).zoom;
    expect(onInput).toHaveBeenCalledWith({ kind: "drop", plain: "", html: "", files, parentId: "home", at: { x: Math.round((300 - home.left) / zoom), y: Math.round((250 - home.top) / zoom) } });
  });

  it("drops on the page when nothing under the pointer takes it (an instance does not)", () => {
    const { viewport, world, onInput } = mount();
    under = [node(world, "btn-copy")];
    drop(viewport, [new File(["x"], "a.png")], 10, 10);
    expect(onInput.mock.calls[0]?.[0].parentId).toBeNull();
  });
});

describe("agents on the canvas", () => {
  it("draws a box around each node an agent touches and its cursor with the name and the verb", () => {
    const { collab, overlays } = mount();
    act(() => collab.set({ agents: [agent({ nodes: ["title", "plain", "gone"] })] }));
    const boxes = overlays.querySelectorAll<HTMLElement>("[data-agent-box]");
    expect(boxes).toHaveLength(3);
    expect(boxes[2]?.style.display).toBe("none");
    expect(overlays.querySelector("[data-testid='agent-cursor']")).toHaveTextContent("claude · editing Title");
    expect(overlays.querySelector("[data-testid='agent-frame-state']")).toHaveTextContent("claude update_nodes");
  });

  it("draws at most 60 boxes for an agent that touches thousands of nodes", () => {
    const { collab, overlays } = mount();
    act(() => collab.set({ agents: [agent({ nodes: Array.from({ length: 5000 }, (_, i) => `n${i}`) })] }));
    expect(overlays.querySelectorAll("[data-agent-box]")).toHaveLength(60);
  });

  it("frames the root frame an active writer is in, and not a reader or an idle one", () => {
    const { collab, overlays } = mount();
    act(() => collab.set({ working: "working", agents: [agent()] }));
    const frame = overlays.querySelector<HTMLElement>("[data-testid='agent-working']") as HTMLElement;
    expect(frame.style).toMatchObject({ left: "100px", top: "80px", width: "400px", height: "300px" });
    expect(frame).toHaveTextContent("working");
    act(() => collab.set({ agents: [agent({ activity: "reading", tool: "get_nodes" })] }));
    expect(overlays.querySelector("[data-testid='agent-working']")).toBeNull();
    act(() => collab.set({ agents: [agent({ idle: true })] }));
    expect(overlays.querySelector("[data-testid='agent-working']")).toBeNull();
    expect(overlays.querySelector("[data-testid='agent-frame-state']")).toBeNull();
    expect(overlays.querySelector("[data-testid='agent-cursor']")).toHaveAttribute("data-idle");
  });

  it("an agent on another page draws nothing, and two on one spot stack their cursors", () => {
    const { collab, overlays } = mount();
    act(() => collab.set({ agents: [agent({ id: "x", nodes: ["nowhere"] })] }));
    expect((overlays.querySelector("[data-agent-box]") as HTMLElement).style.display).toBe("none");
    act(() => collab.set({ agents: [agent({ id: "a" }), agent({ id: "b", name: "codex", tone: "agent-2" })] }));
    const cursors = [...overlays.querySelectorAll<HTMLElement>("[data-testid='agent-cursor']")].map((el) => el.querySelector<HTMLElement>("div.absolute.top-0.left-0:last-child") as HTMLElement);
    expect(cursors[0]?.style.translate).not.toBe(cursors[1]?.style.translate);
  });

  it("a presence update renders no node and a document change moves the boxes", () => {
    const { collab, overlays, world, feed } = mount();
    act(() => collab.set({ agents: [agent()] }));
    const renders = () => (world as unknown as { __paprikaNodeRenders: number }).__paprikaNodeRenders;
    const before = renders();
    act(() => collab.set({ agents: [agent({ verb: "writing", tool: "create_nodes" }), agent({ id: "b", nodes: ["pic"] })] }));
    expect(renders()).toBe(before);
    const doc = everyKindDocument();
    const moved = { ...doc, nodes: { ...doc.nodes, box: { ...doc.nodes.box, x: 650 } } } as Document;
    act(() => collab.set({ agents: [agent({ nodes: ["box"] })] }));
    act(() => feed.update({ doc: moved }));
    expect((overlays.querySelector("[data-agent-box='box']") as HTMLElement).style.left).toBe("650px");
  });
});

describe("the build replay", () => {
  it("marks the node being built with its colour and unmarks it when the walk moves on", () => {
    const { collab, world } = mount();
    act(() => collab.set({ build: [{ id: "title", tone: "agent-2" }] }));
    expect(node(world, "title")).toHaveAttribute("data-build", "current");
    expect(node(world, "title").style.getPropertyValue("--build")).toBe("var(--color-agent-2)");
    act(() => collab.set({ build: [{ id: "plain", tone: "agent-2" }] }));
    expect(node(world, "title")).not.toHaveAttribute("data-build");
    expect(node(world, "plain")).toHaveAttribute("data-build", "current");
    act(() => collab.set({ build: [] }));
    expect(node(world, "plain")).not.toHaveAttribute("data-build");
  });

  it("draws the outline in the layer of the overlays, in the colour of the agent's token, over the node and holding its width at any zoom", () => {
    const { collab, overlays, world } = mount();
    act(() => collab.set({ build: [{ id: "box", tone: "agent-2" }] }));
    const outline = overlays.querySelector<HTMLElement>("[data-build-outline='box']") as HTMLElement;
    expect(outline).not.toBeNull();
    expect(outline.style.display).toBe("block");
    expect(outline.style.left).toBe("600px");
    expect(outline.style.boxShadow).toContain("var(--color-agent-2)");
    expect(outline.style.boxShadow).toContain("calc(1.5px / var(--view-zoom, 1))");
    // not on the node: the world is a light scheme and would give a dark app the light colour
    expect(node(world, "box").style.outline).toBe("");
    expect(world.className).not.toContain("data-build");
    act(() => collab.set({ build: [] }));
    expect(overlays.querySelector("[data-build-outline]")).toBeNull();
  });
});

describe("taking the camera somewhere", () => {
  it("centres a box in world units, at no more zoom than it fits", () => {
    const { world, feed } = mount();
    act(() => feed.update({ focusRequest: { seq: 1, box: { x: 1000, y: 1000, width: 200, height: 100 } } }));
    frames();
    const v = transform(world);
    expect(v.x + 1100 * v.zoom).toBeCloseTo(500, 3);
    expect(v.y + 1050 * v.zoom).toBeCloseTo(400, 3);
  });

  it("centres nodes once painted, and a request again with the same target moves the camera again", () => {
    const { world, feed } = mount();
    act(() => feed.update({ focusRequest: { seq: 1, nodes: ["box"] } }));
    frames(2);
    const first = transform(world);
    const home = node(world, "box");
    expect(home).toBeTruthy();
    expect(first.x + (600 + 40) * first.zoom).toBeGreaterThan(400);
    fireEvent.wheel(world.parentElement as HTMLElement, { deltaX: 200, deltaY: 0 });
    frames(2);
    expect(transform(world).x).not.toBe(first.x);
    act(() => feed.update({ focusRequest: { seq: 2, nodes: ["box"] } }));
    frames(2);
    expect(transform(world).x).toBeCloseTo(first.x, 3);
  });

  it("waits for nodes that are not there yet (another page) and gives up after a while", () => {
    const { world, feed } = mount();
    act(() => feed.update({ focusRequest: { seq: 1, nodes: ["nowhere"] } }));
    const before = transform(world);
    frames(60);
    expect(transform(world)).toEqual(before);
  });
});

describe("capture mode", () => {
  it("puts a node at the origin at zoom 1 and tells the server its box", () => {
    const { viewport, world, overlays } = mount({}, { capture: "home" });
    expect(viewport).toHaveAttribute("data-capture-box", "100,80,400,300");
    expect(transform(world)).toMatchObject({ x: -100, y: -80, zoom: 1 });
    expect(viewport).toHaveAttribute("data-capture");
    expect(overlays.className).toContain("hidden");
  });

  it("a page is its bounds, and a node that is not in the document gives no box", () => {
    const a = mount({}, { capture: "page" });
    expect(a.viewport.getAttribute("data-capture-box")).toMatch(/^[-\d.]+,[-\d.]+,[\d.]+,[\d.]+$/);
    a.unmount();
    const b = mount({}, { capture: "missing" });
    expect(b.viewport).not.toHaveAttribute("data-capture-box");
  });

  it("does not fit the page itself and keeps the camera when the viewport resizes", () => {
    const { world, feed } = mount({}, { capture: "home" });
    act(() => feed.update({ fitRequest: 0, hoveredId: "title" }));
    frames(2);
    expect(transform(world)).toMatchObject({ x: -100, y: -80, zoom: 1 });
  });

  it("a resize of the viewport (it turns fixed and fills the window) does not fit the camera over the capture", () => {
    const observers: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          observers.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    try {
      const { world, feed } = mount({}, { capture: "home" });
      act(() => feed.update({ fitRequest: 1, zoom: 2 }));
      for (const callback of observers) act(() => callback());
      frames(2);
      expect(transform(world)).toMatchObject({ x: -100, y: -80, zoom: 1 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
