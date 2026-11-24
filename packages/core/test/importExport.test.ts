import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyOps,
  arcToCubics,
  createDocument,
  angularPreviewHTML,
  exportAngular,
  exportCssModules,
  exportSVG,
  exportSvelte,
  exportTailwind,
  importHTML,
  importSVG,
  isSVGText,
  parseStyle,
  parseDocument,
  parseMarkup,
  parseTransform,
  pathBounds,
  nodeStyle,
  renderFrameworkHTML,
  renderHTML,
  renderTailwindHTML,
  sveltePreviewHTML,
  tailwindClasses,
  tailwindClassesFor,
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
    expect(r.nodes[0]).toMatchObject({ type: "group" });
    const kids = (r.nodes[0] as { children: Record<string, unknown>[] }).children;
    expect(kids.find((n) => n.type === "text")).toMatchObject({ type: "text", text: "oi", x: 0, y: -12.8, color: "#000000", width: "hug", height: "hug" });
    expect(r.warnings).toEqual([
      'CSS in <style> is not applied; use attributes or style="" on the elements',
      "gradients and patterns (url(#…)) are not imported; using gray",
    ]);
    expect(() => importSVG("<div></div>")).toThrow(/no <svg> element/);
    expect(importSVG("<svg></svg>")).toEqual({ nodes: [], warnings: ["the SVG has no shapes to import"] });
  });

  it("vira texto e expande sprite use/symbol", () => {
    const text = importSVG(`<svg><text x="10" y="20" font-size="16" fill="#112233" text-anchor="middle" font-family="Inter">Hi</text></svg>`);
    expect(text.warnings).toEqual([]);
    expect(text.nodes).toEqual([
      { type: "text", name: "SVG", x: 1.168, y: 7.2, width: "hug", height: "hug", text: "Hi", color: "#112233", fontFamily: "Inter", textAlign: "center" },
    ]);
    const lines = importSVG(`<svg><text x="0" y="10" fill="#111"><tspan>A</tspan><tspan dy="12">B</tspan></text></svg>`);
    expect(lines.nodes[0]).toMatchObject({ type: "group" });
    expect((lines.nodes[0] as { children: { text: string; y: number }[] }).children.map((n) => [n.text, n.y])).toEqual([
      ["A", -2.8],
      ["B", 9.2],
    ]);
    const sprite = importSVG(`<svg><defs><symbol id="box" viewBox="0 0 10 10"><rect width="10" height="10" fill="#c43d27"/></symbol></defs><use href="#box" x="2" y="4" width="20" height="20"/></svg>`);
    expect(sprite.warnings).toEqual([]);
    expect(sprite.nodes).toEqual([{ type: "rect", name: "SVG", x: 2, y: 4, width: 20, height: 20, fill: "#c43d27" }]);
    const linked = importSVG(`<svg><defs><symbol id="s" viewBox="0 0 10 10"><rect id="r" width="10" height="10" fill="#00ff00"/></symbol></defs><use xlink:href="#s" width="10" height="10"/></svg>`);
    expect(linked.nodes[0]).toMatchObject({ type: "rect", x: 0, y: 0, width: 10, height: 10, fill: "#00ff00", name: "r" });
    const cycle = importSVG(`<svg><defs><g id="a"><use href="#a"/></g></defs><use href="#a"/></svg>`);
    expect(cycle.nodes).toEqual([]);
    expect(cycle.warnings).toContain('<use> cycle on "#a" skipped');
    const ext = importSVG(`<svg><use href="https://example.com/a.svg#b"/></svg>`);
    expect(ext.warnings[0]).toMatch(/external <use>/);
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

  it("layout automático usa layout(doc), sem navegador", () => {
    const doc = example("demo.paprika.json");
    const r = exportSVG(doc);
    expect(r.svg).toContain('data-name="Login · mobile"');
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
    const boxes = Object.fromEntries(Object.keys(doc.nodes).map((id) => [id, [0, 0, 10, 10] as [number, number, number, number]]));
    expect(exportSVG(doc, { measure: { boxes } }).svg).toContain('data-name="Login · mobile"');
  });
});

const cardDoc = (): Document =>
  applyOps(createDocument("Cards", "d"), [
    { op: "set_tokens", tokens: { bg: "#ffffff", ink: "#1e2336" } },
    {
      op: "create",
      node: {
        type: "frame", id: "card", name: "Card grande", width: 320, height: 200, fill: "$bg", radius: 8,
        layout: { mode: "column", gap: 8, padding: 16 },
        stroke: { color: "#c43d27", width: 1 }, shadow: { x: 0, y: 2, blur: 4, spread: 0, color: "rgba(0,0,0,.2)" },
        children: [
          { type: "text", id: "title", name: "Título", text: "Olá {mundo}", fontSize: 24, color: "$ink", width: "fill", height: "hug" },
          { type: "rect", id: "bar", name: "Título", width: "fill", height: 4, fill: "#ff278c" },
          { type: "shape", id: "s1", shape: "note", x: 0, y: 0, width: 80, height: 60, text: "n" },
          { type: "shape", id: "s2", shape: "note", x: 0, y: 0, width: 80, height: 60, text: "m" },
        ],
      },
    },
  ]).doc;

describe("tailwindClassesFor", () => {
  it("mapeia declarações do nodeStyle para utilitários", () => {
    expect(tailwindClassesFor("display", "flex")).toEqual(["flex"]);
    expect(tailwindClassesFor("display", "none")).toEqual(["hidden"]);
    expect(tailwindClassesFor("width", "320px")).toEqual(["w-[320px]"]);
    expect(tailwindClassesFor("width", "100%")).toEqual(["w-full"]);
    expect(tailwindClassesFor("padding", "16px")).toEqual(["p-[16px]"]);
    expect(tailwindClassesFor("padding", "1px 2px 3px 4px")).toEqual(["pt-[1px]", "pr-[2px]", "pb-[3px]", "pl-[4px]"]);
    expect(tailwindClassesFor("border", "1px solid #c43d27")).toEqual(["border-[length:1px]", "border-solid", "border-[color:#c43d27]"]);
    expect(tailwindClassesFor("boxShadow", "0px 2px 4px 0px rgba(0, 0, 0, 0.2)")).toEqual(["shadow-[0px_2px_4px_0px_rgba(0,_0,_0,_0.2)]"]);
    expect(tailwindClassesFor("background", "var(--bg)")).toEqual(["bg-[color:var(--bg)]"]);
    expect(tailwindClassesFor("fontSize", "var(--size)")).toEqual(["text-[length:var(--size)]"]);
    expect(tailwindClassesFor("fontFamily", "Inter_x")).toEqual(["font-[family-name:Inter\\_x]"]);
  });

  it("o que não tem utilitário volta para o estilo inline", () => {
    expect(tailwindClassesFor("transform", "scale(2)")).toBeUndefined();
    expect(tailwindClassesFor("alignItems", "weird")).toBeUndefined();
    expect(tailwindClassesFor("fontFamily", "a]b")).toBeUndefined();
    expect(tailwindClassesFor("unknownProp", "1")).toBeUndefined();
    expect(tailwindClasses({ display: "flex", transform: "scale(2)", unknownProp: 1 })).toEqual({
      classes: ["flex"],
      fallback: { transform: "scale(2)", unknownProp: 1 },
    });
  });
});

describe("export tailwind", () => {
  it("renderTailwindHTML troca style por class e mantém o resto da árvore do html", () => {
    const doc = cardDoc();
    const { html, bounds } = renderTailwindHTML(doc, { rootId: "card" });
    expect(bounds).toEqual(renderHTML(doc, { rootId: "card" }).bounds);
    expect(html).toContain("@tailwindcss/browser");
    expect(html).toContain('data-paprika-id="card"');
    expect(html).toContain('class="relative w-[320px] h-[200px]');
    expect(html).not.toContain("<style>");
    expect(html).not.toMatch(/ style="/);
  });

  it("exportTailwind gera TSX com className e sem style para o que tem utilitário", () => {
    const tsx = exportTailwind(cardDoc(), "card");
    expect(tsx).toContain("export function CardGrande()");
    expect(tsx).toContain('className="');
    expect(tsx).not.toContain("style={{");
    expect(tsx).toContain("{\"{\"}mundo{\"}\"}");
    expect(tsx).not.toContain("tokensCss");
  });

  it("cssVariables escreve tokens como var(--nome) e exporta tokensCss", () => {
    const doc = cardDoc();
    const tsx = exportTailwind(doc, "card", { cssVariables: true });
    expect(tsx).toContain("export const tokensCss =");
    expect(tsx).toContain("bg-[color:var(--bg)]");
    expect(tsx).toContain("text-[color:var(--ink)]");
    expect(renderTailwindHTML(doc, { cssVariables: true }).html).toContain(":root{");
  });

  it("recusa páginas e nós inexistentes como o export react", () => {
    const doc = applyOps(createDocument("P", "p"), [{ op: "create", node: { type: "page", id: "pg", name: "P" } }]).doc;
    expect(() => exportTailwind(doc, "pg")).toThrow(/is a page/);
    expect(() => exportTailwind(doc, "nope")).toThrow(/does not exist/);
  });
});

describe("export css-modules", () => {
  it("uma regra por nó com as declarações do nodeStyle", () => {
    const doc = cardDoc();
    const out = exportCssModules(doc, "card");
    expect(out.fileName).toBe("CardGrande.module.css");
    expect(out.component).toContain('import styles from "./CardGrande.module.css";');
    expect(out.component).toContain("export function CardGrande()");
    expect(out.component).toContain("className={styles.cardGrande}");
    expect(out.component).not.toContain("style=");
    const rule = (name: string) => out.css.split("\n").find((l) => l.startsWith(`.${name}{`));
    expect(rule("cardGrande")).toBe(`.cardGrande{${Object.entries(nodeStyle(doc, doc.nodes.card!, { asRoot: true }))
      .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${v}`)
      .join(";")}}`);
  });

  it("nomes repetidos ganham sufixo e o contorno das formas é uma regra só", () => {
    const out = exportCssModules(cardDoc(), "card");
    expect(out.component).toContain("styles.titulo}");
    expect(out.component).toContain("styles.titulo2}");
    expect(out.component.match(/styles\.shapeSvg\}/g)).toHaveLength(2);
    expect(out.css.match(/^\.shapeSvg\{/gm)).toHaveLength(1);
    expect(out.css.match(/^\.shapeText\{/gm)).toHaveLength(1);
  });

  it("cssVariables põe a folha de tokens no topo do módulo", () => {
    const out = exportCssModules(cardDoc(), "card", { cssVariables: true });
    expect(out.css.startsWith(":root{")).toBe(true);
    expect(out.css).toContain("background:var(--bg)");
  });

  it("recusa páginas", () => {
    const doc = applyOps(createDocument("P", "p"), [{ op: "create", node: { type: "page", id: "pg", name: "P" } }]).doc;
    expect(() => exportCssModules(doc, "pg")).toThrow(/is a page/);
  });
});

describe("export angular e svelte", () => {
  it("angular: standalone .ts + template HTML + styles com classes do nodeStyle", () => {
    const out = exportAngular(cardDoc(), "card");
    expect(out.fileBase).toBe("CardGrande");
    expect(out.selector).toBe("app-card-grande");
    expect(out.typescript).toContain('selector: "app-card-grande"');
    expect(out.typescript).toContain("standalone: true");
    expect(out.typescript).toContain('templateUrl: "./CardGrande.component.html"');
    expect(out.typescript).toContain("export class CardGrande {}");
    expect(out.template).toContain('data-paprika-id="card"');
    expect(out.template).toContain('class="cardGrande"');
    expect(out.template).not.toContain(" style=");
    expect(out.styles).toContain(".cardGrande{box-sizing:border-box;");
    expect(out.styles.match(/^\.shapeSvg\{/gm)).toHaveLength(1);
  });

  it("svelte: um .svelte com markup e <style>", () => {
    const out = exportSvelte(cardDoc(), "card");
    expect(out.fileName).toBe("CardGrande.svelte");
    expect(out.source).toContain('data-paprika-id="card"');
    expect(out.source).toContain('class="cardGrande"');
    expect(out.source).toContain("<style>");
    expect(out.source).toContain(".cardGrande{box-sizing:border-box;");
    expect(out.source).not.toContain(" style=");
  });

  it("cssVariables: tokens no CSS; svelte envolve :root em :global", () => {
    const ang = exportAngular(cardDoc(), "card", { cssVariables: true });
    expect(ang.styles.startsWith(":root{")).toBe(true);
    expect(ang.styles).toContain("background:var(--bg)");
    const sv = exportSvelte(cardDoc(), "card", { cssVariables: true });
    expect(sv.source).toContain(":global(:root){");
    expect(sv.source).toContain("background:var(--bg)");
  });

  it("preview estático monta a mesma árvore class+stylesheet do framework HTML", () => {
    const doc = cardDoc();
    const fw = renderFrameworkHTML(doc, { rootId: "card" });
    expect(angularPreviewHTML(doc, "card").html).toBe(fw.html);
    expect(sveltePreviewHTML(doc, "card").html).toBe(fw.html);
    expect(fw.html).not.toMatch(/ style="/);
  });

  it("recusa páginas e nós inexistentes", () => {
    const doc = applyOps(createDocument("P", "p"), [{ op: "create", node: { type: "page", id: "pg", name: "P" } }]).doc;
    expect(() => exportAngular(doc, "pg")).toThrow(/is a page/);
    expect(() => exportSvelte(doc, "nope")).toThrow(/does not exist/);
  });
});
