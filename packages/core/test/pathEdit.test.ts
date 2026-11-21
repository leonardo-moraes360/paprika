import { describe, expect, it } from "vitest";
import {
  insertAnchor,
  moveAnchor,
  moveHandle,
  nearestOnPath,
  parsePath,
  pathBounds,
  pathEditProps,
  pathToSubpaths,
  removeAnchor,
  serializePath,
  subpathsToPath,
  toggleSmooth,
} from "../src/index.js";

const subs = (d: string) => pathToSubpaths(parsePath(d));
const back = (d: string) => serializePath(subpathsToPath(subs(d)));

describe("pathToSubpaths / subpathsToPath", () => {
  it("retas, cúbicas e vários subcaminhos voltam iguais", () => {
    for (const d of ["M0 0 L10 0 L10 10 Z", "M0 0 C5 0 10 5 10 10 L0 10", "M0 0 L4 0 Z M10 10 L14 10 L14 14 Z"]) expect(back(d)).toBe(d);
  });

  it("fechamento explícito vira uma âncora só; curva de volta ao início fica", () => {
    expect(subs("M0 0 L10 0 L10 10 L0 0 Z")[0]!.anchors).toHaveLength(3);
    const s = subs("M0 0 L10 0 C10 10 0 10 0 0 Z")[0]!;
    expect(s.anchors).toHaveLength(2);
    expect(s.anchors[0]!.in).toEqual({ x: 0, y: 10 });
    expect(serializePath(subpathsToPath([s]))).toBe("M0 0 L10 0 C10 10 0 10 0 0 Z");
  });

  it("H/V/S/T/Q e arcos viram retas e cúbicas com a mesma forma", () => {
    expect(back("M0 0 H10 V10")).toBe("M0 0 L10 0 L10 10");
    expect(back("M0 0 Q10 0 10 10")).toBe("M0 0 C6.67 0 10 3.33 10 10");
    const arc = subpathsToPath(subs("M0 10 A10 10 0 0 1 20 10"));
    const b = pathBounds(arc);
    expect(b.width).toBeCloseTo(20, 2);
    expect(b.height).toBeCloseTo(10, 2);
  });

  it("comando depois de Z começa outro subcaminho no ponto inicial", () => {
    const s = subs("M5 5 L10 5 L10 10 Z L0 0");
    expect(s).toHaveLength(2);
    expect(s[1]!.anchors.map((a) => [a.x, a.y])).toEqual([[5, 5], [0, 0]]);
  });
});

describe("edição", () => {
  it("mover âncora leva as alças junto", () => {
    const s = moveAnchor(subs("M0 0 C5 0 10 5 10 10"), { sub: 0, index: 1 }, { x: 20, y: 20 });
    expect(serializePath(subpathsToPath(s))).toBe("M0 0 C5 0 20 15 20 20");
  });

  it("mover alça com espelho mantém o comprimento da oposta", () => {
    const s = subs("M0 0 C0 0 5 10 10 10 C15 10 20 0 20 0");
    const m = moveHandle(s, { sub: 0, index: 1 }, "out", { x: 10, y: 0 }, true);
    expect(m[0]!.anchors[1]!.in!.x).toBeCloseTo(10, 9);
    expect(m[0]!.anchors[1]!.in!.y).toBeCloseTo(15, 9);
    expect(moveHandle(s, { sub: 0, index: 1 }, "out", { x: 10, y: 0 })[0]!.anchors[1]!.in).toEqual({ x: 5, y: 10 });
    expect(s[0]!.anchors[1]!.out).toEqual({ x: 15, y: 10 }); // original intacto
  });

  it("remover âncora; subcaminho vazio some", () => {
    expect(serializePath(subpathsToPath(removeAnchor(subs("M0 0 L10 0 L10 10 Z"), { sub: 0, index: 1 })))).toBe("M0 0 L10 10 Z");
    expect(removeAnchor(subs("M0 0 M5 5 L6 6"), { sub: 0, index: 0 })).toHaveLength(1);
  });

  it("alternar canto/suave", () => {
    const smooth = toggleSmooth(subs("M0 0 L10 10 L20 0"), { sub: 0, index: 1 });
    expect(smooth[0]!.anchors[1]!.in!.y).toBeCloseTo(10, 9);
    expect(smooth[0]!.anchors[1]!.out!.x).toBeGreaterThan(10);
    expect(toggleSmooth(smooth, { sub: 0, index: 1 })[0]!.anchors[1]).toEqual({ x: 10, y: 10 });
  });

  it("inserir âncora não muda a forma (reta, cúbica e trecho de fechamento)", () => {
    const line = insertAnchor(subs("M0 0 L10 0"), { sub: 0, index: 0 }, 0.5);
    expect(serializePath(subpathsToPath(line.subs))).toBe("M0 0 L5 0 L10 0");
    expect(line.ref).toEqual({ sub: 0, index: 1 });

    const curve = subs("M0 0 C0 10 10 10 10 0");
    const split = insertAnchor(curve, { sub: 0, index: 0 }, 0.5);
    expect(serializePath(subpathsToPath(split.subs))).toBe("M0 0 C0 5 2.5 7.5 5 7.5 C7.5 7.5 10 5 10 0");

    const closing = insertAnchor(subs("M0 0 L10 0 L10 10 Z"), { sub: 0, index: 2 }, 0.5);
    expect(serializePath(subpathsToPath(closing.subs))).toBe("M0 0 L10 0 L10 10 L5 5 Z");
  });

  it("ponto mais perto no caminho", () => {
    const hit = nearestOnPath(subs("M0 0 L10 0 L10 10"), { x: 4, y: 1 })!;
    expect(hit.ref).toEqual({ sub: 0, index: 0 });
    expect(hit.t).toBeCloseTo(0.4, 4);
    expect(hit.distance).toBeCloseTo(1, 4);
    expect(hit.point.x).toBeCloseTo(4, 4);
  });
});

describe("pathEditProps", () => {
  it("normaliza para a origem e ajusta a caixa", () => {
    const s = moveAnchor(subs("M0 0 L10 0 L10 10"), { sub: 0, index: 0 }, { x: -5, y: -3 });
    expect(pathEditProps({ x: 100, y: 50 }, s, true)).toEqual({ d: "M0 0 L15 3 L15 13", x: 95, y: 47, width: 15, height: 13 });
    expect(pathEditProps({ x: 100, y: 50 }, s, false)).toEqual({ d: "M0 0 L15 3 L15 13", width: 15, height: 13 });
  });

  it("com viewBox só muda d; sem pontos devolve null", () => {
    expect(pathEditProps({ x: 0, y: 0, viewBox: [0, 0, 24, 24] }, subs("M-2 0 L30 0"), true)).toEqual({ d: "M-2 0 L30 0" });
    expect(pathEditProps({ x: 0, y: 0 }, [], true)).toBeNull();
  });
});
