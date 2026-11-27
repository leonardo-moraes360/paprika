import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasCollabFeed } from "@/components/frontends/canvas";
import type { Node } from "@paprika/core";
import { fakeHttp, jsonResponse, renderRegions, serve } from "@/test/collab-harness";
import { deltaMessage } from "@/test/live-harness";
import { BUILD_STEP_MS } from "@/adapters/canvas-collab";
import { COLLAB_TICK_MS, useCanvasCollab } from "./canvas-collab";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const feedRef: { current: CanvasCollabFeed | null } = { current: null };
function Probe() {
  const { collab, source } = useCanvasCollab();
  feedRef.current = collab;
  return <>{source}</>;
}

async function setup() {
  fakeHttp({ "GET /api/pins": () => jsonResponse({ pins: [] }) });
  // Before the editor mounts: the feed's clock is made when it starts.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  const view = await renderRegions({ regions: [["canvas", <Probe key="p" />]] });
  serve(view.rig, view.doc);
  return view;
}

const presence = (over = {}) => ({ type: "presence" as const, agent: "a1", actor: "agent:claude", tool: "update_nodes", nodes: ["n3"], idle: 0, ...over });

describe("the presence feed of the canvas", () => {
  it("shows an agent with its name, verb and tone, and keeps the same list for a heartbeat", async () => {
    const view = await setup();
    view.rig.push(presence());
    const first = feedRef.current!.get().agents;
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ name: "claude", verb: "editing", activity: "writing", nodes: ["n3"], idle: false });
    expect(first[0]?.tone).toMatch(/^agent-\d$/);
    view.rig.push(presence({ idle: 0 }));
    expect(feedRef.current!.get().agents).toBe(first);
  });

  it("an agent that goes quiet turns idle by itself (a clock, no message) and, after two minutes, leaves", async () => {
    const view = await setup();
    view.rig.push(presence());
    act(() => void vi.advanceTimersByTime(16_000 + COLLAB_TICK_MS));
    expect(feedRef.current!.get().agents[0]?.idle).toBe(true);
    act(() => void vi.advanceTimersByTime(110_000));
    expect(feedRef.current!.get().agents).toEqual([]);
  });

  it("follows the pin selected in the list", async () => {
    const view = await setup();
    act(() => view.handle.current!.actions.setPin("p9"));
    expect(feedRef.current!.get().pinId).toBe("p9");
  });
});

const created = (view: Awaited<ReturnType<typeof setup>>, version: number, actor: string, ids: string[], kind = "ops") => {
  const doc = view.rig.client.store.state.doc!;
  const set: Record<string, Node> = {};
  for (const id of ids) set[id] = { id, type: "rect", name: id, parentId: "frame-0-0", x: 0, y: 0, width: 5, height: 5, rotation: 0, opacity: 1, visible: true, locked: false } as unknown as Node;
  const frame = doc.nodes["frame-0-0"] as Node & { children: string[] };
  set["frame-0-0"] = { ...frame, children: [...frame.children, ...ids] } as Node;
  view.rig.deliver(deltaMessage(doc, version, { actor, kind, nodes: { set } }));
};

describe("the build replay of the canvas", () => {
  it("walks what an agent created, one node at a time, and ends", async () => {
    const view = await setup();
    created(view, 2, "agent:claude", ["new-1", "new-2", "new-3"]);
    expect(feedRef.current!.get().build.map((step) => step.id)).toEqual(["new-1"]);
    act(() => void vi.advanceTimersByTime(BUILD_STEP_MS + 5));
    expect(feedRef.current!.get().build.map((step) => step.id)).toEqual(["new-2"]);
    act(() => void vi.advanceTimersByTime(BUILD_STEP_MS));
    expect(feedRef.current!.get().build.map((step) => step.id)).toEqual(["new-3"]);
    act(() => void vi.advanceTimersByTime(BUILD_STEP_MS * 2));
    expect(feedRef.current!.get().build).toEqual([]);
  });

  it("does not replay what a person made, or a reload", async () => {
    const view = await setup();
    created(view, 2, "user", ["mine"]);
    created(view, 3, "agent:claude", ["reloaded"], "reload");
    act(() => void vi.advanceTimersByTime(BUILD_STEP_MS * 3));
    expect(feedRef.current!.get().build).toEqual([]);
  });

  it("does not replay with reduced motion", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    const view = await setup();
    created(view, 2, "agent:claude", ["a", "b"]);
    act(() => void vi.advanceTimersByTime(BUILD_STEP_MS * 3));
    expect(feedRef.current!.get().build).toEqual([]);
  });
});
