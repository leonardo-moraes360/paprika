import { describe, expect, it } from "vitest";
import { applyOps, contrastRatio, createDocument, effectiveBackground, parseColor, renderHTML, resolveValue, textRunCSS, type Document, type TextNode } from "../src/index.js";

const WCAG_AA = 4.5;

function board(fill: string, color: string, runs: TextNode["runs"]): { doc: Document; node: TextNode } {
  const doc = applyOps(createDocument("t", "d"), [
    { op: "set_tokens", tokens: { brand: "#c43d27", ink: "#f4f1ea" } },
    { op: "create", node: { type: "frame", id: "bg", width: 300, height: 100, fill } },
    { op: "create", node: { type: "text", id: "t", text: "Veja os agentes agora", width: 280, height: 30, color, runs }, parentId: "bg" },
  ]).doc;
  return { doc, node: doc.nodes.t as TextNode };
}

function linkContrast(doc: Document, node: TextNode, runIndex = 0) {
  const run = node.runs![runIndex]!;
  const css = textRunCSS(doc, node, run);
  const own = css.color === "inherit" ? String(resolveValue(doc, node.color, undefined)) : String(css.color);
  const fg = parseColor(own)!;
  const bg = effectiveBackground(doc, node)!;
  const text = parseColor(String(resolveValue(doc, node.color, undefined)))!;
  return { css, link: contrastRatio(fg, bg), text: contrastRatio(text, bg) };
}

const link = [{ start: 9, end: 16, href: "https://paprika.dev" }];

describe("link: contrast and non-colour cue (WCAG 1.4.1, 1.4.3)", () => {
  it("light text on a dark background: the link has exactly the contrast of the text around it", () => {
    const { doc, node } = board("#1a1f31", "#f4f1ea", link);
    const r = linkContrast(doc, node);
    expect(r.css.color).toBe("inherit");
    expect(r.link).toBe(r.text);
    expect(r.link).toBeGreaterThanOrEqual(WCAG_AA);
    expect(r.link).toBeGreaterThan(13);
  });

  it("dark text on a light background: the link has exactly the contrast of the text around it", () => {
    const { doc, node } = board("#ffffff", "#1a1f31", link);
    const r = linkContrast(doc, node);
    expect(r.link).toBe(r.text);
    expect(r.link).toBeGreaterThanOrEqual(WCAG_AA);
  });

  it("text on a brand background: the link has exactly the contrast of the text around it", () => {
    const { doc, node } = board("$brand", "#ffffff", link);
    const r = linkContrast(doc, node);
    expect(r.link).toBe(r.text);
    expect(r.link).toBeGreaterThanOrEqual(WCAG_AA);
  });

  it("a run with its own colour keeps it (and the contrast it gives)", () => {
    const { doc, node } = board("#1a1f31", "#f4f1ea", [{ start: 9, end: 16, href: "https://paprika.dev", color: "#ffd166" }]);
    const r = linkContrast(doc, node);
    expect(r.css.color).toBe("#ffd166");
    expect(r.link).toBeCloseTo(contrastRatio(parseColor("#ffd166")!, parseColor("#1a1f31")!), 10);
    expect(r.link).toBeGreaterThanOrEqual(WCAG_AA);
  });

  it("the old default blue would have failed on the dark background", () => {
    const blue = contrastRatio(parseColor("rgb(0,0,238)")!, parseColor("#1a1f31")!);
    expect(blue).toBeLessThan(2.1);
  });

  it("every link, coloured or not, is underlined with the same thickness, offset and skip-ink", () => {
    for (const runs of [link, [{ ...link[0]!, color: "#ffd166" }]]) {
      const { doc, node } = board("#1a1f31", "#f4f1ea", runs);
      const css = textRunCSS(doc, node, node.runs![0]!);
      expect(css.textDecoration).toBe("underline");
      expect(css.textDecorationThickness).toBe("max(1px, 0.06em)");
      expect(css.textUnderlineOffset).toBe("0.15em");
      expect(css.textDecorationSkipInk).toBe("auto");
    }
  });

  it("a run with no link is not underlined and has no forced colour", () => {
    const { doc, node } = board("#1a1f31", "#f4f1ea", [{ start: 9, end: 16, fontWeight: 700 }]);
    const css = textRunCSS(doc, node, node.runs![0]!);
    expect(css.textDecoration).toBeUndefined();
    expect(css.color).toBeUndefined();
  });

  it("a whole node with href is no text link: no underline, colour inherited by the frame, and the exported anchor resets both", () => {
    const doc = applyOps(createDocument("t", "d"), [
      { op: "create", node: { type: "frame", id: "card", width: 200, height: 60, fill: "#1a1f31", href: "/x" } },
      { op: "create", node: { type: "text", id: "inner", text: "Card", width: 100, height: 20, color: "#f4f1ea" }, parentId: "card" },
    ]).doc;
    const html = renderHTML(doc).html;
    expect(html).toMatch(/<a [^>]*style="[^"]*;color:inherit/);
    expect(html).toMatch(/<a [^>]*style="[^"]*text-decoration:none/);
  });
});
