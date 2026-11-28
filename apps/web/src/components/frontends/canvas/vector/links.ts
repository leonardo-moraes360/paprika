import type { ConnectorEnd } from "@paprika/core";
import type { CanvasRuntime, Pt } from "../types";

/** The node under a screen point an arrow may attach to: any node but a connector or a page. `exclude` is skipped (the arrow being edited). */
export function attachableAt(rt: CanvasRuntime, clientX: number, clientY: number, exclude?: string): string | null {
  const viewport = rt.viewport();
  const doc = rt.doc();
  const hits = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(clientX, clientY) : [];
  for (const el of hits) {
    const host = el.closest<HTMLElement | SVGElement>("[data-paprika-id]");
    if (!host || !viewport?.contains(host)) continue;
    const node = doc.nodes[host.dataset.paprikaId ?? ""];
    if (node && node.type !== "connector" && node.type !== "page" && node.id !== exclude) return node.id;
  }
  return null;
}

/** An end of an arrow at a screen point: the node under it, else the point itself (rounded, relative to `origin` — the corner of the arrow's parent). */
export function endAt(rt: CanvasRuntime, clientX: number, clientY: number, origin: Pt = { x: 0, y: 0 }, exclude?: string): ConnectorEnd {
  const id = attachableAt(rt, clientX, clientY, exclude);
  if (id) return { nodeId: id };
  const p = rt.toWorld(clientX, clientY);
  return { x: Math.round(p.x - origin.x), y: Math.round(p.y - origin.y) };
}
