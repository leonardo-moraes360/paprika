import { describe, expect, it } from "vitest";
import { everyKindDocument } from "@/test/canvas-fixtures";
import { childrenSelection, cycleSibling, stackPlan, stackStep } from "./canvas-keys";

const doc = everyKindDocument();

describe("Enter: the children of the selection", () => {
  it("lists the layers inside each selected container, once, and nothing for a leaf", () => {
    expect(childrenSelection(doc, ["home"])).toEqual(["turned", "ghost", "title", "plain", "pic", "squiggle", "pair"]);
    expect(childrenSelection(doc, ["home", "pair"])).toEqual(["turned", "ghost", "title", "plain", "pic", "squiggle", "pair", "dot"]);
    expect(childrenSelection(doc, ["title"])).toEqual([]);
  });
});

describe("Tab: the siblings", () => {
  it("goes to the next, wraps round, and Shift goes back", () => {
    expect(cycleSibling(doc, ["turned"], 1)).toBe("ghost");
    expect(cycleSibling(doc, ["turned"], -1)).toBe("pair");
    expect(cycleSibling(doc, ["pair"], 1)).toBe("turned");
  });
  it("uses the last selected going forward and the first going back", () => {
    expect(cycleSibling(doc, ["turned", "title"], 1)).toBe("plain");
    expect(cycleSibling(doc, ["title", "plain"], -1)).toBe("ghost");
  });
  it("has nowhere to go for an only child, nothing selected or an unknown id", () => {
    expect(cycleSibling(doc, ["dot"], 1)).toBeNull();
    expect(cycleSibling(doc, [], 1)).toBeNull();
    expect(cycleSibling(doc, ["nope"], 1)).toBeNull();
  });
});

describe("PageUp and PageDown: the stack", () => {
  it("maps the keys: Ctrl or Cmd goes all the way", () => {
    expect(["PageUp", "PageDown"].flatMap((k) => [false, true].map((m) => stackStep(k as "PageUp", m)))).toEqual(["forward", "front", "backward", "back"]);
  });
  it("is one update of `index` per layer", () => {
    expect(stackPlan(doc, ["turned", "title"], "front")).toEqual({
      step: "front",
      ops: [
        { op: "update", id: "turned", props: { index: "front" } },
        { op: "update", id: "title", props: { index: "front" } },
      ],
    });
  });
  it("leaves out the inside of an instance and plans nothing when no layer can move", () => {
    expect(stackPlan(doc, [], "back")).toBeNull();
    expect(stackPlan(doc, ["nope"], "back")).toBeNull();
  });
});
