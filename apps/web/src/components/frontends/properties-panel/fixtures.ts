import { applyOps, createDocument, type Document, type Node, type Op } from "@paprika/core";

export function buildDocument(): Document {
  const base = createDocument("Studio", "doc1");
  const ops: Op[] = [
    { op: "set_tokens", tokens: { brand: "rgb(232, 85, 61)" }, type: "color" },
    { op: "set_tokens", tokens: { gap: 8 } },
    { op: "set_tokens", mode: "dark", tokens: { brand: "rgb(255, 122, 92)" } },
    { op: "create", node: { type: "page", id: "p1", name: "Cover" } },
    {
      op: "create",
      parentId: "p1",
      node: { type: "frame", id: "f1", name: "Home", x: 120, y: 140, width: 520, height: 340, fill: "rgb(26, 31, 49)", radius: 4, layout: { mode: "column", gap: 24, padding: 48 } },
    },
    { op: "create", parentId: "f1", node: { type: "text", id: "t1", name: "Title", text: "Hello", fontFamily: "Inter, sans-serif", fontSize: 30, fontWeight: 700, color: "$brand" } },
    { op: "create", parentId: "f1", node: { type: "rect", id: "r1", name: "Button", x: 10, y: 10, width: 100, height: 50, fill: "rgb(200, 64, 31)", radius: 6 } },
    { op: "create", parentId: "f1", node: { type: "ellipse", id: "e1", name: "Dot", x: 200, y: 10, width: 40, height: 40, fill: "rgb(255, 192, 42)" } },
    { op: "create", parentId: "p1", node: { type: "frame", id: "f2", name: "Free", x: 700, y: 140, width: 200, height: 120 } },
    { op: "create", parentId: "f2", node: { type: "rect", id: "r2", name: "Absolute", x: 10, y: 10, width: 40, height: 40 } },
    { op: "create", parentId: "f2", node: { type: "rect", id: "r3", name: "Second", x: 60, y: 10, width: 40, height: 40 } },
    { op: "create", parentId: "p1", node: { type: "frame", id: "c1", name: "Card", x: 0, y: 600, width: 200, height: 100, component: true, componentProps: [{ name: "label", type: "text", default: "Hi" }] } },
    { op: "create", parentId: "p1", node: { type: "frame", id: "i1", name: "Card copy", instanceOf: "c1", x: 240, y: 600 } },
    { op: "create", parentId: "p1", node: { type: "connector", id: "k1", name: "Link", from: { nodeId: "r1" }, to: { nodeId: "e1" } } },
  ];
  return applyOps(base, ops).doc;
}

export const nodeOf = (doc: Document, id: string): Node => doc.nodes[id] as Node;

export function withGroup(doc: Document): Document {
  const next = applyOps(doc, [{ op: "group", ids: ["r2", "r3"], id: "g1" }]).doc;
  return next;
}
