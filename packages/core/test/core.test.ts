import { describe, expect, it } from "vitest";
import {
  History,
  OpError,
  applyOps,
  contrastRatio,
  createDocument,
  exportReact,
  lintDocument,
  nodeStyle,
  outline,
  parseColor,
  parseDocument,
  queryNodes,
  renderHTML,
  type Document,
  type Op,
} from "../src/index.js";

function card(): { doc: Document; ids: string[] } {
  const base = createDocument("Teste", "doc1");
  const { doc, created } = applyOps(base, [
    {
      op: "create",
      node: {
        type: "frame",
        id: "card",
        name: "Card",
        width: 320,
        height: 200,
        fill: "#ffffff",
        layout: { mode: "column", gap: 8, padding: 16 },
        children: [
          { type: "text", id: "title", name: "Título", text: "Olá", fontSize: 24, width: "fill", height: "hug" },
          { type: "rect", id: "bar", width: "fill", height: 4, fill: "#ff278c" },
        ],
      },
    },
  ]);
  return { doc, ids: created };
}

describe("applyOps", () => {
  it("cria árvore aninhada com ids e parentId corretos", () => {
    const { doc, ids } = card();
    expect(ids).toEqual(["card", "title", "bar"]);
    expect(doc.rootIds).toEqual(["card"]);
    expect(doc.nodes.title?.parentId).toBe("card");
    expect(doc.nodes.card?.type === "frame" && doc.nodes.card.children).toEqual(["title", "bar"]);
    expect(() => parseDocument(doc)).not.toThrow();
  });

  it("é atômico: uma op inválida não altera o documento de entrada", () => {
    const { doc } = card();
    const before = JSON.stringify(doc);
    expect(() =>
      applyOps(doc, [
        { op: "update", id: "title", props: { text: "Mudou" } },
        { op: "update", id: "naoexiste", props: { x: 1 } },
      ]),
    ).toThrow(OpError);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("rejeita campos desconhecidos em vez de descartar em silêncio", () => {
    const { doc } = card();
    expect(() => applyOps(doc, [{ op: "update", id: "title", props: { colour: "#000" } }])).toThrow(
      /unknown field for text: colour/,
    );
    expect(() => applyOps(doc, [{ op: "create", node: { type: "rect", text: "x" } }])).toThrow(/unknown fields/);
  });

  it("rejeita mudanças de campos imutáveis e tipos inválidos", () => {
    const { doc } = card();
    expect(() => applyOps(doc, [{ op: "update", id: "title", props: { type: "rect" } }])).toThrow(/cannot be changed/);
    expect(() => applyOps(doc, [{ op: "update", id: "title", props: { opacity: 2 } }])).toThrow(/opacity/);
    expect(() => applyOps(doc, [{ op: "update", id: "title", props: { fill: "red;}" } }])).toThrow(/color/);
    expect(() =>
      applyOps(doc, [{ op: "update", id: "title", props: { fontFamily: "x;background:url(http://evil)" } }]),
    ).toThrow(/fontFamily/);
  });

  it("só frames recebem filhos e move não cria ciclos", () => {
    const { doc } = card();
    expect(() => applyOps(doc, [{ op: "create", node: { type: "rect" }, parentId: "bar" }])).toThrow(/only frame, group and page/);
    const { doc: d2 } = applyOps(doc, [{ op: "create", node: { type: "frame", id: "inner" }, parentId: "card" }]);
    expect(() => applyOps(d2, [{ op: "move", id: "card", parentId: "inner" }])).toThrow(/cycle/);
  });

  it("ids duplicados são rejeitados", () => {
    const { doc } = card();
    expect(() => applyOps(doc, [{ op: "create", node: { type: "rect", id: "bar" } }])).toThrow(/already exists/);
  });

  it("null em update volta o campo ao padrão", () => {
    const { doc } = card();
    const { doc: d2 } = applyOps(doc, [{ op: "update", id: "card", props: { fill: null } }]);
    expect(d2.nodes.card?.fill).toBeUndefined();
  });
});

describe("History (undo/redo)", () => {
  const ops: Op[][] = [
    [{ op: "update", id: "title", props: { text: "A", color: "#222" } }],
    [{ op: "move", id: "bar", parentId: null, index: 0 }],
    [{ op: "delete", id: "card" }],
    [{ op: "set_tokens", tokens: { primary: "#ff278c" } }],
    [{ op: "rename_document", name: "Novo" }],
  ];

  it("desfaz e refaz cada tipo de operação até o estado original", () => {
    const { doc } = card();
    const h = new History(doc);
    const snapshots = [JSON.stringify(h.doc)];
    for (const batch of ops) {
      h.apply(batch, "agent:test");
      snapshots.push(JSON.stringify(h.doc));
    }
    for (let i = ops.length - 1; i >= 0; i--) {
      h.undo();
      expect(h.doc).toEqual(JSON.parse(snapshots[i]!));
    }
    expect(h.canUndo).toBe(false);
    for (let i = 1; i <= ops.length; i++) {
      h.redo();
      expect(h.doc).toEqual(JSON.parse(snapshots[i]!));
    }
  });

  it("tokens named like Object.prototype members undo to absent, not to the inherited value", () => {
    const { doc } = card();
    const h = new History(doc);
    h.apply([{ op: "set_tokens", tokens: { constructor: "#111111", toString: 4 } }]);
    expect(h.doc.tokens).toMatchObject({ constructor: "#111111", toString: 4 });
    h.undo();
    expect(Object.hasOwn(h.doc.tokens, "constructor")).toBe(false);
    expect(Object.hasOwn(h.doc.tokens, "toString")).toBe(false);
    expect(h.doc).toEqual(doc);
  });

  it("batch: consecutive writes of one actor become one entry; another write or an undo closes it", () => {
    const { doc } = card();
    const h = new History(doc);
    const start = JSON.stringify(h.doc);
    for (const b of ops.slice(0, 3)) h.apply(b, "agent:a", "step", "draw");
    const merged = JSON.stringify(h.doc);
    expect(h.entries()).toHaveLength(1);
    expect(h.entries()[0]).toMatchObject({ actor: "agent:a", label: "draw", batch: "draw" });
    expect(h.entries()[0]!.ops).toHaveLength(3);
    h.apply(ops[3]!, "agent:b", "", "draw"); // other actor: new entry
    h.apply(ops[4]!, "agent:a", "", "draw"); // a's batch was closed by b's write
    expect(h.entries()).toHaveLength(3);
    h.undo();
    h.undo();
    expect(h.doc).toEqual(JSON.parse(merged));
    h.undo(); // the whole batch
    expect(h.doc).toEqual(JSON.parse(start));
    h.redo();
    expect(h.doc).toEqual(JSON.parse(merged));
    h.apply(ops[3]!, "agent:a", "", "draw"); // after a redo the batch stays closed
    expect(h.entries()).toHaveLength(2);
  });

  it("nova edição limpa a pilha de refazer", () => {
    const { doc } = card();
    const h = new History(doc);
    h.apply([{ op: "update", id: "title", props: { text: "A" } }]);
    h.undo();
    h.apply([{ op: "update", id: "title", props: { text: "B" } }]);
    expect(h.canRedo).toBe(false);
  });
});

describe("estilo e renderização", () => {
  it("filhos de frame com layout usam flex; fill vira flex no eixo principal", () => {
    const { doc } = card();
    const s = nodeStyle(doc, doc.nodes.bar!);
    expect(s.position).toBe("relative");
    expect(s.alignSelf).toBe("stretch");
    const f = nodeStyle(doc, doc.nodes.card!);
    expect(f.display).toBe("flex");
    expect(f.flexDirection).toBe("column");
  });

  it("resolve tokens encadeados", () => {
    const { doc } = card();
    const { doc: d2 } = applyOps(doc, [
      { op: "set_tokens", tokens: { pink: "#ff278c", brand: "$pink" } },
      { op: "update", id: "card", props: { fill: "$brand" } },
    ]);
    expect(nodeStyle(d2, d2.nodes.card!).background).toBe("#ff278c");
  });

  it("HTML escapa texto e atributos", () => {
    const { doc } = card();
    const { doc: d2 } = applyOps(doc, [{ op: "update", id: "title", props: { text: "<script>alert(1)</script>" } }]);
    const { html, bounds } = renderHTML(d2, { rootId: "card" });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(bounds).toEqual({ x: 0, y: 0, width: 320, height: 200 });
  });

  it("exporta React com nome de componente derivado", () => {
    const { doc } = card();
    const tsx = exportReact(doc, "card");
    expect(tsx).toMatch(/^export function Card\(\)/);
    expect(tsx).toContain("Olá");
  });
});

describe("lint", () => {
  it("detecta contraste baixo, token inexistente e overflow", () => {
    const base = createDocument("L", "d");
    const { doc } = applyOps(base, [
      {
        op: "create",
        node: {
          type: "frame",
          id: "f",
          name: "Tela",
          width: 100,
          height: 100,
          fill: "#ffffff",
          children: [
            { type: "text", id: "t", text: "fraco", color: "#cccccc", fontSize: 14 },
            { type: "rect", id: "r", x: 80, y: 80, width: 50, height: 50, fill: "$nope" },
          ],
        },
      },
    ]);
    const rules = lintDocument(doc).map((i) => `${i.rule}:${i.nodeId}`);
    expect(rules).toContain("contrast:t");
    expect(rules).toContain("unknown-token:r");
    expect(rules).toContain("overflow:r");
  });

  it("contraste segue WCAG", () => {
    expect(contrastRatio(parseColor("#000")!, parseColor("#fff")!)).toBeCloseTo(21, 0);
    expect(parseColor("rgba(255, 0, 0, 0.5)")).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
    expect(parseColor("linear-gradient(red, blue)")).toBeUndefined();
  });
});

describe("consulta", () => {
  it("outline é compacto e respeita profundidade", () => {
    const { doc } = card();
    expect(outline(doc, { depth: 0 })).toBe('frame#card "Card" 320×200 @0,0 fill=#ffffff column gap=8\n  … 2 filho(s)');
    expect(outline(doc).split("\n")).toHaveLength(3);
  });

  it("queryNodes filtra por tipo, nome e texto", () => {
    const { doc } = card();
    expect(queryNodes(doc, { type: "text" }).map((n) => n.id)).toEqual(["title"]);
    expect(queryNodes(doc, { text: "olá" }).map((n) => n.id)).toEqual(["title"]);
    expect(queryNodes(doc, { name: "car" }).map((n) => n.id)).toEqual(["card"]);
  });
});

describe("parseDocument", () => {
  it("rejeita documentos com árvore inconsistente", () => {
    const { doc } = card();
    const broken = structuredClone(doc);
    broken.rootIds.push("title");
    expect(() => parseDocument(broken)).toThrow(/more than once|parentId/);
    const orphan = structuredClone(doc);
    orphan.rootIds = [];
    expect(() => parseDocument(orphan)).toThrow(/orphan|parentId/);
  });
});
