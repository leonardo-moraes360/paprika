import { describe, expect, it } from "vitest";
import { applyOps, createDocument, exportReact, History, importHTML, lintDocument, modeOf, nodeStyle, parseDocument, renderHTML, resolveValue, type Document, type Op } from "../src/index.js";

const themed = (): Document =>
  applyOps(createDocument("T", "d"), [
    { op: "set_tokens", tokens: { bg: "#fff", fg: "#111", "brand.main": "#c43d27", accent: "$brand.main", size: 16 } },
    { op: "set_tokens", mode: "dark", tokens: { bg: "#000", fg: "#eee", size: 18 } },
    { op: "create", node: { type: "frame", id: "light", width: 100, height: 50, fill: "$bg", children: [{ type: "text", id: "lt", text: "a", color: "$fg", fontSize: "$size" }] } },
    {
      op: "create",
      node: {
        type: "frame", id: "dark", mode: "dark", x: 200, width: 100, height: 50, fill: "$bg",
        children: [{ type: "frame", id: "box", width: 20, height: 20, fill: "$accent", children: [{ type: "text", id: "dt", text: "b", color: "$fg", fontSize: "$size" }] }],
      },
    },
  ]).doc;

describe("modos de tema", () => {
  it("o modo vale no frame e nos descendentes; o que o modo não define vem da base", () => {
    const doc = themed();
    expect(modeOf(doc, doc.nodes.dt)).toBe("dark");
    expect(modeOf(doc, doc.nodes.lt)).toBeUndefined();
    expect(nodeStyle(doc, doc.nodes.dt!)).toMatchObject({ color: "#eee", fontSize: "18px" });
    expect(nodeStyle(doc, doc.nodes.lt!)).toMatchObject({ color: "#111", fontSize: "16px" });
    expect(nodeStyle(doc, doc.nodes.box!).background).toBe("#c43d27");
    expect(resolveValue(doc, "$accent", "dark")).toBe("#c43d27");
    // Nomes herdados de Object não são tokens.
    expect(resolveValue(doc, "$constructor", "dark")).toBe("$constructor");
  });

  it("set_tokens com mode desfaz certo e apaga o modo que fica vazio", () => {
    const h = new History(parseDocument(JSON.parse(JSON.stringify(themed()))));
    h.apply([{ op: "set_tokens", mode: "dark", tokens: { bg: null, fg: null, size: null } }], "user", "limpar");
    expect(h.doc.modes).toBeUndefined();
    h.undo();
    expect(h.doc.modes).toEqual({ dark: { bg: "#000", fg: "#eee", size: 18 } });
    const ops: Op[] = [{ op: "set_tokens", mode: "bad mode", tokens: { a: 1 } }];
    expect(() => applyOps(h.doc, ops)).toThrow(/nome de modo/);
  });

  it("export com variáveis CSS: var(--token), uma regra por modo e data-paprika-mode", () => {
    const doc = themed();
    const { html } = renderHTML(doc, { cssVariables: true });
    expect(html).toContain(":root{--bg:#fff;--fg:#111;--brand\\.main:#c43d27;--accent:var(--brand\\.main);--size:16px}");
    expect(html).toContain('[data-paprika-mode="dark"]{--bg:#000;--fg:#eee;--size:18px}');
    expect(html).toContain('data-paprika-id="dark" data-paprika-type="frame" data-paprika-mode="dark" style="');
    expect(html).toContain("color:var(--fg);font-family");
    // Um nó solto leva o modo herdado para o <body>.
    expect(renderHTML(doc, { rootId: "dt", cssVariables: true }).html).toContain('<body data-paprika-mode="dark">');
    // Sem a opção, nada muda além do atributo do modo.
    expect(renderHTML(doc).html).not.toContain("var(");
    const react = exportReact(doc, "dark", { cssVariables: true });
    expect(react).toMatch(/^export const tokensCss = ":root\{/);
    expect(react).toContain('<div data-paprika-mode="dark" style={{');
    expect(react).toContain('background: "var(--accent)"');
  });

  it("o HTML exportado volta com o modo", () => {
    const doc = themed();
    const back = importHTML(renderHTML(doc, { rootId: "dark" }).html);
    expect(back.nodes[0]).toMatchObject({ type: "frame", mode: "dark" });
  });

  it("lint: token só de outro modo e modo sem tokens", () => {
    const doc = applyOps(themed(), [
      { op: "set_tokens", mode: "dark", tokens: { only: "#f00" } },
      { op: "update", id: "lt", props: { color: "$only" } },
      { op: "create", node: { type: "frame", id: "ghost", name: "G", mode: "ghost", x: 400, width: 10, height: 10 } },
    ]).doc;
    const rules = lintDocument(doc).map((i) => `${i.rule}:${i.nodeId}`);
    expect(rules).toContain("unknown-token:lt");
    expect(rules).toContain("unknown-mode:ghost");
    expect(rules).not.toContain("unknown-token:dt");
  });
});
