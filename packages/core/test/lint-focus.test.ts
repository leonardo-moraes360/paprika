import { describe, expect, it } from "vitest";
import { applyOps, createDocument, groupLint, lintDocument, type Document } from "../src/index.js";

function draw(nodes: Record<string, unknown>[]): Document {
  return applyOps(createDocument("L"), nodes.map((node) => ({ op: "create" as const, node }))).doc;
}

describe("lint that points at what matters", () => {
  it("groups by severity then rule and keeps the first N ids", () => {
    const doc = draw([
      {
        type: "frame",
        id: "sheet",
        name: "Sheet",
        width: 400,
        height: 200,
        fill: "#ffffff",
        children: [
          { type: "text", id: "a", text: "A", fontSize: 11, color: "#111111", x: 8, y: 8 },
          { type: "text", id: "b", text: "B", fontSize: 11, color: "#111111", x: 40, y: 8 },
          { type: "text", id: "c", text: "C", fontSize: 11, color: "#cccccc", x: 80, y: 8 },
        ],
      },
    ]);
    const issues = lintDocument(doc);
    const groups = groupLint(issues, 2);
    expect(groups.map((g) => g.severity)).toEqual([...groups].map((g) => g.severity).sort((x, y) => ({ error: 0, warning: 1, info: 2 })[x] - ({ error: 0, warning: 1, info: 2 })[y]));
    const small = groups.find((g) => g.rule === "small-text");
    expect(small).toMatchObject({ severity: "warning", count: 3, nodeIds: ["a", "b"], message: "font size 11px (< 12px)" });
    const contrast = groups.find((g) => g.rule === "contrast");
    expect(contrast).toMatchObject({ severity: "error", count: 1, nodeIds: ["c"] });
    expect(groups.findIndex((g) => g.rule === "contrast")).toBeLessThan(groups.findIndex((g) => g.rule === "small-text"));
  });

  it("scopes rootIds, drops quieter findings, and honors lintIgnore", () => {
    const doc = applyOps(createDocument("L"), [
      { op: "set_tokens", tokens: { ink: "#111111" } },
      {
        op: "create",
        node: {
          type: "frame",
          id: "board",
          name: "Board",
          width: 1000,
          height: 80,
          fill: "#ffffff",
          layout: { mode: "row", gap: 16 },
          children: [
            { type: "rect", id: "a", width: 400, height: 40, fill: "#111111" },
            { type: "rect", id: "b", width: 400, height: 40, fill: "#111111" },
            { type: "rect", id: "c", width: 400, height: 40, fill: "#111111" },
          ],
        },
      },
      {
        op: "create",
        node: {
          type: "frame",
          id: "other",
          name: "Other",
          x: 0,
          y: 400,
          width: 200,
          height: 80,
          fill: "#ffffff",
          children: [
            { type: "text", id: "tiny", text: "x", fontSize: 10, color: "#111111", x: 8, y: 8 },
            { type: "rect", id: "swatch", x: 8, y: 40, width: 20, height: 20, fill: "#ffffff", lintIgnore: ["raw-color"] },
            { type: "rect", id: "ink", x: 40, y: 40, width: 20, height: 20, fill: "#ffffff" },
          ],
        },
      },
    ]).doc;
    const scoped = lintDocument(doc, { rootIds: ["board"] });
    expect(scoped.map((i) => i.rule)).toContain("layout-overflow");
    expect(scoped.some((i) => i.nodeId === "tiny" || i.nodeId === "swatch" || i.nodeId === "ink")).toBe(false);
    expect(lintDocument(doc, { rootIds: ["other"], minSeverity: "error" })).toEqual([]);
    const other = lintDocument(doc, { rootId: "other" });
    expect(other.some((i) => i.rule === "raw-color" && i.nodeId === "swatch")).toBe(false);
    expect(other.some((i) => i.rule === "raw-color" && i.nodeId === "ink")).toBe(true);
    expect(lintDocument(doc, { rootIds: ["missing"] })).toEqual([]);
  });

  it("raises small-text with minFontSize and skips a scaled mock", () => {
    const doc = draw([
      {
        type: "frame",
        id: "mock",
        name: "Mock",
        width: 200,
        height: 80,
        fill: "#ffffff",
        scaledMock: true,
        children: [{ type: "text", id: "cap", text: "Cap", fontSize: 9, color: "#111111", x: 8, y: 8 }],
      },
      {
        type: "frame",
        id: "real",
        name: "Real",
        x: 0,
        y: 200,
        width: 200,
        height: 80,
        fill: "#ffffff",
        children: [{ type: "text", id: "label", text: "Label", fontSize: 9, color: "#111111", x: 8, y: 8 }],
      },
    ]);
    const all = lintDocument(doc).filter((i) => i.rule === "small-text").map((i) => i.nodeId);
    expect(all).toEqual(["label"]);
    expect(lintDocument(doc, { minFontSize: 9 }).some((i) => i.rule === "small-text")).toBe(false);
    expect(lintDocument(doc, { rootIds: ["mock", "real"], minFontSize: 10 }).filter((i) => i.rule === "small-text").map((i) => i.nodeId)).toEqual(["label"]);
  });

  it("flags a row wider than its frame", () => {
    const doc = draw([
      {
        type: "frame",
        id: "board",
        name: "Board",
        width: 1000,
        height: 80,
        fill: "#ffffff",
        layout: { mode: "row", gap: 16 },
        children: [
          { type: "rect", id: "a", name: "A", width: 400, height: 40, fill: "#111111" },
          { type: "rect", id: "b", name: "B", width: 400, height: 40, fill: "#111111" },
          { type: "rect", id: "c", name: "C", width: 400, height: 40, fill: "#111111" },
        ],
      },
    ]);
    const hit = lintDocument(doc).filter((i) => i.rule === "layout-overflow");
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ nodeId: "board", severity: "warning" });
    expect(hit[0]!.message).toContain("row children leave \"Board\"");
    expect(hit[0]!.message).toContain("on width: C");
    expect(lintDocument(doc).some((i) => i.rule === "hug-was-meant")).toBe(false);
  });

  it("flags a default 100×100 layout frame whose children leave the box", () => {
    const doc = draw([
      {
        type: "frame",
        id: "box",
        name: "Box",
        fill: "#ffffff",
        layout: { mode: "row", gap: 8 },
        children: [
          { type: "rect", id: "a", width: 80, height: 40, fill: "#111111" },
          { type: "rect", id: "b", width: 80, height: 40, fill: "#111111" },
        ],
      },
    ]);
    expect(doc.nodes.box).toMatchObject({ width: 100, height: 100 });
    const hit = lintDocument(doc).filter((i) => i.rule === "hug-was-meant");
    expect(hit.map((i) => i.nodeId)).toEqual(["box"]);
    expect(hit[0]!.message).toContain('set width and height to "hug"');
    expect(lintDocument(doc).some((i) => i.rule === "layout-overflow")).toBe(false);
  });

  it("flags a sibling that floats off, a gap under 4px, and a shape fully hidden", () => {
    const doc = draw([
      {
        type: "frame",
        id: "icon",
        name: "Icon",
        width: 200,
        height: 200,
        fill: "#ffffff",
        children: [
          { type: "ellipse", id: "pod", name: "Pod", x: 0, y: 0, width: 40, height: 40, fill: "#c43d27" },
          { type: "rect", id: "body", name: "Body", x: 10, y: 10, width: 40, height: 40, fill: "#1e2336" },
          { type: "ellipse", id: "calyx", name: "Calyx", x: 90, y: 0, width: 20, height: 20, fill: "#3d7a4a" },
          { type: "rect", id: "left", name: "Left", x: 0, y: 100, width: 20, height: 20, fill: "#111111" },
          { type: "rect", id: "right", name: "Right", x: 22, y: 100, width: 20, height: 20, fill: "#111111" },
          { type: "rect", id: "under", name: "Under", x: 0, y: 160, width: 10, height: 10, fill: "#cccccc" },
          { type: "rect", id: "cover", name: "Cover", x: 0, y: 160, width: 30, height: 30, fill: "#111111" },
        ],
      },
    ]);
    const issues = lintDocument(doc, { rootIds: ["icon"] });
    expect(issues.find((i) => i.rule === "detached-sibling")?.nodeId).toBe("calyx");
    expect(issues.find((i) => i.rule === "near-gap")).toMatchObject({ nodeId: "right" });
    expect(issues.find((i) => i.rule === "near-gap")?.message).toContain("2px from \"Left\"");
    expect(issues.find((i) => i.rule === "fully-hidden")).toMatchObject({ nodeId: "under", message: 'fully hidden behind opaque "Cover"' });
    const groups = groupLint(issues.filter((i) => i.rule === "detached-sibling" || i.rule === "near-gap" || i.rule === "fully-hidden"));
    expect(groups.map((g) => g.rule)).toEqual(["detached-sibling", "fully-hidden", "near-gap"]);
  });

  it("does not treat a path or ellipse as covering its whole box", () => {
    const doc = draw([
      {
        type: "frame",
        id: "glyph",
        name: "Glyph",
        width: 100,
        height: 100,
        fill: "#ffffff",
        children: [
          { type: "path", id: "lobe", name: "Lobe", x: 10, y: 10, width: 80, height: 80, d: "M0 0 L20 0 L20 20 Z", fill: "#c43d27" },
          { type: "ellipse", id: "seed", name: "Seed", x: 10, y: 10, width: 80, height: 80, fill: "#3d7a4a" },
          { type: "path", id: "stem", name: "Stem", x: 10, y: 10, width: 80, height: 80, d: "M60 60 L80 60 L80 80 Z", fill: "#1f5e33" },
          { type: "shape", id: "dot", name: "Dot", shape: "diamond", x: 10, y: 10, width: 80, height: 80, fill: "#f4b41a" },
        ],
      },
    ]);
    expect(lintDocument(doc, { rootIds: ["glyph"] }).filter((i) => i.rule === "fully-hidden")).toEqual([]);
  });
});
