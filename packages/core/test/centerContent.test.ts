import { describe, expect, it } from "vitest";
import {
  History,
  alignContentOps,
  applyOps as applyRaw,
  type Op,
  centerContentOps,
  contentAxes,
  contentSummary,
  contentTarget,
  createDocument,
  type Document,
  type FrameNode,
  type Layout,
} from "../src/index.js";

const applyOps = (doc: Document, ops: Op[]) => applyRaw(doc, ops).doc;

function scene(layout?: Partial<Layout>): Document {
  return applyOps(createDocument("T", "d"), [
    {
      op: "create",
      node: {
        type: "frame",
        id: "btn",
        width: 200,
        height: 80,
        fill: "#cc3322",
        ...(layout ? { layout: { mode: "none", ...layout } as Layout } : {}),
        children: [{ type: "text", id: "label", text: "Start", x: 16, y: 10 }],
      },
    },
    { op: "create", node: { type: "rect", id: "r", width: 100, height: 50 } },
    { op: "create", node: { type: "ellipse", id: "e", width: 60, height: 60 } },
    { op: "create", node: { type: "frame", id: "empty", width: 50, height: 50 } },
  ]);
}

const frame = (doc: Document, id = "btn") => doc.nodes[id] as FrameNode;

describe("center content", () => {
  it("targets frames with children, flags rect and ellipse as empty and ignores the rest", () => {
    const doc = scene();
    expect(contentTarget(doc, doc.nodes.btn)?.kind).toBe("frame");
    expect(contentTarget(doc, doc.nodes.r)?.kind).toBe("empty");
    expect(contentTarget(doc, doc.nodes.e)?.kind).toBe("empty");
    expect(contentTarget(doc, doc.nodes.empty)).toBeNull();
    expect(contentTarget(doc, doc.nodes.label)).toBeNull();
    expect(contentTarget(doc, doc.nodes.p)).toBeNull();
    expect(contentTarget(doc, undefined)).toBeNull();
  });

  it("reads no active axis when the children are positioned by hand", () => {
    expect(contentAxes(frame(scene()))).toEqual({ horizontal: null, vertical: null });
  });

  it("maps row layouts: horizontal is justify, vertical is align", () => {
    const doc = scene({ mode: "row", justify: "end", align: "center" });
    expect(contentAxes(frame(doc))).toEqual({ horizontal: "right", vertical: "middle" });
  });

  it("maps column layouts the other way around", () => {
    const doc = scene({ mode: "column", justify: "end", align: "start" });
    expect(contentAxes(frame(doc))).toEqual({ horizontal: "left", vertical: "bottom" });
  });

  it("leaves stretch and between without an active button", () => {
    const doc = scene({ mode: "row", justify: "between", align: "stretch" });
    expect(contentAxes(frame(doc))).toEqual({ horizontal: null, vertical: null });
  });

  it("centers in place: same id, row layout, center/center, padding 0, gap kept", () => {
    const doc = scene({ mode: "row", gap: 8, padding: 12, wrap: true });
    const { ops, centered } = centerContentOps(doc, ["btn"]);
    expect(centered).toBe(true);
    const next = applyOps(doc, ops);
    const f = frame(next);
    expect(f.type).toBe("frame");
    expect(f.layout).toMatchObject({ mode: "row", gap: 8, padding: 0, align: "center", justify: "center", wrap: true });
    expect(f.fill).toBe("#cc3322");
    expect(f.children).toEqual(["label"]);
  });

  it("keeps a column layout when centering", () => {
    const doc = scene({ mode: "column", gap: 4 });
    const next = applyOps(doc, centerContentOps(doc, ["btn"]).ops);
    expect(frame(next).layout).toMatchObject({ mode: "column", align: "center", justify: "center", gap: 4 });
  });

  it("centering a frame that was free turns on a row layout", () => {
    const doc = scene();
    const next = applyOps(doc, centerContentOps(doc, ["btn"]).ops);
    expect(frame(next).layout).toMatchObject({ mode: "row", padding: 0, align: "center", justify: "center" });
    expect(contentAxes(frame(next))).toEqual({ horizontal: "center", vertical: "middle" });
  });

  it("centering a centered frame goes back to manual positions", () => {
    const doc = applyOps(scene(), centerContentOps(scene(), ["btn"]).ops);
    const again = centerContentOps(doc, ["btn"]);
    expect(again.centered).toBe(false);
    const back = applyOps(doc, again.ops);
    expect(frame(back).layout).toBeUndefined();
    expect(back.nodes.label).toMatchObject({ x: 16, y: 10 });
  });

  it("changing one axis keeps the other", () => {
    const centered = applyOps(scene(), centerContentOps(scene(), ["btn"]).ops);
    const left = applyOps(centered, alignContentOps(centered, "btn", { horizontal: "left" }));
    expect(contentAxes(frame(left))).toEqual({ horizontal: "left", vertical: "middle" });
    const bottom = applyOps(left, alignContentOps(left, "btn", { vertical: "bottom" }));
    expect(contentAxes(frame(bottom))).toEqual({ horizontal: "left", vertical: "bottom" });
  });

  it("changing one axis on a column layout edits the right prop", () => {
    const doc = scene({ mode: "column", justify: "center", align: "center" });
    const next = applyOps(doc, alignContentOps(doc, "btn", { horizontal: "right" }));
    expect(frame(next).layout).toMatchObject({ mode: "column", align: "end", justify: "center" });
  });

  it("changing one axis on a free frame turns on a row layout", () => {
    const doc = scene();
    const next = applyOps(doc, alignContentOps(doc, "btn", { horizontal: "center" }));
    expect(frame(next).layout).toMatchObject({ mode: "row", justify: "center", padding: 0 });
  });

  it("one action is one history step", () => {
    const history = new History(scene());
    const doc = history.doc;
    history.apply(centerContentOps(doc, ["btn"]).ops);
    expect(frame(history.doc).layout?.align).toBe("center");
    history.undo();
    expect(frame(history.doc).layout).toBeUndefined();
  });

  it("several frames are centered in a single batch", () => {
    let doc = scene();
    doc = applyOps(doc, [
      { op: "create", node: { type: "frame", id: "second", width: 80, height: 80, children: [{ type: "text", id: "t2", text: "B" }] } },
    ]);
    const { ops } = centerContentOps(doc, ["btn", "second", "r", "empty"]);
    expect(ops).toHaveLength(2);
    const next = applyOps(doc, ops);
    expect(frame(next, "second").layout?.justify).toBe("center");
  });

  it("does nothing for shapes without children", () => {
    const doc = scene();
    expect(centerContentOps(doc, ["r", "e", "empty"]).ops).toEqual([]);
    expect(alignContentOps(doc, "r", { horizontal: "left" })).toEqual([]);
  });

  it("summarizes the children", () => {
    const doc = applyOps(scene(), [
      { op: "create", node: { type: "text", id: "t2", text: "Two" }, parentId: "btn" },
      { op: "create", node: { type: "path", id: "star", name: "Star", d: "M0 0L10 10" }, parentId: "btn" },
    ]);
    const s = contentSummary(doc, frame(doc));
    expect(s.count).toBe(3);
    expect(s.kinds).toEqual({ text: 2, icon: 1, image: 0, other: 0 });
    expect(s.only).toBeNull();
    const one = contentSummary(scene(), frame(scene()));
    expect(one.only).toEqual({ kind: "text", label: "Start", x: 16, y: 10 });
  });
});
