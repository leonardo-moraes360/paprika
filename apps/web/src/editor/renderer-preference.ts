import { readPersisted, writePersisted } from "@/lib/persist";
import type { EditorRenderer } from "./editor-store";

/** `paprika.renderer` in localStorage, the key of the old app (its `wasmLayer.ts`), so the canvas ported later inherits the choice. */
const key = "renderer";

const isRenderer = (value: string | null): value is EditorRenderer => value === "dom" || value === "wasm";

/** As the old app: `?renderer=dom|wasm` wins, then the saved choice, then DOM. Never throws (private windows, blocked storage). */
export function readRendererPreference(): EditorRenderer {
  try {
    const fromUrl = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("renderer");
    if (isRenderer(fromUrl)) return fromUrl;
  } catch {
    // fall through to the saved choice
  }
  const saved = readPersisted(key);
  return isRenderer(saved) ? saved : "dom";
}

export function writeRendererPreference(renderer: EditorRenderer) {
  writePersisted(key, renderer);
}
