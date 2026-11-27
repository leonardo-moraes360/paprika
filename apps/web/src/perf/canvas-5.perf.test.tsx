import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { editorRegionIds } from "@/editor/editor";
import { stubLayout } from "@/test/canvas-fixtures";
import { fakeWasm } from "@/test/fake-wasm";
import { nodeDelta, renderEditorRig, serveDocument } from "@/test/live-harness";
import { letRealTimersRun } from "@/test/real-settle";

/**
 * Batch 5 of the canvas (the WASM layer) with a document of 5 000 nodes on one page. Counts are commits of the React Profiler and
 * renders of nodes (deterministic), with the module replaced by `test/fake-wasm.ts`; jsdom's durations are information only (the
 * browser's, with the real module, are in the report).
 */
const NODES = 5000;
const regions = [...editorRegionIds, "canvas"];

let restoreLayout: () => void;
beforeAll(() => {
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
});
beforeEach(() => {
  restoreLayout = stubLayout();
  window.localStorage.removeItem("paprika.renderer");
});
afterEach(() => {
  restoreLayout();
  vi.useRealTimers();
  window.localStorage.removeItem("paprika.renderer");
});

const elapse = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

async function open() {
  const view = await renderEditorRig({ nodes: NODES });
  serveDocument(view.rig, view.doc);
  await screen.findByRole("banner");
  await screen.findByRole("tree", { name: "Layer tree" });
  await letRealTimersRun();
  vi.useFakeTimers({ toFake: [...FAKED] });
  await elapse(300);
  const doc = view.rig.client.store.state.doc!;
  view.rig.deliver(nodeDelta(doc, Object.keys(doc.nodes)[10] as string, { x: 1 }, 2));
  await elapse(300);
  view.log.reset();
  const world = screen.getByTestId("canvas-world");
  const viewport = screen.getByTestId("viewport");
  const w = world as unknown as { __paprikaNodeRenders: number; __paprikaMeasures?: number };
  return { ...view, world, viewport, renders: () => w.__paprikaNodeRenders, measures: () => w.__paprikaMeasures ?? 0, ids: Object.keys(doc.nodes) };
}
type View = Awaited<ReturnType<typeof open>>;
const commitsOf = (view: View) => Object.fromEntries(regions.map((id) => [id, view.log.commits(id)]));

const FAKED = ["setTimeout", "clearTimeout", "Date", "requestAnimationFrame", "cancelAnimationFrame"] as const;

/** Chooses a renderer from the zoom bar's menu (the user's path); the menu's own timers run on the real clock, the rest on the test's. */
async function choose(name: RegExp, settled: RegExp) {
  vi.useRealTimers();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /^Renderer:/ }));
  await user.click(screen.getByRole("menuitemradio", { name }));
  await screen.findByRole("button", { name: settled }, { timeout: 30_000 });
  await user.keyboard("{Escape}");
  await letRealTimersRun();
  vi.useFakeTimers({ toFake: [...FAKED] });
  await elapse(300);
}
const chooseWasm = (_view: View) => choose(/^WASM · CPU$/, /^Renderer: WASM · CPU$/);
const chooseDom = () => choose(/^DOM/, /^Renderer: DOM$/);

describe("the WASM layer with 5 000 nodes", { timeout: 60_000 }, () => {
  it("switching to WASM renders the painted nodes once each at most (no node twice), and measures one pass for the scene", async () => {
    const view = await open();
    const rendersBefore = view.renders();
    const measuresBefore = view.measures();
    await chooseWasm(view);
    const rendered = view.renders() - rendersBefore;
    const measured = view.measures() - measuresBefore;
    process.stderr.write(`[perf canvas-5 jsdom] switch to WASM: node renders ${rendered}, measure passes ${measured}, commits ${JSON.stringify(commitsOf(view))}\n`);
    expect(fakeWasm.last?.scenes.length).toBeGreaterThan(0);
    expect(rendered).toBeLessThanOrEqual(NODES);
    expect(measured).toBe(1);
    view.unmount();
  }, 30_000);

  it("switching back to DOM, and again to WASM, creates no second renderer", async () => {
    const view = await open();
    await chooseWasm(view);
    const created = fakeWasm.renderers.filter((r) => !r.freed).length;
    await chooseDom();
    await chooseWasm(view);
    expect(fakeWasm.renderers.filter((r) => !r.freed)).toHaveLength(created);
    view.unmount();
  }, 30_000);

  it("with WASM on, panning and zooming commit nothing, render no node and measure nothing", async () => {
    const view = await open();
    await chooseWasm(view);
    await elapse(300);
    view.log.reset();
    const rendersBefore = view.renders();
    const measuresBefore = view.measures();
    const drawsBefore = fakeWasm.last?.renders.length ?? 0;
    for (let i = 0; i < 60; i++) {
      fireEvent.wheel(view.viewport, { deltaX: 3, deltaY: 5 });
      await elapse(16);
    }
    for (let i = 0; i < 20; i++) {
      fireEvent.wheel(view.viewport, { deltaY: -40, ctrlKey: true });
      await elapse(16);
    }
    await elapse(300);
    expect(view.renders() - rendersBefore).toBe(0);
    // The same as the DOM renderer (canvas.perf.test.tsx): the zoom readout of the bar commits once, when the camera rests; nothing else.
    expect(commitsOf(view)).toEqual({ ...Object.fromEntries(regions.map((id) => [id, 0])), stage: 1 });
    // The camera moved the picture: every frame draws, and nothing is measured again.
    expect((fakeWasm.last?.renders.length ?? 0) - drawsBefore).toBeGreaterThan(0);
    expect(view.measures() - measuresBefore).toBeLessThanOrEqual(1);
    process.stderr.write(`[perf canvas-5 jsdom] pan+zoom with WASM: draws ${(fakeWasm.last?.renders.length ?? 0) - drawsBefore}, measures ${view.measures() - measuresBefore}\n`);
    view.unmount();
  }, 30_000);

  it("a delta on one node with WASM on is one measure pass and renders that node only", async () => {
    const view = await open();
    await chooseWasm(view);
    await elapse(300);
    const doc = view.rig.client.store.state.doc!;
    const rendersBefore = view.renders();
    const measuresBefore = view.measures();
    view.rig.deliver(nodeDelta(doc, view.ids[2500] as string, { x: 321 }, 3));
    await elapse(100);
    expect(view.renders() - rendersBefore).toBe(1);
    expect(view.measures() - measuresBefore).toBe(1);
    view.unmount();
  }, 30_000);
});
