import { describe, expect, it } from "vitest";
import {
  applyOps,
  createDocument,
  DISPLAY_STRIDE,
  displayList,
  layout,
  nodeStyle,
  renderHTML,
  type Document,
  type Op,
} from "../src/index.js";

const tokens = {
  "radius.md": 12,
  "space.md": 8,
  "space.sm": 4,
  "text.md": 18,
  "text.lh": 1.5,
  brand: "#ff0000",
};

function docWith(ops: Op[]): Document {
  return applyOps(createDocument("t", "d"), ops).doc;
}

function frames(space: number): Document {
  return docWith([
    { op: "set_tokens", tokens: { ...tokens, "space.md": space } },
    {
      op: "create",
      node: {
        type: "frame",
        id: "a",
        width: 120,
        height: 100,
        radius: "$radius.md",
        stroke: { color: "#111", width: "$space.sm" },
        shadow: { x: "$space.sm", y: "$space.md", blur: "$space.md", spread: 0, color: "#000" },
        layout: { mode: "column", gap: "$space.md", padding: "$space.md" },
        children: [
          { type: "rect", id: "a1", width: 20, height: 20 },
          { type: "rect", id: "a2", width: 20, height: 20 },
          {
            type: "text",
            id: "t",
            text: "Oi",
            fontSize: "$text.md",
            lineHeight: "$text.lh",
            letterSpacing: "$space.sm",
          },
        ],
      },
    },
    {
      op: "create",
      node: {
        type: "frame",
        id: "b",
        x: 200,
        width: 80,
        height: 80,
        layout: { mode: "column", gap: "$space.md", padding: ["$space.md", "$space.sm", "$space.md", "$space.sm"] },
        children: [{ type: "rect", id: "b1", width: 20, height: 20 }],
      },
    },
  ]);
}

describe("length tokens", () => {
  it("accepts a length token in every length field and resolves it like a number", () => {
    const doc = frames(8);
    const a = doc.nodes.a!;
    expect(a).toMatchObject({ type: "frame", radius: "$radius.md" });
    const css = nodeStyle(doc, a);
    expect(css).toMatchObject({
      borderRadius: "12px",
      border: "4px solid #111",
      gap: "8px",
      padding: "8px",
      boxShadow: "4px 8px 8px 0px #000",
    });
    const text = nodeStyle(doc, doc.nodes.t!);
    expect(text).toMatchObject({ fontSize: "18px", lineHeight: 1.5, letterSpacing: "4px" });
    const boxes = layout(doc);
    expect(boxes.a1).toMatchObject({ y: 8 });
    expect(boxes.a2).toMatchObject({ y: 36 });
    expect(boxes.b1).toMatchObject({ x: 200 + 4, y: 8 });
  });

  it("re-lays out every frame that uses a $space token when the token changes", () => {
    const next = applyOps(frames(8), [{ op: "set_tokens", tokens: { "space.md": 24 } }]).doc;
    const boxes = layout(next);
    expect(boxes.a1).toMatchObject({ y: 24 });
    expect(boxes.a2).toMatchObject({ y: 68 });
    expect(boxes.b1).toMatchObject({ y: 24 });
    expect(nodeStyle(next, next.nodes.a!).gap).toBe("24px");
    expect(nodeStyle(next, next.nodes.b!).padding).toBe("24px 4px 24px 4px");
  });

  it("exports length tokens as var(--token), and line-height as a unitless calc", () => {
    const doc = frames(8);
    const css = nodeStyle(doc, doc.nodes.a!, { vars: true });
    expect(css.borderRadius).toBe("var(--radius\\.md)");
    expect(css.gap).toBe("var(--space\\.md)");
    expect(css.padding).toBe("var(--space\\.md)");
    expect(css.border).toBe("var(--space\\.sm) solid #111");
    const text = nodeStyle(doc, doc.nodes.t!, { vars: true });
    expect(text.fontSize).toBe("var(--text\\.md)");
    expect(text.lineHeight).toBe("calc(var(--text\\.lh) / 1px)");
    expect(text.letterSpacing).toBe("var(--space\\.sm)");
    const { html } = renderHTML(doc, { cssVariables: true, rootId: "a" });
    expect(html).toContain("gap:var(--space\\.md)");
    expect(html).toContain("line-height:calc(var(--text\\.lh) / 1px)");
  });

  it("refuses a color token and an out-of-range length, and keeps an unknown token", () => {
    expect(() =>
      docWith([
        { op: "set_tokens", tokens: { brand: "#ff0000" } },
        { op: "create", node: { type: "rect", id: "r", radius: "$brand" } },
      ]),
    ).toThrow('op[1]: node "r" radius: token "$brand" resolved to "#ff0000", expected a length');
    expect(() =>
      docWith([
        { op: "set_tokens", tokens: { "text.huge": 2000 } },
        { op: "create", node: { type: "text", id: "t", text: "a", fontSize: "$text.huge" } },
      ]),
    ).toThrow('op[1]: node "t" fontSize: token "$text.huge" is 2000, expected a number >= 1 and <= 1000');
    expect(() =>
      docWith([
        { op: "set_tokens", tokens: { neg: -2 } },
        { op: "create", node: { type: "rect", id: "r", shadow: { x: 0, y: 0, blur: "$neg", color: "#000" } } },
      ]),
    ).toThrow('op[1]: node "r" shadow.blur: token "$neg" is -2, expected a number >= 0');
    const doc = docWith([{ op: "create", node: { type: "text", id: "t", text: "a", fontSize: "$text.md" } }]);
    expect(doc.nodes.t).toMatchObject({ fontSize: "$text.md" });
    expect(() =>
      docWith([{ op: "create", node: { type: "frame", id: "f", layout: { padding: [0, 8, 1] } } }]),
    ).toThrow(/\[vertical, horizontal\] or \[top, right, bottom, left\]/);
    expect(docWith([{ op: "create", node: { type: "frame", id: "f", layout: { padding: [4, "$text.md"] } } }]).nodes.f).toMatchObject({
      layout: { padding: [4, "$text.md", 4, "$text.md"] },
    });
    expect(() => docWith([{ op: "create", node: { type: "rect", id: "r", width: "$space.8" } }])).toThrow(/number \(0\.\.100000\), "hug" or "fill"/);
    expect(() => docWith([{ op: "create", node: { type: "text", id: "t", text: "a", lineHeight: 22 } }])).toThrow(/multiplier.*1\.375/);
    expect(() => docWith([{ op: "create", node: { type: "path", id: "p", d: "M0 0 L1 1", fill: "linear-gradient(red, blue)" } }])).toThrow(/structured gradient field/);
    expect(() =>
      docWith([{ op: "create", node: { type: "rect", id: "r" } }, { op: "update", id: "r", props: { fill: "url(#x)" } }]),
    ).toThrow(/op\[1\].*fill/);
  });

  it("packs resolved lengths into the display list", () => {
    const doc = frames(8);
    const boxes = new Map([
      ["a", { x: 0, y: 0, w: 120, h: 100 }],
      ["a1", { x: 8, y: 8, w: 20, h: 20 }],
    ]);
    const list = displayList(doc, boxes);
    const rect = Array.from(list.data.slice(DISPLAY_STRIDE, DISPLAY_STRIDE * 2));
    expect(rect[5]).toBe(0);
    const frame = Array.from(list.data.slice(0, DISPLAY_STRIDE));
    expect(frame[5]).toBe(12);
    expect(frame[12]).toBe(4);
    expect(frame.slice(17, 21)).toEqual([4, 8, 8, 0]);
  });
});
