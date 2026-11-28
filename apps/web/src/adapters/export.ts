import { canvasBounds, exportReact, exportSVG, rootBounds, type Document } from "@paprika/core";
import type { ExportCodeFormat, ExportImageFormat, ExportSize } from "@/components/frontends/export-dialog";

export type ExportScope = "selection" | "page";

export const exportScales: readonly number[] = [1, 2, 3, 4];

/** PNG (`/api/screenshot`, the server draws it), SVG and React (both made here with `@paprika/core`). */
export const exportImageFormats: readonly ExportImageFormat[] = [
  { value: "png", label: "PNG" },
  { value: "svg", label: "SVG", vector: true },
];
export const exportCodeFormats: readonly ExportCodeFormat[] = [{ value: "react", label: "React", extension: ".tsx" }];

/** The page in view: the one of the editor state, or the first page of the document (`null` when the document has none). */
export function activePageId(doc: Document, pageId: string | null): string | null {
  if (pageId && doc.nodes[pageId]?.type === "page") return pageId;
  return doc.rootIds.find((id) => doc.nodes[id]?.type === "page") ?? null;
}

/** The node an export of the selection takes: the primary (last selected) one that is still in the document. */
export function selectedExportId(doc: Document, selection: readonly string[]): string | null {
  for (let i = selection.length - 1; i >= 0; i -= 1) {
    const id = selection[i]!;
    if (doc.nodes[id]) return id;
  }
  return null;
}

/** Root to ask the server for: the selected node, or the page (`null` = the whole canvas when the document has no pages). */
export function exportRootId(doc: Document, scope: string | null, selection: readonly string[], pageId: string | null): string | null {
  if (scope !== "page") {
    const selected = selectedExportId(doc, selection);
    if (selected) return selected;
  }
  return activePageId(doc, pageId);
}

export const hasExportSelection = (doc: Document, selection: readonly string[]) => selectedExportId(doc, selection) !== null;

export function exportSize(doc: Document, rootId: string | null, pageId: string | null): ExportSize {
  try {
    const bounds = rootId ? rootBounds(doc, rootId) : canvasBounds(doc, pageId ?? undefined);
    return { width: Math.max(1, Math.round(bounds.width)), height: Math.max(1, Math.round(bounds.height)) };
  } catch {
    return { width: 1, height: 1 };
  }
}

/** File name without extension: the node's name, else the document's. */
export function exportFileName(doc: Document, rootId: string | null): string {
  const name = (rootId ? doc.nodes[rootId]?.name : "") || doc.name || "paprika";
  return name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "paprika";
}

/** The frame the code export takes: the selected node, else the first frame of the page (`exportReact` refuses pages). */
export function codeRootId(doc: Document, selection: readonly string[], pageId: string | null): string | null {
  const selected = selectedExportId(doc, selection);
  if (selected && doc.nodes[selected]?.type !== "page") return selected;
  const page = activePageId(doc, pageId);
  const roots = page ? (doc.nodes[page] as { children?: string[] } | undefined)?.children ?? [] : doc.rootIds;
  return roots.find((id) => doc.nodes[id]?.type === "frame") ?? null;
}

export function exportCode(doc: Document, rootId: string, tokens: boolean): string {
  return exportReact(doc, rootId, { cssVariables: tokens });
}

/** The SVG of a node or page, made here with the same `exportSVG` the server runs for `/api/svg` (so the workspace the server has open is not touched). */
export function exportSvgText(doc: Document, rootId: string | null): string {
  return exportSVG(doc, rootId ? { rootId } : {}).svg;
}
