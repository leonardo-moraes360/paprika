import { applyOps, type Document, type Op } from "@paprika/core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { everyKindDocument, stubLayout, testDefaults } from "@/test/canvas-fixtures";
import { Canvas, createCanvasFeed } from "./index";
import { boxCorner } from "./transform";

/** Selection and transformation: clicks, marquee, move, reparent and reorder, resize, rotate, double click and the layers menu. */

let restore: () => void;
let under: Element[] = [];
beforeEach(() => {
  restore = stubLayout();
  under = [];
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => under });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
});
afterEach(() => {
  restore();
  vi.useRealTimers();
});

/** The fixture plus a frame without auto layout to drop things into. */
function documentWithPad(): Document {
  const ops: Op[] = [{ op: "create", parentId: "page", node: { type: "frame", id: "pad", name: "Pad", x: 700, y: 400, width: 300, height: 300, fill: "#eeeeee" } }];
  return applyOps(everyKindDocument(), ops).doc;
}

function mount(doc: Document = everyKindDocument(), extra: Partial<Parameters<typeof createCanvasFeed>[0]> = {}, apply: (ops: Op[], label: string) => Promise<boolean> = () => Promise.resolve(true)) {
  const feed = createCanvasFeed({ doc, pageId: "page", ...extra });
  const onSelect = vi.fn((ids: readonly string[]) => feed.update({ selection: ids }));
  const onApply = vi.fn(apply);
  const onConvertToPath = vi.fn();
  const onCenterContent = vi.fn();
  const view = render(<Canvas feed={feed} defaults={testDefaults} onSelect={onSelect} onHover={(id) => feed.update({ hoveredId: id })} onApply={onApply} onConvertToPath={onConvertToPath} onCenterContent={onCenterContent} />);
  return { ...view, feed, onSelect, onApply, onConvertToPath, onCenterContent, viewport: view.getByTestId("viewport"), world: view.getByTestId("canvas-world"), overlays: view.getByTestId("canvas-overlays") };
}

const node = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-paprika-id="${id}"]`) as HTMLElement;
const centre = (el: HTMLElement) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};
const down = (el: Element, init: PointerEventInit = {}, pointerId = 1) => fireEvent.pointerDown(el, { button: 0, pointerId, ...init });
const move = (init: PointerEventInit, pointerId = 1) => fireEvent.pointerMove(window, { pointerId, buttons: 1, ...init });
const up = (init: PointerEventInit = {}, pointerId = 1) => fireEvent.pointerUp(window, { pointerId, ...init });
const flush = async () => act(async () => void (await vi.advanceTimersByTimeAsync(20)));

describe("clicks", () => {
  it("Shift and Cmd toggle a node in the selection", () => {
    const { world, onSelect } = mount(everyKindDocument(), { selection: ["btn"] });
    down(node(world, "box"), { shiftKey: true });
    up();
    expect(onSelect).toHaveBeenLastCalledWith(["btn", "box"]);
    down(node(world, "btn"), { metaKey: true }, 2);
    up({}, 2);
    expect(onSelect).toHaveBeenLastCalledWith(["box"]);
  });

  it("a click on a child of a group selects the group; Ctrl selects the child itself", () => {
    const { world, onSelect } = mount();
    down(node(world, "dot"));
    up();
    expect(onSelect).toHaveBeenLastCalledWith(["pair"]);
    down(node(world, "dot"), { ctrlKey: true }, 2);
    up({}, 2);
    expect(onSelect).toHaveBeenLastCalledWith(["dot"]);
  });

  it("a click on a node that is the whole selection does nothing", () => {
    const { world, onSelect } = mount(everyKindDocument(), { selection: ["btn"] });
    down(node(world, "btn"));
    up();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("a double click selects the node under the pointer, however deep", () => {
    const { world, onSelect, viewport } = mount();
    fireEvent.doubleClick(node(world, "dot"));
    expect(onSelect).toHaveBeenLastCalledWith(["dot"]);
    onSelect.mockClear();
    fireEvent.doubleClick(viewport);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("hover works again after a gesture", () => {
    const { world, viewport, feed } = mount();
    down(node(world, "btn"));
    move({ clientX: 500, clientY: 500 });
    up();
    fireEvent.pointerMove(node(world, "box"), { buttons: 0 });
    expect(feed.get().hoveredId).toBe("box");
    fireEvent.pointerLeave(viewport);
  });
});

describe("the marquee", () => {
  const area = (from: { x: number; y: number }, to: { x: number; y: number }, init: PointerEventInit = {}) => {
    return { from, to, init };
  };
  it("selects the top-level nodes it touches, from the 3rd px of travel, and shows the box meanwhile", () => {
    const { world, viewport, onSelect, overlays } = mount(everyKindDocument(), { selection: ["btn"] });
    const btn = node(world, "btn").getBoundingClientRect();
    const { from, to } = area({ x: btn.left - 20, y: btn.top - 20 }, { x: btn.left + 30, y: btn.top + 20 });
    down(viewport, { clientX: from.x, clientY: from.y });
    expect(onSelect).toHaveBeenLastCalledWith([]);
    onSelect.mockClear();
    move({ clientX: from.x + 2, clientY: from.y });
    expect(onSelect).not.toHaveBeenCalled();
    expect(within(overlays).queryByTestId("marquee")).toBeNull();
    move({ clientX: to.x, clientY: to.y });
    expect(onSelect).toHaveBeenLastCalledWith(["btn"]);
    expect(within(overlays).getByTestId("marquee")).toBeInTheDocument();
    up();
    expect(within(overlays).queryByTestId("marquee")).toBeNull();
  });

  it("Shift adds to the selection and keeps it when nothing is dragged", () => {
    const { world, viewport, onSelect } = mount(everyKindDocument(), { selection: ["box"] });
    const btn = node(world, "btn").getBoundingClientRect();
    down(viewport, { clientX: btn.left - 10, clientY: btn.top - 10, shiftKey: true });
    up();
    expect(onSelect).not.toHaveBeenCalled();
    down(viewport, { clientX: btn.left - 10, clientY: btn.top - 10, shiftKey: true }, 2);
    move({ clientX: btn.left + 20, clientY: btn.top + 20, shiftKey: true }, 2);
    expect(onSelect).toHaveBeenLastCalledWith(["box", "btn"]);
    up({}, 2);
  });
});

describe("move", () => {
  it("does nothing under 3 px; past it the node shows at the new place and ONE update goes out on release", async () => {
    const { world, onApply } = mount();
    const btn = node(world, "btn");
    const at = centre(btn);
    down(btn, { clientX: at.x, clientY: at.y });
    move({ clientX: at.x + 2, clientY: at.y });
    up();
    expect(onApply).not.toHaveBeenCalled();
    down(btn, { clientX: at.x, clientY: at.y }, 2);
    move({ clientX: at.x + 40, clientY: at.y + 10 }, 2);
    expect(btn.style.left).toBe("140px");
    expect(btn.style.top).toBe("510px");
    expect(btn.style.pointerEvents).toBe("none");
    expect(onApply).not.toHaveBeenCalled();
    move({ clientX: at.x + 60, clientY: at.y + 10 }, 2);
    up({}, 2);
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "btn", props: { x: 160, y: 510 } }], "move");
    await flush();
  });

  it("moves the whole selection and says so in the label", () => {
    const { world, onApply } = mount(everyKindDocument(), { selection: ["btn", "box"] });
    const btn = node(world, "btn");
    const at = centre(btn);
    down(btn, { clientX: at.x, clientY: at.y });
    move({ clientX: at.x + 10, clientY: at.y });
    up();
    expect(onApply.mock.calls[0]![0]).toHaveLength(2);
    expect(onApply.mock.calls[0]![1]).toBe("move 2 nodes");
  });

  it("a press on a node selects it first; on a group's child, the group", () => {
    const { world, onSelect } = mount();
    down(node(world, "btn"));
    expect(onSelect).toHaveBeenLastCalledWith(["btn"]);
    up();
  });

  it("a locked node and a connector select but do not move", () => {
    const { world, onApply } = mount();
    down(node(world, "arrow"), { clientX: 10, clientY: 10 });
    move({ clientX: 80, clientY: 80 });
    up();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("puts the node back when the server did not take the ops", async () => {
    const { world, onApply } = mount(everyKindDocument(), {}, () => Promise.resolve(false));
    const btn = node(world, "btn");
    const at = centre(btn);
    down(btn, { clientX: at.x, clientY: at.y });
    move({ clientX: at.x + 40, clientY: at.y });
    up();
    expect(btn.style.left).toBe("140px");
    await flush();
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(btn.style.left).toBe("100px");
  });

  it("under StrictMode (the cleanup of the mount runs once and the setup again) a refused move still puts the node back", async () => {
    const feed = createCanvasFeed({ doc: everyKindDocument(), pageId: "page" });
    const onApply = vi.fn(() => Promise.resolve(false));
    const view = render(
      <StrictMode>
        <Canvas feed={feed} defaults={testDefaults} onSelect={(ids) => feed.update({ selection: ids })} onApply={onApply} />
      </StrictMode>,
    );
    const btn = node(view.getByTestId("canvas-world"), "btn");
    const at = centre(btn);
    down(btn, { clientX: at.x, clientY: at.y });
    move({ clientX: at.x + 40, clientY: at.y });
    up();
    expect(btn.style.left).toBe("140px");
    await flush();
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(btn.style.left).toBe("100px");
  });

  it("dropped into a frame without layout it is reparented, keeping the place under the pointer", () => {
    const doc = documentWithPad();
    const { world, onApply, overlays } = mount(doc);
    const btn = node(world, "btn");
    const pad = node(world, "pad");
    const at = centre(btn);
    const target = centre(pad);
    under = [pad];
    down(btn, { clientX: at.x, clientY: at.y });
    move({ clientX: target.x, clientY: target.y });
    expect(within(overlays).getByTestId("drop-target")).toBeInTheDocument();
    up({ clientX: target.x, clientY: target.y });
    const ops = onApply.mock.calls[0]![0] as Op[];
    expect(ops[0]).toEqual({ op: "move", id: "btn", parentId: "pad" });
    // the node is centred on the pointer, in the frame's own space (the frame is 300 x 300, the node 120 x 40)
    expect(ops[1]).toEqual({ op: "update", id: "btn", props: { x: 90, y: 130 } });
    expect(onApply.mock.calls[0]![1]).toBe("reparent");
    expect(within(overlays).queryByTestId("drop-target")).toBeNull();
  });

  it("flow children, several, dropped into a frame with no flow are a reparent (as the old canvas labelled it), with no preview to show", () => {
    const { world, onApply } = mount(documentWithPad(), { selection: ["title", "plain"] });
    const title = node(world, "title");
    const pad = node(world, "pad");
    const at = centre(title);
    const target = centre(pad);
    under = [pad];
    down(title, { clientX: at.x, clientY: at.y });
    move({ clientX: target.x, clientY: target.y });
    up({ clientX: target.x, clientY: target.y });
    expect((onApply.mock.calls[0]![0] as Op[]).filter((o) => o.op === "move").map((o) => (o as { id: string }).id)).toEqual(["title", "plain"]);
    expect(onApply.mock.calls[0]![1]).toBe("reparent");
  });

  it("dropped over an auto-layout frame it goes to a slot of the flow, with the bar shown; no preview, one `move` with an index", () => {
    const { world, onApply, overlays } = mount();
    const btn = node(world, "btn");
    const home = node(world, "home");
    const at = centre(btn);
    const target = centre(home);
    under = [node(world, "title"), home];
    down(btn, { clientX: at.x, clientY: at.y });
    move({ clientX: target.x, clientY: target.y });
    expect(within(overlays).getByTestId("drop-target")).toBeInTheDocument();
    expect(within(overlays).getByTestId("drop-marker")).toBeInTheDocument();
    up({ clientX: target.x, clientY: target.y });
    expect(onApply).toHaveBeenCalledTimes(1);
    const [ops, label] = onApply.mock.calls[0]!;
    expect(ops).toEqual([{ op: "move", id: "btn", parentId: "home", index: expect.any(Number) }]);
    expect(label).toBe("reparent");
  });

  it("reordering inside the same flow is a reorder", () => {
    const { world, onApply } = mount();
    const title = node(world, "title");
    const home = node(world, "home");
    const at = centre(title);
    under = [home];
    down(title, { clientX: at.x, clientY: at.y });
    move({ clientX: at.x + 5, clientY: at.y + 60 });
    up({ clientX: at.x + 5, clientY: at.y + 60 });
    expect(onApply.mock.calls[0]![1]).toBe("reorder");
    expect(onApply.mock.calls[0]![0]).toEqual([{ op: "move", id: "title", parentId: "home", index: expect.any(Number) }]);
  });

  it("cancelling the pointer leaves nothing behind", () => {
    const { world, onApply, overlays } = mount();
    const btn = node(world, "btn");
    const at = centre(btn);
    down(btn, { clientX: at.x, clientY: at.y });
    move({ clientX: at.x + 40, clientY: at.y });
    fireEvent.pointerCancel(window, { pointerId: 1 });
    expect(btn.style.left).toBe("100px");
    expect(onApply).not.toHaveBeenCalled();
    expect(within(overlays).queryByTestId("drop-target")).toBeNull();
  });
});

describe("handles, size and resize", () => {
  const handle = (overlays: HTMLElement, corner: string) => overlays.querySelector<HTMLElement>(`[data-handle="${corner}"]`) as HTMLElement;

  it("a selected box gets four corners, the turning knob and its size; a group or several get the size only", () => {
    const { overlays, feed } = mount(everyKindDocument(), { selection: ["btn"] });
    expect(["nw", "ne", "sw", "se"].map((c) => handle(overlays, c))).not.toContain(null);
    expect(overlays.querySelector("[data-rotate-handle]")).not.toBeNull();
    expect(within(overlays).getByLabelText("Selection size")).toHaveTextContent("120 × 40");
    act(() => feed.update({ selection: ["btn", "box"] }));
    expect(overlays.querySelector("[data-handle]")).toBeNull();
    expect(within(overlays).getByLabelText("Selection size")).toBeInTheDocument();
    act(() => feed.update({ selection: ["pair"] }));
    expect(overlays.querySelector("[data-handle]")).toBeNull();
  });

  it("dragging the south east corner keeps the north west one and sends one update on release", () => {
    const { overlays, world, onApply } = mount(everyKindDocument(), { selection: ["btn"] });
    const se = handle(overlays, "se");
    down(se, { clientX: 500, clientY: 500 });
    move({ clientX: 530, clientY: 510 });
    expect(node(world, "btn").style.width).toBe("150px");
    expect(node(world, "btn").style.height).toBe("50px");
    expect(onApply).not.toHaveBeenCalled();
    expect(within(overlays).getByLabelText("Selection size")).toHaveTextContent("150 × 50");
    up();
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "btn", props: { x: 100, y: 500, width: 150, height: 50 } }], "resize");
  });

  it("Shift keeps the proportion and shows the hint; Shift+Alt makes it 1:1", () => {
    const { overlays, onApply } = mount(everyKindDocument(), { selection: ["btn"] });
    down(handle(overlays, "se"), { clientX: 0, clientY: 0 });
    move({ clientX: 60, clientY: 0, shiftKey: true });
    expect(within(overlays).getByTestId("resize-lock-hint")).toHaveAttribute("data-lock", "ratio");
    expect(within(overlays).getByTestId("resize-lock-hint")).toHaveTextContent("Aspect · Shift");
    move({ clientX: 60, clientY: 0, shiftKey: true, altKey: true });
    expect(within(overlays).getByTestId("resize-lock-hint")).toHaveAttribute("data-lock", "square");
    up();
    expect(within(overlays).queryByTestId("resize-lock-hint")).toBeNull();
    expect(onApply.mock.calls[0]![0]).toEqual([{ op: "update", id: "btn", props: { x: 100, y: 500, width: 180, height: 180 } }]);
  });

  it("the opposite corner stays: dragging north west moves the origin", () => {
    const { overlays, onApply } = mount(everyKindDocument(), { selection: ["btn"] });
    down(handle(overlays, "nw"), { clientX: 100, clientY: 500 });
    move({ clientX: 120, clientY: 510 });
    up();
    expect(onApply.mock.calls[0]![0]).toEqual([{ op: "update", id: "btn", props: { x: 120, y: 510, width: 100, height: 30 } }]);
  });

  it("a press on a handle that does not move changes nothing; it does not clear the selection either", () => {
    const { overlays, onApply, onSelect } = mount(everyKindDocument(), { selection: ["btn"] });
    down(handle(overlays, "se"), { clientX: 5, clientY: 5 });
    up();
    expect(onApply).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("a turned node is resized along its own axes", () => {
    const doc = applyOps(everyKindDocument(), [{ op: "update", id: "btn", props: { rotation: 90 } }]).doc;
    const { overlays, world, onApply } = mount(doc, { selection: ["btn"] });
    // turned 90 degrees (clockwise), its east side faces down: dragging the se corner down by 20 widens it by 20, the nw corner stays
    const origin = node(world, "btn").getBoundingClientRect();
    const toClient = (p: { x: number; y: number }) => ({ clientX: origin.left + p.x - 100, clientY: origin.top + p.y - 500 });
    const se = boxCorner(100, 500, 120, 40, 90, "se");
    down(handle(overlays, "se"), toClient(se));
    move(toClient({ x: se.x, y: se.y + 20 }));
    up();
    const props = (onApply.mock.calls[0]![0] as unknown as { props: { width: number; height: number; x: number; y: number } }[])[0]!.props;
    expect(props.width).toBe(140);
    expect(props.height).toBe(40);
    const nw = boxCorner(100, 500, 120, 40, 90, "nw");
    const after = boxCorner(props.x, props.y, props.width, props.height, 90, "nw");
    expect(Math.abs(after.x - nw.x) + Math.abs(after.y - nw.y)).toBeLessThan(1.5);
  });
});

describe("rotate", () => {
  const knob = (overlays: HTMLElement) => overlays.querySelector<HTMLElement>("[data-rotate-handle]") as HTMLElement;
  // btn: 120 x 40 at (100, 500): centre (160, 520) in the world; the camera of the fixture fits it, so the pointer is in client px.
  it("turns around the centre following the pointer: a quarter turn", () => {
    const { overlays, world, onApply } = mount(everyKindDocument(), { selection: ["btn"] });
    const c = centre(node(world, "btn"));
    down(knob(overlays), { clientX: c.x, clientY: c.y - 50 });
    move({ clientX: c.x + 50, clientY: c.y });
    expect(node(world, "btn").style.transform).toBe("rotate(90deg)");
    expect(onApply).not.toHaveBeenCalled();
    up();
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "btn", props: { rotation: 90 } }], "rotate");
  });

  it("the outline and the handles turn with the node while the knob is dragged, not only after the release", () => {
    const { overlays, world } = mount(everyKindDocument(), { selection: ["btn"] });
    const c = centre(node(world, "btn"));
    const outline = () => overlays.querySelector<HTMLElement>("[data-selection-box='btn']") as HTMLElement;
    const turned = () => overlays.querySelector<HTMLElement>("[data-selection-handles] > div") as HTMLElement;
    expect(outline().style.transform).toBe("");
    down(knob(overlays), { clientX: c.x, clientY: c.y - 50 });
    move({ clientX: c.x + 50, clientY: c.y });
    expect(node(world, "btn").style.transform).toBe("rotate(90deg)");
    expect(outline().style.transform).toBe("rotate(90deg)");
    expect(turned().style.transform).toContain("rotate(90deg)");
    move({ clientX: c.x, clientY: c.y + 50 });
    expect(outline().style.transform).toBe("rotate(180deg)");
    expect(turned().style.transform).toContain("rotate(180deg)");
    fireEvent.pointerCancel(window, { pointerId: 1 });
    expect(outline().style.transform).toBe("");
  });

  it("Shift snaps to 15 degrees, also when the key goes down while the pointer rests", () => {
    const { overlays, world, onApply } = mount(everyKindDocument(), { selection: ["btn"] });
    const c = centre(node(world, "btn"));
    down(knob(overlays), { clientX: c.x, clientY: c.y - 50 });
    move({ clientX: c.x + 50, clientY: c.y - 40 });
    expect(node(world, "btn").style.transform).not.toBe("rotate(45deg)");
    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
    expect(node(world, "btn").style.transform).toBe("rotate(45deg)");
    up();
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "btn", props: { rotation: 45 } }], "rotate");
  });
});

describe("the layers menu", () => {
  // `findBy*` and the user-event clicks wait on real timers.
  beforeEach(() => vi.useRealTimers());
  const user = () => userEvent.setup();
  it("opens on the right button with the layers under the pointer; picking one selects it", async () => {
    const { world, onSelect, viewport } = mount();
    under = [node(world, "dot"), node(world, "pair"), node(world, "home")];
    fireEvent.contextMenu(viewport, { clientX: 10, clientY: 10 });
    const menu = await screen.findByRole("menu", { name: "Layers under the cursor" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(expect.arrayContaining(["Dot", "Pair", "Home"]));
    await user().click(within(menu).getByText("Pair"));
    expect(onSelect).toHaveBeenLastCalledWith(["pair"]);
  });

  it("offers convert to path for a rectangle or an ellipse, and centre content for a frame", async () => {
    const { world, onConvertToPath, viewport } = mount();
    under = [node(world, "dot"), node(world, "home")];
    fireEvent.contextMenu(viewport, { clientX: 10, clientY: 10 });
    const menu = await screen.findByRole("menu");
    const center = within(menu).getByRole("menuitemcheckbox", { name: /Center content/ });
    expect(center).toBeInTheDocument();
    // the key of the editor's "centre content", as the old menu showed it (Alt and C, one chip each)
    expect(center).toHaveAttribute("aria-keyshortcuts", "Alt+C");
    expect([...center.querySelectorAll("kbd")].map((k) => k.textContent)).toHaveLength(2);
    await user().click(within(menu).getByRole("menuitem", { name: "Convert to path" }));
    expect(onConvertToPath).toHaveBeenCalledWith(["dot"]);
  });

  it("clicking centre content in the menu centres the layers it was opened on, once", async () => {
    const { world, onCenterContent, viewport } = mount();
    under = [node(world, "home")];
    fireEvent.contextMenu(viewport, { clientX: 10, clientY: 10 });
    const menu = await screen.findByRole("menu");
    await user().click(within(menu).getByRole("menuitemcheckbox", { name: /Center content/ }));
    expect(onCenterContent).toHaveBeenCalledTimes(1);
    expect(onCenterContent).toHaveBeenCalledWith(["home"]);
    // a command, not a setting: the menu closes, so the editor's keys (Ctrl+Z) reach the page again
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("does nothing over empty space or with another tool", () => {
    const { viewport, feed } = mount();
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    viewport.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    act(() => feed.update({ tool: "rect" }));
    under = [];
    fireEvent.contextMenu(viewport);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
