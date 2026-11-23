import { describe, expect, it } from "vitest";
import { applyOps, createDocument, exportReact, exportSVG, measureRichText, renderHTML } from "../src/index.js";

const runs = [
  { start: 6, end: 10, fontWeight: 700, color: "$brand" },
  { start: 11, end: 15, italic: true, href: "https://paprika.dev", fontSize: "$text.lg" },
];

function rich() {
  const base = createDocument("t", "d");
  return applyOps(base, [
    { op: "set_tokens", tokens: { brand: "#c43d27", "text.lg": 28 } },
    { op: "create", node: { type: "text", id: "t", text: "Hello bold link", width: 280, height: 40, runs } },
  ]).doc;
}

describe("text runs", () => {
  it("paints runs in HTML, React and SVG", () => {
    const doc = rich();
    const html = renderHTML(doc).html;
    expect(html).toContain("font-weight:700");
    expect(html).toContain("#c43d27");
    expect(html).toContain("font-style:italic");
    expect(html).toContain("font-size:28px");
    expect(html).toContain('href="https://paprika.dev"');
    expect(html).toContain(">bold<");
    const react = exportReact(doc, "t");
    expect(react).toContain("fontWeight: 700");
    expect(react).toContain('href="https://paprika.dev"');
    const svg = exportSVG(doc).svg;
    expect(svg).toContain('font-weight="700"');
    expect(svg).toContain('font-size="28"');
    expect(svg).toContain('href="https://paprika.dev"');
    expect(svg).toContain('text-decoration="underline"');
  });

  it("measures a larger run as a taller line", () => {
    const plain = measureRichText("Hello bold link", 16);
    const richBox = measureRichText("Hello bold link", 16, {
      runs: [{ start: 11, end: 15, fontSize: 28, fontWeight: 400 }],
    });
    expect(richBox.height).toBeGreaterThan(plain.height);
    expect(richBox.width).toBeGreaterThan(plain.width);
  });

  it("rejects a run that leaves the text", () => {
    const doc = rich();
    expect(() => applyOps(doc, [{ op: "update", id: "t", props: { runs: [{ start: 0, end: 99, fontWeight: 700 }] } }])).toThrow(
      /runs\.0\.end: run ends past the text/,
    );
  });

  it("rejects an empty style, overlap and a bad href", () => {
    const doc = rich();
    expect(() =>
      applyOps(doc, [{ op: "update", id: "t", props: { runs: [{ start: 2, end: 1, fontWeight: 700 }] } }]),
    ).toThrow(/run start must be before end/);
    expect(() => applyOps(doc, [{ op: "update", id: "t", props: { runs: [{ start: 0, end: 1 }] } }])).toThrow(/run has no style/);
    expect(() =>
      applyOps(doc, [
        {
          op: "update",
          id: "t",
          props: {
            runs: [
              { start: 0, end: 1, fontWeight: 700 },
              { start: 0, end: 2, color: "#111111" },
            ],
          },
        },
      ]),
    ).toThrow(/runs overlap or are out of order/);
    expect(() =>
      applyOps(doc, [{ op: "update", id: "t", props: { runs: [{ start: 0, end: 2, href: "javascript:alert(1)" }] } }]),
    ).toThrow(/href must be http\(s\), mailto, or a path starting with \/ or #/);
  });
});
