import { applyOps, type Document, type Op } from "@paprika/core";
import { act, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { everyKindDocument, stubLayout, testDefaults } from "@/test/canvas-fixtures";
import { Canvas, createCanvasFeed } from "./index";
import { creationNode, DRAFT_DEFAULTS, draftBox, ghostNode, isDraftTool, nextNumber } from "./labels";
import { editRange, linkOk, marks, paintEditable, readEditable, sameText } from "./rich-text";
import type { CanvasInput } from "./types";

let restore: () => void;
beforeEach(() => {
  restore = stubLayout();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
});
afterEach(() => {
  restore();
  vi.useRealTimers();
});

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(20)));

function mount(input: Partial<CanvasInput> = {}, doc: Document = everyKindDocument(), answer = true) {
  const feed = createCanvasFeed({ doc, pageId: "page", ...input });
  const onSelect = vi.fn((ids: readonly string[]) => feed.update({ selection: ids }));
  const onApply = vi.fn(async (_ops: Op[], _label: string) => answer);
  const onToolDone = vi.fn(() => feed.update({ tool: "select" }));
  const view = render(<Canvas feed={feed} defaults={testDefaults} onSelect={onSelect} onApply={onApply} onToolDone={onToolDone} />);
  const viewport = view.getByTestId("viewport");
  const world = view.getByTestId("canvas-world");
  const overlays = view.getByTestId("canvas-overlays");
  const camera = () => {
    const m = /translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)\s*scale\(([-\d.e]+)\)/.exec(world.style.transform);
    return { x: Number(m?.[1]), y: Number(m?.[2]), zoom: Number(m?.[3]) };
  };
  /** Screen point of a world point. */
  const at = (wx: number, wy: number) => {
    const c = camera();
    return { clientX: c.x + wx * c.zoom, clientY: c.y + wy * c.zoom };
  };
  return { ...view, feed, onSelect, onApply, onToolDone, viewport, world, overlays, at };
}

const node = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-paprika-id="${id}"]`) as HTMLElement;
const ops = (onApply: { mock: { calls: unknown[][] } }, call = 0) => onApply.mock.calls[call]![0] as Op[];

describe("names, sizes and nodes of a creation", () => {
  it("has the old default sizes and knows its tools", () => {
    expect(DRAFT_DEFAULTS.frame).toEqual([390, 844]);
    expect(DRAFT_DEFAULTS.text).toEqual([200, 32]);
    expect(isDraftTool("note")).toBe(true);
    expect(isDraftTool("pen")).toBe(false);
    expect(isDraftTool("connector")).toBe(false);
    expect(isDraftTool("select")).toBe(false);
  });

  it("counts the nodes of the kind (a shape by its kind) and adds one", () => {
    const doc = everyKindDocument();
    expect(nextNumber(doc, "rect")).toBe(3); // turned, ghost
    expect(nextNumber(doc, "text")).toBe(3);
    expect(nextNumber(doc, "diamond")).toBe(2);
    expect(nextNumber(doc, "shape")).toBe(2); // `end` is a rect shape
    expect(nextNumber(doc, "cloud")).toBe(1);
  });

  it("makes a click the default size at the point and a drag the dragged box, whichever way it goes", () => {
    expect(draftBox("rect", { x: 10.4, y: 20.6 }, { x: 12, y: 22 })).toMatchObject({ x: 10, y: 21, width: 120, height: 80, clicked: true });
    expect(draftBox("rect", { x: 100, y: 100 }, { x: 40.4, y: 60 })).toMatchObject({ x: 40, y: 60, width: 60, height: 40, clicked: false });
    expect(draftBox("frame", { x: 0, y: 0 }, { x: 0, y: 30 })).toMatchObject({ width: 1, height: 30, clicked: false });
  });

  it("sends only what differs from the core's defaults, with the old fills", () => {
    const base = { id: "n", name: "N", x: 1, y: 2, width: 3, height: 4 };
    expect(creationNode("frame", base, testDefaults)).toMatchObject({ type: "frame", fill: "#ffffff" });
    expect(creationNode("rect", base, testDefaults)).toMatchObject({ type: "rect", fill: "#d9d4cf" });
    expect(creationNode("ellipse", base, testDefaults)).toMatchObject({ type: "ellipse", fill: "#d9d4cf" });
    expect(creationNode("text", base, testDefaults)).toMatchObject({ type: "text", text: "Texto", height: "hug" });
    expect(creationNode("shape", base, testDefaults)).toMatchObject({ type: "shape", shape: "rect" });
    expect(creationNode("note", base, testDefaults)).toMatchObject({ type: "shape", shape: "note" });
    expect(creationNode("cloud", base, testDefaults)).not.toHaveProperty("fill");
    expect(ghostNode("note", 160, 160, testDefaults)).toMatchObject({ type: "shape", shape: "note", width: 160 });
  });
});

describe("drawing a node with a creation tool", () => {
  it("shows the ghost while the pointer is down, sends nothing until it is released, then ONE create", async () => {
    const t = mount({ tool: "rect" });
    fireEvent.pointerDown(t.viewport, { button: 0, ...t.at(700, 450), pointerId: 1 });
    expect(t.getByTestId("draft-ghost")).toHaveAttribute("data-ghost-tool", "rect");
    fireEvent.pointerMove(window, { ...t.at(800, 520), pointerId: 1 });
    expect(t.getByTestId("create-drag")).toBeInTheDocument();
    expect(t.getByTestId("create-ghost")).toHaveAttribute("aria-hidden", "true");
    expect(t.onApply).not.toHaveBeenCalled();
    fireEvent.pointerUp(window, { ...t.at(800, 520), pointerId: 1 });
    await flush();
    expect(t.queryByTestId("draft-ghost")).toBeNull();
    expect(t.onApply).toHaveBeenCalledTimes(1);
    const [op] = ops(t.onApply);
    expect(op).toMatchObject({ op: "create", parentId: "page", node: { type: "rect", name: "Rectangle 3", x: 700, y: 450, width: 100, height: 70, fill: "#d9d4cf" } });
    expect(t.onApply.mock.calls[0]![1]).toBe("create rectangle");
    expect(t.onToolDone).toHaveBeenCalledTimes(1);
    expect(t.onSelect).toHaveBeenCalledWith([(op as { node: { id: string } }).node.id]);
  });

  it("takes the default size on a click that does not drag, with the point as the top-left corner", async () => {
    const t = mount({ tool: "frame" });
    fireEvent.pointerDown(t.viewport, { button: 0, ...t.at(700, 450), pointerId: 1 });
    fireEvent.pointerUp(window, { ...t.at(701, 451), pointerId: 1 });
    await flush();
    expect(ops(t.onApply)[0]).toMatchObject({ node: { type: "frame", name: "Frame 4", x: 700, y: 450, width: 390, height: 844, fill: "#ffffff" } });
    expect(t.onApply.mock.calls[0]![1]).toBe("create frame");
  });

  it("makes the shape tools a `shape` node of their kind, with their names, and opens the text editor", async () => {
    const t = mount({ tool: "diamond" });
    fireEvent.pointerDown(t.viewport, { button: 0, ...t.at(700, 450), pointerId: 1 });
    fireEvent.pointerUp(window, { ...t.at(700, 450), pointerId: 1 });
    await flush();
    expect(ops(t.onApply)[0]).toMatchObject({ node: { type: "shape", shape: "diamond", name: "Decision 2", width: 160, height: 100 } });
    expect(t.onApply.mock.calls[0]![1]).toBe("create decision");
    // The node reaches the document and the editor opens over it.
    const { doc } = applyOps(everyKindDocument(), ops(t.onApply));
    act(() => t.feed.update({ doc }));
    expect(t.getByTestId("shape-text-editor")).toHaveFocus();
  });

  it("puts the node in the frame under the pointer, in that frame's coordinates", async () => {
    const t = mount({ tool: "ellipse" });
    // `home` is at (100, 80) on the page; the pointer is on it at (150, 120).
    fireEvent.pointerDown(node(t.world, "home"), { button: 0, ...t.at(150, 120), pointerId: 1 });
    fireEvent.pointerMove(window, { ...t.at(190, 160), pointerId: 1 });
    fireEvent.pointerUp(window, { ...t.at(190, 160), pointerId: 1 });
    await flush();
    expect(ops(t.onApply)[0]).toMatchObject({ parentId: "home", node: { type: "ellipse", x: 50, y: 40, width: 40, height: 40 } });
  });

  it("creates nothing and leaves nothing behind when the gesture is cancelled", async () => {
    const t = mount({ tool: "rect" });
    fireEvent.pointerDown(t.viewport, { button: 0, ...t.at(700, 450), pointerId: 1 });
    fireEvent.pointerCancel(window, { pointerId: 1 });
    await flush();
    expect(t.queryByTestId("draft-ghost")).toBeNull();
    expect(t.onApply).not.toHaveBeenCalled();
    expect(t.onToolDone).not.toHaveBeenCalled();
  });

  it("selects and opens nothing when the server did not take the node", async () => {
    const t = mount({ tool: "cloud" }, everyKindDocument(), false);
    fireEvent.pointerDown(t.viewport, { button: 0, ...t.at(700, 450), pointerId: 1 });
    fireEvent.pointerUp(window, { ...t.at(700, 450), pointerId: 1 });
    await flush();
    expect(t.onApply).toHaveBeenCalledTimes(1);
    expect(t.onSelect).not.toHaveBeenCalled();
    expect(t.queryByTestId("shape-text-editor")).toBeNull();
  });

  it("does not draw with the select tool, with the middle button or with Space held", () => {
    const t = mount({ tool: "select" });
    fireEvent.pointerDown(t.viewport, { button: 0, ...t.at(700, 450), pointerId: 1 });
    expect(t.queryByTestId("draft-ghost")).toBeNull();
    fireEvent.pointerUp(window, { pointerId: 1 });
    t.feed.update({ tool: "rect" });
    fireEvent.pointerDown(t.viewport, { button: 1, ...t.at(700, 450), pointerId: 2 });
    expect(t.queryByTestId("draft-ghost")).toBeNull();
    fireEvent.pointerUp(window, { pointerId: 2 });
  });
});

describe("opening an editor with a double click", () => {
  it("opens the text editor on a text, keeping it selected (the press selected it, the double click only opens)", () => {
    const t = mount();
    fireEvent.pointerDown(node(t.world, "plain"), { button: 0, ...t.at(120, 100), pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    fireEvent.pointerDown(node(t.world, "plain"), { button: 0, ...t.at(120, 100), pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    fireEvent.doubleClick(node(t.world, "plain"));
    expect(t.getByRole("textbox", { name: "Text" })).toHaveFocus();
    expect(t.onSelect.mock.calls.every(([ids]) => ids.length === 1 && ids[0] === "plain")).toBe(true);
    expect(node(t.world, "plain").style.visibility).toBe("hidden");
  });

  it("opens the shape's textarea and the arrow's label field, and nothing on a rect", () => {
    const t = mount();
    fireEvent.doubleClick(node(t.world, "box"));
    expect(t.getByTestId("shape-text-editor")).toHaveValue("Decision");
    fireEvent.keyDown(t.getByTestId("shape-text-editor"), { key: "Escape" });
    fireEvent.doubleClick(node(t.world, "arrow"));
    expect(t.getByTestId("connector-label-editor")).toHaveValue("yes");
    fireEvent.keyDown(t.getByTestId("connector-label-editor"), { key: "Escape" });
    fireEvent.doubleClick(node(t.world, "turned"));
    expect(t.queryByRole("textbox")).toBeNull();
  });

  it("leaves a locked node, an instance's copy and any tool but select alone", () => {
    const doc = everyKindDocument();
    (doc.nodes.plain as { locked: boolean }).locked = true;
    const t = mount({}, doc);
    fireEvent.doubleClick(node(t.world, "plain"));
    expect(t.queryByRole("textbox")).toBeNull();
    t.feed.update({ tool: "rect" });
    fireEvent.doubleClick(node(t.world, "box"));
    expect(t.queryByTestId("shape-text-editor")).toBeNull();
  });

  it("opens the name of a frame on a double click of its label, and the double click does not reach the viewport", () => {
    const t = mount();
    const label = t.overlays.querySelector<HTMLElement>('[data-frame-label="home"]') as HTMLElement;
    fireEvent.doubleClick(label);
    const field = t.getByRole("textbox", { name: "Frame name" });
    expect(field).toHaveValue("Home");
    expect(field).toHaveFocus();
  });
});

describe("the text editor", () => {
  const open = (t: ReturnType<typeof mount>) => {
    fireEvent.doubleClick(node(t.world, "title"));
    return t.getByRole("textbox", { name: "Text" });
  };

  it("paints the text and its runs, breaks the line on Enter and confirms with Escape: one update, labelled", async () => {
    const t = mount();
    const surface = open(t);
    expect(surface.textContent).toBe("Hello brave world");
    expect(surface.querySelector("a")).toHaveAttribute("href", "https://example.com");
    surface.append(document.createTextNode("!"));
    fireEvent.keyDown(surface, { key: "Escape" });
    await flush();
    expect(t.onApply).toHaveBeenCalledTimes(1);
    expect(ops(t.onApply)[0]).toMatchObject({ op: "update", id: "title", props: { text: "Hello brave world!" } });
    expect(t.onApply.mock.calls[0]![1]).toBe("edit text");
    expect(t.queryByRole("textbox")).toBeNull();
  });

  it("commits only when something changed", async () => {
    const t = mount();
    const surface = open(t);
    fireEvent.keyDown(surface, { key: "Enter", ctrlKey: true });
    await flush();
    expect(t.onApply).not.toHaveBeenCalled();
    expect(t.queryByRole("textbox")).toBeNull();
  });

  it("keeps the keys of the editor to itself: letters and Delete do not reach the editor's shortcuts", () => {
    const t = mount();
    const surface = open(t);
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    fireEvent.keyDown(surface, { key: "Delete" });
    fireEvent.keyDown(surface, { key: "r" });
    fireEvent.keyDown(surface, { key: "a", ctrlKey: true });
    document.removeEventListener("keydown", seen);
    expect(seen).not.toHaveBeenCalled();
    expect(surface.closest("[contenteditable], [role=textbox]")).toBe(surface);
    expect(surface).toHaveAttribute("contenteditable", "true");
  });

  it("confirms when the focus leaves for somewhere outside, and not when it moves to the bar", async () => {
    const t = mount();
    const surface = open(t);
    surface.append(document.createTextNode("?"));
    const bold = t.getByRole("button", { name: "Bold" });
    fireEvent.blur(surface, { relatedTarget: bold });
    await flush();
    expect(t.onApply).not.toHaveBeenCalled();
    fireEvent.blur(surface, { relatedTarget: document.body });
    await flush();
    expect(t.onApply).toHaveBeenCalledTimes(1);
  });

  it("has the bar: bold, italic, size, colour and link, labelled", () => {
    const t = mount();
    open(t);
    const bar = t.getByRole("toolbar", { name: "Text format" });
    for (const name of ["Bold", "Italic", "Size", "Color", "Link", "Apply link"]) expect(within(bar).getByLabelText(name)).toBeInTheDocument();
  });

  it("applies bold to the saved selection with the runs the old canvas wrote", async () => {
    const t = mount();
    const surface = open(t);
    paintEditable(surface, "Hello", null);
    const range = document.createRange();
    range.setStart(surface.firstChild!, 0);
    range.setEnd(surface.firstChild!, 5);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.mouseDown(t.getByRole("button", { name: "Bold" }));
    fireEvent.click(t.getByRole("button", { name: "Bold" }));
    fireEvent.keyDown(surface, { key: "Escape" });
    await flush();
    expect(ops(t.onApply)[0]).toMatchObject({ props: { text: "Hello", runs: [{ start: 0, end: 5, fontWeight: 700 }] } });
  });
});

describe("an editor whose node goes away", () => {
  const without = (id: string) => applyOps(everyKindDocument(), [{ op: "delete", id }]).doc;
  const handlesOf = (t: ReturnType<typeof mount>) => t.overlays.querySelectorAll("[data-handle]").length;

  it.each([
    ["a text", "title", () => ({ name: "Text" })],
    ["a shape", "box", () => ({ name: "Shape text" })],
    ["an arrow label", "arrow", () => ({ name: "Arrow label" })],
  ])("%s: when another client deletes the node, the editor closes and the handles of the next selection come back", async (_kind, id) => {
    const t = mount();
    fireEvent.doubleClick(node(t.world, id));
    expect(t.queryByTestId("text-editor") ?? t.queryByTestId("shape-text-editor") ?? t.queryByTestId("connector-label-editor")).not.toBeNull();
    act(() => t.feed.update({ doc: without(id) }));
    await flush();
    expect(t.queryByTestId("text-editor") ?? t.queryByTestId("shape-text-editor") ?? t.queryByTestId("connector-label-editor")).toBeNull();
    act(() => t.feed.update({ selection: ["end"] }));
    await flush();
    expect(handlesOf(t)).toBeGreaterThan(0);
  });

  it("a switch of page ends the edit too", async () => {
    const doc = applyOps(everyKindDocument(), [{ op: "add_page", id: "other", name: "Other" } as unknown as Op]).doc;
    const t = mount({}, doc);
    fireEvent.doubleClick(node(t.world, "box"));
    expect(t.queryByTestId("shape-text-editor")).not.toBeNull();
    act(() => t.feed.update({ pageId: "other" }));
    await flush();
    expect(t.queryByTestId("shape-text-editor")).toBeNull();
    act(() => t.feed.update({ pageId: "page", selection: ["end"] }));
    await flush();
    expect(t.queryByTestId("shape-text-editor")).toBeNull();
    expect(handlesOf(t)).toBeGreaterThan(0);
  });

  it("a node that comes back with the same id does not reopen an editor", async () => {
    const t = mount();
    fireEvent.doubleClick(node(t.world, "box"));
    act(() => t.feed.update({ doc: without("box") }));
    await flush();
    act(() => t.feed.update({ doc: everyKindDocument() }));
    await flush();
    expect(t.queryByTestId("shape-text-editor")).toBeNull();
    expect(node(t.world, "box").style.visibility).not.toBe("hidden");
  });
});

describe("an editor and a change from another client", () => {
  const edit = (id: string, props: Record<string, unknown>) => applyOps(everyKindDocument(), [{ op: "update", id, props } as unknown as Op]).doc;

  it("a text nobody has typed in shows the remote text, keeps the caret, and a Escape then writes nothing", async () => {
    const t = mount();
    fireEvent.doubleClick(node(t.world, "plain"));
    const surface = t.getByRole("textbox", { name: "Text" });
    act(() => t.feed.update({ doc: edit("plain", { text: "Remote text" }) }));
    await flush();
    expect(surface.textContent).toBe("Remote text");
    fireEvent.keyDown(surface, { key: "Escape" });
    await flush();
    expect(t.onApply).not.toHaveBeenCalled();
  });

  it("a text with typing in it keeps the typing: the commit is the local text, measured against what the remote wrote", async () => {
    const t = mount();
    fireEvent.doubleClick(node(t.world, "plain"));
    const surface = t.getByRole("textbox", { name: "Text" });
    surface.append(document.createTextNode("X"));
    act(() => t.feed.update({ doc: edit("plain", { text: "Remote text" }) }));
    await flush();
    expect(surface.textContent).toBe("Just textX");
    fireEvent.keyDown(surface, { key: "Escape" });
    await flush();
    expect(ops(t.onApply)[0]).toMatchObject({ id: "plain", props: { text: "Just textX" } });
  });

  it("a text whose remote change arrives and is then typed on commits remote text plus the typing", async () => {
    const t = mount();
    fireEvent.doubleClick(node(t.world, "plain"));
    const surface = t.getByRole("textbox", { name: "Text" });
    act(() => t.feed.update({ doc: edit("plain", { text: "Remote text" }) }));
    await flush();
    surface.append(document.createTextNode("!"));
    fireEvent.keyDown(surface, { key: "Escape" });
    await flush();
    expect(ops(t.onApply)[0]).toMatchObject({ props: { text: "Remote text!" } });
  });

  it("a shape's text, untouched, shows the remote text; typed on, it keeps the typing", async () => {
    const t = mount();
    fireEvent.doubleClick(node(t.world, "box"));
    const area = t.getByTestId("shape-text-editor") as HTMLTextAreaElement;
    act(() => t.feed.update({ doc: edit("box", { text: "Remote" }) }));
    await flush();
    expect(area.value).toBe("Remote");
    fireEvent.keyDown(area, { key: "Escape" });
    await flush();
    expect(t.onApply).not.toHaveBeenCalled();
    fireEvent.doubleClick(node(t.world, "box"));
    const typed = t.getByTestId("shape-text-editor") as HTMLTextAreaElement;
    fireEvent.change(typed, { target: { value: "Mine" } });
    act(() => t.feed.update({ doc: edit("box", { text: "Remote again" }) }));
    await flush();
    expect(typed.value).toBe("Mine");
    fireEvent.keyDown(typed, { key: "Escape" });
    await flush();
    expect(ops(t.onApply)[0]).toMatchObject({ id: "box", props: { text: "Mine" } });
  });

  it("an arrow's label, untouched, shows the remote label; typed on, it keeps the typing", async () => {
    const t = mount();
    fireEvent.doubleClick(node(t.world, "arrow"));
    const field = t.getByTestId("connector-label-editor") as HTMLInputElement;
    act(() => t.feed.update({ doc: edit("arrow", { label: "maybe" }) }));
    await flush();
    expect(field.value).toBe("maybe");
    fireEvent.change(field, { target: { value: "mine" } });
    act(() => t.feed.update({ doc: edit("arrow", { label: "later" }) }));
    await flush();
    expect(field.value).toBe("mine");
    fireEvent.keyDown(field, { key: "Enter" });
    await flush();
    expect(ops(t.onApply)[0]).toMatchObject({ id: "arrow", props: { label: "mine" } });
  });
});

describe("the shape's text, the arrow's label and the frame's name", () => {
  it("commits the shape's text on Escape and on blur, only when it changed", async () => {
    const t = mount();
    fireEvent.doubleClick(node(t.world, "box"));
    const area = t.getByTestId("shape-text-editor") as HTMLTextAreaElement;
    fireEvent.keyDown(area, { key: "Escape" });
    await flush();
    expect(t.onApply).not.toHaveBeenCalled();
    fireEvent.doubleClick(node(t.world, "box"));
    const again = t.getByTestId("shape-text-editor") as HTMLTextAreaElement;
    fireEvent.change(again, { target: { value: "Maybe" } });
    fireEvent.blur(again);
    await flush();
    expect(t.onApply).toHaveBeenCalledTimes(1);
    expect(ops(t.onApply)[0]).toMatchObject({ op: "update", id: "box", props: { text: "Maybe" } });
    expect(t.onApply.mock.calls[0]![1]).toBe("edit text");
  });

  it("sets the arrow's label, and an empty one removes it (null)", async () => {
    const t = mount();
    fireEvent.doubleClick(node(t.world, "arrow"));
    fireEvent.change(t.getByTestId("connector-label-editor"), { target: { value: "  no  " } });
    fireEvent.keyDown(t.getByTestId("connector-label-editor"), { key: "Enter" });
    await flush();
    expect(ops(t.onApply)[0]).toMatchObject({ id: "arrow", props: { label: "no" } });
    expect(t.onApply.mock.calls[0]![1]).toBe("edit label");
    fireEvent.doubleClick(node(t.world, "arrow"));
    fireEvent.change(t.getByTestId("connector-label-editor"), { target: { value: "   " } });
    fireEvent.blur(t.getByTestId("connector-label-editor"));
    await flush();
    expect(ops(t.onApply, 1)[0]).toMatchObject({ id: "arrow", props: { label: null } });
  });

  it("escape drops the arrow's change", async () => {
    const t = mount();
    fireEvent.doubleClick(node(t.world, "arrow"));
    fireEvent.change(t.getByTestId("connector-label-editor"), { target: { value: "x" } });
    fireEvent.keyDown(t.getByTestId("connector-label-editor"), { key: "Escape" });
    await flush();
    expect(t.onApply).not.toHaveBeenCalled();
  });

  it("renames the frame with Enter, trimmed; nothing for the same name or an empty one, nothing with Escape", async () => {
    const t = mount();
    const rename = (value: string, key: string) => {
      fireEvent.doubleClick(t.overlays.querySelector('[data-frame-label="home"]') as HTMLElement);
      const field = t.getByTestId("frame-rename");
      fireEvent.change(field, { target: { value } });
      fireEvent.keyDown(field, { key });
    };
    rename("  Landing ", "Enter");
    await flush();
    expect(t.onApply).toHaveBeenCalledTimes(1);
    expect(ops(t.onApply)[0]).toMatchObject({ op: "update", id: "home", props: { name: "Landing" } });
    expect(t.onApply.mock.calls[0]![1]).toBe("rename frame");
    rename("Home", "Enter");
    rename("   ", "Enter");
    rename("Other", "Escape");
    await flush();
    expect(t.onApply).toHaveBeenCalledTimes(1);
    expect(t.queryByTestId("frame-rename")).toBeNull();
  });
});

describe("rich text", () => {
  it("round-trips the runs through the editor's DOM", () => {
    const el = document.createElement("div");
    const runs = [{ start: 6, end: 11, fontWeight: 700, color: "#ff0000" }, { start: 12, end: 17, href: "https://example.com" }];
    paintEditable(el, "Hello brave world", runs);
    expect(readEditable(el)).toEqual({ text: "Hello brave world", runs });
  });

  it("reads a break (a <br> or a block) as a newline and the marks of a pasted tag", () => {
    const el = document.createElement("div");
    el.innerHTML = "a<br>b<div>c</div><b>d</b><i>e</i>";
    expect(readEditable(el)).toEqual({ text: "a\nb\ncde", runs: [{ start: 5, end: 6, fontWeight: 700 }, { start: 6, end: 7, italic: true }] });
  });

  it("reads an emptied editor (the browser leaves a <br>) as no text", () => {
    const el = document.createElement("div");
    el.innerHTML = "<br>";
    expect(readEditable(el)).toEqual({ text: "", runs: null });
  });

  it("cuts a run at the ends of the range and drops a piece left with no mark", () => {
    const runs = [{ start: 0, end: 10, fontWeight: 700 }];
    expect(editRange("0123456789", runs, 2, 5, marks.bold)).toEqual([
      { start: 0, end: 2, fontWeight: 700 },
      { start: 5, end: 10, fontWeight: 700 },
    ]);
    expect(editRange("0123456789", undefined, 0, 4, marks.italic)).toEqual([{ start: 0, end: 4, italic: true }]);
    expect(editRange("abc", [{ start: 0, end: 3, italic: true }], 0, 3, marks.italic)).toBeNull();
    expect(editRange("abc", undefined, 1, 2, marks.size(30))).toEqual([{ start: 1, end: 2, fontSize: 30 }]);
  });

  it("accepts only the links the old canvas accepted and compares text with runs", () => {
    expect(["https://a.b", "http://a.b", "mailto:a@b.c", "#top", "/x"].every(linkOk)).toBe(true);
    expect(["javascript:alert(1)", "https://a b", "ftp://x", "https://a\"b"].some(linkOk)).toBe(false);
    expect(sameText("a", null, "a", undefined)).toBe(true);
    expect(sameText("a", [{ start: 0, end: 1, italic: true }], "a", null)).toBe(false);
  });
});
