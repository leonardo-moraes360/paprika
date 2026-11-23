import { describe, expect, it } from "vitest";
import { applyOps, createDocument, nodeStyle, renderHTML, type Document, type Op } from "../src/index.js";

function docWith(ops: Op[]): Document {
  return applyOps(createDocument("t", "d"), ops).doc;
}

describe("typed tokens", () => {
  it("stores a type and a collection and checks the value", () => {
    const doc = docWith([
      { op: "set_tokens", tokens: { "font.body": "Inter, system-ui, sans-serif" }, type: "fontFamily", collection: "type" },
      { op: "set_tokens", tokens: { "font.size": 16 }, type: "fontSize", collection: "type" },
      { op: "set_tokens", tokens: { "font.weight": 500 }, type: "fontWeight", collection: "type" },
      { op: "set_tokens", tokens: { "font.lh": 1.4 }, type: "lineHeight", collection: "type" },
      { op: "set_tokens", tokens: { "font.track": 0.2 }, type: "letterSpacing", collection: "type" },
      { op: "set_tokens", tokens: { brand: "#c8401f" }, type: "color", collection: "color" },
      { op: "set_tokens", tokens: { "space.md": 8 }, type: "length", collection: "space" },
    ]);
    expect(doc.tokens.brand).toBe("#c8401f");
    expect(doc.tokenMeta?.brand).toEqual({ type: "color", collection: "color" });
    expect(doc.tokenMeta?.["font.body"]).toEqual({ type: "fontFamily", collection: "type" });
    expect(doc.tokenMeta?.["space.md"]).toEqual({ type: "length", collection: "space" });
  });

  it("refuses a value that does not match the type, and a typed token in the wrong field", () => {
    expect(() => docWith([{ op: "set_tokens", tokens: { brand: 12 }, type: "color" }])).toThrow(
      'op[0]: token "brand": type color expects a color, got 12',
    );
    expect(() => docWith([{ op: "set_tokens", tokens: { "font.weight": 450.5 }, type: "fontWeight" }])).toThrow(
      "integer from 100 to 900",
    );
    expect(() =>
      docWith([
        { op: "set_tokens", tokens: { "space.md": 8 }, type: "length" },
        { op: "create", node: { type: "text", id: "t", text: "a", fontSize: "$space.md" } },
      ]),
    ).toThrow('op[1]: node "t" fontSize: token "$space.md" has type length, expected fontSize');
    expect(() =>
      docWith([
        { op: "set_tokens", tokens: { "font.size": 18 }, type: "fontSize" },
        { op: "create", node: { type: "rect", id: "r", radius: "$font.size" } },
      ]),
    ).toThrow('op[1]: node "r" radius: token "$font.size" has type fontSize, expected length');
    const legacy = docWith([
      { op: "set_tokens", tokens: { "text.md": 18, "space.md": 8 } },
      { op: "create", node: { type: "text", id: "t", text: "a", fontSize: "$text.md", letterSpacing: "$space.md" } },
    ]);
    expect(legacy.nodes.t).toMatchObject({ fontSize: "$text.md", letterSpacing: "$space.md" });
    expect(legacy.tokenMeta).toBeUndefined();
  });

  it("resolves font tokens on the node and in the stylesheet", () => {
    const doc = docWith([
      { op: "set_tokens", tokens: { "font.body": "Inter, system-ui, sans-serif" }, type: "fontFamily", collection: "type" },
      { op: "set_tokens", tokens: { "font.size": 18 }, type: "fontSize", collection: "type" },
      { op: "set_tokens", tokens: { "font.weight": 600 }, type: "fontWeight", collection: "type" },
      { op: "set_tokens", tokens: { "font.lh": 1.5 }, type: "lineHeight", collection: "type" },
      { op: "set_tokens", tokens: { "font.track": 0.4 }, type: "letterSpacing", collection: "type" },
      { op: "set_tokens", tokens: { ink: "#112233" }, type: "color", collection: "color" },
      {
        op: "create",
        node: {
          type: "text",
          id: "t",
          text: "Oi",
          color: "$ink",
          fontFamily: "$font.body",
          fontSize: "$font.size",
          fontWeight: "$font.weight",
          lineHeight: "$font.lh",
          letterSpacing: "$font.track",
        },
      },
    ]);
    const css = nodeStyle(doc, doc.nodes.t!);
    expect(css).toMatchObject({
      color: "#112233",
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: "18px",
      fontWeight: 600,
      lineHeight: 1.5,
      letterSpacing: "0.4px",
    });
    const vars = nodeStyle(doc, doc.nodes.t!, { vars: true });
    expect(vars.fontFamily).toBe("var(--font\\.body)");
    expect(vars.fontWeight).toBe("var(--font\\.weight)");
    expect(vars.lineHeight).toBe("var(--font\\.lh)");
    expect(vars.fontSize).toBe("var(--font\\.size)");
    const { html } = renderHTML(doc, { cssVariables: true, rootId: "t" });
    expect(html).toContain("--font\\.weight:600");
    expect(html).toContain("--font\\.lh:1.5");
    expect(html).toContain("--font\\.size:18px");
    expect(html).not.toContain("--font\\.weight:600px");
  });

  it("keeps a mode value inside the token type and names the collection", () => {
    const doc = docWith([
      { op: "set_tokens", tokens: { ink: "#111111" }, type: "color", collection: "color" },
      { op: "set_tokens", mode: "dark", tokens: { ink: "#eeeeee" } },
    ]);
    expect(doc.modes?.dark?.ink).toBe("#eeeeee");
    expect(doc.tokenMeta?.ink).toEqual({ type: "color", collection: "color" });
    expect(() => docWith([{ op: "set_tokens", tokens: { ink: "#111" }, type: "color" }, { op: "set_tokens", mode: "dark", tokens: { ink: 4 } }])).toThrow(
      "type color expects a color",
    );
  });

  it("detaches a token into the resolved literal and restores it on undo", () => {
    const first = applyOps(createDocument("t", "d"), [
      { op: "set_tokens", tokens: { ink: "#112233" }, type: "color" },
      { op: "set_tokens", tokens: { "font.size": 18 }, type: "fontSize" },
      { op: "set_tokens", tokens: { "font.track": 0.4 }, type: "letterSpacing" },
      { op: "set_tokens", tokens: { "space.md": 8 }, type: "length" },
      {
        op: "create",
        node: {
          type: "text",
          id: "t",
          text: "Oi",
          color: "$ink",
          fontSize: "$font.size",
          letterSpacing: "$font.track",
        },
      },
    ]);
    expect(() => applyOps(first.doc, [{ op: "create", node: { type: "text", id: "bad", text: "a", letterSpacing: "$space.md" } }])).toThrow(
      "has type length, expected letterSpacing",
    );
    const detached = applyOps(first.doc, [{ op: "detach_tokens", ids: ["t"], fields: ["fontSize"] }]);
    expect(detached.doc.nodes.t).toMatchObject({ color: "$ink", fontSize: 18 });
    const all = applyOps(first.doc, [{ op: "detach_tokens", ids: ["t"] }]);
    expect(all.doc.nodes.t).toMatchObject({ color: "#112233", fontSize: 18, letterSpacing: 0.4 });
    const undone = applyOps(all.doc, all.inverse);
    expect(undone.doc.nodes.t).toMatchObject({ color: "$ink", fontSize: "$font.size", letterSpacing: "$font.track" });
    expect(() => applyOps(first.doc, [{ op: "detach_tokens", ids: ["missing"] }])).toThrow('node "missing" does not exist');
  });

  it("drops the type when the token is removed and restores it on undo", () => {
    const made = applyOps(createDocument("t", "d"), [{ op: "set_tokens", tokens: { ink: "#111111" }, type: "color", collection: "color" }]);
    const removed = applyOps(made.doc, [{ op: "set_tokens", tokens: { ink: null } }]);
    expect(removed.doc.tokens.ink).toBeUndefined();
    expect(removed.doc.tokenMeta).toBeUndefined();
    const back = applyOps(removed.doc, removed.inverse);
    expect(back.doc.tokens.ink).toBe("#111111");
    expect(back.doc.tokenMeta?.ink).toEqual({ type: "color", collection: "color" });
  });
});
