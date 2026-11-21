import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyOps,
  arcToCubics,
  createDocument,
  exportSVG,
  importHTML,
  importSVG,
  isSVGText,
  parseStyle,
  parseDocument,
  parseMarkup,
  parseTransform,
  pathBounds,
  renderHTML,
  textContent,
  type Document,
  type MarkupElement,
  type Op,
} from "../src/index.js";

const example = (name: string) => parseDocument(JSON.parse(readFileSync(join(__dirname, "../../../examples", name), "utf8")));
const noWarn = () => {};

/** Importa o HTML de renderHTML de volta num documento vazio. */
function roundtrip(doc: Document, rootId: string): Document {
  const html = renderHTML(doc, { rootId }).html;
  const r = importHTML(html);
  expect(r.warnings).toEqual([]);
  const ops: Op[] = r.nodes.map((node) => ({ op: "create", parentId: null, node }));
  return applyOps(createDocument("R", "r"), ops).doc;
}

describe("parseMarkup", () => {
  it("lê tags, atributos, entidades e tolera HTML malformado", () => {
    const root = parseMarkup(`<!doctype html><DIV Class=a data-x='1 &amp; 2' hidden>Olá&nbsp;&#x1F600;&lt;<br><p>um<p>dois</div><script>if (a<b) {}</script><!-- fim -->`);
    const div = root.children[0] as MarkupElement;
    expect(div.tag).toBe("div");
    expect(Object.fromEntries(div.attrs)).toEqual({ class: "a", "data-x": "1 & 2", hidden: "" });
    expect(textContent(root)).toBe("Olá\u00a0😀<\numdois");
    expect((root.children[1] as { children: string[] }).children).toEqual(["if (a<b) {}"]);
  });

  it("nomes vindos da entrada nunca tocam o protótipo", () => {
    const el = parseMarkup(`<p __proto__="x" constructor="y" style="__proto__: red; toString: 1">`).children[0] as MarkupElement;
    expect(el.attrs).toBeInstanceOf(Map);
    expect([...el.attrs]).toEqual([["__proto__", "x"], ["constructor", "y"], ["style", "__proto__: red; toString: 1"]]);
    const css = parseStyle(el.attrs.get("style"));
    expect([...css.keys()]).toEqual(["__proto__", "tostring"]);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it("recusa entradas grandes demais", () => {
    expect(() => parseMarkup("<br>".repeat(5001))).toThrow(/5000 elements/);
    expect(() => parseMarkup("<g>".repeat(300))).toThrow(/200 levels/);
  });
});

describe("importSVG", () => {
  it("aplica viewBox, transforms e pintura herdada", () => {
    const r = importSVG(`<svg viewBox="0 0 24 24" width="48" height="48" fill="#c43d27"><path d="M2 2 L22 2 L12 20 Z"/></svg>`, { x: 10, y: 0 });
    expect(r.warnings).toEqual([]);
    expect(r.nodes).toEqual([{ type: "path", x: 14, y: 4, d: "M0 0 L40 0 L20 36 Z", fill: "#c43d27", name: "SVG" }]);
  });

  it("rect/circle sem rotação viram nós nativos; com rotação viram path", () => {
    const r = importSVG(`<svg><title>Ícones</title><rect x="1" y="2" width="30" height="20" rx="4" stroke="#000" stroke-width="2"/><g transform="rotate(45)"><circle r="5"/></g></svg>`);
    const g = r.nodes[0]!;
    expect(g).toMatchObject({ type: "group", name: "Ícones" });
    const [rect, circle] = g.children as Record<string, unknown>[];
    expect(rect).toEqual({ type: "rect", x: 1, y: 2, width: 30, height: 20, radius: 4, fill: "#000000", stroke: { color: "#000", width: 2 } });
    expect(circle).toMatchObject({ type: "path", fill: "#000000" });
    expect(circle!.d).toMatch(/^M[\d. -]+( C[\d. -]+){4} Z$/);
  });

  it("lista o que não é importado", () => {
    const r = importSVG(`<svg><style>.a{}</style><text>oi</text><rect width="4" height="4" fill="url(#g)"/></svg>`);
    expect(r.nodes).toHaveLength(1);
    expect(r.warnings).toEqual([
      'CSS in <style> is not applied; use attributes or style="" on the elements',
      "<text> is not imported",
      "gradients and patterns (url(#…)) are not imported; using gray",
    ]);
    expect(() => importSVG("<div></div>")).toThrow(/no <svg> element/);
    expect(importSVG("<svg></svg>")).toEqual({ nodes: [], warnings: ["the SVG has no shapes to import"] });
  });

  it("parseTransform e arcos", () => {
    expect(parseTransform("translate(10 20) scale(2)", noWarn)).toEqual([2, 0, 0, 2, 10, 20]);
    expect(parseTransform("x y translate (1e1,.5) scale(2", noWarn)).toEqual([1, 0, 0, 1, 10, 0.5]);
    // Entradas montadas contra regex com retrocesso terminam em tempo linear.
    const t0 = performance.now();
    parseTransform("a".repeat(200_000) + " " + "a(".repeat(100_000), noWarn);
    expect(parseTransform("1".repeat(100_000) + "x", noWarn)).toEqual([1, 0, 0, 1, 0, 0]);
    expect(performance.now() - t0).toBeLessThan(1000);
    const quarter = arcToCubics({ x: 10, y: 0 }, { cmd: "A", rx: 10, ry: 10, rotation: 0, largeArc: false, sweep: true, to: { x: 0, y: 10 } });
    expect(quarter).toHaveLength(1);
    const b = pathBounds([{ cmd: "M", to: { x: 10, y: 0 } }, ...quarter]);
    expect(b.width).toBeCloseTo(10, 6);
    expect(b.height).toBeCloseTo(10, 6);
  });
});

describe("isSVGText", () => {
  it("reconhece SVG depois de prólogo, comentários e doctype", () => {
    expect(isSVGText(`<?xml version="1.0"?>\n<!-- a --><!DOCTYPE svg>\n<SVG viewBox="0 0 1 1">`)).toBe(true);
    expect(isSVGText("<svg>")).toBe(true);
    expect(isSVGText(" <svg>")).toBe(false);
    expect(isSVGText("<svgx>")).toBe(false);
    expect(isSVGText("<!-- sem fim <svg>")).toBe(false);
    expect(isSVGText("<div><svg>")).toBe(false);
    const t0 = performance.now();
    expect(isSVGText("<!---->".repeat(100_000) + "<!--")).toBe(false);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe("importHTML", () => {
  it("o HTML do próprio Paprika volta igual (demo e bezier)", () => {
    for (const name of ["demo.paprika.json", "bezier.paprika.json"]) {
      const doc = example(name);
      for (const id of doc.rootIds) {
        const back = roundtrip(doc, id);
        // Tokens saem resolvidos no HTML; o resto (tipos, nomes, layout, pintura) volta igual.
        const html = (d: Document, root: string) => renderHTML(d, { rootId: root }).html.replace(/data-paprika-id="[^"]*"/g, "").replace(/<title>.*?<\/title>/, "");
        expect(html(back, back.rootIds[0]!)).toBe(html(doc, id));
        expect(back.nodes[back.rootIds[0]!]!.name).toBe(doc.nodes[id]!.name);
      }
    }
  });

  it("aproxima HTML de outras fontes", () => {
    const r = importHTML(
      `<div style="display:flex; flex-direction:column; gap:8px; padding:16px; background:#fff; width:320px"><h1>Título</h1><button style="background:#c43d27; color:white; padding:8px 16px; border-radius:6px">Entrar</button></div>`,
    );
    expect(r.warnings).toEqual([]);
    expect(r.nodes).toEqual([
      {
        type: "frame", width: 320, height: "hug", fill: "#fff", clip: false,
        layout: { mode: "column", gap: 8, padding: 16, align: "stretch", justify: "start" },
        children: [
          { type: "text", text: "Título", width: "fill", height: "hug", fontSize: 32, fontWeight: 700 },
          {
            type: "frame", width: "fill", height: "hug", fill: "#c43d27", radius: 6, clip: false,
            layout: { mode: "row", align: "center", justify: "start", padding: [8, 16, 8, 16] },
            children: [{ type: "text", text: "Entrar", width: "hug", height: "hug", color: "white" }],
          },
        ],
      },
    ]);
    expect(importHTML("<p class='x'>a</p>").warnings).toEqual(['CSS classes are not applied; only inline styles (style="")']);
    expect(importHTML("").warnings).toEqual(["the HTML has no elements to import"]);
  });
});

describe("exportSVG", () => {
  it("sem medida, exporta nós em posição absoluta", () => {
    const doc = applyOps(createDocument("T", "d"), [
      { op: "create", node: { type: "rect", id: "a", x: 10, y: 10, width: 40, height: 20, radius: 99, fill: "#ff0000", stroke: { color: "#000", width: 2 } } },
      { op: "create", node: { type: "text", id: "t", x: 60, y: 10, width: 80, height: 40, text: "um\ndois", fontSize: 10, lineHeight: 2, textAlign: "center" } },
    ]).doc;
    const r = exportSVG(doc);
    expect(r).toMatchObject({ width: 130, height: 40, warnings: [] });
    expect(r.svg).toContain('<g data-paprika-id="a" transform="translate(0 0)"><rect x="1" y="1" width="38" height="18" rx="9" fill="#ff0000" stroke="#000" stroke-width="2"/></g>');
    expect(r.svg).toContain('text-anchor="middle"><tspan x="40" y="13">um</tspan><tspan x="40" y="33">dois</tspan>');
    expect(exportSVG(doc, { rootId: "a" }).svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="40" height="20" viewBox="0 0 40 20">/);
  });

  it("layout automático exige medida do navegador", () => {
    const doc = example("demo.paprika.json");
    expect(() => exportSVG(doc)).toThrow(/depends on auto layout/);
    const boxes = Object.fromEntries(Object.keys(doc.nodes).map((id) => [id, [0, 0, 10, 10] as [number, number, number, number]]));
    expect(exportSVG(doc, { measure: { boxes } }).svg).toContain('data-name="Login · mobile"');
  });
});
