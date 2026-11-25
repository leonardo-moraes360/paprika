import { describe, expect, it } from "vitest";
import { applyOps, createDocument, nodeStyle, renderHTML, withGenericFamily, type Document, type Op } from "../src/index.js";

function docWith(ops: Op[]): Document {
  return applyOps(createDocument("t", "d"), ops).doc;
}

describe("font family fallback", () => {
  it("appends a generic family only when the list has none", () => {
    expect(withGenericFamily("Inter")).toBe("Inter, sans-serif");
    expect(withGenericFamily("Inter, system-ui, sans-serif")).toBe("Inter, system-ui, sans-serif");
    expect(withGenericFamily("'Fira Code'")).toBe("'Fira Code', monospace");
    expect(withGenericFamily("Georgia")).toBe("Georgia, serif");
    expect(withGenericFamily("IBM Plex Sans")).toBe("IBM Plex Sans, sans-serif");
    expect(withGenericFamily('"Source Serif 4", Georgia')).toBe('"Source Serif 4", Georgia, serif');
    expect(withGenericFamily("var(--font-body)")).toBe("var(--font-body), sans-serif");
    expect(withGenericFamily('"a, b"')).toBe('"a, b", sans-serif');
  });

  it("puts the generic in nodeStyle, for literal values and tokens", () => {
    const doc = docWith([
      { op: "set_tokens", tokens: { "font.body": "Inter" }, type: "fontFamily" },
      { op: "create", node: { type: "text", id: "a", text: "a", fontFamily: "Inter" } },
      { op: "create", node: { type: "text", id: "b", text: "b", fontFamily: "$font.body" } },
    ]);
    expect(nodeStyle(doc, doc.nodes.a!).fontFamily).toBe("Inter, sans-serif");
    expect(nodeStyle(doc, doc.nodes.b!).fontFamily).toBe("Inter, sans-serif");
    expect(nodeStyle(doc, doc.nodes.b!, { vars: true }).fontFamily).toBe("var(--font\\.body), sans-serif");
  });

  it("keeps a bare var() when the token value already has a generic", () => {
    const doc = docWith([
      { op: "set_tokens", tokens: { "font.body": "Inter, system-ui, sans-serif" }, type: "fontFamily" },
      { op: "create", node: { type: "text", id: "b", text: "b", fontFamily: "$font.body" } },
    ]);
    expect(nodeStyle(doc, doc.nodes.b!, { vars: true }).fontFamily).toBe("var(--font\\.body)");
  });
});

describe("export body size", () => {
  it("takes the root box height, or follows a hug root that stays in the flow", () => {
    const doc = docWith([
      { op: "create", node: { type: "frame", id: "fixed", x: 0, y: 0, width: 200, height: 300 } },
      { op: "create", node: { type: "frame", id: "hug", x: 0, y: 0, width: 200, height: "hug", layout: { mode: "column" } } },
    ]);
    const fixed = renderHTML(doc, { rootId: "fixed" }).html;
    expect(fixed).toContain("body{position:relative;width:200px;height:300px;");
    const hug = renderHTML(doc, { rootId: "hug" }).html;
    expect(hug).not.toMatch(/body\{[^}]*[^-]height:1px/);
    expect(hug).toContain("min-height:1px");
    expect(hug).toMatch(/<body><div [^>]*position:relative/);
  });
});
