import { importHTML, importSVG, isSVGText, nearestFree, newId, PLACE_GAP, placedSiblings, type Document, type NodeInput, type Op, type SpotBox } from "@paprika/core";

/** Limits of the old canvas for pictures (`web-legacy/src/Canvas.tsx`): 3.5 MB of file, 5 M characters of data URI, 480 px on the long side. */
export const IMAGE_BYTES = 3_500_000;
export const IMAGE_DATA_URI_CHARS = 5_000_000;
export const IMAGE_LONG_SIDE = 480;

const rasterName = /\.(png|jpe?g|webp|avif|gif)$/i;
const rasterType = /^image\/(png|jpe?g|webp|avif|gif)$/i;

export type FileKind = "raster" | "svg" | "html" | "paprika" | "unsupported";

export type ImportRefusal = { code: "fig" | "pdf" | "paprika"; name: string };

/** What a dropped file is. `.paprika.json` is told apart because it is a whole document, not something to place on a page. */
export function fileKind(name: string, type: string, text?: string): FileKind {
  if (/\.paprika\.json$/i.test(name)) return "paprika";
  if (rasterType.test(type) || rasterName.test(name)) return "raster";
  if (type === "image/svg+xml" || /\.svg$/i.test(name) || (text !== undefined && isSVGText(text.trim()))) return "svg";
  if (type === "text/html" || /\.html?$/i.test(name)) return "html";
  return "unsupported";
}

/** The refusal the old canvas gives for a name (`.fig`, `.pdf`), before looking at the content. */
export function refusalFor(name: string): ImportRefusal | null {
  if (/\.fig$/i.test(name)) return { code: "fig", name };
  if (/\.pdf$/i.test(name)) return { code: "pdf", name };
  if (/\.paprika\.json$/i.test(name)) return { code: "paprika", name };
  return null;
}

/** Scales a picture to at most `IMAGE_LONG_SIDE` on its long side, never up. */
export function imageSize(naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  const scale = Math.min(1, IMAGE_LONG_SIDE / Math.max(naturalWidth, naturalHeight, 1));
  return { width: Math.max(1, Math.round(naturalWidth * scale)), height: Math.max(1, Math.round(naturalHeight * scale)) };
}

export function imageNode(file: { name: string }, src: string, natural: { width: number; height: number }): NodeInput {
  const size = imageSize(natural.width, natural.height);
  const name = (file.name || "image").replace(/\.[^.]+$/, "") || "image";
  return { type: "image", id: newId(), name, x: 0, y: 0, ...size, src, fit: "contain", alt: file.name || "" } as NodeInput;
}

export type Placed = { ops: Op[]; ids: string[]; warnings: string[] };

const box = (node: NodeInput): SpotBox => ({
  x: typeof node.x === "number" ? node.x : 0,
  y: typeof node.y === "number" ? node.y : 0,
  w: typeof node.width === "number" ? node.width : 1,
  h: typeof node.height === "number" ? node.height : 1,
});

/** Nodes in flow layouts are pinned (absolute), as the old canvas does when it drops into an auto layout frame. */
const pin = (parent: Document["nodes"][string] | undefined, node: NodeInput) => {
  const layout = parent && parent.type === "frame" ? parent.layout : undefined;
  if (layout && layout.mode !== "none") node.layoutPositioning = "absolute";
};

/**
 * Turns what a file produced into `create` ops in `parentId` (the page in view, or the canvas), each group at the free
 * spot next to the content (the origin of an empty page), clear of what is there and of the groups placed before it. Every top-level node gets a fresh id.
 */
export function placeNodes(doc: Document, parentId: string | null, groups: readonly (readonly NodeInput[])[], warnings: readonly string[] = []): Placed {
  const occupied: SpotBox[] = placedSiblings(doc, parentId).map((sibling) => sibling.box);
  const ops: Op[] = [];
  const ids: string[] = [];
  const parent = parentId ? doc.nodes[parentId] : undefined;
  for (const group of groups) {
    if (group.length === 0) continue;
    const boxes = group.map(box);
    const minX = Math.min(...boxes.map((b) => b.x));
    const minY = Math.min(...boxes.map((b) => b.y));
    const size = { w: Math.max(...boxes.map((b) => b.x + b.w)) - minX, h: Math.max(...boxes.map((b) => b.y + b.h)) - minY };
    // Next to what is already there (to its right, on its top line), not to the left of the origin where `nearestFree` would otherwise go.
    const from = occupied.length > 0 ? { x: Math.max(...occupied.map((b) => b.x + b.w)) + PLACE_GAP, y: Math.min(...occupied.map((b) => b.y)) } : { x: 0, y: 0 };
    const spot = nearestFree(occupied, size, from);
    occupied.push({ x: spot.x, y: spot.y, w: size.w, h: size.h });
    group.forEach((node, index) => {
      const id = newId();
      const moved = { ...node, id, x: Math.round(spot.x + boxes[index]!.x - minX), y: Math.round(spot.y + boxes[index]!.y - minY) } as NodeInput;
      pin(parent, moved);
      ids.push(id);
      ops.push({ op: "create", parentId, node: moved } as Op);
    });
  }
  return { ops, ids, warnings: [...warnings] };
}

/** SVG or HTML text to nodes (the same converters as the MCP tools); throws the converter's message, or `empty` when nothing came out. */
export function parseMarkup(kind: "svg" | "html", text: string): { nodes: NodeInput[]; warnings: string[] } {
  const result = kind === "svg" ? importSVG(text, { x: 0, y: 0 }) : importHTML(text, { x: 0, y: 0 });
  if (result.nodes.length === 0) throw new Error(result.warnings.join("; ") || "empty");
  return result;
}
