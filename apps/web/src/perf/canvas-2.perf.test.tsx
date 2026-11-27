import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { editorRegionIds } from "@/editor/editor";
import { stubLayout } from "@/test/canvas-fixtures";
import { nodeDelta, renderEditorRig, serveDocument } from "@/test/live-harness";

/**
 * Creation and text editing on a page of 5 000 nodes (plan, section 4, goal 4 for the creation gesture; the editors are the
 * lot's own). Counts commits per region, renders per node and the messages the server gets; durations are jsdom's.
 */
const NODES = 5000;
const regions = [...editorRegionIds, "canvas"];
const none = Object.fromEntries(regions.map((id) => [id, 0]));

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

const elapse = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

async function open() {
  const view = await renderEditorRig({ nodes: NODES });
  serveDocument(view.rig, view.doc);
  await screen.findByRole("banner");
  await screen.findByRole("tree", { name: "Layer tree" });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "requestAnimationFrame", "cancelAnimationFrame"] });
  await elapse(300);
  const doc = view.rig.client.store.state.doc!;
  view.rig.deliver(nodeDelta(doc, Object.keys(doc.nodes)[10] as string, { x: 1 }, 2));
  await elapse(300);
  view.log.reset();
  const world = screen.getByTestId("canvas-world");
  const viewport = screen.getByTestId("canvas-viewport");
  const renders = () => (world as unknown as { __paprikaNodeRenders: number }).__paprikaNodeRenders;
  const commits = () => Object.fromEntries(regions.map((id) => [id, view.log.commits(id)]));
  const sent = () => view.socket.sentOf("ops");
  return { ...view, world, viewport, renders, commits, sent };
}

describe("creation on 5 000 nodes", () => {
  it("moving the pointer renders no node and commits no region but the canvas; nothing is sent until release, then ONE apply", async () => {
    const view = await open();
    fireEvent.keyDown(document.body, { key: "r" });
    await elapse(20);
    expect(screen.getByTestId("canvas-viewport").dataset.tool).toBe("rect");
    view.log.reset();
    const rendersBefore = view.renders();
    fireEvent.pointerDown(view.viewport, { button: 0, clientX: 900, clientY: 100, pointerId: 1 });
    expect(screen.getByTestId("draft-ghost")).toBeInTheDocument();
    for (let i = 1; i <= 30; i++) fireEvent.pointerMove(window, { clientX: 900 + i * 4, clientY: 100 + i * 2, pointerId: 1 });
    expect(view.renders() - rendersBefore).toBe(0);
    const during = view.commits();
    for (const region of regions) if (region !== "canvas") expect(during[region], region).toBe(0);
    expect(during.canvas).toBeLessThanOrEqual(31);
    expect(view.sent()).toHaveLength(0);
    fireEvent.pointerUp(window, { clientX: 1020, clientY: 160, pointerId: 1 });
    await elapse(20);
    expect(view.sent()).toHaveLength(1);
    const message = view.sent()[0] as unknown as { ops: { op: string; parentId: string }[]; label: string };
    expect(message.ops).toHaveLength(1);
    expect(message.ops[0]).toMatchObject({ op: "create", parentId: "page-0" });
    expect(view.renders() - rendersBefore).toBe(0);
    process.stderr.write(`[perf canvas-2 jsdom] draw: ${during.canvas} canvas commits over 31 pointer events, 0 node renders, 1 apply\n`);
    view.unmount();
  });
});

describe("text editing on 5 000 nodes", () => {
  const withText = async () => {
    const view = await open();
    const doc = view.rig.client.store.state.doc!;
    const id = Object.keys(doc.nodes)[2500] as string;
    view.rig.deliver(nodeDelta(doc, id, { type: "text", text: "hello", color: "#111111", fontFamily: "Inter", fontSize: 16, fontWeight: 400, lineHeight: 1.4, letterSpacing: 0, textAlign: "left", height: "hug" }, 3));
    await elapse(60);
    return { view, id };
  };

  it("opening renders only the edited node; typing commits no other node and no region and sends nothing; one apply to confirm", async () => {
    const { view, id } = await withText();
    const el = view.world.querySelector(`[data-paprika-id="${id}"]`) as HTMLElement;
    fireEvent.pointerDown(el, { button: 0, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    await elapse(20);
    view.log.reset();
    const before = view.renders();
    fireEvent.doubleClick(el);
    await elapse(20);
    const surface = screen.getByRole("textbox", { name: "Text" });
    expect(view.renders() - before).toBe(1);
    view.log.reset();
    const afterOpen = view.renders();
    for (let i = 1; i <= 40; i++) {
      surface.textContent = `hello${"!".repeat(i)}`;
      fireEvent.input(surface);
    }
    await elapse(50);
    expect(view.renders() - afterOpen).toBe(0);
    expect(view.commits()).toEqual(none);
    expect(view.sent()).toHaveLength(0);
    fireEvent.keyDown(surface, { key: "Escape" });
    await elapse(20);
    expect(view.sent()).toHaveLength(1);
    expect((view.sent()[0] as unknown as { ops: unknown[] }).ops).toEqual([{ op: "update", id, props: { text: `hello${"!".repeat(40)}`, runs: null } }]);
    process.stderr.write("[perf canvas-2 jsdom] text: open renders 1 node; 40 inputs = 0 renders, 0 commits, 0 messages; confirm = 1 apply\n");
    view.unmount();
  });
});
