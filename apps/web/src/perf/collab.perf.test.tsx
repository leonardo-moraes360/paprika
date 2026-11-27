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
/**
 * The roster lives inside the header (as in the design). The header's profiler sees every commit of its subtree, but the
 * perf log counts for the header only the commits where something besides the roster rendered (see `NESTED_ONLY_MS`).
 */
const outsideRoster = others("agents").filter((id) => id !== "header");

describe("collaboration regions with a document of 5 000 nodes", () => {
  it("64 agents arriving in one frame commit only the roster, once", async () => {
    const view = await openEditor();
    const ids = nodeIds(view);
    act(() => {
      for (let i = 0; i < AGENTS; i += 1) view.rig.sockets.last.receive(presence(i, ids));
    });
    expect(view.rig.client.store.state.agents).toHaveLength(AGENTS);
    // The pages (who is on which page) and the layers (who touches which node) show the arrival, once each; nothing else does.
    for (const id of outsideRoster) expect(view.log.commits(id), id).toBe(id === "pages" || id === "layers" ? 1 : 0);
    // The roster: its mount and the sync of its clock on mount (`useNow`, in lib/), plus at most one for the tones of the 8 clients.
    expect(view.log.commits("agents")).toBeGreaterThan(0);
    expect(view.log.commits("agents")).toBeLessThanOrEqual(3);
    // The header itself renders once: the roster appears (its agents count changed). The roster's later commits are its own.
    expect(view.log.commits("header")).toBe(1);
    view.unmount();
  });

  it("every one of 64 agents reporting on its own commits the roster at most once per message and nothing else", async () => {
    const view = await openEditor();
    const ids = nodeIds(view);
    for (let i = 0; i < AGENTS; i += 1) view.rig.push(presence(i, ids));
    view.log.reset();
    for (let i = 0; i < AGENTS; i += 1) view.rig.push(presence(i, ids, "update_nodes"));
    // Nothing but the roster shows when an agent was last active: the header does not render for it.
    for (const id of outsideRoster) expect(view.log.commits(id), id).toBe(0);
    expect(view.log.commits("agents")).toBeLessThanOrEqual(AGENTS);
    expect(view.log.commits("agents")).toBeGreaterThan(0);
    expect(view.log.commits("header")).toBe(0);
    view.unmount();
  });

  it("the roster's clock ticks inside the roster: ten seconds commit it and no other region", async () => {
    const view = await openEditor();
    // From here on time is the test's (the editor opened on real timers, which `findBy*` needs); the roster's interval is created below, on the fake ones.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
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
    for (const id of outsideRoster) expect(view.log.commits(id), id).toBe(0);
    expect(view.log.commits("header")).toBe(0);
    view.unmount();
  });

  it("a burst of 200 deltas with 64 agents present does not commit the roster, the pages or the layers (they depend on the page and nodes of each agent, not on the document)", async () => {
    const view = await openEditor();
    const ids = nodeIds(view);
    act(() => {
      for (let i = 0; i < AGENTS; i += 1) view.rig.sockets.last.receive(presence(i, ids));
    });
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
