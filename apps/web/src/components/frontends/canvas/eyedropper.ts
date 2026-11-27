import { isScene, modeOf, resolveValue, type Document, type Node } from "@paprika/core";

/** The colour a node paints with: text its colour, a connector its line, a shape its fill, else its stroke; nothing for a page, a group or a picture. */
export function paintOf(doc: Document, node: Node): string | null {
  if (node.type === "page" || node.type === "group" || node.type === "image") return null;
  const mode = modeOf(doc, node);
  const color = (value: string | undefined) => {
    if (!value) return null;
    const resolved = String(resolveValue(doc, value, mode));
    return !resolved || resolved === "transparent" || resolved === "none" ? null : resolved;
  };
  if (node.type === "text") return color(node.color);
  if (node.type === "connector") return color(node.stroke.color);
  if ("fill" in node && typeof node.fill === "string") {
    const fill = color(node.fill);
    if (fill) return fill;
  }
  if ("stroke" in node && node.stroke && typeof node.stroke === "object" && "color" in node.stroke && typeof node.stroke.color === "string") return color(node.stroke.color);
  return null;
}

/** The scene nodes under a screen point, topmost first, inside `root`. */
export function layersUnderPoint(doc: Document, clientX: number, clientY: number, root: Element | null): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    const host = el.closest("[data-paprika-id]");
    if (!host) continue;
    if (root && !root.contains(host)) continue;
    const id = host.getAttribute("data-paprika-id");
    if (!id || seen.has(id) || !isScene(doc.nodes[id])) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** The colour of the first layer under the point that paints one (the old canvas' sampling). */
export function sampleCanvasColor(doc: Document, clientX: number, clientY: number, root: Element | null): string | null {
  for (const id of layersUnderPoint(doc, clientX, clientY, root)) {
    const node = doc.nodes[id];
    const color = node ? paintOf(doc, node) : null;
    if (color) return color;
  }
  return null;
}
