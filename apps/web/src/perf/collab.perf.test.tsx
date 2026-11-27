import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { editorRegionIds } from "@/editor/editor";
import { nodeDelta, renderEditorRig, serveDocument } from "@/test/live-harness";

/**
 * Batch 4 (agents, team, notice, pins, export, import): presence of up to 64 agents, the roster's clock, the team status and
 * the workspace notice commit ONLY the region that shows them. Counts are commits of the React Profiler (deterministic);
 * durations in jsdom are not asserted.
 */
const NODES = 5000;
const AGENTS = 64;

afterEach(() => vi.useRealTimers());

async function openEditor() {
  const view = await renderEditorRig({ nodes: NODES });
  serveDocument(view.rig, view.doc);
  await screen.findByRole("banner");
  view.log.reset();
  return view;
}

const nodeIds = (view: Awaited<ReturnType<typeof openEditor>>) => Object.keys(view.doc.nodes);
const presence = (i: number, ids: string[], tool = i % 3 === 0 ? "get_nodes" : "update_nodes") => ({ type: "presence" as const, agent: `s:${i}`, actor: `agent:client-${i % 8}`, tool, nodes: [ids[100 + i] as string], idle: 0 });
const others = (except: string) => editorRegionIds.filter((id) => id !== except);

describe("collaboration regions with a document of 5 000 nodes", () => {
  it("64 agents arriving in one frame commit only the roster, once", async () => {
    const view = await openEditor();
    const ids = nodeIds(view);
    act(() => {
      for (let i = 0; i < AGENTS; i += 1) view.rig.sockets.last.receive(presence(i, ids));
    });
    expect(view.rig.client.store.state.agents).toHaveLength(AGENTS);
    for (const id of others("agents")) expect(view.log.commits(id), id).toBe(0);
    // One commit for the arrival, and one for the tones the roster gives the 8 clients.
    expect(view.log.commits("agents")).toBeGreaterThan(0);
    expect(view.log.commits("agents")).toBeLessThanOrEqual(3);
    view.unmount();
  });

  it("every one of 64 agents reporting on its own commits the roster at most once per message and nothing else", async () => {
    const view = await openEditor();
    const ids = nodeIds(view);
    for (let i = 0; i < AGENTS; i += 1) view.rig.push(presence(i, ids));
    view.log.reset();
    for (let i = 0; i < AGENTS; i += 1) view.rig.push(presence(i, ids, "update_nodes"));
    for (const id of others("agents")) expect(view.log.commits(id), id).toBe(0);
    expect(view.log.commits("agents")).toBeLessThanOrEqual(AGENTS);
    view.unmount();
  });

  it("the roster's clock ticks inside the roster: ten seconds commit it and no other region", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const view = await openEditor();
    const ids = nodeIds(view);
    act(() => {
      for (let i = 0; i < AGENTS; i += 1) view.rig.sockets.last.receive(presence(i, ids));
    });
    view.log.reset();
    for (let second = 0; second < 10; second += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    expect(view.log.commits("agents")).toBeGreaterThanOrEqual(5);
    for (const id of others("agents")) expect(view.log.commits(id), id).toBe(0);
    view.unmount();
  });

  it("a burst of 200 deltas with 64 agents present does not commit the roster either (it depends on the page of each agent, not on the document)", async () => {
    const view = await openEditor();
    const ids = nodeIds(view);
    act(() => {
      for (let i = 0; i < AGENTS; i += 1) view.rig.sockets.last.receive(presence(i, ids));
    });
    view.log.reset();
    const before = view.rig.client.store.state.doc!;
    view.rig.deliver(...Array.from({ length: 200 }, (_, i) => nodeDelta(before, ids[100 + i] as string, { x: i }, 2 + i)));
    expect(view.rig.client.store.state.version).toBe(201);
    for (const id of editorRegionIds) expect(view.log.commits(id), id).toBe(0);
    view.unmount();
  });

  it("the team status and the workspace notice commit only their own region", async () => {
    const view = await openEditor();
    view.rig.push({ type: "team", status: { id: "me", name: "laptop", fingerprint: "A", team: { id: "t", name: "Team", members: [], removed: [], member: true, canRemove: false }, peers: [], docs: [], rejected: 0 } });
    for (const id of others("team")) expect(view.log.commits(id), id).toBe(0);
    expect(view.log.commits("team")).toBeGreaterThan(0);
    view.log.reset();
    view.rig.push({ type: "workspaceOp", op: { at: 1, actor: "agent:claude", op: "open", workspaceId: "other", workspaceName: "Other", detail: {} } });
    for (const id of others("notice")) expect(view.log.commits(id), id).toBe(0);
    expect(view.log.commits("notice")).toBeGreaterThan(0);
    view.log.reset();
    view.rig.push({ type: "pins", rev: 4 });
    for (const id of editorRegionIds) expect(view.log.commits(id), id).toBe(0);
    view.unmount();
  });
});
