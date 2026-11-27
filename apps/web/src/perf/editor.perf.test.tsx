import { act, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { alwaysMountedRegionIds, editorRegionIds } from "@/editor/editor";
import { docMessage, nodeDelta, renderEditorRig, serveDocument } from "@/test/live-harness";
import { letRealTimersRun } from "@/test/real-settle";

const NODES = 5000;

beforeAll(() => {
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
});
afterEach(() => vi.useRealTimers());

/** Time is the test's from here on: only timers and `Date` are faked, and only after `findBy*` (which polls on real ones) is done. */
const useClock = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
const elapse = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

async function openEditor() {
  const view = await renderEditorRig({ nodes: NODES });
  expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  serveDocument(view.rig, view.doc);
  await screen.findByRole("banner");
  // The layers mount in a transition right after the first paint: wait for them, then let the regions' own mount effects
  // (toolbar, hotkeys, persisted state) and the panels' refresh intervals pass. Only what a delta causes is counted.
  await screen.findByRole("tree", { name: "Layer tree" });
  await letRealTimersRun();
  useClock();
  await elapse(300);
  view.log.reset();
  return view;
}

describe("editor commits with a document of 5 000 nodes", () => {
  it("the document has the size the test says", async () => {
    const view = await renderEditorRig({ nodes: NODES });
    expect(Object.keys(view.doc.nodes)).toHaveLength(NODES);
    view.unmount();
  });

  it("shows the opening state until the document of that workspace arrives, then mounts every region", async () => {
    const view = await renderEditorRig({ nodes: NODES });
    expect(screen.getByRole("status", { name: /opening workspace/i })).toBeInTheDocument();
    serveDocument(view.rig, view.doc);
    await screen.findByRole("banner");
    // `agents` (the roster, in the header) and `team` (the right panel's tab) exist only with agents or a team.
    for (const id of alwaysMountedRegionIds) expect(view.log.stats()[id]?.mounts, id).toBe(1);
    expect(view.log.stats().agents?.mounts ?? 0).toBe(0);
    expect(view.log.stats().team?.mounts ?? 0).toBe(0);
    view.unmount();
  });

  it("a delta that changes ONE node commits nothing in any region (none of them depends on that node)", async () => {
    const view = await openEditor();
    const before = view.rig.client.store.state.doc!;
    const target = Object.keys(before.nodes)[2500] as string;
    view.rig.deliver(nodeDelta(before, target, { x: 123 }, 2));
    const after = view.rig.client.store.state.doc!;
    expect((after.nodes[target] as { x: number }).x).toBe(123);
    expect(after.nodes[Object.keys(before.nodes)[2501] as string]).toBe(before.nodes[Object.keys(before.nodes)[2501] as string]);
    // The toolbar in the stage shows "can undo": the first edit flips it, so the stage commits once. With nothing selected the properties panel is the document panel and lists the new activity entry: one commit. No other region commits.
    const first: Record<string, number> = { stage: 1, properties: 1 };
    for (const id of editorRegionIds) expect(view.log.commits(id), id).toBe(first[id] ?? 0);
    // The next edit flips no flag: only the document panel (activity) may commit, and it lists a new entry no sooner than its refresh interval after the last one.
    view.log.reset();
    view.rig.deliver(nodeDelta(after, Object.keys(before.nodes)[2502] as string, { x: 7 }, 3));
    for (const id of editorRegionIds) expect(view.log.commits(id), id).toBe(0);
    await elapse(150);
    for (const id of editorRegionIds) expect(view.log.commits(id), id).toBe(id === "properties" ? 1 : 0);
    view.unmount();
  });

  it("changing the renderer commits only the stage (its zoom bar): never the layers, the properties or the pages, and no ops", async () => {
    const view = await openEditor();
    window.localStorage.removeItem("paprika.renderer");
    const helloBefore = view.socket.sentOf("hello").length;
    const { default: userEvent } = await import("@testing-library/user-event");
    vi.useRealTimers();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Renderer: DOM" }));
    await user.click(screen.getByRole("menuitemradio", { name: "WASM" }));
    expect(await screen.findByRole("button", { name: "Renderer: WASM · CPU" })).toBeInTheDocument();
    expect(view.socket.sentOf("hello")).toHaveLength(helloBefore + 1);
    expect(view.socket.sentOf("ops")).toEqual([]);
    for (const id of ["layers", "properties", "pages"]) expect(view.log.commits(id), id).toBe(0);
    expect(view.log.commits("stage")).toBeGreaterThan(0);
    window.localStorage.removeItem("paprika.renderer");
    view.unmount();
  });

  it("a burst of 200 deltas in one frame commits nothing, and an agent's presence only the regions that show it", async () => {
    const view = await openEditor();
    const before = view.rig.client.store.state.doc!;
    const keys = Object.keys(before.nodes);
    view.rig.deliver(...Array.from({ length: 200 }, (_, i) => nodeDelta(before, keys[100 + i] as string, { x: i }, 2 + i)));
    expect(view.rig.client.store.state.version).toBe(201);
    expect(view.log.commits("layers")).toBe(0);
    expect(view.log.commits("stage")).toBe(1);
    view.log.reset();
    view.rig.push({ type: "presence", agent: "s:1", actor: "agent:claude", tool: "update_nodes", nodes: [keys[100] as string], idle: 0 });
    // The roster mounts inside the header ("1 active"): the header renders once (it gains the roster) and the roster once (`useNow` reads the clock in its render and not again on mount, so it commits once with a real clock too); the pages and the layers show who is where, once. Presence changes nothing in the properties panel.
    const expected: Record<string, number> = { header: 1, agents: 1, pages: 1, layers: 1 };
    for (const id of editorRegionIds) expect(view.log.commits(id), id).toBe(expected[id] ?? 0);
    view.unmount();
  });

  it("a burst of 200 deltas spread over 40 frames commits no other region than the stage's toolbar once and the document panel a few times", async () => {
    const view = await openEditor();
    const before = view.rig.client.store.state.doc!;
    const keys = Object.keys(before.nodes);
    for (let frame = 0; frame < 40; frame += 1) {
      const live = view.rig.client.store.state.doc!;
      view.rig.deliver(...Array.from({ length: 5 }, (_, i) => nodeDelta(live, keys[100 + frame * 5 + i] as string, { x: frame }, 2 + frame * 5 + i)));
      await elapse(16);
    }
    expect(view.rig.client.store.state.version).toBe(201);
    for (const id of editorRegionIds.filter((r) => r !== "properties")) expect(view.log.commits(id), id).toBe(id === "stage" ? 1 : 0);
    // 640 ms: the panel lists the entries at most ten times a second, not once per frame.
    // Measured: 7 (the first at once, then one per 100 ms; the clock is the test's). A regression to 10 or to one per frame (40) fails.
    expect(view.log.commits("properties")).toBeGreaterThanOrEqual(6);
    expect(view.log.commits("properties")).toBeLessThanOrEqual(8);
    view.unmount();
  });

  it("control: what a region does depend on does commit it (renaming the document re-renders the header, the document panel, and the first edit the toolbar)", async () => {
    const view = await openEditor();
    const before = view.rig.client.store.state.doc!;
    view.rig.deliver({ ...nodeDelta(before, Object.keys(before.nodes)[1] as string, {}, 2), nodes: undefined, name: "Renamed" });
    expect(view.log.commits("header")).toBe(1);
    // (the stage commits too: this edit is the first one, so "can undo" flips; the document panel shows the name and the new activity entry)
    for (const id of editorRegionIds.filter((r) => r !== "header" && r !== "stage")) expect(view.log.commits(id), id).toBe(id === "properties" ? 1 : 0);
    view.unmount();
  });

  it("control: losing the connection re-renders the header and not the stage", async () => {
    const view = await openEditor();
    act(() => view.socket.drop());
    expect(view.log.commits("header")).toBe(1);
    expect(view.log.commits("stage")).toBe(0);
    view.unmount();
  });

  it("a snapshot of the same workspace (a reload) keeps the editor mounted", async () => {
    const view = await openEditor();
    view.rig.deliver(docMessage({ ...view.doc, name: "Same id" }, 5));
    expect(view.log.stats().header?.mounts ?? 0).toBe(0);
    expect(screen.getByRole("banner")).toBeInTheDocument();
    view.unmount();
  });
});
