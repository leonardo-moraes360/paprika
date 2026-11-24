import { modeOf, resolveValue, type Document, type Node } from "@paprika/core";
import { layersUnderPoint } from "./hierarchy";

type Handler = (color: string) => void;

interface EyeDropperWindow {
  EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
}

let handler: Handler | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listen of listeners) listen();
}

export function eyeDropperAvailable(): boolean {
  return typeof window !== "undefined" && typeof (window as EyeDropperWindow).EyeDropper === "function";
}

export async function openEyeDropper(): Promise<string | null> {
  const Ctor = (window as EyeDropperWindow).EyeDropper;
  if (!Ctor) return null;
  try {
    const { sRGBHex } = await new Ctor().open();
    return sRGBHex || null;
  } catch {
    return null;
  }
}

export function eyedropperListening(): boolean {
  return handler !== null;
}

export function subscribeEyedropper(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function beginCanvasSample(onColor: Handler): () => void {
  handler = onColor;
  emit();
  return () => {
    if (handler !== onColor) return;
    handler = null;
    emit();
  };
}

export function finishCanvasSample(color: string | null) {
  if (!handler || !color) return;
  const done = handler;
  handler = null;
  emit();
  done(color);
}

function paintOf(doc: Document, n: Node): string | null {
  if (n.type === "page" || n.type === "group" || n.type === "image") return null;
  const mode = modeOf(doc, n);
  const color = (v: string | undefined) => {
    if (!v) return null;
    const c = String(resolveValue(doc, v, mode));
    if (!c || c === "transparent" || c === "none") return null;
    return c;
  };
  if (n.type === "text") return color(n.color);
  if (n.type === "connector") return color(n.stroke.color);
  if ("fill" in n && typeof n.fill === "string") {
    const fill = color(n.fill);
    if (fill) return fill;
  }
  if ("stroke" in n && n.stroke && typeof n.stroke === "object" && "color" in n.stroke && typeof n.stroke.color === "string") {
    return color(n.stroke.color);
  }
  return null;
}

export function sampleCanvasColor(doc: Document, clientX: number, clientY: number, root: Element | null): string | null {
  for (const id of layersUnderPoint(doc, clientX, clientY, root)) {
    const n = doc.nodes[id];
    if (!n) continue;
    const color = paintOf(doc, n);
    if (color) return color;
  }
  return null;
}
