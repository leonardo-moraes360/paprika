import { describe, expect, it } from "vitest";
import { makeDocument } from "@/test/live-harness";
import { actorTone, AGENT_IDLE_MS, agentIdentities, deriveActiveAgents, noActiveAgents, pageOfNode } from "./active-agents";

const doc = makeDocument(60, { pageCount: 2 });
const agent = (id: string, actor: string, nodes: string[], at: number) => ({ agent: id, actor, nodes, at });

describe("active agents", () => {
  it("names agents after their actor, numbers repeats and gives tones by order of arrival (four, then again)", () => {
    const ids = agentIdentities([agent("a", "agent:claude", [], 0), agent("b", "agent:claude", [], 0), agent("c", "agent:codex", [], 0), agent("d", "agent:x", [], 0), agent("e", "agent:y", [], 0)]);
    expect(ids.get("a")).toEqual({ name: "claude", tone: "agent-1" });
    expect(ids.get("b")).toEqual({ name: "claude 2", tone: "agent-2" });
    expect(ids.get("c")).toEqual({ name: "codex", tone: "agent-3" });
    expect(ids.get("e")).toEqual({ name: "y", tone: "agent-1" });
  });

  it("counts only agents active within the idle window, and maps nodes and pages", () => {
    const now = 1_000_000;
    const state = deriveActiveAgents([agent("a", "agent:claude", ["n3", "n4"], now - 1000), agent("b", "agent:old", ["n5"], now - AGENT_IDLE_MS - 1)], doc, now);
    expect(state.count).toBe(1);
    expect([...state.nodes.keys()]).toEqual(["n3", "n4"]);
    expect(state.nodes.get("n3")?.name).toBe("claude");
    expect(state.pages.get("page-0")).toBe(1);
    expect(deriveActiveAgents([agent("b", "agent:old", ["n5"], now - AGENT_IDLE_MS - 1)], doc, now)).toBe(noActiveAgents);
  });

  it("returns the previous object when nothing it describes changed (a heartbeat)", () => {
    const now = 1_000_000;
    const a = deriveActiveAgents([agent("a", "agent:claude", ["n3"], now - 1000)], doc, now);
    const b = deriveActiveAgents([agent("a", "agent:claude", ["n3"], now - 10)], doc, now + 5, a);
    expect(b).toBe(a);
    const c = deriveActiveAgents([agent("a", "agent:claude", ["n3", "n4"], now)], doc, now, a);
    expect(c).not.toBe(a);
    expect(c.pages).toBe(a.pages);
  });

  it("finds the page of a node and gives an actor a tone", () => {
    expect(pageOfNode(doc, "n3")).toBe("page-0");
    expect(pageOfNode(doc, "nope")).toBeNull();
    expect(actorTone("agent:b", ["agent:a", "agent:b"])).toBe("agent-2");
    expect(actorTone("agent:zzz", [])).toMatch(/^agent-[1-4]$/);
    expect(actorTone("agent:zzz", [])).toBe(actorTone("agent:zzz", ["agent:q"]));
  });
});
