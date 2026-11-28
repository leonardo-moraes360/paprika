import { describe, expect, it } from "vitest";
import type { ServerPin } from "@/data/queries/pins";
import { appendBuild, buildPace, buildSteps, createdInOrder, nextPinNumber, stepBuild, toCanvasAgents, toCanvasPins, AGENT_SHOW_MS, BUILD_STEP_MS, BUILD_WALK_CAP_MS } from "./canvas-collab";

const verb = (tool: string) => `v:${tool}`;
const presence = (over: Partial<Parameters<typeof toCanvasAgents>[0][number]> = {}) => ({ agent: "a1", actor: "agent:claude", tool: "update_nodes", nodes: ["n1"], at: 1000, ...over });

describe("toCanvasAgents", () => {
  it("gives each agent its name, tone, verb, activity and nodes", () => {
    const [agent] = toCanvasAgents([presence()], { "agent:claude": "agent-3" }, 2000, verb);
    expect(agent).toEqual({ id: "a1", name: "claude", tone: "agent-3", tool: "update_nodes", verb: "v:update_nodes", activity: "writing", nodes: ["n1"], idle: false });
  });

  it("numbers several agents of one client like the roster", () => {
    const names = toCanvasAgents([presence(), presence({ agent: "a2" })], {}, 2000, verb).map((agent) => agent.name);
    expect(names).toEqual(["claude", "claude 2"]);
  });

  it("is idle after 15 s and gone after 2 minutes; a reader is reading", () => {
    expect(toCanvasAgents([presence({ at: 0, tool: "get_nodes" })], {}, 15_000, verb)[0]).toMatchObject({ idle: false, activity: "reading" });
    expect(toCanvasAgents([presence({ at: 0 })], {}, 15_001, verb)[0]?.idle).toBe(true);
    expect(toCanvasAgents([presence({ at: 0 })], {}, AGENT_SHOW_MS, verb)).toEqual([]);
  });

  it("keeps the identity of what did not change, so a heartbeat is not news", () => {
    const first = toCanvasAgents([presence()], {}, 2000, verb);
    expect(toCanvasAgents([presence({ at: 1500 })], {}, 2500, verb, first)).toBe(first);
    const moved = toCanvasAgents([presence({ nodes: ["n2"] })], {}, 2500, verb, first);
    expect(moved).not.toBe(first);
  });

  it("64 agents: the same array when nothing changed, and one new object for the one that did", () => {
    const list = Array.from({ length: 64 }, (_, i) => presence({ agent: `a${i}`, actor: `agent:c${i}`, nodes: [`n${i}`] }));
    const first = toCanvasAgents(list, {}, 2000, verb);
    expect(first).toHaveLength(64);
    expect(toCanvasAgents(list.map((p) => ({ ...p, at: p.at + 10 })), {}, 2100, verb, first)).toBe(first);
    const next = toCanvasAgents(list.map((p, i) => (i === 7 ? { ...p, tool: "get_nodes" } : p)), {}, 2100, verb, first);
    expect(next.filter((agent, i) => agent !== first[i])).toHaveLength(1);
  });
});

const pin = (over: Partial<ServerPin> = {}): ServerPin => ({ id: "p1", n: 1, workspaceId: "w", pageId: "pg", nodeId: "n1", region: { x: 1, y: 2, width: 3, height: 4 }, text: "t", author: "user", status: "open", createdAt: 1, updatedAt: 1, ...over });

describe("toCanvasPins", () => {
  const label = (n: number) => `Pin ${n}`;
  it("keeps the pins not resolved, with the tone of whoever claimed one", () => {
    const pins = toCanvasPins([pin(), pin({ id: "p2", n: 2, status: "resolved" }), pin({ id: "p3", n: 3, status: "claimed", claimedBy: "agent:codex" })], { "agent:codex": "agent-2" }, label);
    expect(pins.map((p) => [p.id, p.status, p.tone, p.label])).toEqual([["p1", "open", undefined, "Pin 1"], ["p3", "claimed", "agent-2", "Pin 3"]]);
  });

  it("a pin whose node is gone points at its area; one with no page has none", () => {
    const [gone, loose] = toCanvasPins([pin({ nodeMissing: true }), pin({ id: "p2", pageId: undefined, nodeId: undefined })], {}, label);
    expect(gone?.nodeId).toBeNull();
    expect(loose).toMatchObject({ nodeId: null, pageId: null });
  });

  it("is the same array for a refetch of the same pins", () => {
    const first = toCanvasPins([pin()], {}, label);
    expect(toCanvasPins([pin()], {}, label, first)).toBe(first);
    expect(toCanvasPins([pin({ n: 5 })], {}, label, first)).not.toBe(first);
  });

  it("numbers the next pin after the highest, resolved ones included", () => {
    expect(nextPinNumber([])).toBe(1);
    expect(nextPinNumber([pin({ n: 3, status: "resolved" }), pin({ n: 2 })])).toBe(4);
  });
});

const doc = (ids: Record<string, string[]>, id = "d") =>
  ({ id, rootIds: ["pg"], nodes: { pg: { id: "pg", type: "page", children: ids.pg }, ...Object.fromEntries(Object.entries(ids).filter(([k]) => k !== "pg").map(([k, children]) => [k, { id: k, type: "frame", parentId: "pg", children }])) } }) as never;

describe("the build replay", () => {
  it("lists what was created in the order of the document, never a page, and nothing for another document", () => {
    const before = doc({ pg: ["a"], a: [] });
    const after = doc({ pg: ["a", "b"], a: ["c"], b: [], c: [] });
    expect(createdInOrder(before, after)).toEqual(["c", "b"]);
    expect(createdInOrder(null, after)).toEqual([]);
    expect(createdInOrder(doc({ pg: [] }, "other"), after)).toEqual([]);
  });

  it("walks 120 ms a node, or in strides over two seconds when there are many", () => {
    expect(buildPace(5)).toEqual({ stepMs: BUILD_STEP_MS, stride: 1 });
    const many = buildPace(500);
    expect(many.stepMs).toBe(40);
    expect(many.stride).toBe(Math.ceil(500 / (BUILD_WALK_CAP_MS / 40)));
  });

  it("steps the walk with the clock, ends it past the last node, and appends to the walk of the same agent", () => {
    let walks = appendBuild([], "agent:claude", ["a", "b", "c"], 0);
    expect(walks[0]).toMatchObject({ index: 0, nextAt: BUILD_STEP_MS });
    expect(stepBuild(walks, 100)[0]?.index).toBe(0);
    expect(stepBuild(walks, BUILD_STEP_MS)[0]?.index).toBe(1);
    expect(stepBuild(walks, BUILD_STEP_MS * 3)).toEqual([]);
    walks = appendBuild(walks, "agent:claude", ["c", "d"], 50);
    expect(walks).toHaveLength(1);
    expect(walks[0]?.ids).toEqual(["a", "b", "c", "d"]);
    expect(appendBuild(walks, "agent:codex", ["x"], 50)).toHaveLength(2);
  });

  it("shows the node each walk is on with its agent's tone, the same array while it stays", () => {
    const walks = appendBuild([], "agent:claude", ["a", "b"], 0);
    const first = buildSteps(walks, { "agent:claude": "agent-4" });
    expect(first).toEqual([{ id: "a", tone: "agent-4" }]);
    expect(buildSteps(walks, { "agent:claude": "agent-4" }, first)).toBe(first);
  });
});
