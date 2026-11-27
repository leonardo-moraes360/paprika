import { describe, expect, it } from "vitest";
import {
  applyOps,
  createDocument,
  exportAngular,
  exportCssModules,
  exportReact,
  exportSvelte,
  exportTailwind,
  renderFrameworkHTML,
  renderHTML,
  renderTailwindHTML,
  type Document,
  type Op,
} from "../src/index.js";

// Scans markup for nested anchors: returns the deepest <a> nesting seen (self-closing JSX tags do not open).
function maxAnchorDepth(markup: string): number {
  let depth = 0;
  let max = 0;
  for (const m of markup.matchAll(/<(\/?)a(?=[\s>/])[^>]*?(\/?)>/g)) {
    if (m[1]) depth--;
    else if (!m[2]) {
      depth++;
      max = Math.max(max, depth);
    }
  }
  return max;
}

const strings = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));

function everyExport(doc: Document): string[] {
  const out: string[] = [];
  for (const vars of [false, true]) {
    out.push(renderHTML(doc, { cssVariables: vars }).html, renderTailwindHTML(doc, { cssVariables: vars }).html);
    for (const id of doc.rootIds) {
      out.push(
        renderHTML(doc, { rootId: id, cssVariables: vars }).html,
        exportReact(doc, id, { cssVariables: vars }),
        exportTailwind(doc, id, { cssVariables: vars }),
        strings(exportCssModules(doc, id, { cssVariables: vars })),
        strings(exportAngular(doc, id, { cssVariables: vars })),
        strings(exportSvelte(doc, id, { cssVariables: vars })),
      );
    }
  }
  out.push(strings(renderFrameworkHTML(doc, {}).html));
  return out;
}

const link = (extra: Record<string, unknown> = {}) => ({ start: 0, end: 3, href: "/inner", ...extra });
const text = (id: string, extra: Record<string, unknown> = {}) => ({ type: "text", id, text: "Olá mundo", width: 100, height: 20, ...extra });

function build(root: Record<string, unknown>): Document {
  return applyOps(createDocument("t", "d"), [{ op: "create", node: { width: 300, height: 200, ...root } } as Op]).doc;
}

const cases: Record<string, Record<string, unknown>> = {
  "block + run link": { type: "frame", id: "a", href: "/card", children: [text("t", { runs: [link()] })] },
  "text with href + run link": { type: "frame", id: "a", children: [text("t", { href: "/t", runs: [link()] })] },
  "block with href and no inner link": { type: "frame", id: "a", href: "/card", children: [text("t")] },
  "block in block": {
    type: "frame",
    id: "a",
    href: "/a",
    children: [{ type: "frame", id: "b", href: "/b", width: 100, height: 50, children: [text("t", { runs: [link()] })] }],
  },
  "three levels": {
    type: "frame",
    id: "a",
    href: "/a",
    children: [
      {
        type: "frame",
        id: "b",
        href: "/b",
        width: 200,
        height: 100,
        children: [{ type: "frame", id: "c", href: "/c", width: 100, height: 50, children: [text("t", { href: "/t", runs: [link()] })] }],
      },
    ],
  },
  "link through a group": {
    type: "frame",
    id: "a",
    href: "/a",
    children: [{ type: "group", id: "g", children: [text("t", { runs: [link()] })] }],
  },
  "empty linked child": { type: "frame", id: "a", href: "/a", children: [{ type: "frame", id: "b", href: "/b", width: 10, height: 10 }] },
  "auto layout card": {
    type: "frame",
    id: "a",
    href: "/a",
    layout: { mode: "column", gap: 4, padding: 8 },
    children: [text("t", { runs: [link()] }), text("u")],
  },
  "text block with href and run link": text("a", { href: "/a", runs: [link()] }),
};

describe("anchors are never nested (PAP-A-087)", () => {
  for (const [name, root] of Object.entries(cases)) {
    it(name, () => {
      const doc = build(root);
      for (const markup of everyExport(doc)) expect(maxAnchorDepth(markup)).toBeLessThanOrEqual(1);
    });
  }

  it("the scanner itself detects a nested pair", () => {
    expect(maxAnchorDepth('<a href="x"><a href="y">z</a></a>')).toBe(2);
    expect(maxAnchorDepth('<a href="x" /><a href="y">z</a>')).toBe(1);
  });
});

describe("clickable card output", () => {
  it("block + run link: div with an overlay link first, inner link lifted above it", () => {
    const html = renderHTML(build(cases["block + run link"]!)).html;
    expect(html).toMatch(/<div data-paprika-id="a"[^>]*><a href="\/card" aria-label="[^"]*" style="position:absolute;inset:0;z-index:1"><\/a>/);
    expect(html).toContain('<a href="/inner" style="');
    expect(html).toMatch(/<a href="\/inner" style="[^"]*position:relative;z-index:2/);
  });

  it("the overlay is labelled with the node name, else the text, else the href", () => {
    expect(renderHTML(build({ ...cases["block + run link"]!, name: "Cartão" })).html).toContain('aria-label="Cartão"');
    expect(renderHTML(build(cases["text block with href and run link"]!)).html).toContain('aria-label="Olá mundo"');
    expect(renderHTML(build(cases["block + run link"]!)).html).toContain('aria-label="/card"');
  });

  it("a nested block overlay sits above its parent's overlay", () => {
    const html = renderHTML(build(cases["block in block"]!)).html;
    expect(html).toContain("inset:0;z-index:1");
    expect(html).toContain("inset:0;z-index:2");
  });

  it("a block with href and no inner link is unchanged (still an <a>, no overlay)", () => {
    const html = renderHTML(build(cases["block with href and no inner link"]!)).html;
    expect(html).toMatch(/<a data-paprika-id="a"[^>]* href="\/card">/);
    expect(html).not.toContain("inset:0");
  });

  it("JSX output has the overlay as first child", () => {
    const jsx = exportReact(build(cases["block + run link"]!), "a");
    expect(jsx).toMatch(/<div[^\n]*>\n\s*<a style=\{\{ position: "absolute", inset: "0", zIndex: 1 \}\} href="\/card" aria-label="\/card"><\/a>/);
  });
});
