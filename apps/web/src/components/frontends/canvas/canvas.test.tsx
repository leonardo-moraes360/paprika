import { applyOps, canvasBounds, createDocument, type Document, type Op } from "@paprika/core";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { everyKindDocument, stubLayout, testDefaults } from "@/test/canvas-fixtures";
import { Canvas, createCanvasFeed } from "./index";
import type { CanvasFeed } from "./types";

let restore: () => void;
beforeEach(() => {
  restore = stubLayout();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
});
afterEach(() => {
  restore();
  vi.useRealTimers();
});

const frames = (n = 1) => act(() => void vi.advanceTimersByTime(17 * n));
const settle = () => act(() => void vi.advanceTimersByTime(200));

function mount(doc: Document = everyKindDocument(), extra: Partial<Parameters<typeof createCanvasFeed>[0]> = {}) {
  const feed = createCanvasFeed({ doc, pageId: "page", ...extra });
  const onSelect = vi.fn((ids: readonly string[]) => feed.update({ selection: ids }));
  const onHover = vi.fn((id: string | null) => feed.update({ hoveredId: id }));
  const onZoomChange = vi.fn();
  const view = render(<Canvas feed={feed} defaults={testDefaults} onSelect={onSelect} onHover={onHover} onZoomChange={onZoomChange} />);
  const viewport = view.getByTestId("viewport");
  const world = view.getByTestId("canvas-world");
  const overlays = view.getByTestId("canvas-overlays");
  return { ...view, feed, onSelect, onHover, onZoomChange, viewport, world, overlays };
}

const node = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-paprika-id="${id}"]`);
const nodeRenders = (world: HTMLElement) => (world as unknown as { __paprikaNodeRenders: number }).__paprikaNodeRenders;
const transform = (el: HTMLElement) => {
  const m = /translate\(([-\d.e]+)px(?:,\s*([-\d.e]+)px)?\)\s*scale\(([-\d.e]+)\)/.exec(el.style.transform);
  return m ? { x: Number(m[1]), y: Number(m[2] ?? 0), zoom: Number(m[3]) } : null;
};

describe("rendering of every kind of node", () => {
  it("the world does not inherit the chrome's line height: design text without one renders as in a plain page", () => {
    const { world } = mount();
    expect(world.className).toContain("[line-height:normal]");
  });

  it("paints each node of the page with its id and type, the way the old canvas did", () => {
    const { world } = mount();
    const expected: Record<string, string> = { home: "frame", turned: "rect", title: "text", pic: "image", squiggle: "path", pair: "group", dot: "ellipse", box: "shape", arrow: "connector", "btn-copy": "frame" };
    for (const [id, type] of Object.entries(expected)) expect(node(world, id), id).toHaveAttribute("data-paprika-type", type);
  });

  it("nests children inside their parent, in document order", () => {
    const { world } = mount();
    const home = node(world, "home") as HTMLElement;
    expect([...home.children].map((c) => c.getAttribute("data-paprika-id"))).toEqual(["turned", "ghost", "title", "plain", "pic", "squiggle", "pair"]);
    expect(node(home, "dot")?.parentElement).toBe(node(home, "pair"));
  });

  it("takes the style of every node from nodeStyle: auto layout, clip, rotation, hidden", () => {
    const { world } = mount();
    const home = node(world, "home") as HTMLElement;
    expect(home.style).toMatchObject({ display: "flex", flexDirection: "column", overflow: "hidden", position: "absolute" });
    expect(home.style.left).toBe("100px");
    expect(node(world, "turned")?.style.transform).toBe("rotate(15deg)");
    expect(node(world, "ghost")?.style.display).toBe("none");
    // a child of an auto-layout frame flows (relative), it is not placed by x and y
    expect(node(world, "turned")?.style.position).toBe("relative");
  });

  it("draws text with its runs as spans and a link", () => {
    const { world } = mount();
    const title = node(world, "title") as HTMLElement;
    expect(title.textContent).toBe("Hello brave world");
    const spans = [...title.children];
    expect(spans.map((s) => s.tagName)).toEqual(["SPAN", "SPAN", "SPAN", "A", "SPAN"].slice(0, spans.length));
    expect(title.querySelector("a")).toHaveAttribute("href", "https://example.com");
    // A link with no colour of its own takes the colour of the text around it and is underlined the same way in the canvas, the editor and the export.
    const link = title.querySelector("a") as HTMLElement;
    expect(link.style.color).toBe("inherit");
    expect(link.style.textDecorationLine).toBe("underline");
    expect(link.style.textDecorationThickness).toBe("max(1px, 0.06em)");
    expect(link.style.textUnderlineOffset).toBe("0.15em");
    expect(title.querySelector("span[style*='font-weight']")?.textContent).toBe("brave");
    expect(node(world, "plain")?.textContent).toBe("Just text");
    expect(node(world, "plain")?.children).toHaveLength(0);
  });

  it("draws an image, a path, a shape with its text and a connector with its label", () => {
    const { world } = mount();
    const img = node(world, "pic") as HTMLImageElement;
    expect(img.tagName).toBe("IMG");
    expect(img).toHaveAttribute("src", "https://example.com/a.png");
    expect(img).toHaveAttribute("alt", "A picture");
    const path = node(world, "squiggle") as HTMLElement;
    expect(path.tagName.toLowerCase()).toBe("svg");
    expect(path.querySelector("path")?.getAttribute("d")).toBe("M0 0 L50 50");
    const shape = node(world, "box") as HTMLElement;
    expect(shape.querySelector("svg path")).not.toBeNull();
    expect(shape.textContent).toBe("Decision");
    const arrow = node(world, "arrow") as HTMLElement;
    expect(arrow.tagName.toLowerCase()).toBe("svg");
    expect(arrow.querySelectorAll("path")).toHaveLength(2);
    expect(arrow.querySelector("[data-connector-hit]")).not.toBeNull();
    expect(arrow.querySelector("text[data-connector-label]")?.textContent).toBe("yes");
  });

  it("draws an instance of a component like any frame, with the copies the server made", () => {
    const { world } = mount();
    expect(node(world, "btn-copy")).not.toBeNull();
    expect(node(world, "btn-copy")?.style.left).toBe("300px");
  });

  it("paints only the page in view", () => {
    const doc = everyKindDocument();
    const { world, feed } = mount(doc);
    expect(node(world, "home")).not.toBeNull();
    act(() => feed.update({ pageId: null }));
    expect(node(world, "home")).not.toBeNull();
  });

  it("keeps the document's own colours whatever the app theme: the world is a light scheme", () => {
    const { world } = mount();
    expect(world.className).toContain("scheme-light");
    expect(node(world, "turned")?.style.background).toMatch(/rgb\(196, 61, 39\)|#c43d27/i);
  });
});

describe("the camera", () => {
  it("fits the page when the canvas opens: centred, no more than 100 %", () => {
    const { world } = mount();
    const v = transform(world) as { x: number; y: number; zoom: number };
    const b = canvasBounds(everyKindDocument(), "page");
    expect(b.width).toBeLessThan(1000 - 120);
    expect(v.zoom).toBeCloseTo(1, 5);
    expect(v.x).toBeCloseTo((1000 - b.width) / 2 - b.x, 3);
    expect(v.y).toBeCloseTo((800 - b.height) / 2 - b.y, 3);
  });

  it("opens a page with nothing on it at 100 %, in a room too narrow for the stand-in box to fit (870 px wide, as with the editor's panels)", () => {
    restore();
    restore = stubLayout({ width: 870, height: 640 });
    const empty = applyOps(createDocument("Empty", "doc-2"), [{ op: "add_page", id: "p", name: "Page" } as unknown as Op]).doc;
    const { world, viewport, feed } = mount(empty, { pageId: "p" });
    expect(viewport).toBeTruthy();
    expect(transform(world)).toEqual({ x: (870 - 800) / 2, y: (640 - 600) / 2, zoom: 1 });
    // a page with a frame still fits it
    act(() => feed.update({ doc: everyKindDocument(), pageId: "page", fitRequest: 1 }));
    frames();
    expect(transform(world)?.zoom).toBeLessThanOrEqual(1);
  });

  it("writes the transform on the world element and the camera on the overlay layer, with no React render", () => {
    const { world, overlays, viewport } = mount();
    const before = [...world.querySelectorAll("[data-paprika-id]")];
    const renders = nodeRenders(world);
    fireEvent.wheel(viewport, { deltaX: 30, deltaY: 50 });
    frames();
    const v = transform(world) as { x: number; y: number };
    expect(overlays.style.getPropertyValue("--view-x")).toBe(`${v.x}px`);
    expect(overlays.style.getPropertyValue("--view-zoom")).toBe("1");
    expect([...world.querySelectorAll("[data-paprika-id]")]).toEqual(before);
    expect(nodeRenders(world)).toBe(renders);
  });

  it("pans with the wheel, and with Shift the vertical wheel moves the other axis", () => {
    const { world, viewport } = mount();
    const start = transform(world) as { x: number; y: number };
    fireEvent.wheel(viewport, { deltaX: 10, deltaY: 40 });
    frames();
    expect(transform(world)).toMatchObject({ x: start.x - 10, y: start.y - 40 });
    fireEvent.wheel(viewport, { deltaX: 0, deltaY: 25, shiftKey: true });
    frames();
    expect(transform(world)).toMatchObject({ x: start.x - 35, y: start.y - 40 });
  });

  it("zooms with Ctrl or Cmd and the wheel, at the cursor, between 10 % and 800 %", () => {
    const { world, viewport } = mount();
    const start = transform(world) as { x: number; y: number; zoom: number };
    fireEvent.wheel(viewport, { deltaY: -200, ctrlKey: true, clientX: 300, clientY: 200 });
    frames();
    const after = transform(world) as { x: number; y: number; zoom: number };
    expect(after.zoom).toBeCloseTo(Math.exp(0.3), 5);
    // the world point under the cursor stays under it
    expect((300 - start.x) / start.zoom).toBeCloseTo((300 - after.x) / after.zoom, 2);
    expect((200 - start.y) / start.zoom).toBeCloseTo((200 - after.y) / after.zoom, 2);
    fireEvent.wheel(viewport, { deltaY: -100000, metaKey: true, clientX: 0, clientY: 0 });
    frames();
    expect(transform(world)?.zoom).toBe(8);
    fireEvent.wheel(viewport, { deltaY: 100000, ctrlKey: true, clientX: 0, clientY: 0 });
    frames();
    expect(transform(world)?.zoom).toBeCloseTo(0.1, 8);
  });

  it("pans with the middle button and with Space and the primary button", () => {
    const { world, viewport } = mount();
    const start = transform(world) as { x: number; y: number };
    fireEvent.pointerDown(viewport, { button: 1, clientX: 100, clientY: 100, pointerId: 1 });
    expect(viewport.dataset.pan).toBe("panning");
    fireEvent.pointerMove(window, { clientX: 160, clientY: 130, pointerId: 1 });
    frames();
    expect(transform(world)).toMatchObject({ x: start.x + 60, y: start.y + 30 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(viewport.dataset.pan).toBeUndefined();

    const now = transform(world) as { x: number; y: number };
    fireEvent.keyDown(window, { code: "Space" });
    expect(viewport.dataset.pan).toBe("ready");
    fireEvent.pointerDown(viewport, { button: 0, clientX: 10, clientY: 10, pointerId: 2 });
    fireEvent.pointerMove(window, { clientX: 5, clientY: 0, pointerId: 2 });
    frames();
    expect(transform(world)).toMatchObject({ x: now.x - 5, y: now.y - 10 });
    fireEvent.pointerUp(window, { pointerId: 2 });
    expect(viewport.dataset.pan).toBe("ready");
    fireEvent.keyUp(window, { code: "Space" });
    expect(viewport.dataset.pan).toBeUndefined();
  });

  it("Space pans with the focus on the viewport itself, even when it matches :focus-visible after a click", () => {
    const { viewport } = mount();
    const matches = viewport.matches.bind(viewport) as (selector: string) => boolean;
    vi.spyOn(viewport, "matches").mockImplementation(((selector: string) => selector === ":focus-visible" || matches(selector)) as never);
    fireEvent.keyDown(viewport, { code: "Space" });
    expect(viewport.dataset.pan).toBe("ready");
    fireEvent.keyUp(viewport, { code: "Space" });
  });

  it("Space typed into a text field does not pan", () => {
    const { viewport } = mount();
    const input = document.body.appendChild(document.createElement("input"));
    fireEvent.keyDown(input, { code: "Space" });
    expect(viewport.dataset.pan).toBeUndefined();
    input.remove();
  });

  it("reports the zoom to the owner only once the camera rests (140 ms), and not for a pan", () => {
    const { viewport, onZoomChange } = mount();
    settle();
    onZoomChange.mockClear();
    fireEvent.wheel(viewport, { deltaX: 40, deltaY: 40 });
    frames();
    settle();
    expect(onZoomChange).not.toHaveBeenCalled();
    fireEvent.wheel(viewport, { deltaY: -100, ctrlKey: true, clientX: 10, clientY: 10 });
    frames();
    act(() => void vi.advanceTimersByTime(100));
    expect(onZoomChange).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(60));
    expect(onZoomChange).toHaveBeenCalledTimes(1);
    expect(onZoomChange.mock.calls[0]![0]).toBeCloseTo(Math.exp(0.15), 5);
  });

  it("follows the zoom commands of the owner (the zoom bar) around the centre of the viewport", () => {
    const { world, feed } = mount();
    const start = transform(world) as { x: number; y: number; zoom: number };
    act(() => feed.update({ zoom: start.zoom * 1.25 }));
    frames();
    const after = transform(world) as { x: number; y: number; zoom: number };
    expect(after.zoom).toBeCloseTo(start.zoom * 1.25, 8);
    expect((500 - start.x) / start.zoom).toBeCloseTo((500 - after.x) / after.zoom, 5);
    expect((400 - start.y) / start.zoom).toBeCloseTo((400 - after.y) / after.zoom, 5);
    act(() => feed.update({ zoom: 20 }));
    frames();
    expect(transform(world)?.zoom).toBe(8);
  });

  it("fits again on a fit request, and when the document or the page changes", () => {
    const { world, viewport, feed } = mount();
    fireEvent.wheel(viewport, { deltaX: 300, deltaY: 300 });
    frames();
    act(() => feed.update({ fitRequest: 1 }));
    expect(transform(world)).toMatchObject({ zoom: 1 });
    const b = canvasBounds(everyKindDocument(), "page");
    expect((transform(world) as { x: number }).x).toBeCloseTo((1000 - b.width) / 2 - b.x, 3);
  });

  it("does not reset a zoom the person made when something unrelated changes", () => {
    const { world, viewport, feed } = mount();
    fireEvent.wheel(viewport, { deltaY: -300, ctrlKey: true, clientX: 0, clientY: 0 });
    frames();
    const zoomed = transform(world);
    act(() => feed.update({ hoveredId: "title" }));
    act(() => feed.update({ tool: "rect" }));
    frames();
    expect(transform(world)).toEqual(zoomed);
  });
});

describe("the background", () => {
  it("is the canvas token with a 20 px grid in the grid token that follows the camera", () => {
    const { viewport, world } = mount();
    expect(viewport.className).toContain("bg-canvas");
    expect(viewport.style.backgroundImage).toContain("var(--color-grid)");
    expect(viewport.style.backgroundSize).toBe("20px 20px");
    const start = transform(world) as { x: number; y: number };
    fireEvent.wheel(viewport, { deltaX: 7, deltaY: 3 });
    frames();
    expect(viewport.style.backgroundPosition).toBe(`${(start.x - 7) % 20}px ${(start.y - 3) % 20}px`);
    fireEvent.wheel(viewport, { deltaY: -140, ctrlKey: true, clientX: 0, clientY: 0 });
    frames();
    expect(viewport.style.backgroundSize).not.toBe("20px 20px");
  });
});

describe("selection and hover", () => {
  it("a click on a node selects it and a click on nothing clears the selection", () => {
    const { world, viewport, onSelect } = mount();
    fireEvent.pointerDown(node(world, "title") as HTMLElement, { button: 0, pointerId: 1 });
    expect(onSelect).toHaveBeenLastCalledWith(["title"]);
    expect(node(world, "title")).toHaveAttribute("data-selected");
    fireEvent.pointerUp(window, { pointerId: 1 });
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 2 });
    expect(onSelect).toHaveBeenLastCalledWith([]);
    expect(node(world, "title")).not.toHaveAttribute("data-selected");
  });

  it("only acts with the select tool", () => {
    const { world, onSelect } = mount(everyKindDocument(), { tool: "rect" });
    fireEvent.pointerDown(node(world, "title") as HTMLElement, { button: 0, pointerId: 1 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("marks the node under the pointer and the one the owner says is hovered", () => {
    const { world, viewport, onHover, feed } = mount();
    fireEvent.pointerMove(node(world, "plain") as HTMLElement);
    expect(onHover).toHaveBeenLastCalledWith("plain");
    expect(node(world, "plain")).toHaveAttribute("data-hovered");
    fireEvent.pointerLeave(viewport);
    expect(onHover).toHaveBeenLastCalledWith(null);
    expect(node(world, "plain")).not.toHaveAttribute("data-hovered");
    act(() => feed.update({ hoveredId: "pic" }));
    expect(node(world, "pic")).toHaveAttribute("data-hovered");
  });

  it("draws the outline of the selection over the node, in world units, and one box per selected node", () => {
    const { overlays, feed } = mount();
    act(() => feed.update({ selection: ["home"] }));
    const box = overlays.querySelector<HTMLElement>("[data-selection-box='home']") as HTMLElement;
    expect(box.style).toMatchObject({ display: "block", left: "100px", top: "80px", width: "400px", height: "300px" });
    expect(box.style.boxShadow).toBe("inset 0 0 0 calc(1.5px / var(--view-zoom, 1)) var(--color-select-brand)");
    expect(overlays.querySelector("[data-selection-group]")).toHaveStyle({ display: "none" });
    act(() => feed.update({ selection: ["home", "box"] }));
    expect(overlays.querySelector("[data-selection-group]")).toHaveStyle({ display: "block", left: "100px", width: "660px" });
    act(() => feed.update({ selection: [] }));
    expect(overlays.querySelector("[data-testid='selection']")).toBeNull();
  });

  it("a turned node gets a turned outline", () => {
    const { overlays, feed } = mount();
    act(() => feed.update({ selection: ["home"] }));
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 60 });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 30 });
    act(() => feed.update({ selection: ["turned"] }));
    const box = overlays.querySelector<HTMLElement>("[data-selection-box='turned']") as HTMLElement;
    expect(box.style.transform).toBe("rotate(15deg)");
    expect(box.style.width).toBe("60px");
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
  });

  it("outlines the hovered node unless it is selected", () => {
    const { overlays, feed } = mount();
    act(() => feed.update({ hoveredId: "box" }));
    expect(overlays.querySelector("[data-hover-outline='box']")).not.toBeNull();
    act(() => feed.update({ selection: ["box"] }));
    expect(overlays.querySelector("[data-hover-outline]")).toBeNull();
  });
});

describe("frame labels", () => {
  it("names each root frame above its corner, at a constant size whatever the zoom", () => {
    const { overlays } = mount();
    const label = overlays.querySelector<HTMLElement>("[data-frame-label='home']") as HTMLElement;
    expect(label.textContent).toBe("Home");
    expect(label.style.left).toBe("100px");
    expect(label.style.top).toBe("80px");
    expect(label.style.transform).toContain("calc(1 / var(--view-zoom))");
    expect(overlays.querySelector("[data-frame-label='box']")).toBeNull();
  });

  it("selects the frame when its label is pressed, and toggles it with Shift", () => {
    const { overlays, onSelect } = mount();
    const label = overlays.querySelector("[data-frame-label='home']") as HTMLElement;
    fireEvent.pointerDown(label, { button: 0 });
    expect(onSelect).toHaveBeenLastCalledWith(["home"]);
    fireEvent.pointerDown(label, { button: 0, shiftKey: true });
    expect(onSelect).toHaveBeenLastCalledWith([]);
  });

  it("follows a rename and a move of the frame, and only that label renders", () => {
    const doc = everyKindDocument();
    const { overlays, feed } = mount(doc);
    const home = doc.nodes.home!;
    act(() => feed.update({ doc: { ...doc, nodes: { ...doc.nodes, home: { ...home, name: "Landing", x: 150 } as never } } }));
    const label = overlays.querySelector<HTMLElement>("[data-frame-label='home']") as HTMLElement;
    expect(label.textContent).toBe("Landing");
    expect(label.style.left).toBe("150px");
  });
});

describe("a document change renders only the nodes that changed", () => {
  const withNode = (doc: Document, id: string, props: Record<string, unknown>): Document => ({ ...doc, nodes: { ...doc.nodes, [id]: { ...doc.nodes[id]!, ...props } as never } });

  it("a change in one node does not re-render a node that did not change (same DOM element, same style)", () => {
    const doc = everyKindDocument();
    const { world, feed } = mount(doc);
    const home = node(world, "home") as HTMLElement;
    const plain = node(world, "plain") as HTMLElement;
    const before = plain.outerHTML;
    act(() => feed.update({ doc: withNode(doc, "title", { text: "Changed" }) }));
    expect(node(world, "home")).toBe(home);
    expect(node(world, "plain")).toBe(plain);
    expect(plain.outerHTML).toBe(before);
    expect(node(world, "title")?.textContent).toBe("Changed");
  });

  it("a replaced object with the same content changes nothing at all", () => {
    const doc = everyKindDocument();
    const { feed, world } = mount(doc);
    const html = world.innerHTML;
    act(() => feed.update({ doc: { ...doc, nodes: Object.fromEntries(Object.entries(doc.nodes).map(([id, n]) => [id, JSON.parse(JSON.stringify(n))])) } }));
    expect(world.innerHTML).toBe(html);
  });

  it("a node added or removed shows up", () => {
    const doc = everyKindDocument();
    const { feed, world } = mount(doc);
    const { dot: _dot, ...rest } = doc.nodes;
    const pair = doc.nodes.pair as unknown as { children: string[] };
    act(() => feed.update({ doc: { ...doc, nodes: { ...rest, pair: { ...pair, children: [] } as never } } }));
    expect(node(world, "dot")).toBeNull();
    expect(node(world, "pair")).not.toBeNull();
  });

  it("a token change paints every node that uses it again", () => {
    const doc = withNode(everyKindDocument(), "turned", { fill: "$brand" });
    const first = { ...doc, tokens: { ...doc.tokens, brand: "#112233" } };
    const { feed, world } = mount(first);
    expect(node(world, "turned")?.style.background).toMatch(/rgb\(17, 34, 51\)|#112233/i);
    act(() => feed.update({ doc: { ...first, tokens: { ...first.tokens, brand: "#445566" } } }));
    expect(node(world, "turned")?.style.background).toMatch(/rgb\(68, 85, 102\)|#445566/i);
  });

  it("counts the renders: one node for one change, all of them for a token", () => {
    const doc = everyKindDocument();
    const { feed, world } = mount(doc);
    let before = nodeRenders(world);
    const next = withNode(doc, "plain", { text: "x" });
    act(() => feed.update({ doc: next }));
    expect(nodeRenders(world) - before).toBe(1);
    before = nodeRenders(world);
    act(() => feed.update({ doc: withNode(next, "pair", { opacity: 0.5 }) }));
    expect(nodeRenders(world) - before).toBe(1);
    before = nodeRenders(world);
    act(() => feed.update({ selection: ["title"] }));
    expect(nodeRenders(world) - before).toBe(1);
    act(() => feed.update({ selection: ["plain"] }));
    expect(nodeRenders(world) - before).toBe(3);
  });
});
