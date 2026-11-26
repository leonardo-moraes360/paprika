import { describe, expect, it } from "vitest";
import {
  ADOPT_SCAN_LIMIT,
  History,
  adoptableContent,
  alignContentOps,
  applyOps as applyRaw,
  centerContentOps,
  contentSummary,
  contentTarget,
  createDocument,
  isContentCentered,
  type Document,
  type FrameNode,
  type Op,
} from "../src/index.js";

const applyOps = (doc: Document, ops: Op[]) => applyRaw(doc, ops).doc;

function button(extra: Record<string, unknown> = {}): Document {
  return applyOps(createDocument("T", "d"), [
    { op: "create", node: { type: "frame", id: "board", x: 0, y: 0, width: 600, height: 400, children: [] } },
    { op: "create", parentId: "board", node: { type: "rect", id: "r", name: "Botao", x: 40, y: 30, width: 200, height: 80, fill: "#cc3322", radius: 12, ...extra } },
    { op: "create", parentId: "board", node: { type: "text", id: "t", text: "Salvar", x: 60, y: 50 } },
  ]);
}

function seal(): Document {
  return applyOps(createDocument("T", "d"), [
    { op: "create", node: { type: "frame", id: "board", x: 0, y: 0, width: 600, height: 400, children: [] } },
    { op: "create", parentId: "board", node: { type: "ellipse", id: "e", name: "Selo", x: 100, y: 100, width: 120, height: 120, fill: "#224488" } },
    { op: "create", parentId: "board", node: { type: "path", id: "ic", d: "M0 0 L10 0 L10 10 Z", x: 140, y: 140, width: 10, height: 10 } },
  ]);
}

const asFrame = (doc: Document, id: string) => doc.nodes[id] as FrameNode;

describe("convert_to_frame", () => {
  it("turns a rect into a frame in place and keeps its look", () => {
    const doc = button({ stroke: { color: "#000000", width: 2 }, shadow: { x: 0, y: 2, blur: 4, color: "#00000040" }, opacity: 0.8, rotation: 0 });
    const before = doc.nodes.r!;
    const out = applyOps(doc, [{ op: "convert_to_frame", id: "r" }]);
    const now = asFrame(out, "r");
    expect(now.type).toBe("frame");
    expect(now.children).toEqual([]);
    expect(now.clip).toBe(true);
    const { type: _t, ...rest } = before as Record<string, unknown>;
    const { type: _u, children: _c, clip: _k, ...nowRest } = now as unknown as Record<string, unknown>;
    expect(nowRest).toEqual(rest);
    expect(out.nodes.board).toMatchObject({ children: ["r", "t"] });
    expect(now.parentId).toBe("board");
  });

  it("turns a circle ellipse into a frame whose radius reproduces it", () => {
    const out = applyOps(seal(), [{ op: "convert_to_frame", id: "e" }]);
    expect(asFrame(out, "e")).toMatchObject({ type: "frame", radius: 60, width: 120, height: 120, fill: "#224488", name: "Selo" });
  });

  it("refuses an ellipse that is not a circle, copies and non-shapes", () => {
    const doc = applyOps(seal(), [{ op: "create", parentId: "board", node: { type: "ellipse", id: "oval", width: 80, height: 40 } }]);
    expect(() => applyRaw(doc, [{ op: "convert_to_frame", id: "oval" }])).toThrow(/not a circle/);
    expect(() => applyRaw(doc, [{ op: "convert_to_frame", id: "board" }])).toThrow(/only a rect or ellipse/);
    expect(() => applyRaw(doc, [{ op: "convert_to_frame", id: "nope" }])).toThrow(/does not exist/);
  });

  it("adopts the listed siblings with coordinates relative to the new frame, keeping the stacking", () => {
    const doc = button();
    const out = applyOps(doc, [{ op: "convert_to_frame", id: "r", adopt: ["t"] }]);
    expect(asFrame(out, "r").children).toEqual(["t"]);
    expect(out.nodes.t).toMatchObject({ parentId: "r", x: 20, y: 20 });
    expect(asFrame(out, "board").children).toEqual(["r"]);
  });

  it("offsets adopted coordinates by an inside stroke, since the frame border pushes its children in", () => {
    const doc = button({ stroke: { color: "#000000", width: 2 } });
    expect(applyOps(doc, [{ op: "convert_to_frame", id: "r", adopt: ["t"] }]).nodes.t).toMatchObject({ x: 18, y: 18 });
    const outside = button({ stroke: { color: "#000000", width: 2, position: "outside" } });
    expect(applyOps(outside, [{ op: "convert_to_frame", id: "r", adopt: ["t"] }]).nodes.t).toMatchObject({ x: 20, y: 20 });
  });

  it("rejects bad adoption lists", () => {
    const doc = applyOps(button(), [
      { op: "create", node: { type: "frame", id: "other", x: 700, y: 0, width: 50, height: 50, children: [] } },
      { op: "create", parentId: "board", node: { type: "connector", id: "c", from: { x: 0, y: 0 }, to: { x: 5, y: 5 } } },
    ]);
    expect(() => applyRaw(doc, [{ op: "convert_to_frame", id: "r", adopt: ["r"] }])).toThrow(/cannot adopt itself/);
    expect(() => applyRaw(doc, [{ op: "convert_to_frame", id: "r", adopt: ["other"] }])).toThrow(/not a sibling/);
    expect(() => applyRaw(doc, [{ op: "convert_to_frame", id: "r", adopt: ["c"] }])).toThrow(/connector/);
    const rotated = applyOps(doc, [{ op: "update", id: "r", props: { rotation: 10 } }]);
    expect(() => applyRaw(rotated, [{ op: "convert_to_frame", id: "r", adopt: ["t"] }])).toThrow(/rotated/);
  });

  it("undoes the conversion, the adoption and the centering together, exactly", () => {
    const doc = button({ stroke: { color: "#000000", width: 1 } });
    const { ops } = centerContentOps(doc, ["r"]);
    const res = applyRaw(doc, ops);
    expect(asFrame(res.doc, "r").layout).toMatchObject({ mode: "row", justify: "center", align: "center", padding: 0 });
    const back = applyRaw(res.doc, res.inverse);
    expect(back.doc).toEqual(doc);
    expect(JSON.stringify(back.doc)).toBe(JSON.stringify(doc));
    const redo = applyRaw(back.doc, back.inverse);
    expect(redo.doc).toEqual(res.doc);
  });

  it("undoes an ellipse conversion exactly, including a stored radius", () => {
    const doc = applyOps(seal(), [{ op: "update", id: "e", props: { radius: 7 } }]);
    const res = applyRaw(doc, [{ op: "convert_to_frame", id: "e", adopt: ["ic"] }]);
    expect(applyRaw(res.doc, res.inverse).doc).toEqual(doc);
  });

  it("is one history step for undo and redo", () => {
    const doc = button();
    const history = new History(doc);
    const { ops } = centerContentOps(doc, ["r"]);
    history.apply(ops, "user", "center content");
    expect(history.entries()).toHaveLength(1);
    const centered = history.doc;
    history.undo();
    expect(history.doc).toEqual(doc);
    history.redo();
    expect(history.doc).toEqual(centered);
  });
});

describe("convert_to_shape", () => {
  it("converts only a plain frame back", () => {
    const doc = applyOps(button(), [{ op: "convert_to_frame", id: "r" }]);
    expect(applyOps(doc, [{ op: "convert_to_shape", id: "r", shape: "rect" }]).nodes.r).toEqual(button().nodes.r);
    const busy = applyOps(doc, [{ op: "update", id: "r", props: { layout: { mode: "row" } } }]);
    expect(() => applyRaw(busy, [{ op: "convert_to_shape", id: "r", shape: "rect" }])).toThrow(/frame content/);
    const withChild = applyOps(button(), [{ op: "convert_to_frame", id: "r", adopt: ["t"] }]);
    expect(() => applyRaw(withChild, [{ op: "convert_to_shape", id: "r", shape: "rect" }])).toThrow(/children/);
    expect(() => applyRaw(doc, [{ op: "convert_to_shape", id: "r", shape: "ellipse" }])).toThrow(/not a circle/);
    expect(() => applyRaw(button(), [{ op: "convert_to_shape", id: "r", shape: "rect" }])).toThrow(/needs a frame/);
  });
});

describe("adoptableContent", () => {
  it("takes the visible siblings above the shape that sit inside its bounds, text included", () => {
    expect(adoptableContent(button(), "r")).toEqual(["t"]);
    expect(adoptableContent(seal(), "e")).toEqual(["ic"]);
  });

  it("leaves out what sits below, partly outside, locked, hidden or a connector", () => {
    const doc = applyOps(button(), [
      { op: "create", parentId: "board", index: 0, node: { type: "text", id: "below", text: "x", x: 60, y: 50 } },
      { op: "create", parentId: "board", node: { type: "rect", id: "wide", x: 200, y: 40, width: 100, height: 10 } },
      { op: "create", parentId: "board", node: { type: "rect", id: "locked", x: 50, y: 40, width: 10, height: 10, locked: true } },
      { op: "create", parentId: "board", node: { type: "rect", id: "hidden", x: 60, y: 60, width: 10, height: 10, visible: false } },
      { op: "create", parentId: "board", node: { type: "connector", id: "c", from: { x: 50, y: 40 }, to: { x: 60, y: 50 } } },
    ]);
    expect(adoptableContent(doc, "r")).toEqual(["t"]);
  });

  it("keeps the stacking: a node under a partly-outside sibling stays out", () => {
    const doc = applyOps(button(), [
      { op: "create", parentId: "board", index: 1, node: { type: "rect", id: "cover", x: 55, y: 45, width: 100, height: 50, fill: "#ffffff" } },
    ]);
    expect(adoptableContent(doc, "r")).toEqual(["cover", "t"]);
    const stacked = applyOps(button(), [
      { op: "create", parentId: "board", index: 1, node: { type: "rect", id: "badge", x: 55, y: 45, width: 300, height: 20 } },
    ]);
    expect(adoptableContent(stacked, "r")).toEqual([]);
  });

  it("returns nothing for a rotated shape, a flow parent, an oval, an instance copy or a non-shape", () => {
    expect(adoptableContent(applyOps(button(), [{ op: "update", id: "r", props: { rotation: 5 } }]), "r")).toEqual([]);
    const flow = applyOps(button(), [{ op: "update", id: "board", props: { layout: { mode: "row" } } }]);
    expect(adoptableContent(flow, "r")).toEqual([]);
    const oval = applyOps(seal(), [{ op: "update", id: "e", props: { height: 100 } }]);
    expect(adoptableContent(oval, "e")).toEqual([]);
    expect(adoptableContent(button(), "t")).toEqual([]);
    expect(adoptableContent(button(), "board")).toEqual([]);
    expect(adoptableContent(button(), "missing")).toEqual([]);
  });

  it("scans at most ADOPT_SCAN_LIMIT siblings above the shape", () => {
    const ops: Op[] = [];
    for (let i = 0; i < ADOPT_SCAN_LIMIT + 10; i++)
      ops.push({ op: "create", parentId: "board", node: { type: "rect", id: `n${i}`, x: 50 + (i % 5), y: 40, width: 4, height: 4 } });
    const doc = applyOps(button(), [{ op: "delete", id: "t" }, ...ops]);
    const found = adoptableContent(doc, "r");
    expect(found).toHaveLength(ADOPT_SCAN_LIMIT);
    expect(found[ADOPT_SCAN_LIMIT - 1]).toBe(`n${ADOPT_SCAN_LIMIT - 1}`);
  });

  it("costs the same on a huge page as on a small one (bounded scan)", () => {
    const wide = (count: number): Document => {
      const base = button();
      const nodes = { ...base.nodes };
      const board = { ...(nodes.board as FrameNode) };
      const kids = [...board.children];
      for (let i = 0; i < count; i++) {
        const id = `bulk${i}`;
        nodes[id] = { type: "text", id, name: "", parentId: "board", x: 50 + (i % 100), y: 40 + (i % 30), width: "hug", height: "hug", text: `t${i}`, rotation: 0, opacity: 1, visible: true, locked: false, color: "#111111", fontFamily: "Inter", fontSize: 16, fontWeight: 400, lineHeight: 1.4, letterSpacing: 0, textAlign: "left", radius: 0 } as unknown as Document["nodes"][string];
        kids.push(id);
      }
      nodes.board = { ...board, children: kids };
      return { ...base, nodes };
    };
    const time = (doc: Document) => {
      const runs: number[] = [];
      for (let k = 0; k < 7; k++) {
        const fresh = { ...doc };
        const t = performance.now();
        const found = adoptableContent(fresh, "r");
        runs.push(performance.now() - t);
        expect(found.length).toBeLessThanOrEqual(ADOPT_SCAN_LIMIT);
      }
      return runs.sort((a, b) => a - b)[3]!;
    };
    const small = time(wide(ADOPT_SCAN_LIMIT));
    const huge = time(wide(20_000));
    expect(huge).toBeLessThan(small * 3 + 15);
  });

  it("is cached per document", () => {
    const doc = button();
    expect(adoptableContent(doc, "r")).toBe(adoptableContent(doc, "r"));
  });
});

describe("shape as a content target", () => {
  it("is a target when there is content, empty otherwise", () => {
    const target = contentTarget(button(), button().nodes.r);
    expect(target?.kind).toBe("shape");
    const lone = applyOps(button(), [{ op: "delete", id: "t" }]);
    expect(contentTarget(lone, lone.nodes.r)?.kind).toBe("empty");
    expect(centerContentOps(lone, ["r"])).toEqual({ ops: [], centered: false });
    expect(alignContentOps(lone, "r", { horizontal: "left" })).toEqual([]);
  });

  it("centers a shape with content in one op list and reports it as not centered yet", () => {
    const doc = button();
    const { ops, centered } = centerContentOps(doc, ["r"]);
    expect(centered).toBe(true);
    expect(ops.map((o) => o.op)).toEqual(["convert_to_frame", "update"]);
    const out = applyOps(doc, ops);
    expect(isContentCentered(asFrame(out, "r"))).toBe(true);
    expect(centerContentOps(out, ["r"]).centered).toBe(false);
  });

  it("aligns one axis through the conversion", () => {
    const doc = button();
    const out = applyOps(doc, alignContentOps(doc, "r", { horizontal: "right" }));
    expect(asFrame(out, "r").layout).toMatchObject({ mode: "row", justify: "end" });
  });

  it("summarizes the adopted content like a frame", () => {
    const doc = button();
    expect(contentSummary(doc, adoptableContent(doc, "r")).only).toMatchObject({ kind: "text", label: "Salvar" });
  });
});
