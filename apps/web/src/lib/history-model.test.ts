import { describe, expect, it } from "vitest";
import { buildHistoryRows, filterSteps, flattenGroups, groupSteps, type HistoryAuthor, type HistoryStepData } from "./history-model";

const you: HistoryAuthor = { id: "user", name: "you", agent: false };
const claude: HistoryAuthor = { id: "agent:claude", name: "claude", agent: true };
const codex: HistoryAuthor = { id: "agent:codex", name: "codex", agent: true };

const step = (id: string, author: HistoryAuthor, at: number): HistoryStepData => ({ id, author, label: id, at, undone: false, nodeIds: [] });

const steps = [step("1", you, 1), step("2", claude, 2), step("3", claude, 3), step("4", codex, 4), step("5", claude, 5)];

describe("history model", () => {
  it("keeps only human steps with mineOnly", () => {
    expect(filterSteps(steps, true).map((s) => s.id)).toEqual(["1"]);
    expect(filterSteps(steps, false)).toHaveLength(5);
  });

  it("groups consecutive steps of the same author, newest first", () => {
    const groups = groupSteps(steps);
    expect(groups.map((g) => [g.author.name, g.steps.map((s) => s.id)])).toEqual([
      ["claude", ["5"]],
      ["codex", ["4"]],
      ["claude", ["3", "2"]],
      ["you", ["1"]],
    ]);
    expect(groups[2]?.newestAt).toBe(3);
  });

  it("flattens into a header followed by its steps with stable keys", () => {
    const rows = flattenGroups(groupSteps(steps));
    expect(rows.map((r) => r.kind)).toEqual(["header", "step", "header", "step", "header", "step", "step", "header", "step"]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it("returns no rows for no steps and merges the human steps when filtering", () => {
    expect(buildHistoryRows([], false)).toEqual([]);
    const mine = buildHistoryRows([step("a", you, 1), step("b", claude, 2), step("c", you, 3)], true);
    expect(mine.filter((r) => r.kind === "header")).toHaveLength(1);
    expect(mine.filter((r) => r.kind === "step")).toHaveLength(2);
  });
});
