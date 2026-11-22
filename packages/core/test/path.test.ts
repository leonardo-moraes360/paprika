import { describe, expect, it } from "vitest";
import {
  anchorsToPath,
  applyOps,
  createDocument,
  lintDocument,
  parsePath,
  pathBounds,
  pathError,
  renderHTML,
  serializePath,
  translatePath,
} from "../src/index.js";

const near = (a: number, b: number, eps = 0.05) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("path: parser", () => {
  it("normaliza relativos, H/V, S/T e lineto implícito para absolutos", () => {
    const segs = parsePath("m10 10 20 0 h10 v10 c0 10 10 10 10 0 s10 -10 10 0 q5 5 10 0 t10 0 z");
    expect(segs.map((s) => s.cmd).join("")).toBe("MLLLCCQQZ");
    expect(serializePath(segs)).toBe(
      "M10 10 L30 10 L40 10 L40 20 C40 30 50 30 50 20 C50 10 60 10 60 20 Q65 25 70 20 Q75 15 80 20 Z",
    );
  });

  it("aceita flags de arco coladas e números compactos", () => {
    const segs = parsePath("M0,0A5 5 0 1110 0L.5.5-1e1-2");
    expect(segs[1]).toMatchObject({ cmd: "A", largeArc: true, sweep: true, to: { x: 10, y: 0 } });
    expect(segs[2]).toMatchObject({ cmd: "L", to: { x: 0.5, y: 0.5 } });
    expect(segs[3]).toMatchObject({ cmd: "L", to: { x: -10, y: -2 } });
  });

  it("erros apontam a posição", () => {
    expect(pathError("L 0 0")).toMatch(/start with M/);
    expect(pathError("M0 0 C 1 2 3")).toMatch(/number expected at position 12/);
    expect(pathError("M0 0 X 1")).toMatch(/unknown command "X"/);
    expect(pathError("M0 0 Z 4")).toMatch(/numbers after Z/);
    expect(pathError("M0 0 A 1 1 0 2 0 3 3")).toMatch(/arc flag/);
    expect(pathError("M0 0 L 1 1 url(#x)")).not.toBeNull();
    expect(pathError("M0 0 C 0 -10 10 -10 10 0")).toBeNull();
  });
});

describe("path: bounds", () => {
  it("usa extremos da cúbica, não os pontos de controle", () => {
    const b = pathBounds(parsePath("M0 0 C 0 -40 100 -40 100 0"));
    near(b.x, 0);
    near(b.width, 100);
    near(b.y, -30); // pico da cúbica = 3/4 da altura dos controles
    near(b.height, 30);
  });

  it("quadrática e arco (semicírculo)", () => {
    const q = pathBounds(parsePath("M0 0 Q 50 100 100 0"));
    near(q.height, 50);
    const a = pathBounds(parsePath("M0 50 A 50 50 0 0 1 100 50"));
    near(a.y, 0, 0.1);
    near(a.width, 100, 0.1);
  });

  it("translate desloca todos os pontos", () => {
    expect(serializePath(translatePath(parsePath("M10 10 C 20 0 30 0 40 10"), -10, -5))).toBe("M0 5 C10 -5 20 -5 30 5");
  });
});

describe("path: caneta (âncoras → d)", () => {
  it("reta sem alças, cúbica com alças, fecha com Z", () => {
    const d = serializePath(
      anchorsToPath(
        [
          { x: 0, y: 0 },
          { x: 50, y: 0, in: { x: 40, y: -20 }, out: { x: 60, y: 20 } },
          { x: 50, y: 50 },
        ],
        true,
      ),
    );
    expect(d).toBe("M0 0 C0 0 40 -20 50 0 C60 20 50 50 50 50 L0 0 Z");
  });
});

describe("path: nó no documento", () => {
  it("create sem width/height usa a caixa do desenho; viewBox define a caixa", () => {
    const { doc } = applyOps(createDocument("t", "d"), [
      { op: "create", node: { type: "path", id: "p", d: "M0 0 L 120 0 L 60 80 Z", fill: "#111111" } },
      { op: "create", node: { type: "path", id: "icon", d: "M12 2 L22 22 L2 22 Z", viewBox: [0, 0, 24, 24], fill: "#111111" } },
    ]);
    expect(doc.nodes.p).toMatchObject({ width: 120, height: 80 });
    expect(doc.nodes.icon).toMatchObject({ width: 24, height: 24 });
  });

  it("renderiza <svg><path> com fill/stroke resolvidos e sem background na caixa", () => {
    const base = createDocument("t", "d");
    base.tokens.ink = "#123456";
    const { doc } = applyOps(base, [
      {
        op: "create",
        node: { type: "path", id: "p", d: "M0 0 L10 10", stroke: { color: "$ink", width: 2 }, shadow: { x: 0, y: 2, blur: 4, spread: 0, color: "#0004" } },
      },
    ]);
    const { html } = renderHTML(doc, { rootId: "p" });
    expect(html).toMatch(/<svg data-paprika-id="p"[^>]*><path d="M0 0 L10 10" fill="none" fill-rule="nonzero" stroke-linecap="round" stroke-linejoin="round" stroke="#123456" stroke-width="2"\/><\/svg>/);
    expect(html).toContain("drop-shadow(");
    expect(html).not.toContain("border:");
  });

  it("stroke dashed adds stroke-dasharray from width", () => {
    const base = createDocument("t", "d");
    const { doc } = applyOps(base, [
      {
        op: "create",
        node: { type: "path", id: "p", d: "M0 0 L20 0", stroke: { color: "#000", width: 2, style: "dashed" } },
      },
    ]);
    const { html } = renderHTML(doc, { rootId: "p" });
    expect(html).toContain('stroke-dasharray="6 5"');
  });

  it("d inválido é rejeitado de forma atômica; lint avisa path invisível", () => {
    const base = createDocument("t", "d");
    expect(() =>
      applyOps(base, [
        { op: "create", node: { type: "rect", id: "ok" } },
        { op: "create", node: { type: "path", id: "bad", d: "M0 0 Q 1" } },
      ]),
    ).toThrow(/invalid d/);
    expect(base.nodes.ok).toBeUndefined();
    const { doc } = applyOps(base, [{ op: "create", node: { type: "path", id: "ghost", d: "M0 0 L 5 5" } }]);
    expect(lintDocument(doc).map((i) => i.rule)).toContain("invisible-path");
  });
});
