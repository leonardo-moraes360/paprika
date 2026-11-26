import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { displayList, type Box, type Document } from "@paprika/core";
import type { ViewStore } from "./viewStore";

export type RendererMode = "dom" | "wasm";

export interface WasmStatus {
  backend: "loading" | "webgpu" | "cpu" | "unavailable" | "error";
  detail: string;
}

interface WasmRenderer {
  readonly backend: string;
  readonly adapterInfo: string;
  readonly fallbackReason: string;
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
  }
  for (const fn of rendererListeners) fn(mode);
}

const LAYOUT_UNIT = 64;
const snap = (v: number) => Math.round(v * LAYOUT_UNIT) / LAYOUT_UNIT;

function pixels(value: string, fallback: number): number {
  return value.endsWith("px") ? Number.parseFloat(value) : fallback;
}

export function measureBoxes(world: HTMLElement): Map<string, Box> {
  const boxes = new Map<string, Box>();
  const wr = world.getBoundingClientRect();
  const scale = new DOMMatrixReadOnly(getComputedStyle(world).transform).a;
  const k = scale > 0 ? 1 / scale : 1;
  const turned = new Map<Element, boolean>([[world, false]]);
  const isTurned = (el: Element | null): boolean => {
    if (!el) return false;
    const hit = turned.get(el);
    if (hit !== undefined) return hit;
    const t = (el as HTMLElement).style?.transform;
    const v = (!!t && t !== "none") || isTurned(el.parentElement);
    turned.set(el, v);
    return v;
  };
  const layout = new Map<Element, Box | null>([[world, { x: 0, y: 0, w: 0, h: 0 }]]);
  // A turned element has an AABB rect, so its layout box comes from its centre and its own size; its descendants chain through offsets.
  const place = (el: HTMLElement): Box | null => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0 && el.offsetParent === null) return null;
    if (!isTurned(el)) return { x: snap((r.left - wr.left) * k), y: snap((r.top - wr.top) * k), w: snap(r.width * k), h: snap(r.height * k) };
    const w = pixels(el.style.width, el.offsetWidth);
    const h = pixels(el.style.height, el.offsetHeight);
    if (!isTurned(el.parentElement)) {
      return { x: snap(((r.left + r.right) / 2 - wr.left) * k - w / 2), y: snap(((r.top + r.bottom) / 2 - wr.top) * k - h / 2), w, h };
    }
    const parent = el.offsetParent as HTMLElement | null;
    const p = parent && box(parent);
    if (!parent || !p) return null;
    return { x: p.x + parent.clientLeft + el.offsetLeft, y: p.y + parent.clientTop + el.offsetTop, w, h };
  };
  const box = (el: HTMLElement): Box | null => {
    const hit = layout.get(el);
    if (hit !== undefined) return hit;
    const v = place(el);
    layout.set(el, v);
    return v;
  };
  // Paths use their exact inline style whoever paints them: the box decides the painter and must not flip-flop.
  for (const el of world.querySelectorAll<Element>("[data-paprika-id]")) {
    const isPath = (el as HTMLElement | SVGElement).dataset.paprikaType === "path";
    if (el instanceof HTMLElement && !isPath) {
      const b = box(el);
      if (b) boxes.set(el.dataset.paprikaId!, b);
      continue;
    }
    if ((el instanceof SVGElement || el instanceof HTMLElement) && el.parentElement instanceof HTMLElement) {
      const parent = el.parentElement;
      const p = box(parent);
      const left = Number.parseFloat(el.style.left);
      const top = Number.parseFloat(el.style.top);
      const w = Number.parseFloat(el.style.width);
      const h = Number.parseFloat(el.style.height);
      if (!p || [left, top, w, h].some((n) => Number.isNaN(n))) continue;
      boxes.set(el.dataset.paprikaId!, { x: p.x + parent.clientLeft + left, y: p.y + parent.clientTop + top, w, h });
    }
  }
  return boxes;
}

type WorldHook = HTMLElement & {
  __paprikaBoxes?: ReadonlyMap<string, Box>;
  __paprikaMeasureMs?: number;
  __paprikaMeasure?: () => Map<string, Box>;
};

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

interface Options {
  mode: RendererMode;
  doc: Document;
  viewStore: ViewStore;
  viewportRef: RefObject<HTMLDivElement | null>;
  worldRef: RefObject<HTMLDivElement | null>;
  layoutKey: unknown;
  pageId: string | null;
}

export function useWasmLayer({ mode, doc, viewStore, viewportRef, worldRef, layoutKey, pageId }: Options) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WasmRenderer | null>(null);
  const [status, setStatus] = useState<WasmStatus>({ backend: wasmAvailable ? "loading" : "unavailable", detail: "" });
  const [ready, setReady] = useState(false);
  const [shown, setShown] = useState(false);
  const [painted, setPainted] = useState<ReadonlySet<string>>(() => new Set());
  const [creates, setCreates] = useState(0);
  const [retain, setRetain] = useState(mode === "wasm");
  if (mode === "wasm" && !retain) setRetain(true);
  const booting = useRef(false);
  const unmounted = useRef(false);

  const drawNow = useCallback(() => {
    const r = rendererRef.current;
    if (!r) return false;
    const v = viewStore.get();
    const dpr = window.devicePixelRatio || 1;
    try {
      r.render(v.x * dpr, v.y * dpr, v.zoom * dpr);
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
  }, [viewStore]);

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
      r.resize(w, h);
      drawNow();
    });
    ro.observe(vp);
    return () => ro.disconnect();
  }, [ready, viewportRef, drawNow]);

  useLayoutEffect(() => {
    if (mode !== "wasm") {
      setShown((prev) => (prev ? false : prev));
      return;
    }
    const r = rendererRef.current;
    const world = worldRef.current;
    if (!ready || !r || !world) return;
    const t0 = performance.now();
    const boxes = measureBoxes(world);
    const hook = world as WorldHook;
    hook.__paprikaBoxes = boxes;
    hook.__paprikaMeasureMs = performance.now() - t0;
    hook.__paprikaMeasure = () => measureBoxes(world);
    const list = displayList(doc, boxes, pageId ?? undefined);
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
    if (!ready || mode !== "wasm") return;
    return viewStore.onFrame(() => {
      drawNow();
    });
  }, [ready, mode, viewStore, drawNow]);

  useEffect(
    () => () => {
      unmounted.current = true;
        rendererRef.current?.free();
      rendererRef.current = null;
    },
    [],
  );

  return { canvasRef, status, active: mode === "wasm" && shown && status.backend !== "error", painted, retain, creates };
}
