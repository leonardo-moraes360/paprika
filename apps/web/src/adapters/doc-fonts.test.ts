import type { Node } from "@paprika/core";
import { describe, expect, it } from "vitest";
import { makeDocument } from "@/test/live-harness";
import { documentFonts } from "./doc-fonts";

const withFonts = (fonts: Record<string, string>) => {
  const doc = makeDocument(20);
  for (const [id, fontFamily] of Object.entries(fonts)) doc.nodes[id] = { ...(doc.nodes[id] as Node), fontFamily } as unknown as Node;
  return doc;
};

describe("documentFonts", () => {
  it("is empty without a document or without fonts", () => {
    expect(documentFonts(null)).toEqual([]);
    expect(documentFonts(makeDocument(10))).toEqual([]);
  });

  it("lists the distinct trimmed families, sorted", () => {
    expect(documentFonts(withFonts({ n2: "Inter", n3: "  Georgia ", n4: "Inter", n5: "  " }))).toEqual(["Georgia", "Inter"]);
  });

  it("keeps the same list while a delta changes nothing about the fonts, and follows one that does", () => {
    const doc = withFonts({ n2: "Inter" });
    const first = documentFonts(doc);
    const touch = (from: typeof doc, id: string, props: Record<string, unknown>) => ({ ...from, nodes: { ...from.nodes, [id]: { ...from.nodes[id], ...props } as Node } });
    const moved = touch(doc, "n5", { x: 5 });
    expect(documentFonts(moved)).toBe(first);
    const changed = touch(moved, "n6", { fontFamily: "Mono" });
    expect(documentFonts(changed)).toEqual(["Inter", "Mono"]);
  });
});
