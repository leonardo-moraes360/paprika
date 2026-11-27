import { describe, expect, it } from "vitest";
import type { Gradient } from "@paprika/core";
import { angleFrom, dragGradient, gradientEnds, nudgeGradient, parseHandle, placeHandles } from "./gradient";
import { closesPath, dragAnchor, penAnchor, penOps, withoutDoublePress } from "./pen";
import { layoutAfterDrag, layoutAfterStep, packPadding, paddingAfterDrag, spacingHandles, unchangedSpacing, worldDeltaToLocal } from "./spacing";
import { toSvgPoint } from "./path-edit";

const paint = { stroke: "stroke-value", fill: "fill-value" };
const line: Gradient = { type: "linear", angle: 90, cx: 0.5, cy: 0.5, radius: 0.5, stops: [{ color: "a", offset: 0 }, { color: "b", offset: 1 }] };
const radial: Gradient = { ...line, type: "radial", radius: 0.5 };
const conic: Gradient = { ...line, type: "conic", angle: 0 };

describe("pen", () => {
  it("rounds an anchor to hundredths", () => {
    expect(penAnchor({ x: 1.2345, y: 9.999 })).toEqual({ x: 1.23, y: 10 });
  });

  it("closes only with three anchors or more and a press within 8 screen px of the first", () => {
    const three = [penAnchor({ x: 0, y: 0 }), penAnchor({ x: 50, y: 0 }), penAnchor({ x: 50, y: 50 })];
    expect(closesPath(three, { x: 3, y: 3 }, 1)).toBe(true);
    expect(closesPath(three, { x: 7.9, y: 0 }, 1)).toBe(true);
    expect(closesPath(three, { x: 8, y: 0 }, 1)).toBe(false);
    // the distance is on screen: at 2x zoom 4 world px are 8 screen px
    expect(closesPath(three, { x: 4, y: 0 }, 2)).toBe(false);
    expect(closesPath(three.slice(0, 2), { x: 0, y: 0 }, 1)).toBe(false);
  });

  it("pulls mirrored handles only past 3 screen px", () => {
    const a = penAnchor({ x: 10, y: 10 });
    expect(dragAnchor(a, { x: 12, y: 10 }, 1)).toBeNull();
    expect(dragAnchor(a, { x: 12, y: 10 }, 2)).toEqual({ x: 10, y: 10, out: { x: 12, y: 10 }, in: { x: 8, y: 10 } });
    expect(dragAnchor(a, { x: 30, y: 25 }, 1)).toEqual({ x: 10, y: 10, out: { x: 30, y: 25 }, in: { x: -10, y: -5 } });
  });

  it("drops the second press of a double click, but not a real second point", () => {
    const a = [penAnchor({ x: 0, y: 0 }), penAnchor({ x: 40, y: 0 }), penAnchor({ x: 41, y: 0 })];
    expect(withoutDoublePress(a, 1)).toHaveLength(2);
    expect(withoutDoublePress([a[0]!, a[1]!], 1)).toHaveLength(2);
  });

  it("makes the node the old canvas made: the name it is given, a 2 px stroke, a fill only when closed, the box at the integer corner", () => {
    const draft = { parentId: "page", origin: { x: 0, y: 0 }, anchors: [penAnchor({ x: 10.4, y: 20.6 }), penAnchor({ x: 60, y: 20.6 }), penAnchor({ x: 60, y: 80.2 })] };
    const open = penOps(draft, false, "Vetor 3", paint, "p1")!;
    expect(open.id).toBe("p1");
    const node = (open.ops[0] as { node: Record<string, unknown>; parentId: string }).node;
    expect(open.ops[0]).toMatchObject({ op: "create", parentId: "page" });
    expect(node).toMatchObject({ type: "path", name: "Vetor 3", x: 10, y: 20, stroke: { color: "stroke-value", width: 2 } });
    expect(node.fill).toBeUndefined();
    expect(node.width).toBe(50);
    expect(node.height).toBe(61);
    expect(node.d).toBe("M0.4 0.6 L50 0.6 L50 60.2");
    const closed = penOps(draft, true, "Vetor 1", paint, "p2")!;
    expect((closed.ops[0] as { node: Record<string, unknown> }).node).toMatchObject({ name: "Vetor 1", fill: "fill-value" });
  });

  it("makes nothing under two anchors", () => {
    expect(penOps({ parentId: null, origin: { x: 0, y: 0 }, anchors: [penAnchor({ x: 1, y: 1 })] }, false, "Vetor 1", paint)).toBeNull();
  });
});

describe("gradient handles", () => {
  it("finds the ends of a linear line across the box", () => {
    const across = gradientEnds(90, 200, 100);
    expect([across.x1, across.y1, across.x2, across.y2].map(Math.round)).toEqual([0, 50, 200, 50]);
    const diagonal = gradientEnds(180, 200, 100);
    expect(diagonal.y1).toBe(0);
    expect(diagonal.y2).toBe(100);
  });

  it("reads an angle clockwise from the top", () => {
    expect(angleFrom(10, 0, 0, 0)).toBe(90);
    expect(angleFrom(0, 10, 0, 0)).toBe(180);
    expect(angleFrom(-10, 0, 0, 0)).toBe(270);
  });

  it("places an end for a linear gradient and a centre and a radius for a radial", () => {
    expect(placeHandles(line, 200, 100).map((h) => h.key)).toEqual(["stop:0", "stop:1", "end"]);
    expect(placeHandles(radial, 200, 100).map((h) => h.key)).toEqual(["stop:0", "stop:1", "center", "radius"]);
    expect(placeHandles(conic, 200, 100).map((h) => h.key)).toEqual(["stop:0", "stop:1", "center", "angle"]);
  });

  it("drags a stop along the line, clamped to 0..1 and rounded to thousandths", () => {
    const next = dragGradient({ kind: "stop", index: 0 }, line, 50, 50, 200, 100);
    expect(next.stops[0]).toEqual({ color: "a", offset: 0.25 });
    expect(next.stops[1]).toEqual({ color: "b", offset: 1 });
    expect(dragGradient({ kind: "stop", index: 0 }, line, 400, 50, 200, 100).stops[0]!.offset).toBe(1);
    expect(line.stops[0]!.offset).toBe(0);
  });

  it("drags the centre, the radius and the angle", () => {
    expect(dragGradient({ kind: "center" }, radial, 50, 25, 200, 100)).toMatchObject({ cx: 0.25, cy: 0.25 });
    expect(dragGradient({ kind: "radius" }, radial, 150, 50, 200, 100).radius).toBe(0.25);
    expect(dragGradient({ kind: "end" }, line, 100, 100, 200, 100).angle).toBe(180);
    expect(dragGradient({ kind: "angle" }, conic, 150, 50, 200, 100).angle).toBe(90);
  });

  it("parses the handle keys it writes", () => {
    expect(parseHandle("stop:3")).toEqual({ kind: "stop", index: 3 });
    expect(parseHandle("radius")).toEqual({ kind: "radius" });
    expect(parseHandle("stop:x")).toBeNull();
    expect(parseHandle("nope")).toBeNull();
    expect(parseHandle(undefined)).toBeNull();
  });

  it("steps a handle with the keys: 1 % or 1 degree, ten times that with Shift", () => {
    expect(nudgeGradient({ kind: "stop", index: 0 }, line, 1, false).stops[0]!.offset).toBe(0.01);
    expect(nudgeGradient({ kind: "stop", index: 0 }, line, 1, true).stops[0]!.offset).toBe(0.1);
    expect(nudgeGradient({ kind: "stop", index: 0 }, line, -1, false).stops[0]!.offset).toBe(0);
    expect(nudgeGradient({ kind: "end" }, line, 1, false).angle).toBe(91);
    expect(nudgeGradient({ kind: "end" }, line, -1, true).angle).toBe(75);
    expect(nudgeGradient({ kind: "radius" }, radial, 1, true).radius).toBe(0.6);
  });
});

describe("spacing handles", () => {
  const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

  it("puts a padding handle on each side and a gap handle between neighbours", () => {
    const handles = spacingHandles({ w: 200, h: 100 }, [10, 20, 30, 40], [box(40, 10, 50, 60), box(100, 10, 50, 60)], "row");
    expect(handles.map((h) => h.id)).toEqual(["padding-top", "padding-right", "padding-bottom", "padding-left", "gap-0"]);
    expect(handles.find((h) => h.id === "padding-top")).toMatchObject({ x: 100, y: 10, axis: "y" });
    expect(handles.find((h) => h.id === "padding-right")).toMatchObject({ x: 180, y: 50, axis: "x" });
    expect(handles.find((h) => h.id === "padding-bottom")).toMatchObject({ x: 100, y: 70 });
    expect(handles.find((h) => h.id === "padding-left")).toMatchObject({ x: 40, y: 50 });
    expect(handles.find((h) => h.id === "gap-0")).toMatchObject({ kind: "gap", x: 95, y: 40, axis: "x" });
  });

  it("puts a gap handle between the lines of a wrapped layout too", () => {
    const handles = spacingHandles({ w: 200, h: 200 }, [0, 0, 0, 0], [box(0, 0, 80, 50), box(90, 0, 80, 50), box(0, 60, 80, 50)], "row");
    const gaps = handles.filter((h) => h.kind === "gap");
    expect(gaps).toHaveLength(2);
    expect(gaps[1]).toMatchObject({ axis: "y", y: 55 });
  });

  it("moves a side's padding with the pointer, all four with Alt, and packs equal ones", () => {
    expect(paddingAfterDrag([10, 10, 10, 10], "top", 0, 5, false)).toEqual([15, 10, 10, 10]);
    expect(paddingAfterDrag([10, 10, 10, 10], "bottom", 0, 5, false)).toEqual([10, 10, 5, 10]);
    expect(paddingAfterDrag([10, 20, 10, 10], "right", -5, 0, false)).toEqual([10, 25, 10, 10]);
    expect(paddingAfterDrag([10, 20, 30, 40], "left", 3, 0, true)).toBe(43);
    expect(paddingAfterDrag([10, 10, 10, 10], "left", 5, 99, false)).toEqual([10, 10, 10, 15]);
    expect(paddingAfterDrag([10, 10, 10, 10], "top", 0, -50, false)).toEqual([0, 10, 10, 10]);
    expect(packPadding([4, 4, 4, 4])).toBe(4);
  });

  it("turns a world move into the frame's own axes when it is rotated", () => {
    const local = worldDeltaToLocal(10, 0, 90);
    expect(local.x).toBeCloseTo(0);
    expect(local.y).toBeCloseTo(-10);
    expect(worldDeltaToLocal(3, 4, 0)).toEqual({ x: 3, y: 4 });
  });

  const base = { mode: "row" as const, gap: 8, padding: 10, align: "start" as const, justify: "start" as const, wrap: false };
  const start = { padding: [10, 10, 10, 10] as [number, number, number, number], gap: 8 };

  it("builds the layout of a drag and tells when nothing changed", () => {
    expect(layoutAfterDrag(base, start, { kind: "gap", axis: "x" }, { dx: 5, dy: 99 }, 0, false)).toMatchObject({ gap: 13, padding: 10 });
    expect(layoutAfterDrag(base, start, { kind: "padding", side: "left", axis: "x" }, { dx: 5, dy: 0 }, 0, true)).toMatchObject({ padding: 15, gap: 8 });
    expect(layoutAfterDrag(base, start, { kind: "padding", axis: "x" }, { dx: 5, dy: 0 }, 0, false)).toBeNull();
    expect(unchangedSpacing("gap", base, start)).toBe(true);
    expect(unchangedSpacing("padding", { ...base, padding: [10, 10, 10, 11] }, start)).toBe(false);
    expect(unchangedSpacing("padding", { ...base, padding: 10 }, start)).toBe(true);
  });

  it("steps a value with the keys", () => {
    expect(layoutAfterStep(base, start, { kind: "gap" }, 10, false)).toMatchObject({ gap: 18 });
    expect(layoutAfterStep(base, start, { kind: "padding", side: "top" }, -1, false)).toMatchObject({ padding: [9, 10, 10, 10] });
    expect(layoutAfterStep(base, start, { kind: "padding", side: "top" }, 5, true)).toMatchObject({ padding: 15 });
  });
});

describe("path coordinates", () => {
  it("maps a screen point through the inverse of the element's matrix", () => {
    // scaled 2x and moved to (100, 50)
    const m = { a: 2, b: 0, c: 0, d: 2, e: 100, f: 50 };
    expect(toSvgPoint(m, 140, 90)).toEqual({ x: 20, y: 20 });
    // turned 90 degrees
    const r = { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 };
    const p = toSvgPoint(r, 0, 10);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(0);
  });
});
