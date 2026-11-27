import { describe, expect, it } from "vitest";
import type { StepResult } from "@/data/live/protocol";
import type { PanelStep } from "@/data/queries/history";
import { historyAuthor, pageOfNodes, stepNumber, stepOutcome, toHistorySteps } from "./history";

const step = (id: number, actor: string, extra: Partial<PanelStep> = {}): PanelStep => ({ id, actor, label: `step ${id}`, at: 1000 + id, ops: 1, undone: false, nodeIds: ["a"], ...extra });
const result = (extra: Partial<StepResult>): StepResult => ({ result: "undone", ord: 3, label: "L", actor: "user", newer: 0, withActor: "", withLabel: "", ...extra });

describe("history adapter", () => {
  it("turns numeric ids into strings, 'user' into you and an agent into a named, toned author", () => {
    const steps = toHistorySteps([step(1, "user"), step(2, "agent:claude", { undone: true }), step(3, "agent:claude")], ["agent:codex", "agent:claude"]);
    expect(steps.map((s) => s.id)).toEqual(["1", "2", "3"]);
    expect(steps[0]?.author).toEqual({ id: "user", name: "user", agent: false });
    expect(steps[1]?.author).toEqual({ id: "agent:claude", name: "claude", agent: true, tone: "agent-2" });
    expect(steps[1]?.author).toBe(steps[2]?.author);
    expect(steps[1]?.undone).toBe(true);
    expect(toHistorySteps(undefined, [])).toEqual([]);
    expect(historyAuthor("agent", []).name).toBe("agent");
  });

  it("maps a panel id back to the server's, refusing what is not one", () => {
    expect(stepNumber("12")).toBe(12);
    expect(stepNumber("x")).toBeNull();
    expect(stepNumber("1.5")).toBeNull();
  });

  it("reads the answers of undo and redo", () => {
    expect(stepOutcome(result({}), false, true)).toEqual({ kind: "undone", label: "L", ord: 3, newer: 0, agent: null, own: true });
    expect(stepOutcome(result({ actor: "agent:claude", newer: 2 }), false, false)).toMatchObject({ kind: "undone", agent: "claude", newer: 2 });
    expect(stepOutcome(result({ result: "redone" }), true, false)).toEqual({ kind: "redone", label: "L" });
    expect(stepOutcome(result({ result: "nothing", actor: "agent:claude" }), false, true)).toEqual({ kind: "nothing-mine", agent: "claude" });
    expect(stepOutcome(result({ result: "nothing", actor: "" }), false, true)).toEqual({ kind: "nothing" });
    expect(stepOutcome(result({ result: "nothing" }), true, true)).toEqual({ kind: "nothing-redo" });
    expect(stepOutcome(result({ result: "conflict" }), true, false)).toEqual({ kind: "conflict", redo: true });
    expect(stepOutcome(result({ result: "missing" }), false, false)).toEqual({ kind: "missing" });
  });

  it("keeps, of the nodes of a step, the ones that exist on the page of the first", () => {
    const nodes = { p1: { type: "page" }, p2: { type: "page" }, a: { type: "frame", parentId: "p1" }, b: { type: "rect", parentId: "a" }, c: { type: "rect", parentId: "p2" } };
    expect(pageOfNodes(nodes, ["gone", "b", "c", "a"])).toEqual({ ids: ["b", "a"], pageId: "p1" });
    expect(pageOfNodes(nodes, ["p1", "gone"])).toEqual({ ids: [], pageId: null });
  });
});
