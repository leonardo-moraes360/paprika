import { describe, expect, it } from "vitest";
import { actorName, agentTone, isStep, toActivityEntries, toPanelActivity, type ActivitySource } from "./activity";

const item = (id: number, actor: string, label: string, kind?: string, at = 1000): ActivitySource => ({ id, actor, label, at, kind });

describe("activity adapter", () => {
  it("an undo or redo is a step by its kind; without a kind the label prefix says so", () => {
    expect(isStep(item(1, "user", "x", "undo"))).toBe(true);
    expect(isStep(item(1, "user", "x", "redo"))).toBe(true);
    expect(isStep(item(1, "user", "desfazer: x", "ops"))).toBe(false);
    expect(isStep(item(1, "user", "desfazer: mover"))).toBe(true);
    expect(isStep(item(1, "user", "Refazer: mover"))).toBe(true);
    expect(isStep(item(1, "user", "undo: move"))).toBe(true);
    expect(isStep(item(1, "user", "mover"))).toBe(false);
  });

  it("names the actor: you, an agent without its prefix, anything else as is", () => {
    expect(actorName("agent:claude")).toBe("claude");
    expect(actorName("agent")).toBe("agent");
    expect(actorName("import")).toBe("import");
  });

  it("gives an agent the same tone every time, one of the four", () => {
    expect(agentTone("agent:claude")).toBe(agentTone("agent:claude"));
    for (const name of ["agent:a", "agent:b", "agent:c", "agent:d", "agent:e"]) expect(agentTone(name)).toMatch(/^agent-[1-4]$/);
  });

  it("maps the live list to entries: you x agent, tone, step, ids as strings, at most 15, memoized by list", () => {
    const list = Array.from({ length: 20 }, (_, i) => item(i + 1, i === 0 ? "user" : "agent:claude", "edit", i === 1 ? "undo" : "ops"));
    const entries = toActivityEntries(list);
    expect(entries).toHaveLength(15);
    expect(entries[0]).toMatchObject({ id: "1", actor: { you: true }, step: false });
    expect(entries[1]).toMatchObject({ actor: { name: "claude", tone: agentTone("agent:claude") }, step: true });
    expect(toActivityEntries(list)).toBe(entries);
  });

  it("builds the panel rows: you, tone, undone, batch runs of the same author, marker after the leading steps", () => {
    const entries = toActivityEntries([
      item(6, "user", "desfazer: a", "undo"),
      item(5, "agent:claude", "b", "ops"),
      item(4, "agent:claude", "c", "ops"),
      item(3, "user", "", "ops"),
      item(2, "agent:codex", "d", "ops"),
    ]);
    const { rows, marker } = toPanelActivity(entries, "You", "Edit");
    expect(marker).toBe(1);
    expect(rows.map((r) => r.undone)).toEqual([true, false, false, false, false]);
    expect(rows.map((r) => r.batch)).toEqual([false, true, true, false, false]);
    expect(rows[3]).toMatchObject({ author: "You", tone: "select-pill", label: "Edit" });
    expect(rows[1]).toMatchObject({ author: "claude", tone: agentTone("agent:claude") });
  });

  it("an empty list has no rows", () => {
    expect(toPanelActivity([], "You", "Edit")).toEqual({ rows: [], marker: 0 });
  });
});
