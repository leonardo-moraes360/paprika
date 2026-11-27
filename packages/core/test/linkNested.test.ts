import { createRequire } from "node:module";
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
    expect(html).toMatch(/<div data-paprika-id="a"[^>]*><a href="\/card" aria-label="[^"]*" style="position:absolute;inset:0;z-index:1;outline-offset:-2px"><\/a>/);
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
    expect(html).toContain("inset:0;z-index:1;outline-offset:-2px");
    expect(html).toContain("inset:0;z-index:2;outline-offset:-2px");
  });

  it("a block with href and no inner link is unchanged (still an <a>, no overlay)", () => {
    const html = renderHTML(build(cases["block with href and no inner link"]!)).html;
    expect(html).toMatch(/<a data-paprika-id="a"[^>]* href="\/card">/);
    expect(html).not.toContain("inset:0");
  });

  it("JSX output has the overlay as first child", () => {
    const jsx = exportReact(build(cases["block + run link"]!), "a");
    expect(jsx).toMatch(/<div[^\n]*>\n\s*<a style=\{\{ position: "absolute", inset: "0", zIndex: 1, outlineOffset: "-2px" \}\} href="\/card" aria-label="\/card"><\/a>/);
  });
});

const mid = (extra: Record<string, unknown>, children: unknown[]) => ({
  type: "frame",
  id: "a",
  href: "/card",
  children: [{ type: "frame", id: "m", x: 10, y: 10, width: 250, height: 150, ...extra, children }],
});

describe("links below an ancestor that creates a stacking context stay reachable", () => {
  const stacking: [string, Record<string, unknown>][] = [
    ["opacity", { opacity: 0.5 }],
    ["rotation", { rotation: 1 }],
    ["filter", { filter: { blur: 2 } }],
    ["backdrop filter", { backdropFilter: { blur: 2 } }],
  ];
  for (const [name, props] of stacking) {
    it(`${name}: the ancestor is lifted above the overlay and made click-through, the link opts back in`, () => {
      const html = renderHTML(build(mid(props, [text("t", { runs: [link()] })]))).html;
      const ancestor = html.match(/<div data-paprika-id="m"[^>]*style="([^"]*)"/)![1]!;
      expect(ancestor).toMatch(/z-index:2;pointer-events:none/);
      expect(html).toMatch(/<a href="\/inner" style="[^"]*z-index:2;pointer-events:auto"/);
    });
  }

  it("an ancestor without a stacking context is left alone", () => {
    const html = renderHTML(build(mid({}, [text("t", { runs: [link()] })]))).html;
    expect(html).not.toContain("pointer-events");
  });

  it("an ancestor with a stacking context but no link below it is left alone", () => {
    const html = renderHTML(build({ ...mid({ opacity: 0.5 }, [text("t")]), children: [{ type: "frame", id: "m", opacity: 0.5, width: 10, height: 10 }, text("u", { runs: [link()] })] })).html;
    expect(html).not.toMatch(/data-paprika-id="m"[^>]*pointer-events/);
  });

  it("a framed link and a nested card overlay below it opt back in", () => {
    const framed = renderHTML(build(mid({ opacity: 0.5 }, [{ type: "frame", id: "b", href: "/inner", width: 50, height: 20 }]))).html;
    expect(framed).toMatch(/<a data-paprika-id="b"[^>]*z-index:2;pointer-events:auto"[^>]* href="\/inner">/);
    const nested = renderHTML(build(mid({ opacity: 0.5 }, [{ type: "frame", id: "b", href: "/inner", width: 50, height: 20, children: [text("u", { runs: [link({ href: "/deep" })] })] }]))).html;
    expect(nested).toMatch(/<a href="\/inner" aria-label="\/inner" style="position:absolute;inset:0;z-index:2;outline-offset:-2px;pointer-events:auto">/);
    expect(nested).toMatch(/<a href="\/deep" style="[^"]*z-index:3;pointer-events:auto"/);
  });

  it("the same markup rules hold in JSX, Tailwind and CSS Modules", () => {
    const doc = build(mid({ opacity: 0.5 }, [text("t", { runs: [link()] })]));
    expect(exportReact(doc, "a")).toContain('zIndex: 2, pointerEvents: "none"');
    expect(exportReact(doc, "a")).toContain('zIndex: 2, pointerEvents: "auto"');
    expect(exportTailwind(doc, "a")).toContain('pointerEvents: "auto"');
    expect(strings(exportCssModules(doc, "a"))).toContain("pointer-events:none");
    expect(strings(exportCssModules(doc, "a"))).toContain('pointerEvents: \\"auto\\"');
  });
});

describe("a hidden link does not make the card an overlay", () => {
  it("hidden text with a run link: the card stays a plain <a>", () => {
    const doc = build({ type: "frame", id: "a", href: "/card", children: [text("t", { visible: false, runs: [link()] })] });
    for (const markup of [renderHTML(doc).html, exportReact(doc, "a"), exportTailwind(doc, "a"), strings(exportCssModules(doc, "a"))]) {
      expect(markup).not.toContain("aria-label");
      expect(markup).not.toContain("inset");
    }
    expect(renderHTML(doc).html).toMatch(/<a data-paprika-id="a"[^>]* href="\/card">/);
  });

  it("hidden links inside a plain <a> card are emitted without an anchor (no nested <a>)", () => {
    const doc = build({
      type: "frame",
      id: "a",
      href: "/card",
      children: [{ type: "frame", id: "h", href: "/h", visible: false, width: 10, height: 10, children: [text("t", { href: "/deep", runs: [link()] })] }, text("u")],
    });
    for (const markup of everyExport(doc)) expect(maxAnchorDepth(markup)).toBeLessThanOrEqual(1);
    expect(renderHTML(doc).html).not.toContain('href="/h"');
    expect(renderHTML(doc).html).not.toContain('href="/inner"');
  });

  it("a hidden link next to a visible one: the card is still an overlay", () => {
    const doc = build({ type: "frame", id: "a", href: "/card", children: [text("t", { runs: [link()] }), text("h", { visible: false, runs: [link({ href: "/hidden" })] })] });
    expect(renderHTML(doc).html).toContain('aria-label="/card"');
  });
});

describe("JSX attribute values are valid for any node name or link", () => {
  const nasty = 'Cartão "x" {y} \\ &amp; \n fim';
  const doc = build({
    type: "frame",
    id: "a",
    name: nasty,
    href: '/a?b=1&amp;d',
    children: [
      text("t", { name: 'T "q" {z}', href: '/t&#39;u', runs: [link({ href: '/in&amp;ner' })] }),
      { type: "image", id: "i", name: 'I "1"', src: 'https://example.com/a%22b.png', alt: 'um "alt" {x}', width: 20, height: 20 },
    ],
  });

  const esbuildTransform = (src: string): string => {
    const resolveFrom = (from: string, id: string) => createRequire(from).resolve(id);
    const vite = resolveFrom(resolveFrom(import.meta.url, "vitest"), "vite");
    const esbuild = createRequire(resolveFrom(vite, "esbuild"))("esbuild") as { transformSync: (s: string, o: { loader: string }) => { code: string } };
    return esbuild.transformSync(src, { loader: "tsx" }).code;
  };

  const outputs: [string, string][] = [
    ["react", exportReact(doc, "a")],
    ["react vars", exportReact(doc, "a", { cssVariables: true })],
    ["tailwind", exportTailwind(doc, "a")],
    ["css modules", exportCssModules(doc, "a").component],
  ];
  for (const [name, src] of outputs) {
    it(`${name} compiles as tsx and keeps the exact strings`, () => {
      const code = esbuildTransform(src);
      expect(code).toContain("createElement(");
      expect(src).not.toMatch(/="[^"\n]*\\"/);
    });
  }

  it("the evaluated attribute values are the original strings", () => {
    const code = esbuildTransform(exportReact(doc, "a"));
    expect(code).toContain(' {y} \\\\ &amp; \\n fim');
    expect(code).toContain('T "q" {z}');
    expect(code).toContain(JSON.stringify('/a?b=1&amp;d'));
    expect(code).toContain(JSON.stringify('/in&amp;ner'));
    expect(code).toContain('um "alt" {x}');
  });

  it("plain values keep the quoted-string form", () => {
    const plain = build({ type: "frame", id: "a", name: "Cartão", href: "/a?b=1&c=2", children: [text("t", { runs: [link()] })] });
    const src = exportReact(plain, "a");
    expect(src).toContain('data-name="Cartão"');
    expect(src).toContain('href="/inner"');
  });
});
