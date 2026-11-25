import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { displayList, type Box, type Document } from "@paprika/core";

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

export function measureBoxes(world: HTMLElement): Map<string, Box> {
  const boxes = new Map<string, Box>();
  const origin = new Map<Element, { x: number; y: number }>([[world, { x: 0, y: 0 }]]);
  const pos = (el: HTMLElement): { x: number; y: number } | null => {
    const hit = origin.get(el);
    if (hit) return hit;
    const parent = el.offsetParent as HTMLElement | null;
    if (!parent) return null;
    const p = pos(parent);
    if (!p) return null;
    const v = { x: p.x + el.offsetLeft, y: p.y + el.offsetTop };
    origin.set(el, v);
    return v;
  };
  // Paths use their exact inline style whoever paints them: offset geometry rounds, and the box decides the painter.
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
  layoutKey: unknown;
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

  const drawNow = useCallback(() => {
    cancelAnimationFrame(frame.current);
    const r = rendererRef.current;
    if (!r) return false;
    const v = viewRef.current;
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
  }, []);

  const draw = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(drawNow);
  }, [drawNow]);

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

  return { canvasRef, status, active: mode === "wasm" && shown && status.backend !== "error", painted, retain, creates };
}
