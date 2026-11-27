import type { Corner } from "../transform";
import type { CanvasRuntime, NodeBox } from "../types";

const CORNERS = new Set<string>(["nw", "ne", "sw", "se"]);

/** The corner of the resize handle a press landed on (`data-handle` on the handles of `ui/selection-handles`), or `null`. */
export function cornerOf(target: EventTarget | null): Corner | null {
  const value = target instanceof Element ? target.closest("[data-handle]")?.getAttribute("data-handle") : null;
  return value && CORNERS.has(value) ? (value as Corner) : null;
}

export const isRotateHandle = (target: EventTarget | null) => target instanceof Element && target.closest("[data-rotate-handle]") !== null;

/** Calls `onChange` with the modifier keys whenever one goes down or up, so a held key applies without the pointer moving. Returns what removes it. */
export function watchModifiers(onChange: (keys: { shift: boolean; alt: boolean }) => void): () => void {
  const handler = (e: KeyboardEvent) => onChange({ shift: e.shiftKey || e.getModifierState("Shift"), alt: e.altKey || e.getModifierState("Alt") });
  window.addEventListener("keydown", handler);
  window.addEventListener("keyup", handler);
  return () => {
    window.removeEventListener("keydown", handler);
    window.removeEventListener("keyup", handler);
  };
}

/** The box a node is shown at right now: the gesture in progress (or a commit waiting for its echo) over the document. */
export function shownBox(rt: CanvasRuntime, id: string): { x: number; y: number; width: number; height: number; rotation: number } | null {
  const node = rt.doc().nodes[id];
  if (!node || node.type === "page") return null;
  const patch = rt.store.state.preview[id];
  const own = node as unknown as { x: number; y: number; width?: number | string; height?: number | string; rotation?: number };
  const measured: NodeBox | null = typeof own.width === "number" && typeof own.height === "number" ? null : rt.measure(id);
  return {
    x: patch?.x ?? own.x,
    y: patch?.y ?? own.y,
    width: patch?.width ?? (typeof own.width === "number" ? own.width : (measured?.width ?? 1)),
    height: patch?.height ?? (typeof own.height === "number" ? own.height : (measured?.height ?? 1)),
    rotation: patch?.rotation ?? own.rotation ?? 0,
  };
}

/** The top-left corner (world) of the space a node of `parentId` is placed in. */
export function originOf(rt: CanvasRuntime, parentId: string | null | undefined): { x: number; y: number } {
  const parent = parentId ? rt.doc().nodes[parentId] : undefined;
  if (!parent || parent.type === "page") return { x: 0, y: 0 };
  const box = rt.measure(parent.id);
  return { x: box?.x ?? 0, y: box?.y ?? 0 };
}
