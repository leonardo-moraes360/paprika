import { applyOps, createDocument, type Document, type Op } from "@paprika/core";
import { act, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubLayout, testDefaults } from "@/test/canvas-fixtures";
import { gestures } from "./gestures";
import { Canvas, createCanvasFeed } from "./index";

const paint = { stroke: "ink-colour", fill: "paper-colour" };

/** A page with a path, a gradient rect, a row frame with three children, three boxes and a curve between two of them. */
function vectorDocument(extra: Op[] = []): Document {
  const ops: Op[] = [
    { op: "add_page", id: "page", name: "Page" } as unknown as Op,
    { op: "create", parentId: "page", node: { type: "path", id: "vec", name: "Vetor 1", x: 100, y: 100, width: 200, height: 120, d: "M0 100 C40 0 160 0 200 100 L100 120 Z", fill: "paper", stroke: { color: "ink", width: 2 } } },
    { op: "create", parentId: "page", node: { type: "rect", id: "grad", name: "Gradient", x: 400, y: 100, width: 240, height: 140, fill: "paper", gradient: { type: "linear", angle: 90, cx: 0.5, cy: 0.5, radius: 0.5, stops: [{ color: "red", offset: 0 }, { color: "blue", offset: 1 }] } } },
    { op: "create", parentId: "page", node: { type: "ellipse", id: "turned", name: "Turned", x: 700, y: 100, width: 100, height: 100, rotation: 30, fill: "paper", gradient: { type: "radial", angle: 0, cx: 0.5, cy: 0.5, radius: 0.5, stops: [{ color: "red", offset: 0 }, { color: "blue", offset: 1 }] } } },
    { op: "create", parentId: "page", node: { type: "frame", id: "flow", name: "Flow", x: 100, y: 400, width: 360, height: 160, layout: { mode: "row", gap: 16, padding: 20, align: "start", justify: "start" } } },
    { op: "create", parentId: "flow", node: { type: "rect", id: "k1", name: "K1", width: 80, height: 60 } },
    { op: "create", parentId: "flow", node: { type: "rect", id: "k2", name: "K2", width: 80, height: 60 } },
    { op: "create", parentId: "flow", node: { type: "rect", id: "k3", name: "K3", width: 80, height: 60 } },
    { op: "create", parentId: "page", node: { type: "frame", id: "free", name: "Free", x: 900, y: 400, width: 300, height: 300 } },
    { op: "create", parentId: "page", node: { type: "shape", id: "sa", name: "A", x: 600, y: 400, width: 140, height: 70, text: "A", shape: "rect" } },
    { op: "create", parentId: "page", node: { type: "shape", id: "sb", name: "B", x: 600, y: 650, width: 140, height: 70, text: "B", shape: "rect" } },
    { op: "create", parentId: "page", node: { type: "connector", id: "arrow", from: { nodeId: "sa" }, to: { nodeId: "sb" }, route: "elbow" } },
    { op: "create", parentId: "page", node: { type: "connector", id: "curve", from: { nodeId: "sa" }, to: { nodeId: "sb" }, route: "curve" } },
    ...extra,
  ];
  return applyOps(createDocument("Vectors", "doc-v"), ops).doc;
}

let restore: () => void;
const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
beforeEach(() => {
  restore = stubLayout();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
  // jsdom has no SVG layout: the edit layer maps a pointer to the path with the element's matrix, which is the identity here.
  (SVGElement.prototype as unknown as { getScreenCTM: () => typeof identity }).getScreenCTM = () => identity;
  // nor offsets: a node's position in its parent comes from its inline style (the auto-layout stub below lays the row out)
  for (const key of ["offsetLeft", "offsetTop", "offsetWidth", "offsetHeight"] as const) {
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get(this: HTMLElement) {
        const id = this.dataset.paprikaId;
        const siblings = this.parentElement ? [...this.parentElement.children].filter((c) => (c as HTMLElement).dataset.paprikaId) : [];
        const w = Number.parseFloat(this.style.width) || 0;
        const h = Number.parseFloat(this.style.height) || 0;
        if (key === "offsetWidth") return w;
        if (key === "offsetHeight") return h;
        if (!id || this.parentElement?.dataset.paprikaId !== "flow") return 0;
        // the row: padding 20, gap 16, children 80 wide
        const index = siblings.indexOf(this);
        return key === "offsetLeft" ? 20 + index * (80 + 16) : 20;
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

function mount(options: { tool?: Parameters<typeof createCanvasFeed>[0] extends infer P ? (P extends { tool?: infer T } ? T : never) : never; selection?: string[]; apply?: (ops: Op[], label: string) => Promise<boolean>; doc?: Document; flat?: boolean } = {}) {
  const feed = createCanvasFeed({ doc: options.doc ?? vectorDocument(), pageId: options.flat ? null : "page", tool: options.tool ?? "select" });
  const onSelect = vi.fn((ids: readonly string[]) => feed.update({ selection: ids }));
  const onApply = vi.fn<(ops: Op[], label: string) => Promise<boolean>>(options.apply ?? (async () => true));
  const onToolDone = vi.fn(() => feed.update({ tool: "select" }));
  const onError = vi.fn();
  const view = render(<Canvas feed={feed} onSelect={onSelect} onApply={onApply} onToolDone={onToolDone} onError={onError} defaults={{ ...testDefaults, vector: paint }} />);
  frames(2);
  // The selection comes after the canvas is up, as a click does (the overlays measure the nodes that are there by then).
  if (options.selection?.length) act(() => feed.update({ selection: options.selection }));
  const scoped = within(view.container);
  const viewport = scoped.getByTestId("viewport");
  const world = scoped.getByTestId("canvas-world");
  const m = /translate\(([-\d.e]+)px(?:,\s*([-\d.e]+)px)?\)\s*scale\(([-\d.e]+)\)/.exec(world.style.transform) ?? [];
  const cam = { x: Number(m[1] ?? 0), y: Number(m[2] ?? 0), zoom: Number(m[3] ?? 1) };
  /** Client point of a world point. */
  const at = (x: number, y: number) => ({ clientX: cam.x + x * cam.zoom, clientY: cam.y + y * cam.zoom });
  return { ...view, feed, onSelect, onApply, onToolDone, onError, viewport, world, cam, at };
}
type Mounted = ReturnType<typeof mount>;

let pointer = 0;
const press = (target: Element, point: { clientX: number; clientY: number }, init: PointerEventInit = {}) => {
  pointer += 1;
  fireEvent.pointerDown(target, { button: 0, pointerId: pointer, ...point, ...init });
  return pointer;
};
const move = (id: number, point: { clientX: number; clientY: number }, init: PointerEventInit = {}) => fireEvent.pointerMove(window, { pointerId: id, ...point, ...init });
const release = (id: number, point: { clientX: number; clientY: number }, init: PointerEventInit = {}) => fireEvent.pointerUp(window, { pointerId: id, ...point, ...init });
const click = (target: Element, point: { clientX: number; clientY: number }) => release(press(target, point), point);
const drag = (target: Element, from: { clientX: number; clientY: number }, to: { clientX: number; clientY: number }, init: PointerEventInit = {}) => {
  const id = press(target, from, init);
  move(id, { clientX: (from.clientX + to.clientX) / 2, clientY: (from.clientY + to.clientY) / 2 }, init);
  move(id, to, init);
  release(id, to, init);
  return id;
};

const created = (m: Mounted) => m.onApply.mock.calls.map(([ops, label]) => ({ ops, label }));
const node = (m: Mounted, id: string) => m.world.querySelector<HTMLElement>(`[data-paprika-id="${id}"]`) as HTMLElement;

describe("the pen", () => {
  it("a click adds an anchor, a drag out of it pulls mirrored handles, and a press on the first anchor of three closes the path", async () => {
    const m = mount({ tool: "pen" });
    const target = m.viewport;
    click(target, m.at(1000, 1000));
    click(target, m.at(1100, 1000));
    drag(target, m.at(1100, 1100), m.at(1160, 1140));
    expect(m.container.querySelectorAll("[data-pen-anchor]")).toHaveLength(3);
    click(target, m.at(1002, 1001));
    await flush();
    expect(m.onApply).toHaveBeenCalledTimes(1);
    const { ops, label } = created(m)[0]!;
    expect(label).toBe("draw vector");
    const op = ops[0] as { op: string; parentId: string; node: Record<string, unknown> };
    expect(op).toMatchObject({ op: "create", parentId: "page" });
    expect(op.node).toMatchObject({ type: "path", name: "Vector 2", x: 1000, y: 1000, stroke: { color: "ink-colour", width: 2 }, fill: "paper-colour" });
    expect(String(op.node.d)).toMatch(/^M0 0 L100 0 C100 0 .* Z$/);
    expect(m.container.querySelector('[data-testid="pen-overlay"]')).toBeNull();
  });

  it("a drag shorter than 3 screen px is a click; a longer one makes the handles (out toward the pointer, in mirrored)", async () => {
    const m = mount({ tool: "pen" });
    click(m.viewport, m.at(1000, 1000));
    drag(m.viewport, m.at(1100, 1000), m.at(1102, 1000));
    drag(m.viewport, m.at(1100, 1100), m.at(1140, 1100));
    fireEvent.keyDown(window, { key: "Enter" });
    await flush();
    const d = String((created(m)[0]!.ops[0] as { node: { d: string } }).node.d);
    // the second anchor (a plain click) makes a line, the third has handles: its in handle at -40, its out at +40
    expect(d).toBe("M0 0 L100 0 L100 100".replace("L100 100", "C100 0 60 100 100 100"));
  });

  it("Enter and Esc end an open path (no fill); the tool is done at once and the path is selected once the server took it", async () => {
    const m = mount({ tool: "pen" });
    click(m.viewport, m.at(1000, 1000));
    click(m.viewport, m.at(1100, 1050));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(m.onToolDone).toHaveBeenCalledTimes(1);
    expect(m.onSelect).toHaveBeenLastCalledWith([]);
    await flush();
    const op = created(m)[0]!.ops[0] as { node: Record<string, unknown> };
    expect(op.node.fill).toBeUndefined();
    expect(op.node.d).toBe("M0 0 L100 50");
    expect(m.onSelect).toHaveBeenLastCalledWith([op.node.id]);
  });

  it("Backspace and Delete take the last point back; with one point left, they drop the draft", async () => {
    const m = mount({ tool: "pen" });
    click(m.viewport, m.at(1000, 1000));
    click(m.viewport, m.at(1100, 1000));
    click(m.viewport, m.at(1100, 1100));
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(m.container.querySelectorAll("[data-pen-anchor]")).toHaveLength(2);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(m.container.querySelectorAll("[data-pen-anchor]")).toHaveLength(1);
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(m.container.querySelector('[data-testid="pen-overlay"]')).toBeNull();
    fireEvent.keyDown(window, { key: "Enter" });
    await flush();
    expect(m.onApply).not.toHaveBeenCalled();
  });

  it("Esc with fewer than two points makes nothing and leaves the tool alone", async () => {
    const m = mount({ tool: "pen" });
    click(m.viewport, m.at(1000, 1000));
    fireEvent.keyDown(window, { key: "Escape" });
    await flush();
    expect(m.onApply).not.toHaveBeenCalled();
    expect(m.onToolDone).not.toHaveBeenCalled();
    expect(m.container.querySelector('[data-testid="pen-overlay"]')).toBeNull();
  });

  it("a double click ends the path and drops the second press of the double click", async () => {
    const m = mount({ tool: "pen" });
    click(m.viewport, m.at(1000, 1000));
    click(m.viewport, m.at(1100, 1000));
    click(m.viewport, m.at(1100, 1001));
    fireEvent.doubleClick(m.viewport);
    await flush();
    expect((created(m)[0]!.ops[0] as { node: { d: string } }).node.d).toBe("M0 0 L100 0");
  });

  it("its keys are marked as handled (defaultPrevented) and are not stopped: the shortcuts stand aside and anyone else still sees them", () => {
    const m = mount({ tool: "pen" });
    click(m.viewport, m.at(1000, 1000));
    click(m.viewport, m.at(1100, 1000));
    const seen: boolean[] = [];
    const later = (e: KeyboardEvent) => seen.push(e.defaultPrevented);
    document.addEventListener("keydown", later);
    fireEvent.keyDown(document.body, { key: "Escape" });
    document.removeEventListener("keydown", later);
    expect(seen).toEqual([true]);
  });

  it("does not take keys typed into a field, nor with a modifier", () => {
    const m = mount({ tool: "pen" });
    click(m.viewport, m.at(1000, 1000));
    click(m.viewport, m.at(1100, 1000));
    const input = document.body.appendChild(document.createElement("input"));
    fireEvent.keyDown(input, { key: "Backspace" });
    fireEvent.keyDown(window, { key: "Backspace", ctrlKey: true });
    expect(m.container.querySelectorAll("[data-pen-anchor]")).toHaveLength(2);
    input.remove();
  });

  it("leaving the pen tool drops the draft", () => {
    const m = mount({ tool: "pen" });
    click(m.viewport, m.at(1000, 1000));
    expect(m.container.querySelector('[data-testid="pen-overlay"]')).not.toBeNull();
    act(() => m.feed.update({ tool: "select" }));
    expect(m.container.querySelector('[data-testid="pen-overlay"]')).toBeNull();
  });

  it("the elastic line follows the cursor without rendering", () => {
    const m = mount({ tool: "pen" });
    click(m.viewport, m.at(1000, 1000));
    const line = m.container.querySelector<SVGLineElement>('[data-testid="pen-elastic"]') as SVGLineElement;
    const before = m.container.querySelector('[data-testid="pen-overlay"]');
    fireEvent.pointerMove(m.viewport, { ...m.at(1200, 1050), buttons: 0 });
    expect(line.getAttribute("x2")).toBe("1200");
    expect(line.getAttribute("y2")).toBe("1050");
    expect(m.container.querySelector('[data-testid="pen-overlay"]')).toBe(before);
  });

  it("a path begun over a frame that places by x and y is made in that frame, in its coordinates; over an auto-layout frame it goes to the page", async () => {
    const m = mount({ tool: "pen" });
    const free = node(m, "free");
    click(free, m.at(950, 450));
    click(free, m.at(1050, 450));
    fireEvent.keyDown(window, { key: "Enter" });
    await flush();
    const op = created(m)[0]!.ops[0] as { parentId: string; node: { x: number; y: number } };
    expect(op.parentId).toBe("free");
    expect(op.node).toMatchObject({ x: 50, y: 50 });
    act(() => m.feed.update({ tool: "pen" }));
    const flowing = node(m, "flow");
    click(flowing, m.at(150, 450));
    click(flowing, m.at(250, 450));
    fireEvent.keyDown(window, { key: "Enter" });
    await flush();
    expect((created(m)[1]!.ops[0] as { parentId: string }).parentId).toBe("page");
  });

  it("when the server refuses, nothing is selected and the tool stays done", async () => {
    const m = mount({ tool: "pen", apply: async () => false });
    click(m.viewport, m.at(1000, 1000));
    click(m.viewport, m.at(1100, 1000));
    fireEvent.keyDown(window, { key: "Enter" });
    await flush();
    expect(m.onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("editing a path", () => {
  const enter = (m: Mounted) => {
    const vec = node(m, "vec");
    click(vec, m.at(200, 180));
    fireEvent.doubleClick(vec);
    frames();
  };
  const anchor = (m: Mounted, key: string) => m.container.querySelector(`[data-path-anchor="${key}"]`) as Element;
  const handle = (m: Mounted, key: string) => m.container.querySelector(`[data-path-handle="${key}"]`) as Element;
  const pt = (x: number, y: number) => ({ clientX: x, clientY: y });

  it("a double click on a selected path enters edit mode: its anchors and handles, in the path's own coordinates", () => {
    const m = mount({ selection: ["vec"] });
    enter(m);
    expect(m.container.querySelector('[data-testid="path-edit"]')).not.toBeNull();
    expect(m.container.querySelectorAll("[data-path-anchor]")).toHaveLength(3);
    expect(m.container.querySelectorAll("[data-path-handle]")).toHaveLength(2);
    expect(m.container.querySelector("[data-path-outline]")).not.toBeNull();
  });

  it("does not enter on a path that is not selected, is locked, or sits in an instance", () => {
    const m = mount();
    fireEvent.doubleClick(node(m, "vec"));
    expect(m.container.querySelector('[data-testid="path-edit"]')).toBeNull();
    const locked = mount({ doc: vectorDocument([{ op: "update", id: "vec", props: { locked: true } } as unknown as Op]), selection: ["vec"] });
    fireEvent.doubleClick(node(locked, "vec"));
    expect(locked.container.querySelector('[data-testid="path-edit"]')).toBeNull();
  });

  it("dragging an anchor shows nothing until it moves 3 px, then sends ONE update with the outline and the new box (label 'move point')", async () => {
    const m = mount({ selection: ["vec"] });
    enter(m);
    const a = anchor(m, "0:2");
    const id = press(a, pt(100, 120));
    move(id, pt(101, 121));
    release(id, pt(101, 121));
    await flush();
    expect(m.onApply).not.toHaveBeenCalled();

    const id2 = press(a, pt(100, 120));
    move(id2, pt(120, 130));
    move(id2, pt(150, 140));
    expect(m.onApply).not.toHaveBeenCalled();
    release(id2, pt(150, 140));
    await flush();
    expect(m.onApply).toHaveBeenCalledTimes(1);
    const [ops, label] = m.onApply.mock.calls[0]!;
    expect(label).toBe("move point");
    expect(ops).toHaveLength(1);
    expect(ops![0]).toMatchObject({ op: "update", id: "vec" });
    const props = (ops![0] as unknown as { props: { d: string; x: number; y: number; width: number; height: number } }).props;
    expect(props.d).toBe("M0 75 C40 -25 160 -25 200 75 L150 115 Z");
    expect(props).toMatchObject({ x: 100, y: 125 });
  });

  it("shows the new outline on the path at once and keeps it until the document has it; a refusal puts it back", async () => {
    let answer: (ok: boolean) => void = () => {};
    const m = mount({ selection: ["vec"], apply: () => new Promise<boolean>((resolve) => (answer = resolve)) });
    enter(m);
    const before = node(m, "vec").querySelector("path")?.getAttribute("d");
    drag(anchor(m, "0:2"), pt(100, 120), pt(100, 150));
    frames();
    expect(node(m, "vec").querySelector("path")?.getAttribute("d")).not.toBe(before);
    await act(async () => answer(false));
    await flush();
    frames();
    expect(node(m, "vec").querySelector("path")?.getAttribute("d")).toBe(before);
  });

  it("a handle moves its twin too (mirrored) unless Alt is held", async () => {
    const smooth = () => vectorDocument([{ op: "update", id: "vec", props: { d: "M0 100 C0 50 50 0 100 0 C150 0 200 50 200 100" } } as unknown as Op]);
    const m = mount({ doc: smooth(), selection: ["vec"] });
    enter(m);
    drag(handle(m, "0:1:out"), pt(150, 0), pt(150, 30));
    await flush();
    const mirrored = (m.onApply.mock.calls[0]![0][0] as unknown as { props: { d: string } }).props.d;
    expect(m.onApply.mock.calls[0]![1]).toBe("move handle");
    const m2 = mount({ doc: smooth(), selection: ["vec"] });
    enter(m2);
    drag(handle(m2, "0:1:out"), pt(150, 0), pt(150, 30), { altKey: true });
    await flush();
    const loose = (m2.onApply.mock.calls[0]![0][0] as unknown as { props: { d: string } }).props.d;
    // the same drag; Alt leaves the incoming handle where it was, the plain one mirrors it
    expect(mirrored).not.toBe(loose);
    const controls = (d: string) => d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    // Alt: the incoming handle keeps its length and direction as it was in the loose copy; the mirror changes it
    expect(controls(mirrored)).not.toEqual(controls(loose));
  });

  it("a double click on an anchor toggles corner and smooth; on the outline it inserts a point", async () => {
    const m = mount({ selection: ["vec"] });
    enter(m);
    fireEvent.doubleClick(anchor(m, "0:2"));
    await flush();
    expect(m.onApply.mock.calls[0]![1]).toBe("toggle corner/smooth");
    expect((m.onApply.mock.calls[0]![0][0] as unknown as { props: { d: string } }).props.d).toMatch(/C/);
    expect(m.container.querySelector("[data-path-anchor][data-selected]")).not.toBeNull();

    const m2 = mount({ selection: ["vec"] });
    enter(m2);
    // a point on the straight edge between the last anchor (100, 120) and the first (0, 100) is closer to the outline than any other
    const outline = m2.container.querySelector("[data-path-outline]") as Element;
    fireEvent.doubleClick(outline, pt(50, 110));
    await flush();
    expect(m2.onApply.mock.calls[0]![1]).toBe("insert point");
    expect(m2.container.querySelectorAll("[data-path-anchor]")).toHaveLength(4);
  });

  it("Delete removes the selected point; with no segment left the vector is deleted and nothing stays selected", async () => {
    const m = mount({ doc: vectorDocument([{ op: "update", id: "vec", props: { d: "M0 0 L50 50" } } as unknown as Op]), selection: ["vec"] });
    enter(m);
    expect(anchor(m, "0:0")).toBeTruthy();
    click(anchor(m, "0:0"), pt(0, 0));
    fireEvent.keyDown(window, { key: "Delete" });
    await flush();
    expect(m.onApply.mock.calls[0]![1]).toBe("remove point");
    expect(m.onApply.mock.calls[0]![0][0]).toMatchObject({ op: "update", id: "vec" });
  });

  it("a path with one anchor left is deleted (no segments)", async () => {
    const doc = vectorDocument([{ op: "update", id: "vec", props: { d: "M10 10" } } as unknown as Op]);
    const m = mount({ doc, selection: ["vec"] });
    enter(m);
    click(anchor(m, "0:0"), pt(10, 10));
    fireEvent.keyDown(window, { key: "Backspace" });
    await flush();
    expect(m.onApply).toHaveBeenCalledWith([{ op: "delete", id: "vec" }], "delete vector");
    expect(m.onSelect).toHaveBeenLastCalledWith([]);
    expect(m.container.querySelector('[data-testid="path-edit"]')).toBeNull();
  });

  it("Esc and Enter leave edit mode (and are marked as handled); so does changing the selection or the tool", () => {
    for (const key of ["Escape", "Enter"]) {
      const m = mount({ selection: ["vec"] });
      enter(m);
      const seen: boolean[] = [];
      const later = (e: KeyboardEvent) => seen.push(e.defaultPrevented);
      document.addEventListener("keydown", later);
      fireEvent.keyDown(document.body, { key });
      document.removeEventListener("keydown", later);
      expect(seen).toEqual([true]);
      expect(m.container.querySelector('[data-testid="path-edit"]')).toBeNull();
      m.unmount();
    }
    const other = mount({ selection: ["vec"] });
    enter(other);
    act(() => other.feed.update({ selection: ["grad"] }));
    expect(other.container.querySelector('[data-testid="path-edit"]')).toBeNull();
    const tool = mount({ selection: ["vec"] });
    enter(tool);
    act(() => tool.feed.update({ tool: "rect" }));
    expect(tool.container.querySelector('[data-testid="path-edit"]')).toBeNull();
  });

  it("while editing, a press on the path or its outline does not change the selection", () => {
    const m = mount({ selection: ["vec"] });
    enter(m);
    m.onSelect.mockClear();
    click(node(m, "vec"), m.at(200, 180));
    click(m.container.querySelector("[data-path-outline]") as Element, pt(50, 105));
    expect(m.onSelect).not.toHaveBeenCalled();
  });
});

describe("connectors", () => {
  /** `document.elementsFromPoint` answers with what the test says is under the pointer. */
  const under = (...ids: string[]) => {
    (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () => ids.flatMap((id) => document.querySelector(`[data-paprika-id="${id}"]`) ?? []);
  };
  afterEach(() => delete (document as unknown as Record<string, unknown>).elementsFromPoint);

  it("the tool makes a { from, to, route: elbow } connector on the page from a node to a node, and is done", async () => {
    const m = mount({ tool: "connector" });
    under("sa");
    const id = press(m.viewport, m.at(650, 430));
    under("sb");
    move(id, m.at(650, 600));
    expect(m.container.querySelector('[data-testid="link-draft"]')).not.toBeNull();
    release(id, m.at(650, 680));
    await flush();
    expect(m.onApply).toHaveBeenCalledTimes(1);
    const [ops, label] = m.onApply.mock.calls[0]!;
    expect(label).toBe("create arrow");
    expect(ops![0]).toMatchObject({ op: "create", parentId: "page", node: { type: "connector", name: "Arrow 3", from: { nodeId: "sa" }, to: { nodeId: "sb" }, route: "elbow" } });
    expect(m.onToolDone).toHaveBeenCalledTimes(1);
    expect(m.container.querySelector('[data-testid="link-draft"]')).toBeNull();
  });

  it("in a document with no pages (nodes at the root) the arrow is still made, at the root", async () => {
    const flat = applyOps(createDocument("Flat", "doc-flat"), [
      { op: "create", node: { type: "rect", id: "sa", name: "A", x: 0, y: 0, width: 100, height: 60, fill: "#c43d27" } },
      { op: "create", node: { type: "rect", id: "sb", name: "B", x: 300, y: 0, width: 100, height: 60, fill: "#3d7bc4" } },
    ] as unknown as Op[]).doc;
    const m = mount({ tool: "connector", doc: flat, flat: true });
    under("sa");
    const id = press(m.viewport, m.at(50, 30));
    under("sb");
    move(id, m.at(330, 30));
    release(id, m.at(350, 30));
    await flush();
    expect(m.onApply).toHaveBeenCalledTimes(1);
    expect(m.onApply.mock.calls[0]![0][0]).toMatchObject({ op: "create", parentId: null, node: { type: "connector", from: { nodeId: "sa" }, to: { nodeId: "sb" } } });
  });

  it("ends on empty canvas are points, rounded; a connector and the page are not targets", async () => {
    const m = mount({ tool: "connector" });
    under("arrow", "page");
    drag(m.viewport, m.at(1000.4, 1000.6), m.at(1200, 1100));
    await flush();
    expect((m.onApply.mock.calls[0]![0][0] as { node: { from: unknown; to: unknown } }).node).toMatchObject({ from: { x: 1000, y: 1001 }, to: { x: 1200, y: 1100 } });
  });

  it("makes nothing under 6 px, nor an arrow from a node to itself", async () => {
    const m = mount({ tool: "connector" });
    under("sa");
    drag(m.viewport, m.at(650, 430), m.at(654, 432));
    // a different node under the end, but the pointer moved under 6 px
    const id = press(m.viewport, m.at(650, 430));
    under("sb");
    move(id, m.at(653, 432));
    release(id, m.at(653, 432));
    under("sa");
    drag(m.viewport, m.at(650, 430), m.at(700, 450));
    await flush();
    expect(m.onApply).not.toHaveBeenCalled();
    expect(m.onToolDone).not.toHaveBeenCalled();
  });

  it("the selected connector has a handle on each end, and one more to bend a curve; a locked one has none", () => {
    const m = mount({ selection: ["arrow"] });
    expect([...m.container.querySelectorAll("[data-connector-handle]")].map((e) => (e as HTMLElement).dataset.connectorHandle)).toEqual(["from", "to"]);
    const c = mount({ selection: ["curve"] });
    expect([...c.container.querySelectorAll("[data-connector-handle]")].map((e) => (e as HTMLElement).dataset.connectorHandle)).toEqual(["from", "to", "curve"]);
    const locked = mount({ doc: vectorDocument([{ op: "update", id: "arrow", props: { locked: true } } as unknown as Op]), selection: ["arrow"] });
    expect(locked.container.querySelectorAll("[data-connector-handle]")).toHaveLength(0);
    expect(mount({ selection: ["sa", "sb"] }).container.querySelectorAll("[data-connector-handle]")).toHaveLength(0);
  });

  it("dragging an end routes the arrow again while it moves and sends ONE update on release (label 'attach end')", async () => {
    const m = mount({ selection: ["arrow"] });
    const before = node(m, "arrow").querySelector("path")?.getAttribute("d");
    const to = m.container.querySelector('[data-connector-handle="to"]') as Element;
    under("page");
    const id = press(to, m.at(670, 650));
    move(id, m.at(672, 651));
    expect(node(m, "arrow").querySelector("path")?.getAttribute("d")).toBe(before);
    move(id, m.at(900, 300));
    frames();
    expect(node(m, "arrow").querySelector("path")?.getAttribute("d")).not.toBe(before);
    expect(m.onApply).not.toHaveBeenCalled();
    release(id, m.at(900, 300));
    await flush();
    expect(m.onApply).toHaveBeenCalledTimes(1);
    expect(m.onApply).toHaveBeenCalledWith([{ op: "update", id: "arrow", props: { to: { x: 900, y: 300 } } }], "attach end");
  });

  it("attaches an end to the node it is released over, and the start one has its own label; a press that never moved sends nothing", async () => {
    const m = mount({ selection: ["arrow"] });
    under("k1");
    drag(m.container.querySelector('[data-connector-handle="from"]') as Element, m.at(670, 470), m.at(150, 430));
    await flush();
    expect(m.onApply).toHaveBeenCalledWith([{ op: "update", id: "arrow", props: { from: { nodeId: "k1" } } }], "attach start");
    m.onApply.mockClear();
    click(m.container.querySelector('[data-connector-handle="to"]') as Element, m.at(670, 650));
    await flush();
    expect(m.onApply).not.toHaveBeenCalled();
  });

  it("the handle of a curve moves its control point (rounded to 4 decimals) and the label is 'bend arrow'", async () => {
    const m = mount({ selection: ["curve"] });
    drag(m.container.querySelector('[data-connector-handle="curve"]') as Element, m.at(700, 500), m.at(300.123456, 500.5));
    await flush();
    const [ops, label] = m.onApply.mock.calls[0]!;
    expect(label).toBe("bend arrow");
    expect(ops![0]).toMatchObject({ op: "update", id: "curve", props: { control: { x: 300.1235, y: 500.5 } } });
  });
});

describe("gradient handles", () => {
  const stop = (m: Mounted, i: number) => m.container.querySelector(`[data-gradient-handle="stop:${i}"]`) as Element;

  it("show for the selected node's gradient: its stops and the angle end; not on a turned node, a locked one, nor with several selected", () => {
    const m = mount({ selection: ["grad"] });
    expect([...m.container.querySelectorAll("[data-gradient-handle]")].map((e) => (e as HTMLElement).dataset.gradientHandle)).toEqual(["stop:0", "stop:1", "end"]);
    expect(mount({ selection: ["turned"] }).container.querySelectorAll("[data-gradient-handle]")).toHaveLength(0);
    const locked = mount({ doc: vectorDocument([{ op: "update", id: "grad", props: { locked: true } } as unknown as Op]), selection: ["grad"] });
    expect(locked.container.querySelectorAll("[data-gradient-handle]")).toHaveLength(0);
    expect(mount({ selection: ["grad", "vec"] }).container.querySelectorAll("[data-gradient-handle]")).toHaveLength(0);
  });

  it("dragging writes the node's own style (no render) and sends ONE update with the whole gradient on release (label 'gradient')", async () => {
    const m = mount({ selection: ["grad"] });
    const renders = (m.world as unknown as { __paprikaNodeRenders: number });
    const before = renders.__paprikaNodeRenders;
    const id = press(stop(m, 0), m.at(400, 170));
    move(id, m.at(460, 170));
    expect(node(m, "grad").style.background).toContain("25%");
    expect(m.onApply).not.toHaveBeenCalled();
    release(id, m.at(460, 170));
    await flush();
    expect(renders.__paprikaNodeRenders).toBe(before);
    expect(m.onApply).toHaveBeenCalledTimes(1);
    const [ops, label] = m.onApply.mock.calls[0]!;
    expect(label).toBe("gradient");
    expect(ops![0]).toMatchObject({ op: "update", id: "grad", props: { gradient: { type: "linear", stops: [{ color: "red", offset: 0.25 }, { color: "blue", offset: 1 }] } } });
  });

  it("a press that changes nothing sends nothing, and the style is as it was", async () => {
    const m = mount({ selection: ["grad"] });
    const before = node(m, "grad").style.background;
    click(stop(m, 0), m.at(400, 170));
    await flush();
    expect(m.onApply).not.toHaveBeenCalled();
    expect(node(m, "grad").style.background).toBe(before);
  });

  it("a refused update puts the element's style back", async () => {
    const m = mount({ selection: ["grad"], apply: async () => false });
    const before = node(m, "grad").style.background;
    drag(stop(m, 0), m.at(400, 170), m.at(460, 170));
    await flush();
    expect(node(m, "grad").style.background).toBe(before);
  });

  it("an arrow key on a focused handle moves it one step and sends one update", async () => {
    const m = mount({ selection: ["grad"] });
    fireEvent.keyDown(stop(m, 1), { key: "ArrowLeft" });
    await flush();
    expect(m.onApply).toHaveBeenCalledTimes(1);
    expect(m.onApply.mock.calls[0]![0][0]).toMatchObject({ props: { gradient: { stops: [{ offset: 0 }, { offset: 0.99 }] } } });
  });
});

describe("the handles of an edit need the select tool", () => {
  it.each([
    ["spacing", ["flow"], '[data-spacing="gap-0"]', { x: 196, y: 450 }, { x: 216, y: 450 }],
    ["gradient", ["grad"], '[data-gradient-handle="stop:0"]', { x: 400, y: 170 }, { x: 460, y: 170 }],
    ["arrow end", ["arrow"], '[data-connector-handle="to"]', { x: 670, y: 650 }, { x: 900, y: 300 }],
  ])("the %s handle is not drawn with the rectangle tool, and a drag from where it is draws a rectangle and edits nothing", async (_name, selection, selector, from, to) => {
    const m = mount({ selection, tool: "rect" });
    expect(m.container.querySelector(selector)).toBeNull();
    drag(m.container.querySelector('[data-testid="viewport"]') as Element, m.at(from.x, from.y), m.at(to.x, to.y));
    await flush();
    const labels = m.onApply.mock.calls.map((c) => c[1]);
    expect(labels).not.toContain("gap");
    expect(labels).not.toContain("gradient");
    expect(labels).not.toContain("attach end");
    expect(labels).toEqual(["create rectangle"]);
  });

  it.each([
    ["spacing", ["flow"], '[data-spacing="gap-0"]'],
    ["gradient", ["grad"], '[data-gradient-handle="stop:0"]'],
    ["arrow end", ["arrow"], '[data-connector-handle="to"]'],
  ])("the %s handle is drawn with the select tool", (_name, selection, selector) => {
    const m = mount({ selection });
    expect(m.container.querySelector(selector)).not.toBeNull();
  });
});

describe("spacing handles", () => {
  const spacing = (m: Mounted, id: string) => m.container.querySelector(`[data-spacing="${id}"]`) as Element;

  it("a frame with auto-layout shows a handle on each padding side and one in each gap", () => {
    const m = mount({ selection: ["flow"] });
    expect([...m.container.querySelectorAll("[data-spacing]")].map((e) => (e as HTMLElement).dataset.spacing)).toEqual(["padding-top", "padding-right", "padding-bottom", "padding-left", "gap-0", "gap-1"]);
    expect(spacing(m, "gap-0")).toHaveAttribute("role", "slider");
    expect(spacing(m, "gap-0")).toHaveAttribute("aria-valuenow", "16");
    expect(mount({ selection: ["free"] }).container.querySelectorAll("[data-spacing]")).toHaveLength(0);
    expect(mount({ selection: ["flow", "free"] }).container.querySelectorAll("[data-spacing]")).toHaveLength(0);
  });

  it("dragging a gap shows the layout on the frame and sends ONE update on release (label 'gap')", async () => {
    const m = mount({ selection: ["flow"] });
    const id = press(spacing(m, "gap-0"), m.at(196, 450));
    move(id, m.at(216, 450));
    expect(node(m, "flow").style.gap).toBe("36px");
    expect(m.onApply).not.toHaveBeenCalled();
    release(id, m.at(216, 450));
    await flush();
    expect(m.onApply).toHaveBeenCalledTimes(1);
    const [ops, label] = m.onApply.mock.calls[0]!;
    expect(label).toBe("gap");
    expect(ops![0]).toMatchObject({ op: "update", id: "flow", props: { layout: { mode: "row", gap: 36, padding: 20 } } });
  });

  it("padding: one side, and with Alt all four; a press that did not move writes nothing", async () => {
    const m = mount({ selection: ["flow"] });
    drag(spacing(m, "padding-top"), m.at(280, 420), m.at(280, 430));
    await flush();
    expect(m.onApply.mock.calls[0]![1]).toBe("padding");
    expect(m.onApply.mock.calls[0]![0][0]).toMatchObject({ props: { layout: { padding: [30, 20, 20, 20] } } });
    const all = mount({ selection: ["flow"] });
    drag(spacing(all, "padding-left"), all.at(120, 480), all.at(128, 480), { altKey: true });
    await flush();
    expect(all.onApply.mock.calls[0]![0][0]).toMatchObject({ props: { layout: { padding: 28 } } });
    const still = mount({ selection: ["flow"] });
    click(spacing(still, "padding-right"), still.at(440, 480));
    await flush();
    expect(still.onApply).not.toHaveBeenCalled();
  });

  it("a refusal puts the frame's layout back", async () => {
    const m = mount({ selection: ["flow"], apply: async () => false });
    drag(spacing(m, "gap-0"), m.at(196, 450), m.at(216, 450));
    await flush();
    await flush(); frames(2);
    expect(node(m, "flow").style.gap).toBe("16px");
  });

  it("arrow keys step a handle (1 px, 10 with Shift) and send one update each", async () => {
    const m = mount({ selection: ["flow"] });
    fireEvent.keyDown(spacing(m, "gap-0"), { key: "ArrowRight", shiftKey: true });
    await flush();
    expect(m.onApply.mock.calls[0]![0][0]).toMatchObject({ props: { layout: { gap: 26 } } });
  });
});

describe("the gestures of this batch", () => {
  it("are listed before the click that selects, so a handle never starts a selection", () => {
    const ids = gestures.map((g) => g.id);
    for (const id of ["connector-edit", "gradient-handle", "spacing-handle", "pen", "path-edit-drag", "path-edit-hold", "connector-create"]) expect(ids.indexOf(id), id).toBeLessThan(ids.indexOf("select-click"));
    expect(ids.indexOf("pan")).toBe(0);
  });
});

describe("with the selection and the editors of the other batches", () => {
  const enterEdit = (m: Mounted) => {
    fireEvent.doubleClick(node(m, "vec"));
    frames();
  };
  const corner = (m: Mounted) => m.container.querySelector('[data-selection-handles] [data-handle="nw"]');
  const knob = (m: Mounted) => m.container.querySelector("[data-selection-handles] [data-rotate-handle]");
  const badge = (m: Mounted) => m.container.querySelector<HTMLElement>('[data-selection-handles] [aria-label="Selection size"]');

  it("the resize corners and the turning knob stand aside while the points of a path are edited, and come back when the mode ends", () => {
    const m = mount({ selection: ["vec"] });
    expect(corner(m)).not.toBeNull();
    expect(knob(m)).not.toBeNull();
    enterEdit(m);
    expect(m.container.querySelector('[data-testid="path-edit"]')).not.toBeNull();
    expect(corner(m)).toBeNull();
    expect(knob(m)).toBeNull();
    expect(badge(m)).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    frames();
    expect(m.container.querySelector('[data-testid="path-edit"]')).toBeNull();
    expect(corner(m)).not.toBeNull();
    expect(knob(m)).not.toBeNull();
  });

  it("they stand aside while the text of a shape is edited too, and come back after", async () => {
    const m = mount({ selection: ["sa"] });
    expect(corner(m)).not.toBeNull();
    fireEvent.doubleClick(node(m, "sa"));
    expect(m.container.querySelector('[data-testid="shape-text-editor"]')).not.toBeNull();
    expect(corner(m)).toBeNull();
    expect(knob(m)).toBeNull();
    fireEvent.keyDown(m.container.querySelector('[data-testid="shape-text-editor"]') as Element, { key: "Escape" });
    await flush();
    expect(m.container.querySelector('[data-testid="shape-text-editor"]')).toBeNull();
    expect(corner(m)).not.toBeNull();
  });

  it("the size badge stays through the gestures of this batch: a gradient stop, a gap, a point of the path", async () => {
    const grad = mount({ selection: ["grad"] });
    expect(badge(grad)?.textContent).toBe("240 × 140");
    const id = press(grad.container.querySelector('[data-gradient-handle="stop:0"]') as Element, grad.at(400, 170));
    move(id, grad.at(460, 170));
    expect(badge(grad)?.textContent).toBe("240 × 140");
    expect(badge(grad)?.closest<HTMLElement>("[class*=absolute]")?.style.display).not.toBe("none");
    release(id, grad.at(460, 170));
    const flow = mount({ selection: ["flow"] });
    const g = press(flow.container.querySelector('[data-spacing="gap-0"]') as Element, flow.at(196, 450));
    move(g, flow.at(216, 450));
    expect(badge(flow)?.textContent).toBe("360 × 160");
    release(g, flow.at(216, 450));
    await flush();
    const path = mount({ selection: ["vec"] });
    enterEdit(path);
    // (jsdom has no layout for an svg: the badge's number is the stub's, what matters is that it is there and unchanged)
    const shown = badge(path)?.textContent;
    expect(shown).toMatch(/^\d+ × \d+$/);
    const a = press(path.container.querySelector('[data-path-anchor="0:0"]') as Element, path.at(100, 200));
    move(a, path.at(120, 210));
    expect(badge(path)?.textContent).toBe(shown);
    release(a, path.at(120, 210));
  });

  it("an arrow follows a node the move drags: its route changes with the preview, before anything is sent", async () => {
    const m = mount();
    const route = () => node(m, "arrow").querySelector("path")?.getAttribute("d") ?? "";
    const before = route();
    expect(before).not.toBe("");
    const box = node(m, "sb");
    const from = m.at(670, 685);
    const id = press(box, from);
    move(id, m.at(700, 690));
    move(id, m.at(1000, 700));
    expect(route()).not.toBe(before);
    expect(m.onApply).not.toHaveBeenCalled();
    release(id, m.at(1000, 700));
    await flush();
    expect(m.onApply).toHaveBeenCalledTimes(1);
    expect(m.onApply.mock.calls[0]![0].map((op) => (op as { id?: string }).id)).toEqual(["sb"]);
  });

  it("and goes back to the document's route when the move is refused", async () => {
    const m = mount({ apply: async () => false });
    const route = () => node(m, "arrow").querySelector("path")?.getAttribute("d") ?? "";
    const before = route();
    const id = press(node(m, "sb"), m.at(670, 685));
    move(id, m.at(700, 690));
    move(id, m.at(1000, 700));
    release(id, m.at(1000, 700));
    await flush();
    frames(2);
    expect(route()).toBe(before);
  });
});
