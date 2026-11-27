import { act, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Node } from "@paprika/core";
import { editorRegionIds } from "@/editor/editor";
import { stubLayout } from "@/test/canvas-fixtures";
import { deltaMessage, nodeDelta, renderEditorRig, serveDocument } from "@/test/live-harness";

/**
 * Batch 4 of the canvas (presence, pins, the build replay) with a document of 5 000 nodes on one page and up to 64 agents: what it
 * commits. Counts are commits of the React Profiler and renders of nodes (deterministic); the durations of jsdom are not asserted.
 * The regions that already showed presence (the pages, the layers, the roster in the header) are counted by `collab.perf.test.tsx`
 * with the batch in place; here the point is that the canvas shows 64 agents without rendering one node and without
 * committing more than once per frame, and that the `properties` region and the rest stay at 0.
 */
const NODES = 5000;
const AGENTS = 64;
const regions = [...editorRegionIds, "canvas"];

/**
 * Commits of the same scenarios at the base commit of the batch (28a0c02, before the canvas drew presence), measured with this file's
 * scenarios on that tree: what `layers` and `properties` already did for them. The canvas must add nothing to them.
 */
const BASE = { delta: { properties: 1, layers: 0 }, idle20: { properties: 2, layers: 0 }, build: { properties: 4 } } as const;

let restoreLayout: () => void;
beforeAll(() => {
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [] });
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
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "requestAnimationFrame", "cancelAnimationFrame"] });
  await elapse(300);
  const doc = view.rig.client.store.state.doc!;
  view.rig.deliver(nodeDelta(doc, Object.keys(doc.nodes)[10] as string, { x: 1 }, 2));
  await elapse(300);
  view.log.reset();
  const world = screen.getByTestId("canvas-world");
  const renders = () => (world as unknown as { __paprikaNodeRenders: number }).__paprikaNodeRenders;
  return { ...view, world, renders, ids: Object.keys(doc.nodes) };
}

type View = Awaited<ReturnType<typeof open>>;
const commitsOf = (view: View) => Object.fromEntries(regions.map((id) => [id, view.log.commits(id)]));
const presence = (i: number, ids: string[], tool = i % 3 === 0 ? "get_nodes" : "update_nodes", span = 3) => ({
  type: "presence" as const,
  agent: `s:${i}`,
  actor: `agent:client-${i % 8}`,
  tool,
  nodes: Array.from({ length: span }, (_, k) => ids[200 + i * 5 + k] as string),
  idle: 0,
});
const lift = (view: View) => view.world.querySelectorAll("[data-paprika-id]").length;

describe("goal: presence on the canvas with 5 000 nodes and 64 agents", () => {
  it("64 agents draw their cursors and boxes: no node renders, the canvas commits once, properties and the rest not at all", async () => {
    const view = await open();
    const before = view.renders();
    view.rig.push(...Array.from({ length: AGENTS }, (_, i) => presence(i, view.ids)));
    await elapse(50);
    expect(view.renders() - before).toBe(0);
    expect(view.log.commits("canvas")).toBeLessThanOrEqual(2);
    expect(view.log.commits("properties")).toBe(0);
    expect(document.querySelectorAll("[data-testid='agent-cursor']")).toHaveLength(AGENTS);
    expect(document.querySelectorAll("[data-agent-box]")).toHaveLength(AGENTS * 3);
    // Every agent's cursor was placed (the measure ran), nothing was added to the document.
    const placed = [...document.querySelectorAll<HTMLElement>("[data-agent-box]")].filter((el) => el.style.display === "block");
    expect(placed.length).toBeGreaterThan(0);
    expect(lift(view)).toBe(NODES - 1);
    process.stderr.write(`[perf canvas-4 jsdom] 64 agents arriving: ${JSON.stringify(commitsOf(view))}, node renders ${view.renders() - before}\n`);
    view.unmount();
  });

  it("a heartbeat of every agent (same nodes, newer) commits nothing anywhere and renders no node", async () => {
    const view = await open();
    view.rig.push(...Array.from({ length: AGENTS }, (_, i) => presence(i, view.ids)));
    await elapse(50);
    view.log.reset();
    const before = view.renders();
    for (let frame = 0; frame < 10; frame += 1) {
      view.rig.push(...Array.from({ length: AGENTS }, (_, i) => presence(i, view.ids)));
      await elapse(16);
    }
    expect(view.renders() - before).toBe(0);
    expect(commitsOf(view)).toEqual(Object.fromEntries(regions.map((id) => [id, 0])));
    view.unmount();
  });

  it("every agent changing what it touches in one frame is one commit of the canvas, no node renders, nothing else", async () => {
    const view = await open();
    view.rig.push(...Array.from({ length: AGENTS }, (_, i) => presence(i, view.ids)));
    await elapse(50);
    view.log.reset();
    const before = view.renders();
    view.rig.push(...Array.from({ length: AGENTS }, (_, i) => ({ ...presence(i, view.ids, "update_nodes"), nodes: [view.ids[900 + i] as string] })));
    await elapse(16);
    expect(view.renders() - before).toBe(0);
    expect(view.log.commits("canvas")).toBeLessThanOrEqual(1);
    expect(view.log.commits("properties")).toBe(0);
    view.unmount();
  });

  it("a delta on ONE node with 64 agents on screen renders that node and commits the canvas once; layers and properties as they were", async () => {
    const view = await open();
    view.rig.push(...Array.from({ length: AGENTS }, (_, i) => presence(i, view.ids)));
    await elapse(50);
    view.log.reset();
    const doc = view.rig.client.store.state.doc!;
    const before = view.renders();
    view.rig.deliver(nodeDelta(doc, view.ids[2500] as string, { x: 321 }, 3));
    expect(view.renders() - before).toBe(1);
    expect(view.log.commits("canvas")).toBe(1);
    // The same as the base (28a0c02) in this very scenario: the properties panel shows the document's activity (1), the layers do not move (0).
    expect(view.log.commits("properties")).toBe(BASE.delta.properties);
    expect(view.log.commits("layers")).toBe(BASE.delta.layers);
    view.unmount();
  });

  it("the idle clock of the canvas (2 s) commits the canvas only when an agent turned idle, never a node", async () => {
    const view = await open();
    view.rig.push(...Array.from({ length: AGENTS }, (_, i) => presence(i, view.ids)));
    await elapse(50);
    view.log.reset();
    const before = view.renders();
    await elapse(10_000);
    expect(view.log.commits("canvas")).toBe(0);
    await elapse(10_000);
    expect(view.log.commits("canvas")).toBeLessThanOrEqual(1);
    expect(view.renders() - before).toBe(0);
    // The base's own clock of the properties panel ("ago") and of the roster, 20 s: the canvas adds nothing to them.
    expect(view.log.commits("properties")).toBe(BASE.idle20.properties);
    expect(view.log.commits("layers")).toBe(BASE.idle20.layers);
    view.unmount();
  });
});

describe("goal: the build replay with 5 000 nodes", () => {
  it("an agent creating 200 nodes: the walk of two seconds marks nodes by attribute and commits nothing", async () => {
    const view = await open();
    const doc = view.rig.client.store.state.doc!;
    const parent = Object.keys(doc.nodes).find((id) => doc.nodes[id]!.type === "frame") as string;
    const set: Record<string, Node> = {};
    const made = Array.from({ length: 200 }, (_, i) => `made-${i}`);
    for (const id of made) set[id] = { id, type: "rect", name: id, parentId: parent, x: 0, y: 0, width: 5, height: 5, rotation: 0, opacity: 1, visible: true, locked: false, fill: "#000000" } as unknown as Node;
    set[parent] = { ...(doc.nodes[parent] as Node & { children: string[] }), children: [...(doc.nodes[parent] as Node & { children: string[] }).children, ...made] } as Node;
    view.rig.deliver(deltaMessage(doc, 3, { actor: "agent:claude", kind: "ops", nodes: { set } }));
    await elapse(20);
    view.log.reset();
    const before = view.renders();
    let marked = 0;
    for (let tick = 0; tick < 60; tick += 1) {
      await elapse(40);
      marked += view.world.querySelectorAll("[data-build='current']").length;
    }
    expect(marked).toBeGreaterThan(10);
    expect(view.renders() - before).toBe(0);
    expect(commitsOf(view)).toEqual({ ...Object.fromEntries(regions.map((id) => [id, 0])), properties: BASE.build.properties });
    await elapse(500);
    expect(view.world.querySelectorAll("[data-build]")).toHaveLength(0);
    process.stderr.write(`[perf canvas-4 jsdom] build replay: ${marked} marks over the walk, commits ${JSON.stringify(commitsOf(view))}\n`);
    view.unmount();
  });
});
