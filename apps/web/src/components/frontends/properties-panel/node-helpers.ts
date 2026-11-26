import { ignoresLayout, isInstance, type Document, type Node } from "@paprika/core";

export function isFlowChild(doc: Document, node: Node): boolean {
  const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
  return parent?.type === "frame" && !!parent.layout && parent.layout.mode !== "none" && node.type !== "page" && node.type !== "connector";
}

export function showsConstraints(doc: Document, node: Node): boolean {
  if (node.type === "page" || node.type === "connector") return false;
  const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
  if (!parent || parent.type !== "frame" || isInstance(parent)) return false;
  return !isFlowChild(doc, node) || ignoresLayout(node);
}

export type Constraints = { horizontal: "left" | "right" | "center" | "scale"; vertical: "top" | "bottom" | "center" | "scale" };

export function constraintsOf(node: Node): Constraints {
  if ("constraints" in node && node.constraints) return { horizontal: node.constraints.horizontal, vertical: node.constraints.vertical };
  return { horizontal: "left", vertical: "top" };
}
