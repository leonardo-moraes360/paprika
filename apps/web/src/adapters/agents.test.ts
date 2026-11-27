import type { Document } from "@paprika/core";
import { describe, expect, it } from "vitest";
import { agentLabel, agentPages, toAgentEntries, toneFor, toolActivity, type AgentPresence } from "./agents";

const presence = (agent: string, actor: string, tool = "update_nodes", nodes: string[] = [], at = 1000): AgentPresence => ({ agent, actor, tool, nodes, at });

describe("agentLabel", () => {
  it("drops the agent: prefix and keeps a peer's name", () => {
    expect(agentLabel("agent:claude")).toBe("claude");
    expect(agentLabel("agent:claude @ Marina")).toBe("claude @ Marina");
    expect(agentLabel("agent:")).toBe("agent");
    expect(agentLabel(undefined)).toBe("agent");
  });
});

describe("toolActivity", () => {
  it("says reading for the read tools and for the read prefixes, writing for the rest", () => {
    for (const tool of ["get_nodes", "find_nodes", "get_document_outline", "render_screenshot", "lint_design", "export_code", "list_anything"]) expect(toolActivity(tool), tool).toBe("reading");
    for (const tool of ["update_nodes", "create_nodes", "apply_ops", "delete_nodes", "undo"]) expect(toolActivity(tool), tool).toBe("writing");
  });
});

describe("toneFor", () => {
  it("uses the tone the editor gave, and a stable one while there is none", () => {
    expect(toneFor("agent:a", { "agent:a": "agent-3" })).toBe("agent-3");
    const first = toneFor("agent:zed", {});
    expect(first).toMatch(/^agent-[1-4]$/);
    expect(toneFor("agent:zed", {})).toBe(first);
  });
});

describe("toAgentEntries", () => {
  it("numbers the sessions of one client in order of arrival and keeps one tone per client", () => {
    const tones = { "agent:claude": "agent-1", "agent:codex": "agent-2" } as const;
    const entries = toAgentEntries([presence("s:1", "agent:claude"), presence("s:2", "agent:codex", "get_nodes"), presence("s:3", "agent:claude")], tones);
    expect(entries.map((entry) => entry.name)).toEqual(["claude", "codex", "claude 2"]);
    expect(entries.map((entry) => entry.tone)).toEqual(["agent-1", "agent-2", "agent-1"]);
    expect(entries.map((entry) => entry.activity)).toEqual(["writing", "reading", "writing"]);
    expect(entries[0]).toMatchObject({ id: "s:1", tool: "update_nodes", lastActiveAt: 1000 });
  });

  it("adds the page of the agent when it has one", () => {
    const entries = toAgentEntries([presence("s:1", "agent:claude")], {}, [{ agent: "s:1", pageId: "p1", pageName: "Cover" }]);
    expect(entries[0]).toMatchObject({ pageId: "p1", pageName: "Cover" });
    expect(toAgentEntries([presence("s:1", "agent:claude")], {})[0]).not.toHaveProperty("pageId");
  });
});

describe("agentPages", () => {
  const doc = {
    rootIds: ["p1", "p2"],
    nodes: {
      p1: { id: "p1", type: "page", name: "Cover", parentId: null, children: ["f1"] },
      p2: { id: "p2", type: "page", name: "Editor", parentId: null, children: ["f2"] },
      f1: { id: "f1", type: "frame", name: "Home", parentId: "p1", children: ["r1"] },
      r1: { id: "r1", type: "rect", name: "Button", parentId: "f1" },
      f2: { id: "f2", type: "frame", name: "Shell", parentId: "p2", children: [] },
    },
  } as unknown as Document;

  it("finds the page of the first node of the presence that is still in the document", () => {
    const pages = agentPages(doc, [presence("a", "x", "t", ["gone", "r1"]), presence("b", "x", "t", ["f2"]), presence("c", "x", "t", ["gone"]), presence("d", "x", "t", [])]);
    expect(pages).toEqual([
      { agent: "a", pageId: "p1", pageName: "Cover" },
      { agent: "b", pageId: "p2", pageName: "Editor" },
    ]);
  });

  it("is empty without a document", () => {
    expect(agentPages(null, [presence("a", "x", "t", ["r1"])])).toEqual([]);
  });
});
