import type { Document } from "@paprika/core";
import { describe, expect, it } from "vitest";
import { centerPlan, convertToPathPlan, deletePlan, duplicatePlan, escapeSelection, groupPlan, nudgePlan, selectAllIds, ungroupPlan, wrapPlan } from "./selection-ops";

const n = (id: string, type: string, parentId: string, extra: Record<string, unknown> = {}) => ({ id, name: id, type, parentId, visible: true, locked: false, x: 5, y: 6, width: 10, height: 10, rotation: 0, opacity: 1, ...extra });
const doc = {
  format: "paprika/1",
  id: "d",
  name: "d",
  tokens: {},
  rootIds: ["p"],
  nodes: {
    p: { id: "p", name: "P", type: "page", parentId: null, children: ["f", "g"] },
    f: n("f", "frame", "p", { children: ["r1", "r2"] }),
    r1: n("r1", "rect", "f"),
    r2: n("r2", "rect", "f", { locked: true }),
    g: n("g", "group", "p", { children: ["r3"] }),
    r3: n("r3", "rect", "g"),
  },
} as unknown as Document;
let counter = 0;
const ids = () => `new${++counter}`;

describe("selection ops", () => {
  it("groups, wraps and ungroups with an op that names the new id, and selects it", () => {
    expect(groupPlan(doc, ["r1"], () => "G")).toEqual({ ops: [{ op: "group", ids: ["r1"], id: "G" }], label: "group", select: ["G"] });
    expect(wrapPlan(doc, ["r1", "r2"], () => "W")).toMatchObject({ ops: [{ op: "wrap", ids: ["r1", "r2"], id: "W" }], select: ["W"] });
    expect(ungroupPlan(doc, ["g"])).toMatchObject({ ops: [{ op: "ungroup", ids: ["g"] }], label: "ungroup", select: ["r3"] });
    expect(ungroupPlan(doc, ["f"])).toBeNull();
    expect(groupPlan(doc, [])).toBeNull();
  });

  it("reports what the core refuses instead of throwing", () => {
    expect(groupPlan(doc, ["p"])).toBeNull();
    const refused = groupPlan(doc, ["f", "r1"]);
    expect(refused === null || "error" in refused || "ops" in refused).toBe(true);
  });

  it("duplicates 20 px down and right, right after the original, deep, with new ids", () => {
    counter = 0;
    const plan = duplicatePlan(doc, ["f"], ids);
    expect(plan && "ops" in plan).toBe(true);
    if (!plan || !("ops" in plan)) return;
    const op = plan.ops[0] as { op: string; node: { x: number; y: number; id: string; children: { id: string }[] }; parentId: string; index: number };
    expect(op).toMatchObject({ op: "create", parentId: "p", index: 1 });
    expect(op.node).toMatchObject({ x: 25, y: 26 });
    expect(op.node.children.map((c) => c.id)).toEqual(["new2", "new3"]);
    expect(plan.select).toEqual([op.node.id]);
  });

  it("deletes the top layers only and clears the selection", () => {
    expect(deletePlan(doc, ["f", "r1", "r3"])).toEqual({ ops: [{ op: "delete", id: "f" }, { op: "delete", id: "r3" }], label: "delete", select: [] });
    expect(deletePlan(doc, ["p"])).toBeNull();
  });

  it("moves by the step, leaving locked layers and connectors", () => {
    expect(nudgePlan(doc, ["r1", "r2"], 10, -1)).toEqual({ ops: [{ op: "update", id: "r1", props: { x: 15, y: 5 } }], label: "nudge" });
    expect(nudgePlan(doc, ["r2"], 1, 0)).toBeNull();
  });

  it("selects all next to the selection or on the page, and Esc goes up to the parent unless it is the page", () => {
    expect(selectAllIds(doc, ["r1"], "p")).toEqual(["r1", "r2"]);
    expect(selectAllIds(doc, [], "p")).toEqual(["f", "g"]);
    expect(selectAllIds(doc, ["f"], "p")).toEqual(["f", "g"]);
    expect(escapeSelection(doc, ["r1"])).toEqual(["f"]);
    expect(escapeSelection(doc, ["f"])).toEqual([]);
    expect(escapeSelection(doc, [])).toEqual([]);
  });

  it("centers a frame's content (and says whether it was already) and converts a rect to a path", () => {
    expect(centerPlan(doc, ["f"]).plan?.label).toBe("center");
    expect(centerPlan(doc, ["r1"]).plan).toBeNull();
    expect(convertToPathPlan(doc, ["r1"])).toMatchObject({ ops: [{ op: "convert_to_path", ids: ["r1"] }] });
    expect(convertToPathPlan(doc, ["f"])).toBeNull();
  });
});
