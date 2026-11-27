import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";
import { editorRegionIds } from "@/editor/editor";
import { deltaMessage, nodeDelta, renderEditorRig, serveDocument } from "@/test/live-harness";

/** Commits of the shell regions (header, pages, layers, stage, history) with a document of 5 000 nodes. Durations are jsdom's: information only. */

const NODES = 5000;

beforeAll(() => {
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
  for (const key of ["clientHeight", "offsetHeight"]) Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => 600 });
  for (const key of ["clientWidth", "offsetWidth"]) Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => 300 });
});

async function open() {
  const view = await renderEditorRig({ nodes: NODES });
  serveDocument(view.rig, view.doc);
  await screen.findByRole("banner");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  // The first edit flips "can undo" (the toolbar); settle that so the numbers below are about the edit itself.
  const doc = view.rig.client.store.state.doc!;
  view.rig.deliver(nodeDelta(doc, Object.keys(doc.nodes)[10] as string, { x: 1 }, 2));
  view.log.reset();
  return view;
}

const report = (label: string, view: Awaited<ReturnType<typeof open>>) => {
  const stats = view.log.stats();
  const line = ["layers", "header", "pages", "stage"].map((id) => `${id}=${stats[id]?.commits ?? 0}/${(stats[id]?.actualDuration ?? 0).toFixed(1)}ms`).join(" ");
  process.stderr.write(`[perf lote2 jsdom] ${label}: ${line}\n`);
};

const only = (view: Awaited<ReturnType<typeof open>>, expected: Record<string, number>) => {
  for (const id of editorRegionIds) expect(view.log.commits(id), id).toBe(expected[id] ?? 0);
};

describe("shell regions with 5 000 nodes", () => {
  it("a delta that moves a node commits nothing (the layers do not show positions)", async () => {
    const view = await open();
    const doc = view.rig.client.store.state.doc!;
    view.rig.deliver(nodeDelta(doc, Object.keys(doc.nodes)[2500] as string, { x: 555 }, 3));
    only(view, {});
    report("move one node", view);
    view.unmount();
  });

  it("renaming ONE node commits the layers once and nothing else", async () => {
    const view = await open();
    const doc = view.rig.client.store.state.doc!;
    const id = Object.keys(doc.nodes)[2500] as string;
    view.rig.deliver(nodeDelta(doc, id, { name: "Renamed" }, 3));
    only(view, { layers: 1 });
    report("rename one node", view);
    view.unmount();
  });

  it("a burst of 200 renames in one frame is ONE commit of the layers", async () => {
    const view = await open();
    const doc = view.rig.client.store.state.doc!;
    const keys = Object.keys(doc.nodes);
    view.rig.deliver(...Array.from({ length: 200 }, (_, i) => nodeDelta(doc, keys[100 + i] as string, { name: `N${i}` }, 3 + i)));
    only(view, { layers: 1 });
    report("200 renames in a frame", view);
    view.unmount();
  });

  it("selecting a layer commits the layers once (selection is not a document change) and no other region", async () => {
    const user = userEvent.setup();
    const view = await open();
    const items = within(screen.getByRole("tree", { name: "Layer tree" })).getAllByRole("treeitem");
    const row = items[5] as HTMLElement;
    const name = row.textContent as string;
    view.log.reset();
    await user.click(within(row).getByText(name));
    expect(row).toHaveAttribute("aria-selected", "true");
    expect(view.log.commits("layers")).toBeGreaterThanOrEqual(1);
    for (const id of editorRegionIds.filter((r) => !["layers", "properties", "activity", "stage"].includes(r))) expect(view.log.commits(id), id).toBe(0);
    report("select one layer", view);
    view.unmount();
  });

  it("toggling the visibility of one node (an agent hiding it) commits the layers once", async () => {
    const view = await open();
    const doc = view.rig.client.store.state.doc!;
    view.rig.deliver(nodeDelta(doc, Object.keys(doc.nodes)[300] as string, { visible: false }, 3));
    only(view, { layers: 1 });
    view.unmount();
  });

  it("an agent heartbeat that repeats the same nodes commits nothing after the first presence", async () => {
    const view = await open();
    const keys = Object.keys(view.rig.client.store.state.doc!.nodes);
    const presence = { type: "presence" as const, agent: "a:1", actor: "agent:claude", tool: "update_nodes", nodes: [keys[100] as string], idle: 0 };
    view.rig.push(presence);
    view.log.reset();
    view.rig.push(presence, presence, presence);
    only(view, {});
    view.rig.deliver(deltaMessage(view.rig.client.store.state.doc!, 3, { name: "Still the header only" }));
    only(view, { header: 1 });
    view.unmount();
  });

  it("opening the workspace: the first commit of the layers with 5 000 nodes (jsdom timing, information)", async () => {
    const view = await renderEditorRig({ nodes: NODES });
    const started = performance.now();
    serveDocument(view.rig, view.doc);
    await screen.findByRole("banner");
    const stats = view.log.stats();
    process.stderr.write(`[perf lote2 jsdom] open 5000 nodes: ${(performance.now() - started).toFixed(0)}ms to the banner, layers mount ${(stats.layers?.actualDuration ?? 0).toFixed(1)}ms\n`);
    expect(stats.layers?.mounts).toBe(1);
    view.unmount();
  });
});
