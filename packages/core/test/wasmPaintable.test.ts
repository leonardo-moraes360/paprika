import { describe, expect, it } from "vitest";
import { applyOps, createDocument, WASM_FALLBACK_RULES, wasmFallbackRule, wasmPaintable, type Document } from "../src/index.js";

type Spec = Record<string, unknown>;

function build(node: Spec, wrap?: Spec): Document {
  const root = wrap ? { type: "frame", id: "wrap", width: 200, height: 200, ...wrap, children: [{ id: "n", ...node }] } : { id: "n", ...node };
  return applyOps(createDocument("t", "d"), [{ op: "create", node: root as never }]).doc;
}

const rect = (extra: Spec = {}): Spec => ({ type: "rect", width: 40, height: 40, fill: "#fff", ...extra });
const solid = { color: "#000", width: 2 };

const fallbacks: Array<[string, string, Spec, Spec?]> = [
  ["non-shape", "text", { type: "text", text: "hi" }],
  ["non-shape", "image", { type: "image", src: "data:image/png;base64,aaaa", width: 20, height: 20 }],
  ["non-shape", "group", { type: "group", children: [] }],
  ["uneven-corners", "frame with four radii", { type: "frame", width: 40, height: 40, fill: "#fff", radius: [1, 2, 3, 4] }],
  ["uneven-corners", "rect with four radii", rect({ radius: [4, 0, 4, 0] })],
  ["under-uneven-frame", "child of an uneven frame", rect(), { fill: "#fff", radius: [8, 0, 8, 0] }],
  ["under-rotated-ancestor", "child of a rotated frame", rect(), { fill: "#fff", rotation: 12 }],
  ["gradient", "linear gradient", rect({ gradient: { type: "linear", angle: 90, stops: [{ color: "#000", offset: 0 }, { color: "#fff", offset: 1 }] } })],
  ["non-solid-fill", "oklch fill", rect({ fill: "oklch(0.7 0.1 200)" })],
  ["non-solid-fill", "color-mix fill", rect({ fill: "color-mix(in srgb, #f00 50%, #00f)" })],
  ["non-solid-stroke-color", "oklch stroke", rect({ stroke: { color: "oklch(0.7 0.1 200)", width: 2 } })],
  ["outline", "outline", rect({ outline: { color: "#f00", width: 2 } })],
  ["filter", "blur", rect({ filter: { blur: 4 } })],
  ["filter", "grayscale", rect({ filter: { grayscale: 1 } })],
  ["backdrop-filter", "backdrop blur", rect({ backdropFilter: { blur: 8 } })],
  ["several-shadows", "two outer shadows", rect({ shadow: [{ x: 0, y: 2, blur: 4, color: "#0008" }, { x: 0, y: 8, blur: 16, color: "#0004" }] })],
  ["inner-shadow", "inset shadow", rect({ shadow: { x: 0, y: 2, blur: 4, color: "#0008", inner: true } })],
  ["path-shadow", "shadow on a path", { type: "path", d: "M0 0 L10 10", width: 10, height: 10, fill: "#fff", shadow: { x: 0, y: 2, blur: 4, color: "#0008" } }],
  ["non-solid-shadow-color", "oklch shadow", rect({ shadow: { x: 0, y: 2, blur: 4, color: "oklch(0.3 0.1 30)" } })],
  ["non-solid-stroke-style", "dashed stroke", rect({ stroke: { ...solid, style: "dashed" } })],
  ["non-solid-stroke-style", "dotted stroke", rect({ stroke: { ...solid, style: "dotted" } })],
  ["stroke-position", "centered rect stroke", rect({ stroke: { ...solid, position: "center" } })],
  ["stroke-position", "outside ellipse stroke", { type: "ellipse", width: 40, height: 40, fill: "#fff", stroke: { ...solid, position: "outside" } }],
  ["stroke-position", "inside path stroke", { type: "path", d: "M0 0 L10 10", width: 10, height: 10, stroke: { ...solid, position: "inside" } }],
];

const paintable: Array<[string, Spec, Spec?]> = [
  ["plain rect", rect()],
  ["uniform radius", rect({ radius: 8 })],
  ["four equal radii", rect({ radius: [8, 8, 8, 8] })],
  ["ellipse", { type: "ellipse", width: 40, height: 40, fill: "#fff" }],
  ["frame", { type: "frame", width: 40, height: 40, fill: "#fff", clip: true }],
  ["inside stroke on a rect", rect({ stroke: solid })],
  ["zero-width stroke at any position", rect({ stroke: { color: "#000", width: 0, position: "outside" } })],
  ["centered stroke on a path", { type: "path", d: "M0 0 L10 10", width: 10, height: 10, stroke: { ...solid, position: "center" } }],
  ["one outer shadow", rect({ shadow: { x: 0, y: 2, blur: 4, color: "#0008" } })],
  ["hex, rgb and rgba fills", rect({ fill: "rgba(10, 20, 30, 0.5)" })],
  ["child of a plain frame", rect(), { fill: "#123", radius: 8 }],
  ["child of a frame with equal corners", rect(), { fill: "#123", radius: [6, 6, 6, 6] }],
];

describe("wasmPaintable: explicit fallback rules", () => {
  it("lists every rule once, with a reason", () => {
    const ids = WASM_FALLBACK_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of WASM_FALLBACK_RULES) expect(r.reason.length).toBeGreaterThan(10);
  });

  it("every rule has at least one failing case below", () => {
    expect(new Set(fallbacks.map(([id]) => id))).toEqual(new Set(WASM_FALLBACK_RULES.map((r) => r.id)));
  });

  it.each(fallbacks)("%s: %s falls back to the DOM", (id, _name, node, wrap) => {
    const doc = build(node, wrap);
    const n = doc.nodes.n!;
    expect(wasmPaintable(doc, n)).toBe(false);
    expect(wasmFallbackRule(doc, n)?.id).toBe(id);
  });

  it.each(paintable)("%s stays on the WASM layer", (_name, node, wrap) => {
    const doc = build(node, wrap);
    expect(wasmFallbackRule(doc, doc.nodes.n!)).toBeNull();
    expect(wasmPaintable(doc, doc.nodes.n!)).toBe(true);
  });
});
