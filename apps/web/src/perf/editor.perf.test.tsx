import { act, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { editorRegionIds } from "@/editor/editor";
import { docMessage, nodeDelta, renderEditorRig, serveDocument } from "@/test/live-harness";

const NODES = 5000;

async function openEditor() {
  const view = await renderEditorRig({ nodes: NODES });
  expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  serveDocument(view.rig, view.doc);
  await screen.findByRole("banner");
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
    for (const id of editorRegionIds) expect(view.log.stats()[id]?.mounts, id).toBe(1);
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
    for (const id of editorRegionIds) expect(view.log.commits(id), id).toBe(0);
    view.unmount();
  });

  it("a burst of 200 deltas in one frame and an agent's presence commit nothing either", async () => {
    const view = await openEditor();
    const before = view.rig.client.store.state.doc!;
    const keys = Object.keys(before.nodes);
    view.rig.deliver(...Array.from({ length: 200 }, (_, i) => nodeDelta(before, keys[100 + i] as string, { x: i }, 2 + i)));
    expect(view.rig.client.store.state.version).toBe(201);
    view.rig.push({ type: "presence", agent: "s:1", actor: "agent:claude", tool: "update_nodes", nodes: [keys[100] as string], idle: 0 });
    for (const id of editorRegionIds) expect(view.log.commits(id), id).toBe(0);
    view.unmount();
  });

  it("control: what a region does depend on does commit it (renaming the document re-renders the header only)", async () => {
    const view = await openEditor();
    const before = view.rig.client.store.state.doc!;
    view.rig.deliver({ ...nodeDelta(before, Object.keys(before.nodes)[1] as string, {}, 2), nodes: undefined, name: "Renamed" });
    expect(view.log.commits("header")).toBe(1);
    for (const id of editorRegionIds.filter((r) => r !== "header")) expect(view.log.commits(id), id).toBe(0);
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
