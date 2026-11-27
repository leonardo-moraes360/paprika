import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { editorRegionIds } from "@/editor/editor";
import { stubLayout } from "@/test/canvas-fixtures";
import { nodeDelta, renderEditorRig, serveDocument } from "@/test/live-harness";
import { letRealTimersRun } from "@/test/real-settle";

/**
 * What only an overlay shows (the ghost of a creation, the pen's draft, an arrow being drawn, the area of a pin, the marquee) is
 * kept in the overlay bus, never in the canvas store, because every one of the 5 000 nodes of the page reads that store (a selector
 * each) and a write to it asks them all. Each case moves the pointer 40 times with the tool or the gesture and counts, in a page of
 * 5 000 nodes: renders of nodes, writes to the canvas store, commits of every region and messages sent. Counts are deterministic;
 * durations in jsdom are not asserted.
 */
const NODES = 5000;
const regions = [...editorRegionIds, "canvas"];

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
  const counters = world as unknown as { __paprikaNodeRenders: number; __paprikaStateWrites: number };
  return { ...view, viewport, renders: () => counters.__paprikaNodeRenders, writes: () => counters.__paprikaStateWrites, sent: () => view.rig.sockets.last.sentOf("ops") };
}
type View = Awaited<ReturnType<typeof open>>;

const key = (k: string) => fireEvent.keyDown(document.body, { key: k });
const down = (el: Element, x: number, y: number) => fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: x, clientY: y });
const drag = (from: number, steps: number, dx = 4, dy = 3) => {
  for (let i = 1; i <= steps; i++) fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: from + i * dx, clientY: from + i * dy });
};

/** The three numbers every case ends on: nothing rendered a node, nothing was written to the canvas store, nothing was sent. */
function expectQuiet(view: View, before: { renders: number; writes: number }) {
  expect(view.renders() - before.renders, "node renders").toBe(0);
  expect(view.writes() - before.writes, "writes to the canvas store").toBe(0);
  expect(view.sent(), "messages sent").toHaveLength(0);
}
const snapshot = (view: View) => ({ renders: view.renders(), writes: view.writes() });

describe("overlay-only values with 5 000 nodes", { timeout: 30_000 }, () => {
  it("the ghost of a creation tool (a rectangle dragged out)", async () => {
    const view = await open();
    key("r");
    await elapse(20);
    view.log.reset();
    const before = snapshot(view);
    down(view.viewport, 900, 100);
    expect(screen.getByTestId("draft-ghost")).toBeInTheDocument();
    drag(900, 40);
    expectQuiet(view, before);
    for (const id of regions) if (id !== "canvas") expect(view.log.commits(id), id).toBe(0);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 1060, clientY: 220 });
    await elapse(20);
    expect(view.sent()).toHaveLength(1);
    view.unmount();
  });

  it("the draft of the pen: each press adds an anchor and the pointer moving pulls a handle", async () => {
    const view = await open();
    key("p");
    await elapse(20);
    view.log.reset();
    const before = snapshot(view);
    down(view.viewport, 900, 100);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 900, clientY: 100 });
    down(view.viewport, 1000, 100);
    drag(1000, 40);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 1160, clientY: 220 });
    expect(view.viewport.querySelectorAll("[data-pen-anchor]").length).toBeGreaterThanOrEqual(2);
    expectQuiet(view, before);
    view.unmount();
  });

  it("an arrow being drawn with the connector tool", async () => {
    const view = await open();
    key("a");
    await elapse(20);
    view.log.reset();
    const before = snapshot(view);
    down(view.viewport, 900, 100);
    drag(900, 40);
    expect(screen.getByTestId("link-draft")).toBeInTheDocument();
    expectQuiet(view, before);
    // released over nothing it is an arrow that is not made only when too short; here it is long, so it is sent: the release is the one write
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 1060, clientY: 220 });
    await elapse(20);
    view.unmount();
  });

  it("the area of the pin tool being dragged", async () => {
    const view = await open();
    key("i");
    await elapse(20);
    view.log.reset();
    const before = snapshot(view);
    down(view.viewport, 900, 100);
    drag(900, 40);
    expect(screen.getByTestId("pin-drag")).toBeInTheDocument();
    expectQuiet(view, before);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 1060, clientY: 220 });
    await elapse(20);
    view.unmount();
  });

  it("the marquee over empty space", async () => {
    const view = await open();
    view.log.reset();
    const before = snapshot(view);
    // an empty spot of the page: far from any node of the synthetic document
    down(view.viewport, 5000, 5000);
    drag(5000, 40);
    expect(view.viewport.querySelector("[data-marquee]") ?? screen.queryByTestId("marquee")).not.toBeNull();
    expect(view.renders() - before.renders).toBe(0);
    expect(view.writes() - before.writes, "writes to the canvas store").toBe(0);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 5160, clientY: 5120 });
    view.unmount();
  });
});
