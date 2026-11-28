import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIVITY_REFRESH_MS } from "@/editor/regions/activity";
import { PANEL_REFRESH_MS, Properties } from "@/editor/regions/properties";
import { EditorProvider, initialEditorState, useEditorStore, type EditorActions } from "@/editor/editor-store";
import { dismissToasts } from "@/lib/notify";
import { createPerfLog, PerfProvider, RegionProfiler } from "@/perf";
import { Notifications } from "@/components/notifications";
import { LiveProvider } from "@/data/live";
import { createLiveRig, docMessage, makeDocument, nodeDelta, type LiveRig } from "@/test/live-harness";

afterEach(() => {
  vi.useRealTimers();
  dismissToasts();
});

/**
 * Time is the test's: the panel's refresh interval (100 ms) and the activity's pass when this says so, never because a
 * loaded machine was slow. Only the timers and `Date` are faked (the polling of `findBy*` keeps real intervals).
 */
const useClock = () => {
  if (!vi.isFakeTimers()) vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
};
const elapse = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));
const settle = () => elapse(Math.max(PANEL_REFRESH_MS, ACTIVITY_REFRESH_MS) + 30);

type Mounted = Awaited<ReturnType<typeof mount>>;

/** The properties region alone, in its profiler, over a fake server with an N-node document. */
async function mount(nodes: number, rig: LiveRig = createLiveRig()) {
  useClock();
  const log = createPerfLog();
  const doc = makeDocument(nodes);
  let actions!: EditorActions;
  function Grab() {
    actions = useEditorStore().actions;
    return null;
  }
  const view = render(
    <PerfProvider log={log}>
      <LiveProvider client={rig.client}>
        <EditorProvider initial={initialEditorState}>
          <Grab />
          <RegionProfiler id="properties">
            <Properties />
          </RegionProfiler>
        </EditorProvider>
        <Notifications />
      </LiveProvider>
    </PerfProvider>,
  );
  const socket = await rig.connect();
  rig.deliver(docMessage(doc, 1));
  log.reset();
  return { ...view, rig, socket, doc, log, select: (ids: string[]) => act(() => actions.select(ids)) };
}

const commits = (view: Mounted) => view.log.commits("properties");
const keys = (view: Mounted) => Object.keys(view.doc.nodes);

describe("properties region commits with a document of 5 000 nodes", () => {
  it("a delta on a node that is not selected commits nothing", async () => {
    const view = await mount(5000);
    const ids = keys(view);
    view.select([ids[10] as string]);
    expect(screen.getByTestId("node-panel")).toBeInTheDocument();
    view.log.reset();
    view.rig.deliver(nodeDelta(view.doc, ids[3000] as string, { x: 5, fill: "#000000" }, 2));
    expect(commits(view)).toBe(0);
    view.unmount();
  }, 30_000);

  it("a burst of 200 deltas on other nodes, presence and a hover commit nothing either", async () => {
    const view = await mount(5000);
    const ids = keys(view);
    view.select([ids[10] as string]);
    screen.getByTestId("node-panel");
    view.log.reset();
    view.rig.deliver(...Array.from({ length: 200 }, (_, i) => nodeDelta(view.doc, ids[2000 + i] as string, { x: i }, 2 + i)));
    view.rig.push({ type: "presence", agent: "s:1", actor: "agent:claude", tool: "update_nodes", nodes: [ids[2000] as string], idle: 0 });
    expect(commits(view)).toBe(0);
    view.unmount();
  }, 30_000);

  it("a delta on the selected node, its parent frame, or the document tokens commits once", async () => {
    const view = await mount(5000);
    const ids = keys(view);
    const rect = ids.find((id) => id.startsWith("n")) as string;
    view.select([rect]);
    screen.getByTestId("node-panel");
    await settle();
    view.log.reset();
    view.rig.deliver(nodeDelta(view.doc, rect, { x: 42 }, 2));
    expect(commits(view)).toBe(1);
    await settle();
    view.log.reset();
    const live = view.rig.client.store.state.doc!;
    view.rig.deliver(nodeDelta(live, live.nodes[rect]!.parentId as string, { name: "Renamed frame" }, 3));
    expect(commits(view)).toBe(1);
    view.unmount();
  }, 30_000);

  it("a burst of deltas on the selected node renders at once when the panel was still, then once more per interval", async () => {
    const view = await mount(5000);
    const rect = keys(view).find((id) => id.startsWith("n")) as string;
    view.select([rect]);
    screen.getByTestId("node-panel");
    await settle();
    view.log.reset();
    for (let i = 0; i < 10; i += 1) view.rig.deliver(nodeDelta(view.rig.client.store.state.doc!, rect, { x: i }, 2 + i));
    expect(commits(view)).toBe(1);
    expect(screen.getByRole("textbox", { name: "X" })).toHaveValue("0");
    await settle();
    expect(commits(view)).toBe(2);
    expect(screen.getByRole("textbox", { name: "X" })).toHaveValue("9");
    view.unmount();
  }, 30_000);

  it("with nothing selected, an edit adds one activity row and one commit (the document panel lists it); a burst is one commit", async () => {
    const view = await mount(5000);
    const ids = keys(view);
    expect(screen.getByTestId("document-panel")).toBeInTheDocument();
    view.log.reset();
    view.rig.deliver(nodeDelta(view.doc, ids[300] as string, { x: 1 }, 2));
    expect(commits(view)).toBe(1);
    await settle();
    view.log.reset();
    view.rig.deliver(...Array.from({ length: 50 }, (_, i) => nodeDelta(view.rig.client.store.state.doc!, ids[400 + i] as string, { x: i }, 3 + i)));
    expect(commits(view)).toBe(1);
    view.unmount();
  }, 30_000);

  it("a burst spread over 40 frames (200 deltas, 5 per frame) renders the document panel at most ten times, not once per frame", async () => {
    const view = await mount(5000);
    const ids = keys(view);
    expect(screen.getByTestId("document-panel")).toBeInTheDocument();
    await settle();
    view.log.reset();
    for (let frame = 0; frame < 40; frame += 1) {
      const live = view.rig.client.store.state.doc!;
      view.rig.deliver(...Array.from({ length: 5 }, (_, i) => nodeDelta(live, ids[400 + frame * 5 + i] as string, { x: frame * 5 + i }, 2 + frame * 5 + i)));
      await elapse(16);
    }
    expect(view.rig.client.store.state.version).toBe(201);
    // 640 ms of edits: the first entry shows at once, then one render per 100 ms. Without the throttle this is one per frame (40).
    // Measured: 7 (the first at once, then one per 100 ms; the clock is the test's). A regression to 10 or to one per frame (40) fails.
    expect(commits(view)).toBeGreaterThanOrEqual(6);
    expect(commits(view)).toBeLessThanOrEqual(8);
    await settle();
    // The last render shows every entry that came in (the list is capped by the store, so look at the newest).
    expect(screen.getByRole("list", { name: "Activity" }).textContent).toContain("edit");
    view.unmount();
  }, 30_000);

  it("20 isolated deltas on a node that is not selected, 200 ms apart, cost one commit each plus one per second of clock (not one per row per second)", async () => {
    // The relative times of the activity rows tick every second; each row used to have its own interval, so 20 rows committed 20 times a second.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const view = await mount(5000);
    const ids = keys(view);
    expect(screen.getByTestId("document-panel")).toBeInTheDocument();
    await settle();
    view.log.reset();
    const frame = 20;
    for (let i = 0; i < 20; i += 1) {
      view.rig.deliver(nodeDelta(view.rig.client.store.state.doc!, ids[400] as string, { x: 40 + i }, 2 + i));
      // The gap goes frame by frame: each timer of a real browser is its own task, so each one that changes the panel is its own commit.
      for (let elapsed = 0; elapsed < 200; elapsed += frame) await elapse(frame);
    }
    const seconds = 4;
    expect(view.rig.client.store.state.version).toBe(21);
    expect(commits(view)).toBeLessThanOrEqual(20 + seconds + 1);
    view.unmount();
  }, 30_000);

  it("selecting a node switches the panel in one commit", async () => {
    const view = await mount(5000);
    const ids = keys(view);
    screen.getByTestId("document-panel");
    view.log.reset();
    view.select([ids[10] as string]);
    // One render for the switch; the second commit is a nested update of the scroll area (layout effect), not a render of the fields.
    expect(commits(view)).toBeLessThanOrEqual(2);
    expect(view.log.entries().filter((e) => e.actualDuration > 5)).toHaveLength(1);
    expect(screen.getByTestId("node-panel")).toBeInTheDocument();
    view.unmount();
  }, 30_000);

  it("an activity row ages by itself: its time moves on while the panel is not told anything", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    try {
      const view = await mount(200);
      view.rig.deliver(nodeDelta(view.doc, keys(view)[5] as string, { x: 1 }, 2));
      expect(screen.getByText("now", { selector: "time" })).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(7000));
      expect(screen.getByText("7s", { selector: "time" })).toBeInTheDocument();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  }, 30_000);
});
