import { describe, expect, it } from "vitest";
import { applyOps, copyId, createDocument, detachTokensSkipped, type Document, type FrameNode, type Op } from "../src/index.js";

const props = [
  { name: "label", type: "text", default: "OK" },
  { name: "pressed", type: "boolean", default: false },
] as const;

const tree = (extra: Record<string, unknown> = {}) => ({
  type: "frame" as const,
  id: "btn",
  width: 100,
  height: 40,
  ...extra,
  children: [
    { type: "text" as const, id: "lbl", text: "OK", width: 40, height: 20, bind: { text: "label" } },
    { type: "frame" as const, id: "wrap", width: 20, height: 20, children: [{ type: "rect" as const, id: "press", width: 5, height: 5, bind: { visible: "pressed" } }] },
  ],
});

describe("bind is checked when the transaction ends", () => {
  it("accepts bound children created together with the component flag", () => {
    const doc = applyOps(createDocument("T", "d"), [{ op: "create", node: tree({ component: true, componentProps: props }) }]).doc;
    expect((doc.nodes.btn as FrameNode).component).toBe(true);
  });

  it("accepts the flag set after the children in the same transaction", () => {
    const doc = applyOps(createDocument("T", "d"), [
      { op: "create", node: tree() },
      { op: "update", id: "btn", props: { component: true, componentProps: props } },
    ]).doc;
    expect((doc.nodes.btn as FrameNode).component).toBe(true);
  });

  it("names the child and the missing component when still invalid", () => {
    expect(() => applyOps(createDocument("T", "d"), [{ op: "create", node: tree() }])).toThrow(
      /"lbl" has a bind outside a component: none of its ancestors is a component; the frame that contains it must be a component/,
    );
  });
});

function withInstance(): Document {
  return applyOps(createDocument("T", "d"), [
    { op: "create", node: tree({ component: true, componentProps: props }) },
    { op: "create", node: { type: "frame", id: "i1", instanceOf: "btn", x: 200, propValues: { label: "Salvar", pressed: true } } },
  ]).doc;
}

describe("detach_instance with bound copies", () => {
  it("drops the bind and keeps the resolved values", () => {
    const doc = withInstance();
    expect(doc.nodes[copyId("i1", "lbl")]).toMatchObject({ text: "Salvar", bind: { text: "label" } });
    const out = applyOps(doc, [{ op: "detach", ids: ["i1"] }]).doc;
    const lbl = out.nodes[copyId("i1", "lbl")] as unknown as Record<string, unknown>;
    expect(lbl.text).toBe("Salvar");
    expect(lbl.bind).toBeUndefined();
    expect(lbl.sourceId).toBeUndefined();
    expect((out.nodes.i1 as FrameNode).instanceOf).toBeUndefined();
    expect(out.nodes[copyId("i1", "press")]).toMatchObject({ visible: true });
  });
});

describe("detach_tokens on instances", () => {
  const tokens: Op = { op: "set_tokens", tokens: { brand: "#c43d27", alt: "#112233", pad: 8 } };
  const base = () =>
    applyOps(createDocument("T", "d"), [
      tokens,
      { op: "create", node: { type: "frame", id: "card", component: true, width: 100, height: 40, fill: "$brand", layout: { mode: "row", gap: "$pad" }, children: [{ type: "text", id: "t", text: "x", color: "$brand", width: 10, height: 10 }] } },
      { op: "create", node: { type: "frame", id: "i1", instanceOf: "card" } },
    ]).doc;

  it("skips derived fields and reports them instead of failing", () => {
    const doc = base();
    const r = applyOps(doc, [{ op: "detach_tokens", ids: ["i1"] }]);
    expect(r.doc).toEqual(doc);
    expect(detachTokensSkipped(doc, ["i1"])).toEqual({ i1: ["fill", "layout"] });
    expect(detachTokensSkipped(doc, [copyId("i1", "t")])).toEqual({ [copyId("i1", "t")]: ["color"] });
  });

  it("detaches the overrides the instance owns", () => {
    const doc = applyOps(base(), [
      { op: "update", id: "i1", props: { fill: "$alt" } },
      { op: "update", id: copyId("i1", "t"), props: { color: "$alt" } },
    ]).doc;
    const out = applyOps(doc, [{ op: "detach_tokens", ids: ["i1", copyId("i1", "t")] }]).doc;
    expect((out.nodes.i1 as FrameNode).overrides).toEqual({ card: { fill: "#112233" }, t: { color: "#112233" } });
    expect(detachTokensSkipped(doc, ["i1"])).toEqual({ i1: ["layout"] });
  });

  it("still fails when a plain node has nothing to detach", () => {
    expect(() => applyOps(createDocument("T", "d"), [{ op: "create", node: { type: "rect", id: "r" } }, { op: "detach_tokens", ids: ["r"] }])).toThrow(/no token to detach/);
  });
});
