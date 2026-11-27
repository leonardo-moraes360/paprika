import { readPersisted, writePersisted } from "@/lib/persist";
import { readCaptureParams } from "./capture";
import type { EditorRenderer } from "./editor-store";

/** `paprika.renderer` in localStorage, the key of the old app (its `wasmLayer.ts`), so the canvas ported later inherits the choice. */
const key = "renderer";

export const hasWebGpu = () => typeof navigator !== "undefined" && "gpu" in navigator && Boolean((navigator as { gpu?: unknown }).gpu);

/**
 * `dom`, `cpu` and `gpu` are the three modes. `wasm` is the value the old app wrote (URL and saved choice) when there was a single WASM
 * mode that picked its backend by itself: it means `gpu` where the browser has WebGPU and `cpu` where it does not, and the server's
 * screenshot (`?renderer=wasm&capture=...`) always gets `cpu`, so a capture never depends on the machine's GPU. Only this legacy value
 * decides by itself; a person who picks `gpu` and has none is told (the canvas reports the failure).
 */
export function parseRenderer(value: string | null, gpu: boolean = hasWebGpu(), capture: boolean = false): EditorRenderer | null {
  if (value === "dom" || value === "cpu" || value === "gpu") return value;
  if (value === "wasm") return gpu && !capture ? "gpu" : "cpu";
  return null;
}

/** `?renderer=` wins, then the saved choice, then DOM. Never throws (private windows, blocked storage). */
export function readRendererPreference(): EditorRenderer {
  let capture = false;
  try {
    capture = readCaptureParams() !== null;
    const fromUrl = typeof window === "undefined" ? null : parseRenderer(new URLSearchParams(window.location.search).get("renderer"), hasWebGpu(), capture);
    if (fromUrl) return fromUrl;
  } catch {
    // fall through to the saved choice
  }
  return parseRenderer(readPersisted(key), hasWebGpu(), capture) ?? "dom";
}

export function writeRendererPreference(renderer: EditorRenderer) {
  writePersisted(key, renderer);
}
