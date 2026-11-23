import { describe, expect, it } from "vitest";
import {
  History,
  applyOps,
  copyId,
  createDocument,
  parseDocument,
  renderHTML,
  type Document,
  type FrameNode,
  type PathNode,
  type TextNode,
} from "../src/index.js";

function base(): Document {
  return applyOps(createDocument("T", "d"), [
    {
      op: "create",
      node: {
        type: "frame",
        id: "btn",
        name: "Botão",
        component: true,
        width: 120,
        height: 40,
        radius: 8,
        fill: "#3355ff",
        stroke: { color: "#000000", width: 1 },
        layout: { mode: "row", gap: 4, padding: [8, 12, 8, 12] },
        children: [
          { type: "text", id: "lbl", text: "OK", color: "#ffffff", fontSize: 14, letterSpacing: 1, width: 40, height: 20 },
          { type: "path", id: "ico", d: "M0 0 L10 10", width: 10, height: 10 },
        ],
      },
    },
    { op: "create", node: { type: "frame", id: "i1", instanceOf: "btn", x: 200, y: 0 } },
  ]).doc;
}

const kid = (doc: Document, inst: string, src: string) => doc.nodes[copyId(inst, src)]!;

describe("componentes e instâncias", () => {
  it("instância copia o desenho do componente, com ids derivados e sourceId", () => {
    const doc = base();
    const i1 = doc.nodes.i1 as FrameNode;
    expect(i1.children).toEqual([copyId("i1", "lbl"), copyId("i1", "ico")]);
    expect(i1).toMatchObject({ x: 200, width: 120, height: 40, radius: 8, fill: "#3355ff", layout: { mode: "row", gap: 4 } });
    expect(i1.component).toBeUndefined();
    const lbl = kid(doc, "i1", "lbl") as TextNode;
    expect(lbl).toMatchObject({ type: "text", text: "OK", sourceId: "lbl", parentId: "i1" });
    expect(copyId("i1", "lbl")).toMatch(/^i1-[0-9a-z]{14}$/);
    expect(copyId("i1", "lbl")).toBe(copyId("i1", "lbl"));
    // documento continua válido ao reler
    expect(() => parseDocument(JSON.parse(JSON.stringify(doc)))).not.toThrow();
  });

  it("mudança no componente propaga; desfazer volta", () => {
    const h = new History(base());
    h.apply([{ op: "update", id: "lbl", props: { text: "Enviar" } }], "a", "texto");
    expect((kid(h.current, "i1", "lbl") as TextNode).text).toBe("Enviar");
    h.undo();
    expect((kid(h.current, "i1", "lbl") as TextNode).text).toBe("OK");
  });

  it("scale escala geometria, texto, borda, layout e path", () => {
    const doc = applyOps(base(), [{ op: "update", id: "i1", props: { scale: 2 } }]).doc;
    const i1 = doc.nodes.i1 as FrameNode;
    expect(i1).toMatchObject({ width: 240, height: 80, radius: 16, stroke: { width: 2 }, layout: { gap: 8, padding: [16, 24, 16, 24] }, x: 200 });
    expect(kid(doc, "i1", "lbl")).toMatchObject({ fontSize: 28, letterSpacing: 2, width: 80, height: 40, lineHeight: 1.4 });
    const ico = kid(doc, "i1", "ico") as PathNode;
    expect(ico).toMatchObject({ width: 20, height: 20, viewBox: [0, 0, 10, 10], d: "M0 0 L10 10" });
  });

  it("update numa cópia vira override e sobrevive a mudanças no componente", () => {
    const h = new History(base());
    const l = copyId("i1", "lbl");
    h.apply([{ op: "update", id: l, props: { text: "Cancelar", color: "#ff0000" } }], "a", "ov");
    expect((h.current.nodes.i1 as FrameNode).overrides).toEqual({ lbl: { text: "Cancelar", color: "#ff0000" } });
    h.apply([{ op: "update", id: "lbl", props: { fontSize: 20, text: "Outro" } }], "a", "comp");
    expect(kid(h.current, "i1", "lbl")).toMatchObject({ text: "Cancelar", fontSize: 20 });
    // null volta ao valor do componente
    h.apply([{ op: "update", id: l, props: { text: null } }], "a", "reset");
    expect((h.current.nodes.i1 as FrameNode).overrides).toEqual({ lbl: { color: "#ff0000" } });
    expect((kid(h.current, "i1", "lbl") as TextNode).text).toBe("Outro");
    h.undo();
    h.undo();
    h.undo();
    expect((h.current.nodes.i1 as FrameNode).overrides).toBeUndefined();
    expect((kid(h.current, "i1", "lbl") as TextNode).text).toBe("OK");
  });

  it("fill da raiz vira override; geometria da raiz é recusada", () => {
    const doc = applyOps(base(), [{ op: "update", id: "i1", props: { fill: "#00aa00", x: 10 } }]).doc;
    expect(doc.nodes.i1).toMatchObject({ fill: "#00aa00", x: 10, overrides: { btn: { fill: "#00aa00" } } });
    const after = applyOps(doc, [{ op: "update", id: "btn", props: { fill: "#111111" } }]).doc;
    expect(after.nodes.i1).toMatchObject({ fill: "#00aa00" });
    expect(() => applyOps(base(), [{ op: "update", id: "i1", props: { width: 10 } }])).toThrow(/come from the component "btn"/);
  });

  it("regras: cópias não se movem, não se apagam, não recebem filhos", () => {
    const doc = base();
    const l = copyId("i1", "lbl");
    expect(() => applyOps(doc, [{ op: "update", id: l, props: { x: 5 } }])).toThrow(/only fill, color, text/);
    expect(() => applyOps(doc, [{ op: "delete", id: l }])).toThrow(/visible: false/);
    expect(() => applyOps(doc, [{ op: "move", id: l, parentId: null }])).toThrow(/a copy inside the instance/);
    expect(() => applyOps(doc, [{ op: "create", parentId: "i1", node: { type: "rect" } }])).toThrow(/is an instance/);
    expect(() => applyOps(doc, [{ op: "move", id: "btn", parentId: "i1" }])).toThrow(/is an instance/);
    expect(() => applyOps(doc, [{ op: "update", id: l, props: { fontSize: 3 } }])).toThrow(/got fontSize/);
    expect(() => applyOps(doc, [{ op: "create", node: { type: "rect", sourceId: "x" } }])).toThrow(/sourceId is generated/);
  });

  it("regras de fim de transação: componente precisa existir e não pode ser instância", () => {
    const doc = base();
    expect(() => applyOps(doc, [{ op: "delete", id: "btn" }])).toThrow(/component "btn" does not exist/);
    expect(() => applyOps(doc, [{ op: "update", id: "btn", props: { component: null } }])).toThrow(/is not a component/);
    expect(() => applyOps(doc, [{ op: "move", id: "i1", parentId: "btn" }])).toThrow(/component cycle: "btn" → "btn"/);
    expect(() => applyOps(doc, [{ op: "update", id: "i1", props: { component: true } }])).toThrow(/cannot be a component/);
    // apagar componente e instâncias juntos funciona
    expect(() => applyOps(doc, [{ op: "delete", id: "i1" }, { op: "delete", id: "btn" }])).not.toThrow();
  });

  it("detach deixa frame comum com as mesmas cópias; desfazer volta à instância", () => {
    const h = new History(applyOps(base(), [{ op: "update", id: copyId("i1", "lbl"), props: { text: "X" } }]).doc);
    h.apply([{ op: "detach", ids: ["i1"] }], "a", "detach");
    const i1 = h.current.nodes.i1 as FrameNode;
    expect(i1.instanceOf).toBeUndefined();
    expect(i1.overrides).toBeUndefined();
    const l = kid(h.current, "i1", "lbl") as TextNode;
    expect(l.text).toBe("X");
    expect(l.sourceId).toBeUndefined();
    // agora é um nó comum
    h.apply([{ op: "update", id: l.id, props: { x: 3 } }], "a", "mover");
    h.undo();
    h.undo();
    expect((h.current.nodes.i1 as FrameNode).instanceOf).toBe("btn");
    expect(kid(h.current, "i1", "lbl")).toMatchObject({ sourceId: "lbl", text: "X" });
  });

  it("apagar e desfazer uma instância restaura as cópias", () => {
    const h = new History(base());
    h.apply([{ op: "delete", id: "i1" }], "a", "del");
    expect(h.current.nodes[copyId("i1", "lbl")]).toBeUndefined();
    h.undo();
    expect(kid(h.current, "i1", "lbl")).toMatchObject({ sourceId: "lbl" });
  });

  it("groups dentro do componente são copiados; instância num group ajusta a caixa", () => {
    const doc = applyOps(base(), [
      { op: "update", id: "btn", props: { layout: null } },
      { op: "update", id: "ico", props: { x: 50, y: 5 } },
      { op: "group", ids: ["lbl", "ico"], id: "g" },
    ]).doc;
    const gc = kid(doc, "i1", "g");
    expect(gc).toMatchObject({ type: "group", sourceId: "g", width: 60, height: 20 });
    expect((doc.nodes.i1 as FrameNode).children).toEqual([copyId("i1", "g")]);
    const wrap = applyOps(doc, [{ op: "group", ids: ["i1"], id: "outer" }, { op: "update", id: "i1", props: { scale: 3 } }]).doc;
    expect(wrap.nodes.outer).toMatchObject({ width: 360, height: 120 });
  });

  it("props de texto, boolean e variante, e slot preenchido pela instância", () => {
    const doc = applyOps(createDocument("T", "d"), [
      {
        op: "create",
        node: {
          type: "frame",
          id: "btn",
          component: true,
          width: 120,
          height: 40,
          componentProps: [
            { name: "label", type: "text", default: "OK" },
            { name: "disabled", type: "boolean", default: false },
            { name: "size", type: "variant", options: ["sm", "md"], default: "md" },
          ],
          children: [
            { type: "text", id: "lbl", text: "OK", width: 40, height: 20, bind: { text: "label" } },
            { type: "ellipse", id: "dot", width: 8, height: 8, bind: { visible: "disabled" } },
            { type: "rect", id: "sm", width: 10, height: 10, bind: { variant: { size: "sm" } } },
            { type: "frame", id: "icon", slot: "icon", width: 16, height: 16, children: [{ type: "rect", id: "ph", width: 4, height: 4 }] },
          ],
        },
      },
      { op: "create", node: { type: "ellipse", id: "gem", width: 12, height: 12, fill: "#00aa00" } },
      {
        op: "create",
        node: {
          type: "frame",
          id: "i1",
          instanceOf: "btn",
          x: 200,
          propValues: { label: "Enviar", disabled: false, size: "md" },
          slots: { icon: ["gem"] },
        },
      },
    ]).doc;
    expect(kid(doc, "i1", "lbl")).toMatchObject({ text: "Enviar" });
    expect(kid(doc, "i1", "dot")).toMatchObject({ visible: false });
    expect(doc.nodes[copyId("i1", "sm")]).toBeUndefined();
    const icon = kid(doc, "i1", "icon") as FrameNode;
    expect(icon.children).toEqual([copyId("i1", "icon/gem")]);
    expect(doc.nodes[copyId("i1", "icon/gem")]).toMatchObject({ type: "ellipse", fill: "#00aa00", sourceId: "icon/gem" });
    expect(doc.nodes[copyId("i1", "ph")]).toBeUndefined();
  });

  it("instância dentro de componente aceita override pelo caminho", () => {
    const doc = applyOps(createDocument("T", "d"), [
      {
        op: "create",
        node: {
          type: "frame",
          id: "btn",
          component: true,
          width: 80,
          height: 32,
          fill: "#3355ff",
          children: [{ type: "text", id: "lbl", text: "OK", width: 20, height: 16 }],
        },
      },
      {
        op: "create",
        node: {
          type: "frame",
          id: "card",
          component: true,
          width: 200,
          height: 80,
          children: [{ type: "frame", id: "btnInst", instanceOf: "btn", x: 8, y: 8 }],
        },
      },
      { op: "create", node: { type: "frame", id: "c1", instanceOf: "card", x: 300, overrides: { "btnInst/lbl": { text: "Salvar" } } } },
    ]).doc;
    const nested = doc.nodes[copyId("c1", "btnInst")] as FrameNode;
    expect(nested.instanceOf).toBe("btn");
    expect(doc.nodes[copyId(nested.id, "lbl")]).toMatchObject({ text: "Salvar", sourceId: "lbl" });
    const h = new History(doc);
    const label = copyId(nested.id, "lbl");
    h.apply([{ op: "update", id: label, props: { text: "Cancelar" } }], "a", "path");
    expect((h.current.nodes.c1 as FrameNode).overrides).toEqual({ "btnInst/lbl": { text: "Cancelar" } });
    expect((h.current.nodes[copyId(copyId("c1", "btnInst"), "lbl")] as TextNode).text).toBe("Cancelar");
  });

  it("renderiza a instância como frame comum", () => {
    const { html } = renderHTML(base(), { rootId: "i1" });
    expect(html).toContain(`data-paprika-id="${copyId("i1", "lbl")}"`);
    expect(html).toContain("OK");
  });
});
