import { describe, expect, it } from "vitest";
import { everyKindDocument } from "@/test/canvas-fixtures";
import { dropAccepts, isAbsolute, isDeep, isFlowFrame, isResizable, isToggle, isTransformable, movableNodes, pickTarget } from "./target";

const doc = everyKindDocument();

describe("pickTarget", () => {
  it("a click on a child of a group picks the group; once the group is selected, the next click goes in", () => {
    expect(pickTarget(doc, "dot", [])).toBe("pair");
    expect(pickTarget(doc, "dot", ["home"])).toBe("pair");
    expect(pickTarget(doc, "dot", ["pair"])).toBe("pair");
    expect(pickTarget(doc, "dot", ["dot"])).toBe("dot");
  });
  it("a plain node (or one in a plain frame) is itself", () => {
    expect(pickTarget(doc, "title", [])).toBe("title");
  });
});

describe("rules", () => {
  it("flow, absolute, movable, resizable", () => {
    expect(isFlowFrame(doc.nodes.home)).toBe(true);
    expect(isFlowFrame(doc.nodes.box)).toBe(false);
    expect(isAbsolute(doc, doc.nodes.turned!)).toBe(false);
    expect(isAbsolute(doc, doc.nodes.box!)).toBe(true);
    expect(movableNodes(doc, ["box", "arrow", "nope"]).map((n) => n.id)).toEqual(["box"]);
    expect(isResizable(doc, doc.nodes.box)).toBe(true);
    expect(isResizable(doc, doc.nodes.pair)).toBe(false);
    expect(isResizable(doc, doc.nodes.arrow)).toBe(false);
    expect(isResizable(doc, doc.nodes["btn-copy"])).toBe(false);
    expect(isTransformable(doc, doc.nodes.box)).toBe(true);
  });
  it("a drop goes into a frame or a group, never into itself, a child, a leaf or an instance", () => {
    expect(dropAccepts(doc, null, new Set(["box"]))).toBe(true);
    expect(dropAccepts(doc, "home", new Set(["box"]))).toBe(true);
    expect(dropAccepts(doc, "pair", new Set(["pair"]))).toBe(false);
    expect(dropAccepts(doc, "dot", new Set(["home"]))).toBe(false);
    expect(dropAccepts(doc, "box", new Set(["end"]))).toBe(false);
    expect(dropAccepts(doc, "btn-copy", new Set(["box"]))).toBe(false);
    expect(dropAccepts(doc, "page", new Set(["box"]))).toBe(false);
  });
  it("modifiers: Shift or Cmd toggle, Ctrl alone is deep", () => {
    const k = (shiftKey = false, metaKey = false, ctrlKey = false) => ({ shiftKey, metaKey, ctrlKey });
    expect([isToggle(k(true)), isToggle(k(false, true)), isToggle(k(false, false, true)), isToggle(k(true, false, true))]).toEqual([true, true, false, true]);
    expect([isDeep(k(false, false, true)), isDeep(k(true, false, true)), isDeep(k())]).toEqual([true, false, false]);
  });
});
