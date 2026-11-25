import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { displayList, type Box, type Document } from "@paprika/core";

/**
 * WASM canvas layer (ADR 0002): shapes and paths are drawn by `crates/render` (vello on
 * WebGPU, vello_cpu when there is no hardware GPU) on a <canvas> under the DOM. The DOM keeps
 * layout, text, images, hit testing and selection; nodes drawn here lose their DOM paint.
 */
export type RendererMode = "dom" | "wasm";

export interface WasmStatus {
  /** `webgpu` or `cpu` once ready; `loading` while the module and the GPU start. */
  backend: "loading" | "webgpu" | "cpu" | "unavailable" | "error";
  detail: string;
}

interface WasmRenderer {
  readonly backend: string;
  readonly adapterInfo: string;
  readonly fallbackReason: string;
  /** First asynchronous GPU failure (device lost, validation error); empty when healthy. */
  readonly deviceError: string;
  finish(): Promise<void>;
  setBackground(r: number, g: number, b: number, a: number): void;
  setScene(data: Float32Array, paths: string): void;
  resize(width: number, height: number): void;
  render(tx: number, ty: number, zoom: number): void;
  free(): void;
}
interface WasmModule {
  default(): Promise<unknown>;
  createRenderer(canvas: HTMLCanvasElement, mode: string): Promise<WasmRenderer>;
}

// Built by `crates/render/build.mjs` into ./wasm (gitignored). The glob is empty when the Rust
// toolchain was missing at build time: the layer then reports "unavailable" and the DOM paints.
const loaders = import.meta.glob<WasmModule>("./wasm/paprika_render.js");
const loadModule = Object.values(loaders)[0];
export const wasmAvailable = !!loadModule;

let modulePromise: Promise<WasmModule> | null = null;

function loadWasm(): Promise<WasmModule> {
  if (!loadModule) return Promise.reject(new Error("WASM renderer not built"));
  if (!modulePromise) {
    const pending = loadModule().then(async (mod) => {
      await mod.default();
      return mod;
    });
    modulePromise = pending;
    void pending.catch(() => {
      if (modulePromise === pending) modulePromise = null;
    });
  }
  return modulePromise;
}

const STORAGE_KEY = "paprika.renderer";

/** `?renderer=wasm|dom` wins over the saved choice; the default is the DOM. */
export function initialRendererMode(): RendererMode {
  const q = new URLSearchParams(location.search).get("renderer");
  if (q === "wasm" || q === "dom") return q;
  try {
    return localStorage.getItem(STORAGE_KEY) === "wasm" ? "wasm" : "dom";
  } catch {
    return "dom";
  }
}

const rendererListeners = new Set<(mode: RendererMode) => void>();

export function onRendererMode(fn: (mode: RendererMode) => void): () => void {
  rendererListeners.add(fn);
  return () => rendererListeners.delete(fn);
}

export function saveRendererMode(mode: RendererMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
  for (const fn of rendererListeners) fn(mode);
}

/** Canvas-space boxes (before rotation) of every rendered node, read from the DOM layout. */
export function measureBoxes(world: HTMLElement): Map<string, Box> {
  const boxes = new Map<string, Box>();
  const origin = new Map<Element, { x: number; y: number }>([[world, { x: 0, y: 0 }]]);
  const pos = (el: HTMLElement): { x: number; y: number } | null => {
    const hit = origin.get(el);
    if (hit) return hit;
    const parent = el.offsetParent as HTMLElement | null;
    if (!parent) return null; // display: none
    const p = pos(parent);
    if (!p) return null;
    const v = { x: p.x + el.offsetLeft, y: p.y + el.offsetTop };
    origin.set(el, v);
    return v;
  };
  // Paths are measured from their inline style (exact, fractional), never from offset geometry. An
  // <svg> has no offset geometry, and a path the WASM layer paints is a <div> instead (RenderNode)
  // whose offsetLeft/offsetWidth round to whole pixels. Measuring the two differently made the box,
  // and the overlap test that decides who paints it, depend on that very decision: the path flipped
  // between the layers on every commit (PAP-A-035).
  for (const el of world.querySelectorAll<Element>("[data-paprika-id]")) {
    const isPath = (el as HTMLElement | SVGElement).dataset.paprikaType === "path";
    if (el instanceof HTMLElement && !isPath) {
      const p = pos(el);
      if (p) boxes.set(el.dataset.paprikaId!, { x: p.x, y: p.y, w: el.offsetWidth, h: el.offsetHeight });
      continue;
    }
    if ((el instanceof SVGElement || el instanceof HTMLElement) && el.parentElement instanceof HTMLElement) {
      const p = pos(el.parentElement);
      const left = Number.parseFloat(el.style.left);
      const top = Number.parseFloat(el.style.top);
      const w = Number.parseFloat(el.style.width);
      const h = Number.parseFloat(el.style.height);
      if (!p || [left, top, w, h].some((n) => Number.isNaN(n))) continue;
      boxes.set(el.dataset.paprikaId!, { x: p.x + left, y: p.y + top, w, h });
    }
  }
  return boxes;
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

interface Options {
  mode: RendererMode;
  doc: Document;
  view: { x: number; y: number; zoom: number };
  viewportRef: RefObject<HTMLDivElement | null>;
  worldRef: RefObject<HTMLDivElement | null>;
  /** Changes whenever the DOM layout may have moved (drag/resize preview). */
  layoutKey: unknown;
  /** Page shown on the canvas (null: the document has no pages). */
  pageId: string | null;
}

export function useWasmLayer({ mode, doc, view, viewportRef, worldRef, layoutKey, pageId }: Options) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WasmRenderer | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const [status, setStatus] = useState<WasmStatus>({ backend: wasmAvailable ? "loading" : "unavailable", detail: "" });
  const [ready, setReady] = useState(false);
  const [shown, setShown] = useState(false);
  const [painted, setPainted] = useState<ReadonlySet<string>>(() => new Set());
  const [creates, setCreates] = useState(0);
  const [retain, setRetain] = useState(mode === "wasm");
  if (mode === "wasm" && !retain) setRetain(true);
  const frame = useRef(0);
  const booting = useRef(false);
  const unmounted = useRef(false);

  /** Renders the current scene right away (same task, so before the next paint). */
  const drawNow = useCallback(() => {
    cancelAnimationFrame(frame.current);
    const r = rendererRef.current;
    if (!r) return false;
    const v = viewRef.current;
    const dpr = window.devicePixelRatio || 1;
    try {
      r.render(v.x * dpr, v.y * dpr, v.zoom * dpr);
      // WebGPU reports device loss and validation errors after `render` returned. Without this
      // check the DOM would stay unpainted over a canvas that never received the frame.
      if (r.backend === "webgpu") {
        void r.finish().then(() => {
          if (rendererRef.current !== r || !r.deviceError) return;
          setShown(false);
          setStatus({ backend: "error", detail: r.deviceError });
        });
      }
      return true;
    } catch (e) {
      setShown(false);
      setStatus({ backend: "error", detail: String(e) });
      return false;
    }
  }, []);

  /** Coalesces several changes in one frame into a single render on the next animation frame. */
  const draw = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(drawNow);
  }, [drawNow]);

  // One renderer per mount. Toggling back to the DOM hides the canvas and keeps the device.
  useEffect(() => {
    if (mode !== "wasm") return;
    if (!loadModule) {
      setStatus({ backend: "unavailable", detail: "WASM renderer not built (run pnpm build with Rust installed)" });
      return;
    }
    if (rendererRef.current) {
      setReady(true);
      return;
    }
    if (booting.current) return;
    const canvas = canvasRef.current;
    const vp = viewportRef.current;
    if (!canvas || !vp) {
      setStatus({ backend: "error", detail: "canvas missing" });
      return;
    }
    booting.current = true;
    setStatus({ backend: "loading", detail: "" });
    const dpr = window.devicePixelRatio || 1;
    const rect = vp.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    loadWasm()
      .then((mod) => mod.createRenderer(canvas, "auto"))
      .then((r) => {
        if (unmounted.current) {
          r.free();
          return;
        }
        r.setBackground(0, 0, 0, 0);
        rendererRef.current = r;
        booting.current = false;
        setCreates((n) => n + 1);
        setStatus({
          backend: r.backend === "webgpu" ? "webgpu" : "cpu",
          detail: r.adapterInfo + (r.fallbackReason ? ` · ${r.fallbackReason}` : ""),
        });
        setReady(true);
      })
      .catch((e: unknown) => {
        booting.current = false;
        if (!unmounted.current) setStatus({ backend: "error", detail: String(e instanceof Error ? e.message : e) });
      });
  }, [mode, viewportRef]);

  // Keep the backing store at device resolution. Setting canvas.width/height clears the bitmap,
  // and ResizeObserver callbacks run after this frame's animation callbacks but before its paint:
  // deferring the render to the next rAF would paint a blank layer for one frame on every resize
  // step (dragging a side panel resizes the viewport on every pointermove), so render right here.
  useEffect(() => {
    if (!ready) return;
    const vp = viewportRef.current!;
    const ro = new ResizeObserver(() => {
      const r = rendererRef.current;
      const canvas = canvasRef.current;
      if (!r || !canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = vp.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (w === canvas.width && h === canvas.height) return;
      canvas.width = w;
      canvas.height = h;
      r.resize(w, h); // reconfigures the WebGPU surface or the CPU pixmap
      drawNow();
    });
    ro.observe(vp);
    return () => ro.disconnect();
  }, [ready, viewportRef, drawNow]);

  // Rebuild the display list after React commits the DOM (layout is final here).
  useLayoutEffect(() => {
    if (mode !== "wasm") {
      setShown((prev) => (prev ? false : prev));
      return;
    }
    const r = rendererRef.current;
    const world = worldRef.current;
    if (!ready || !r || !world) return;
    const list = displayList(doc, measureBoxes(world), pageId ?? undefined);
    r.setScene(list.data, list.paths);
    setPainted((prev) => (sameIds(prev, list.painted) ? prev : list.painted));
    if (!drawNow()) return;
    setShown(true);
    setStatus((prev) => {
      if (prev.backend !== "error" && prev.backend !== "loading") return prev;
      return {
        backend: r.backend === "webgpu" ? "webgpu" : "cpu",
        detail: r.adapterInfo + (r.fallbackReason ? ` · ${r.fallbackReason}` : ""),
      };
    });
  }, [mode, ready, doc, layoutKey, worldRef, drawNow, pageId, painted]);

  useEffect(() => {
    if (ready && mode === "wasm") draw();
  }, [ready, mode, view, draw]);

  useEffect(
    () => () => {
      unmounted.current = true;
      cancelAnimationFrame(frame.current);
      rendererRef.current?.free();
      rendererRef.current = null;
    },
    [],
  );

  /** The DOM stops painting shapes only once a render has succeeded, and takes them back on any error. */
  return { canvasRef, status, active: mode === "wasm" && shown && status.backend !== "error", painted, retain, creates };
}
