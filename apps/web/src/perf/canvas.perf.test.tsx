import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { editorRegionIds } from "@/editor/editor";
import { stubLayout } from "@/test/canvas-fixtures";
import { nodeDelta, renderEditorRig, serveDocument } from "@/test/live-harness";

/**
 * The canvas with a document of 5 000 nodes on one page (plan, section 4, goals 1, 2, 3 and 6). Counts commits per region and
 * renders per node; durations are jsdom's and information only (the browser's are in the report).
 */
const NODES = 5000;
const regions = [...editorRegionIds, "canvas"];

let restoreLayout: () => void;
beforeAll(() => {
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
});
beforeEach(() => {
  restoreLayout = stubLayout();
});
afterEach(() => {
  restoreLayout();
  vi.useRealTimers();
});

/** Time is the test's once the editor is on screen: timers, frames and `Date` are faked. */
const elapse = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

async function open() {
  const started = performance.now();
  const view = await renderEditorRig({ nodes: NODES });
  serveDocument(view.rig, view.doc);
  await screen.findByRole("banner");
  await screen.findByRole("tree", { name: "Layer tree" });
  const opened = performance.now() - started;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "requestAnimationFrame", "cancelAnimationFrame"] });
  await elapse(300);
  // The first edit flips "can undo" (the toolbar): settle it so the numbers below are about the action itself.
  const doc = view.rig.client.store.state.doc!;
  view.rig.deliver(nodeDelta(doc, Object.keys(doc.nodes)[10] as string, { x: 1 }, 2));
  await elapse(300);
  view.log.reset();
  const world = screen.getByTestId("canvas-world");
  const viewport = screen.getByTestId("canvas-viewport");
  const renders = () => (world as unknown as { __paprikaNodeRenders: number }).__paprikaNodeRenders;
  return { ...view, world, viewport, renders, opened };
}

const commitsOf = (view: Awaited<ReturnType<typeof open>>) => Object.fromEntries(regions.map((id) => [id, view.log.commits(id)]));
const nodeEl = (world: HTMLElement, id: string) => world.querySelector(`[data-paprika-id="${id}"]`) as HTMLElement;

describe("the canvas with 5 000 nodes", () => {
  it("opens the whole page, every node in the DOM", async () => {
    const view = await open();
    expect(view.world.querySelectorAll("[data-paprika-id]")).toHaveLength(NODES - 1);
    process.stderr.write(`[perf canvas jsdom] open ${NODES} nodes: ${view.opened.toFixed(0)}ms to the layers\n`);
    view.unmount();
  });

  it("goal 1: panning commits nothing in any region and renders no node", async () => {
    const view = await open();
    const rendersBefore = view.renders();
    for (let i = 0; i < 60; i++) {
      fireEvent.wheel(view.viewport, { deltaX: 3, deltaY: 5 });
      await elapse(16);
    }
    await elapse(300);
    expect(view.renders() - rendersBefore).toBe(0);
    expect(commitsOf(view)).toEqual(Object.fromEntries(regions.map((id) => [id, 0])));
    view.unmount();
  });

  it("goal 1: zooming commits nothing and renders no node while it moves; at rest the zoom bar's percentage is the only commit (the stage)", async () => {
    const view = await open();
    const rendersBefore = view.renders();
    for (let i = 0; i < 30; i++) {
      fireEvent.wheel(view.viewport, { deltaY: -40, ctrlKey: true, clientX: 400, clientY: 300 });
      await elapse(16);
    }
    expect(commitsOf(view)).toEqual(Object.fromEntries(regions.map((id) => [id, 0])));
    await elapse(300);
    expect(view.renders() - rendersBefore).toBe(0);
    expect(commitsOf(view)).toEqual({ ...Object.fromEntries(regions.map((id) => [id, 0])), stage: 1 });
    expect(screen.getByText(/^\d+%$/)).toBeInTheDocument();
    view.unmount();
  });

  it("goal 2: a delta on ONE node renders that node and commits the canvas once; nothing else is rendered", async () => {
    const view = await open();
    const doc = view.rig.client.store.state.doc!;
    const id = Object.keys(doc.nodes)[2500] as string;
    const before = view.renders();
    view.rig.deliver(nodeDelta(doc, id, { x: 321 }, 3));
    expect(view.renders() - before).toBe(1);
    expect(nodeEl(view.world, id).style.left).toBe("321px");
    expect(view.log.commits("canvas")).toBe(1);
    for (const region of ["header", "pages", "layers", "history", "pins", "notice", "export", "import"]) expect(view.log.commits(region), region).toBe(0);
    view.unmount();
  });

  it("goal 2: a burst of 200 deltas in one frame is one commit of the canvas, and 200 nodes render once each", async () => {
    const view = await open();
    const doc = view.rig.client.store.state.doc!;
    const keys = Object.keys(doc.nodes);
    const before = view.renders();
    view.rig.deliver(...Array.from({ length: 200 }, (_, i) => nodeDelta(doc, keys[100 + i] as string, { x: 1000 + i }, 3 + i)));
    expect(view.renders() - before).toBe(200);
    expect(view.log.commits("canvas")).toBe(1);
    expect(view.log.commits("layers")).toBe(0);
    view.unmount();
  });

  it("goal 2: a delta that changes only the document's name renders no node", async () => {
    const view = await open();
    const doc = view.rig.client.store.state.doc!;
    const before = view.renders();
    view.rig.deliver({ ...nodeDelta(doc, Object.keys(doc.nodes)[1] as string, {}, 3), nodes: undefined, name: "Renamed" });
    expect(view.renders() - before).toBe(0);
    view.unmount();
  });

  it("goal 3: selecting renders the node that enters and the one that leaves, commits the canvas once, and not the layers more than the panel itself asks", async () => {
    const view = await open();
    const keys = Object.keys(view.rig.client.store.state.doc!.nodes);
    const [a, b] = [keys[2500] as string, keys[2600] as string];
    let before = view.renders();
    fireEvent.pointerDown(nodeEl(view.world, a), { button: 0, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(view.renders() - before).toBe(1);
    expect(nodeEl(view.world, a)).toHaveAttribute("data-selected");
    expect(view.log.commits("canvas")).toBe(1);
    view.log.reset();
    before = view.renders();
    fireEvent.pointerDown(nodeEl(view.world, b), { button: 0, pointerId: 2 });
    fireEvent.pointerUp(window, { pointerId: 2 });
    expect(view.renders() - before).toBe(2);
    expect(view.log.commits("canvas")).toBe(1);
    for (const region of ["header", "pages", "history", "pins", "notice", "export", "import"]) expect(view.log.commits(region), region).toBe(0);
    view.log.reset();
    // clearing the selection renders the one that leaves
    before = view.renders();
    fireEvent.pointerDown(view.viewport, { button: 0, pointerId: 3 });
    expect(view.renders() - before).toBe(1);
    view.unmount();
  });

  it("goal 6: hovering a node renders only that node (and the one that was hovered), the canvas commits once, no other region", async () => {
    const view = await open();
    const keys = Object.keys(view.rig.client.store.state.doc!.nodes);
    const [a, b] = [keys[2500] as string, keys[2600] as string];
    let before = view.renders();
    fireEvent.pointerMove(nodeEl(view.world, a));
    expect(view.renders() - before).toBe(1);
    expect(nodeEl(view.world, a)).toHaveAttribute("data-hovered");
    expect(commitsOf(view)).toEqual({ ...Object.fromEntries(regions.map((id) => [id, 0])), canvas: 1 });
    view.log.reset();
    before = view.renders();
    fireEvent.pointerMove(nodeEl(view.world, b));
    expect(view.renders() - before).toBe(2);
    // moving inside the same node does nothing
    view.log.reset();
    fireEvent.pointerMove(nodeEl(view.world, b), { clientX: 5 });
    expect(commitsOf(view)).toEqual(Object.fromEntries(regions.map((id) => [id, 0])));
    view.unmount();
  });
});
