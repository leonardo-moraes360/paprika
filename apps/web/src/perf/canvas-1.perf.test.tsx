import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { editorRegionIds } from "@/editor/editor";
import { stubLayout } from "@/test/canvas-fixtures";
import { nodeDelta, renderEditorRig, serveDocument } from "@/test/live-harness";
import { letRealTimersRun } from "@/test/real-settle";

/**
 * Selection and transformation on a page of 5 000 nodes (plan, section 4, goals 3 and 4): what commits while a node is selected,
 * dragged, resized, turned or boxed in by the marquee, and how many `apply` calls go out (none before the pointer is released,
 * one after). Durations are jsdom's and information only; the browser's are in the report.
 */
const NODES = 5000;
const regions = [...editorRegionIds, "canvas"];
const quiet = ["header", "pages", "history", "pins", "notice", "export", "import"];

let restoreLayout: () => void;
beforeAll(() => {
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [] });
});
beforeEach(() => {
  restoreLayout = stubLayout();
});
afterEach(() => {
  restoreLayout();
  vi.useRealTimers();
});

const elapse = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

async function open() {
  const view = await renderEditorRig({ nodes: NODES });
  serveDocument(view.rig, view.doc);
  await screen.findByRole("banner");
  await screen.findByRole("tree", { name: "Layer tree" });
  await letRealTimersRun();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "requestAnimationFrame", "cancelAnimationFrame"] });
  await elapse(300);
  const doc = view.rig.client.store.state.doc!;
  view.rig.deliver(nodeDelta(doc, Object.keys(doc.nodes)[10] as string, { x: 1 }, 2));
  await elapse(300);
  view.log.reset();
  const world = screen.getByTestId("canvas-world");
  const viewport = screen.getByTestId("viewport");
  const renders = () => (world as unknown as { __paprikaNodeRenders: number }).__paprikaNodeRenders;
  const sent = () => view.rig.sockets.last.sentOf("ops");
  return { ...view, world, viewport, renders, sent };
}

type View = Awaited<ReturnType<typeof open>>;
const nodeEl = (world: HTMLElement, id: string) => world.querySelector(`[data-paprika-id="${id}"]`) as HTMLElement;
const ids = (view: View) => Object.keys(view.rig.client.store.state.doc!.nodes);
const down = (el: Element, init: PointerEventInit = {}, pointerId = 1) => fireEvent.pointerDown(el, { button: 0, pointerId, ...init });
const move = (init: PointerEventInit, pointerId = 1) => fireEvent.pointerMove(window, { pointerId, buttons: 1, ...init });
const up = (init: PointerEventInit = {}, pointerId = 1) => fireEvent.pointerUp(window, { pointerId, ...init });
const silent = (view: View, except: string[] = []) => {
  for (const region of quiet.filter((r) => !except.includes(r))) expect(view.log.commits(region), region).toBe(0);
};

describe("the canvas with 5 000 nodes: selection and transformation", { timeout: 30_000 }, () => {
  it("goal 3: Shift-click renders the node that enters and commits the canvas once", async () => {
    const view = await open();
    const [a, b] = [ids(view)[2500] as string, ids(view)[2600] as string];
    down(nodeEl(view.world, a));
    up();
    view.log.reset();
    const before = view.renders();
    down(nodeEl(view.world, b), { shiftKey: true }, 2);
    up({}, 2);
    expect(view.renders() - before).toBe(1);
    expect(nodeEl(view.world, b)).toHaveAttribute("data-selected");
    expect(nodeEl(view.world, a)).toHaveAttribute("data-selected");
    expect(view.log.commits("canvas")).toBe(1);
    silent(view);
    expect(view.sent()).toHaveLength(0);
    view.unmount();
  });

  it("goal 4: dragging one node renders only that node per pointermove; no apply until the pointer is released, then exactly one", async () => {
    const view = await open();
    const id = ids(view)[2500] as string;
    const el = nodeEl(view.world, id);
    down(el, { clientX: 10, clientY: 10 });
    up();
    down(el, { clientX: 10, clientY: 10 }, 2);
    view.log.reset();
    const before = view.renders();
    const MOVES = 30;
    for (let i = 1; i <= MOVES; i++) {
      const renders = view.renders();
      move({ clientX: 10 + i * 3, clientY: 10 + i }, 2);
      expect(view.renders() - renders, `move ${i}`).toBe(1);
    }
    expect(view.renders() - before).toBe(MOVES);
    expect(el.style.left).not.toBe("");
    // one commit of the canvas per move (the dragged node and the overlays), nothing anywhere else
    expect(view.log.commits("canvas")).toBeLessThanOrEqual(MOVES);
    silent(view);
    expect(view.log.commits("layers")).toBe(0);
    expect(view.sent()).toHaveLength(0);
    process.stderr.write(`[perf canvas-1 jsdom] drag 1 of ${NODES}: ${MOVES} moves, canvas commits ${view.log.commits("canvas")}, node renders ${view.renders() - before}, canvas actualDuration ${(view.log.stats().canvas?.actualDuration ?? 0).toFixed(1)}ms\n`);
    up({}, 2);
    expect(view.sent()).toHaveLength(1);
    expect(view.sent()[0]!.ops).toHaveLength(1);
    // the echo takes the preview over: the node renders once more, with the document's values
    const doc = view.rig.client.store.state.doc!;
    const reqId = view.rig.sockets.last.lastReqId("ops");
    view.rig.deliver(nodeDelta(doc, id, { x: 100, y: 30 }, 3));
    act(() => view.rig.sockets.last.ack(reqId, 3));
    await elapse(50);
    expect(el.style.left).toBe("100px");
    expect(view.sent()).toHaveLength(1);
    view.unmount();
  });

  it("goal 4: a refused move puts the node back and sends nothing more", async () => {
    const view = await open();
    const id = ids(view)[2500] as string;
    const el = nodeEl(view.world, id);
    const left = el.style.left;
    down(el, { clientX: 10, clientY: 10 });
    move({ clientX: 80, clientY: 10 });
    up();
    expect(el.style.left).not.toBe(left);
    const socket = view.rig.sockets.last;
    act(() => socket.receive({ type: "error", reqId: socket.lastReqId("ops") as string, message: "nope" } as never));
    await elapse(50);
    expect(el.style.left).toBe(left);
    view.unmount();
  });

  it("goal 4: resizing and turning render only the node per move, and send one apply each", async () => {
    const view = await open();
    const id = ids(view)[2500] as string;
    down(nodeEl(view.world, id));
    up();
    const handle = view.world.ownerDocument.querySelector<HTMLElement>('[data-handle="se"]') as HTMLElement;
    view.log.reset();
    let before = view.renders();
    down(handle, { clientX: 0, clientY: 0 }, 2);
    for (let i = 1; i <= 10; i++) move({ clientX: i * 2, clientY: i }, 2);
    expect(view.renders() - before).toBe(10);
    expect(view.sent()).toHaveLength(0);
    silent(view);
    up({}, 2);
    expect(view.sent()).toHaveLength(1);
    const knob = view.world.ownerDocument.querySelector<HTMLElement>("[data-rotate-handle]") as HTMLElement;
    before = view.renders();
    down(knob, { clientX: 0, clientY: -50 }, 3);
    for (let i = 1; i <= 10; i++) move({ clientX: i * 5, clientY: -50 + i }, 3);
    expect(view.renders() - before).toBe(10);
    up({}, 3);
    expect(view.sent()).toHaveLength(2);
    view.unmount();
  });

  it("the marquee over the page renders only the nodes that enter the selection, and sends nothing", async () => {
    const view = await open();
    const roots = view.rig.client.store.state.doc!.nodes["page-0"] as unknown as { children: string[] };
    const before = view.renders();
    down(view.viewport, { clientX: 5, clientY: 5 });
    view.log.reset();
    for (let i = 1; i <= 10; i++) move({ clientX: 5 + i * 40, clientY: 5 + i * 30 });
    const selected = view.world.querySelectorAll("[data-selected]").length;
    expect(selected).toBeGreaterThan(0);
    expect(selected).toBeLessThanOrEqual(roots.children.length);
    expect(view.renders() - before).toBe(selected);
    silent(view, ["layers"]);
    up();
    expect(view.sent()).toHaveLength(0);
    process.stderr.write(`[perf canvas-1 jsdom] marquee over ${roots.children.length} top-level nodes: selected ${selected}, canvas commits ${view.log.commits("canvas")}\n`);
    view.unmount();
  });

  it("hover still works, and costs one node, after a drag", async () => {
    const view = await open();
    const [a, b] = [ids(view)[2500] as string, ids(view)[2600] as string];
    down(nodeEl(view.world, a), { clientX: 10, clientY: 10 });
    move({ clientX: 50, clientY: 10 });
    up();
    view.log.reset();
    const before = view.renders();
    fireEvent.pointerMove(nodeEl(view.world, b), { buttons: 0 });
    expect(nodeEl(view.world, b)).toHaveAttribute("data-hovered");
    expect(view.renders() - before).toBeLessThanOrEqual(2);
    view.unmount();
  });

  it("Enter goes through the editor shortcuts and renders only the nodes that enter the selection", async () => {
    const view = await open();
    const frame = "frame-0-0";
    act(() => void view.rig.client.store.state);
    down(nodeEl(view.world, frame));
    up();
    view.log.reset();
    const before = view.renders();
    fireEvent.keyDown(view.viewport, { key: "Enter" });
    expect(view.sent()).toHaveLength(0);
    expect(view.world.querySelectorAll("[data-selected]").length).toBe(50);
    expect(view.renders() - before).toBe(51);
    view.unmount();
  });
});
