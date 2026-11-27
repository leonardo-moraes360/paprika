import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { editorRegionIds } from "@/editor/editor";
import { createLiveRig, nodeDelta, renderEditorRig, serveDocument } from "@/test/live-harness";
import { letRealTimersRun } from "@/test/real-settle";

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
/**
 * The roster lives inside the header (as in the design). The header's profiler sees every commit of its subtree, but the
 * perf log counts for the header only the commits where something besides the roster rendered (see `NESTED_ONLY_MS`).
 */
const outsideRoster = others("agents").filter((id) => id !== "header");

describe("collaboration regions with a document of 5 000 nodes", () => {
  it("64 agents arriving in separate socket tasks within one frame commit the roster, the pages and the layers once", async () => {
    const view = await openEditor();
    const ids = nodeIds(view);
    // Each message is its own task, as on a real socket: no `act` around the loop that would let React batch them for the store.
    for (let i = 0; i < AGENTS; i += 1) act(() => view.rig.sockets.last.receive(presence(i, ids)));
    // Nothing reached the store yet: presence waits for the frame like the document frames do.
    expect(view.rig.client.store.state.agents).toHaveLength(0);
    expect(view.rig.scheduler.pending).toBe(true);
    act(() => view.rig.scheduler.flush());
    expect(view.rig.client.store.state.agents).toHaveLength(AGENTS);
    // The pages (who is on which page) and the layers (who touches which node) show the arrival, once each; nothing else does.
    for (const id of outsideRoster) expect(view.log.commits(id), id).toBe(id === "pages" || id === "layers" ? 1 : 0);
    // The roster mounts (its first commit, with the clock read in the render and not again on mount) and shows the 64 in that same commit.
    expect(view.log.commits("agents")).toBe(1);
    // The header itself renders once: the roster appears (its agents count changed). The roster's later commits are its own.
    expect(view.log.commits("header")).toBe(1);
    view.unmount();
  });

  it("every one of 64 agents reporting on its own, in tasks of one frame, commits the roster and the layers at most once per frame and nothing else", async () => {
    const view = await openEditor();
    const ids = nodeIds(view);
    for (let i = 0; i < AGENTS; i += 1) view.rig.push(presence(i, ids));
    view.log.reset();
    // A frame: 64 reports, each its own task (every agent touches a node of its own), then the frame's flush.
    for (let i = 0; i < AGENTS; i += 1) act(() => view.rig.sockets.last.receive(presence(i, ids, "update_nodes")));
    act(() => view.rig.scheduler.flush());
    for (const id of outsideRoster) expect(view.log.commits(id), id).toBeLessThanOrEqual(1);
    expect(view.log.commits("agents")).toBeLessThanOrEqual(1);
    expect(view.log.commits("layers")).toBe(0);
    expect(view.log.commits("header")).toBe(0);
    // The same agents again with the same nodes, only newer: the layers do not move and the roster, whose clock shows seconds, does not move either.
    view.log.reset();
    for (let i = 0; i < AGENTS; i += 1) act(() => view.rig.sockets.last.receive(presence(i, ids, "update_nodes")));
    act(() => view.rig.scheduler.flush());
    for (const id of editorRegionIds) expect(view.log.commits(id), id).toBe(0);
    view.unmount();
  });

  it("the roster's clock ticks inside the roster: ten seconds commit it and no other region", async () => {
    const view = await openEditor();
    // From here on time is the test's (the editor opened on real timers, which `findBy*` needs); the roster's interval is created below, on the fake ones.
    await letRealTimersRun();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const ids = nodeIds(view);
    view.rig.push(...Array.from({ length: AGENTS }, (_, i) => presence(i, ids)));
    view.log.reset();
    for (let second = 0; second < 10; second += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    expect(view.log.commits("agents")).toBeGreaterThanOrEqual(5);
    for (const id of outsideRoster) expect(view.log.commits(id), id).toBe(0);
    expect(view.log.commits("header")).toBe(0);
    view.unmount();
  });

  it("an agent that reports again commits the roster only when the report moves its last-active time by a second or more, and nothing else", async () => {
    // The client reads the clock through `Date.now` at each call, so the test's fake clock moves it.
    const rig = createLiveRig({ now: () => Date.now() });
    const view = await renderEditorRig({ nodes: NODES, client: rig });
    serveDocument(view.rig, view.doc);
    await screen.findByRole("banner");
    await letRealTimersRun();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const ids = nodeIds(view);
    view.rig.push(presence(0, ids, "update_nodes"));
    view.log.reset();
    await act(async () => void (await vi.advanceTimersByTimeAsync(400)));
    view.rig.push(presence(0, ids, "update_nodes"));
    for (const id of editorRegionIds) expect(view.log.commits(id), id).toBe(0);
    await act(async () => void (await vi.advanceTimersByTimeAsync(1200)));
    view.rig.push(presence(0, ids, "update_nodes"));
    // 1.6 s after the one the roster shows: the roster re-renders (its "last active" moved), the rest does not.
    expect(view.log.commits("agents")).toBe(1);
    for (const id of editorRegionIds.filter((r) => r !== "agents")) expect(view.log.commits(id), id).toBe(0);
    view.unmount();
  });

  it("a burst of 200 deltas with 64 agents present does not commit the roster, the pages or the layers (they depend on the page and nodes of each agent, not on the document)", async () => {
    const view = await openEditor();
    const ids = nodeIds(view);
    view.rig.push(...Array.from({ length: AGENTS }, (_, i) => presence(i, ids)));
    view.log.reset();
    const before = view.rig.client.store.state.doc!;
    view.rig.deliver(...Array.from({ length: 200 }, (_, i) => nodeDelta(before, ids[100 + i] as string, { x: i }, 2 + i)));
    expect(view.rig.client.store.state.version).toBe(201);
    // stage: the first edit flips "can undo" in the toolbar. properties: the document panel lists the new activity entries (once for the burst).
    for (const id of editorRegionIds) expect(view.log.commits(id), id).toBe(id === "stage" || id === "properties" ? 1 : 0);
    view.unmount();
  });

  it("the team status and the workspace notice commit only their own region", async () => {
    const view = await openEditor();
    view.rig.push({ type: "team", status: { id: "me", name: "laptop", fingerprint: "A", team: { id: "t", name: "Team", members: [], removed: [], member: true, canRemove: false }, peers: [], docs: [], rejected: 0 } });
    // The header shows the pill, and the properties panel gets its tabs in the header slot. The team tab is not open, so the team panel is not mounted.
    for (const id of editorRegionIds) expect(view.log.commits(id), id).toBe(id === "header" || id === "properties" ? 1 : 0);
    expect(view.log.commits("team")).toBe(0);
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
