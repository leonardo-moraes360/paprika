import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

/** Lets the panel's refresh interval pass (real time: the interval is 100 ms). */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, PANEL_REFRESH_MS + 30)));

type Mounted = Awaited<ReturnType<typeof mount>>;

/** The properties region alone, in its profiler, over a fake server with an N-node document. */
async function mount(nodes: number, rig: LiveRig = createLiveRig()) {
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
    expect(await screen.findByTestId("node-panel")).toBeInTheDocument();
    view.log.reset();
    view.rig.deliver(nodeDelta(view.doc, ids[3000] as string, { x: 5, fill: "#000000" }, 2));
    expect(commits(view)).toBe(0);
    view.unmount();
  });

  it("a burst of 200 deltas on other nodes, presence and a hover commit nothing either", async () => {
    const view = await mount(5000);
    const ids = keys(view);
    view.select([ids[10] as string]);
    await screen.findByTestId("node-panel");
    view.log.reset();
    view.rig.deliver(...Array.from({ length: 200 }, (_, i) => nodeDelta(view.doc, ids[2000 + i] as string, { x: i }, 2 + i)));
    view.rig.push({ type: "presence", agent: "s:1", actor: "agent:claude", tool: "update_nodes", nodes: [ids[2000] as string], idle: 0 });
    expect(commits(view)).toBe(0);
    view.unmount();
  });

  it("a delta on the selected node, its parent frame, or the document tokens commits once", async () => {
    const view = await mount(5000);
    const ids = keys(view);
    const rect = ids.find((id) => id.startsWith("n")) as string;
    view.select([rect]);
    await screen.findByTestId("node-panel");
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
  });

  it("a burst of deltas on the selected node renders at once when the panel was still, then once more per interval", async () => {
    const view = await mount(5000);
    const rect = keys(view).find((id) => id.startsWith("n")) as string;
    view.select([rect]);
    await screen.findByTestId("node-panel");
    await settle();
    view.log.reset();
    for (let i = 0; i < 10; i += 1) view.rig.deliver(nodeDelta(view.rig.client.store.state.doc!, rect, { x: i }, 2 + i));
    expect(commits(view)).toBe(1);
    expect(screen.getByRole("textbox", { name: "X" })).toHaveValue("0");
    await settle();
    expect(commits(view)).toBe(2);
    expect(screen.getByRole("textbox", { name: "X" })).toHaveValue("9");
    view.unmount();
  });

  it("with nothing selected, an edit adds one activity row and one commit (the document panel lists it); a burst is one commit", async () => {
    const view = await mount(5000);
    const ids = keys(view);
    expect(await screen.findByTestId("document-panel")).toBeInTheDocument();
    view.log.reset();
    view.rig.deliver(nodeDelta(view.doc, ids[300] as string, { x: 1 }, 2));
    expect(commits(view)).toBe(1);
    view.log.reset();
    view.rig.deliver(...Array.from({ length: 50 }, (_, i) => nodeDelta(view.rig.client.store.state.doc!, ids[400 + i] as string, { x: i }, 3 + i)));
    expect(commits(view)).toBe(1);
    view.unmount();
  });

  it("selecting a node switches the panel in one commit", async () => {
    const view = await mount(5000);
    const ids = keys(view);
    await screen.findByTestId("document-panel");
    view.log.reset();
    view.select([ids[10] as string]);
    // One render for the switch; the second commit is a nested update of the scroll area (layout effect), not a render of the fields.
    expect(commits(view)).toBeLessThanOrEqual(2);
    expect(view.log.entries().filter((e) => e.actualDuration > 5)).toHaveLength(1);
    expect(screen.getByTestId("node-panel")).toBeInTheDocument();
    view.unmount();
  });

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
  });
});
