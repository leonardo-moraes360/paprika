import { importHTML, importSVG, isSVGText, nearestFree, newId, PLACE_GAP, placedSiblings, type Document, type NodeInput, type Op, type SpotBox } from "@paprika/core";

/** Limits for pictures: 3.5 MB of file, 5 M characters of data URI, 480 px on the long side. */
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

/** `fallbackName` is the name of a picture that came without one, in the language of the interface (the caller translates it). */
export function imageNode(file: { name: string }, src: string, natural: { width: number; height: number }, fallbackName = "image"): NodeInput {
  const size = imageSize(natural.width, natural.height);
  const name = (file.name || fallbackName).replace(/\.[^.]+$/, "") || fallbackName;
  return { type: "image", id: newId(), name, x: 0, y: 0, ...size, src, fit: "contain", alt: file.name || "" } as NodeInput;
}

/** `byGroup[i]` is what the i-th input group made (empty for an empty group), so a caller can send some groups apart from the others. */
export type Placed = { ops: Op[]; ids: string[]; warnings: string[]; byGroup: { ops: Op[]; ids: string[] }[] };

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
  const byGroup: Placed["byGroup"] = [];
  const parent = parentId ? doc.nodes[parentId] : undefined;
  for (const group of groups) {
    const mine: Placed["byGroup"][number] = { ops: [], ids: [] };
    byGroup.push(mine);
    if (group.length === 0) continue;
    const boxes = group.map(box);
    // Plain loops: `Math.min(...array)` overflows the stack with tens of thousands of nodes (a big SVG).
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const b of boxes) {
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.w > maxX) maxX = b.x + b.w;
      if (b.y + b.h > maxY) maxY = b.y + b.h;
    }
    const size = { w: maxX - minX, h: maxY - minY };
    // Next to what is already there (to its right, on its top line), not to the left of the origin where `nearestFree` would otherwise go.
    let right = -Infinity;
    let top = Infinity;
    for (const b of occupied) {
      if (b.x + b.w > right) right = b.x + b.w;
      if (b.y < top) top = b.y;
    }
    const from = occupied.length > 0 ? { x: right + PLACE_GAP, y: top } : { x: 0, y: 0 };
    const spot = nearestFree(occupied, size, from);
    occupied.push({ x: spot.x, y: spot.y, w: size.w, h: size.h });
    group.forEach((node, index) => {
      const id = newId();
      const moved = { ...node, id, x: Math.round(spot.x + boxes[index]!.x - minX), y: Math.round(spot.y + boxes[index]!.y - minY) } as NodeInput;
      pin(parent, moved);
      const op = { op: "create", parentId, node: moved } as Op;
      ids.push(id);
      ops.push(op);
      mine.ids.push(id);
      mine.ops.push(op);
    });
  }
  return { ops, ids, warnings: [...warnings], byGroup };
}

/** What `parseMarkup` throws when nothing came out: the converter's notes (English, from `@paprika/core`), kept as a list so the screen can translate each one. */
export class MarkupError extends Error {
  readonly notes: readonly string[];
  constructor(notes: readonly string[]) {
    super(notes.join("; ") || "empty");
    this.name = "MarkupError";
    this.notes = notes;
  }
}

/** SVG or HTML text to nodes (the same converters as the MCP tools); throws a `MarkupError` (message `empty` without notes) when nothing came out. */
export function parseMarkup(kind: "svg" | "html", text: string): { nodes: NodeInput[]; warnings: string[] } {
  const result = kind === "svg" ? importSVG(text, { x: 0, y: 0 }) : importHTML(text, { x: 0, y: 0 });
  if (result.nodes.length === 0) throw new MarkupError(result.warnings);
  return result;
}

export type ConverterNoteKey =
  | "transformInvalid" | "opacityColor" | "gradients" | "invalidColor" | "invalidGeometry" | "textSkew" | "useNoHref" | "useExternal" | "useMissing" | "useCycle" | "usePercent"
  | "noSvgElement" | "markupTooLarge" | "markupTooMany" | "markupTooDeep" | "styleTag" | "clipMask" | "tagNotImported" | "svgEmpty" | "backgroundImage" | "fontSize" | "position" | "sizeUnsupported" | "cssClasses" | "imgSrc" | "htmlEmpty" | "other";

export type ConverterNote = { key: ConverterNoteKey; values: Record<string, string> };

/**
 * The notes `importSVG` and `importHTML` of `@paprika/core` write are English sentences. The ones the converters can make are
 * mapped to a key under `app.collab.import.notes.*` (with what the sentence quotes as values); anything else comes out as
 * `other`, with the converter's own text as the `detail`.
 */
const NOTES: readonly [RegExp, ConverterNoteKey, (match: RegExpMatchArray) => Record<string, string>][] = [
  [/^no <svg> element found$/, "noSvgElement", () => ({})],
  [/^markup too large \(max\. (\d+) characters\)$/, "markupTooLarge", (m) => ({ limit: m[1]! })],
  [/^markup with more than (\d+) elements$/, "markupTooMany", (m) => ({ limit: m[1]! })],
  [/^markup with more than (\d+) levels$/, "markupTooDeep", (m) => ({ limit: m[1]! })],
  [/^transform "(.*)" is invalid; skipped$/, "transformInvalid", (m) => ({ name: m[1]! })],
  [/^opacity of "(.*)" skipped \(unrecognized color\)$/, "opacityColor", (m) => ({ color: m[1]! })],
  [/^gradients and patterns \(url\(#…\)\) are not imported; using gray$/, "gradients", () => ({})],
  [/^invalid color "(.*)" skipped$/, "invalidColor", (m) => ({ color: m[1]! })],
  [/^<(.*)> with invalid geometry skipped: (.*)$/, "invalidGeometry", (m) => ({ tag: m[1]!, detail: m[2]! })],
  [/^<text> with rotation or skew stays upright; only the origin is transformed$/, "textSkew", () => ({})],
  [/^<use> without href skipped$/, "useNoHref", () => ({})],
  [/^external <use> \((.*)\) is not imported$/, "useExternal", (m) => ({ href: m[1]! })],
  [/^<use> target "#(.*)" was not found$/, "useMissing", (m) => ({ id: m[1]! })],
  [/^<use> cycle on "#(.*)" skipped$/, "useCycle", (m) => ({ id: m[1]! })],
  [/^<use> percentage width or height is not scaled$/, "usePercent", () => ({})],
  [/^CSS in <style> is not applied; use attributes or style="" on the elements$/, "styleTag", () => ({})],
  [/^clip-path\/mask on <(.*)> skipped$/, "clipMask", (m) => ({ tag: m[1]! })],
  [/^<(.*)> is not imported$/, "tagNotImported", (m) => ({ tag: m[1]! })],
  [/^the SVG has no shapes to import$/, "svgEmpty", () => ({})],
  [/^background images \(url\(\)\) are not imported$/, "backgroundImage", () => ({})],
  [/^font-size "(.*)" is not px; skipped$/, "fontSize", (m) => ({ value: m[1]! })],
  [/^position: (fixed|sticky) tratado como absolute$/, "position", (m) => ({ value: m[1]! })],
  [/^(width|height) "(.*)" is not supported; using hug$/, "sizeUnsupported", (m) => ({ axis: m[1]!, value: m[2]! })],
  [/^CSS classes are not applied; only inline styles \(style=""\)$/, "cssClasses", () => ({})],
  [/^<img> without an http\(s\) or data:image\/ src skipped$/, "imgSrc", () => ({})],
  [/^the HTML has no elements to import$/, "htmlEmpty", () => ({})],
];

export function converterNote(text: string): ConverterNote {
  for (const [pattern, key, values] of NOTES) {
    const match = text.match(pattern);
    if (match) return { key, values: values(match) };
  }
  return { key: "other", values: { detail: text } };
}

/** The most the server takes in one WebSocket message is 8 MiB (`maxBody` of `server/internal/server/http.go`, also the read limit of the socket): a batch stays well under it, for the message around the ops. */
export const IMPORT_BATCH_BYTES = 7_000_000;

/** Bytes the ops take on the wire (UTF-8 of their JSON). */
export function opsBytes(ops: readonly Op[]): number {
  return new TextEncoder().encode(JSON.stringify(ops)).length;
}

/**
 * Splits items (in order) into batches whose sizes add up to at most `limit`, never splitting an item. An item that is
 * over the limit by itself comes out alone, flagged `oversized`, for the caller to refuse instead of sending.
 */
export function batchBySize(sizes: readonly number[], limit: number = IMPORT_BATCH_BYTES): { indexes: number[]; oversized: boolean }[] {
  const batches: { indexes: number[]; oversized: boolean }[] = [];
  let current: { indexes: number[]; oversized: boolean; bytes: number } | null = null;
  sizes.forEach((size, index) => {
    if (size > limit) {
      batches.push({ indexes: [index], oversized: true });
      current = null;
      return;
    }
    if (!current || current.bytes + size > limit) {
      current = { indexes: [], oversized: false, bytes: 0 };
      batches.push(current);
    }
    current.indexes.push(index);
    current.bytes += size;
  });
  return batches.map(({ indexes, oversized }) => ({ indexes, oversized }));
}
