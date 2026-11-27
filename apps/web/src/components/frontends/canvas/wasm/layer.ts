import { displayList, type Box } from "@paprika/core";
import { patchedDocument } from "../preview-node";
import { NO_PAINTED } from "../region";
import type { CanvasRuntime } from "../runtime";
import { measureBoxes } from "./measure";
import type { CanvasRendererStatus, WasmLoader, WasmMode, WasmRenderer } from "./types";

export type WasmLayerOptions = {
  rt: CanvasRuntime;
  /** The renderer module's loader, read at the time of each boot; `null` when this build has none. */
  loader: () => WasmLoader | null | undefined;
  /** The status changed (loading, the backend, an error). Called only when it differs from the last one. */
  onStatus: (status: CanvasRendererStatus) => void;
  /** The renderer failed and the DOM paints again. Called once per failure, with the mode that failed. */
  onError: (message: string, mode: WasmMode) => void;
};

export type WasmLayer = {
  /**
   * The owner's choice: `null` for the DOM, `cpu` or `gpu` for WASM. Turning it on boots the renderer once and keeps it alive when it goes
   * off again; going from one backend to the other frees it and boots the other on the new `<canvas>` (a canvas keeps its first context type).
   */
  setRequested: (mode: WasmMode | null) => void;
  /** The `<canvas>` the layer draws on (a ref callback). It stays mounted after the first use so the device is not made again. */
  setCanvas: (canvas: HTMLCanvasElement | null) => void;
  /** The canvas is on screen (an effect); `stop` frees the renderer. Safe to run twice (StrictMode). */
  start: () => void;
  stop: () => void;
  status: () => CanvasRendererStatus;
  /** Measures the boxes and draws the scene now (what a frame does, without waiting for it). */
  refresh: () => void;
};

type WorldHook = HTMLElement & { __paprikaBoxes?: ReadonlyMap<string, Box>; __paprikaMeasureMs?: number; __paprikaMeasure?: () => Map<string, Box>; __paprikaMeasures?: number };

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The WASM layer of ONE canvas: a renderer (vello on WebGPU, or on the CPU) that paints frames, rectangles, ellipses and paths on a
 * `<canvas>` under the DOM, which keeps text, images, selection and hit testing. It lives outside React: the camera draws it
 * frame by frame (`view.onFrame`), a changed document or preview measures the boxes again once per animation frame, and
 * the only thing React sees is `painted`, the ids the nodes drop their paint for.
 *
 * Handing over is safe at both ends: the DOM stops painting a node only AFTER the layer drew it, and any error (the module, the
 * adapter, a lost device, a render that throws) frees the renderer and gives every node back to the DOM at once.
 */
export function createWasmLayer({ rt, loader, onStatus, onError }: WasmLayerOptions): WasmLayer {
  let requested: WasmMode | null = null;
  let live = false;
  let canvas: HTMLCanvasElement | null = null;
  let renderer: WasmRenderer | null = null;
  /** The mode the live renderer was made for. */
  let rendererMode: WasmMode | null = null;
  let booting = false;
  /** A failure holds the layer off until the owner asks again (turns WASM off and on). */
  let failed = false;
  /** `unavailable` was already said for this request. */
  let toldUnavailable = false;
  let epoch = 0;
  let creates = 0;
  let painted: ReadonlySet<string> = NO_PAINTED;
  let status: CanvasRendererStatus = { backend: loader() ? "idle" : "unavailable", detail: "" };
  let frame = 0;
  let attached: (() => void) | null = null;

  const world = () => rt.world() as WorldHook | null;
  const dpr = () => (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);

  const writeAttrs = () => {
    if (!canvas) return;
    canvas.dataset.backend = status.backend;
    canvas.dataset.detail = status.detail;
    canvas.dataset.creates = String(creates);
    canvas.dataset.requested = requested ?? "dom";
  };
  const setStatus = (next: CanvasRendererStatus) => {
    if (next.backend === status.backend && next.detail === status.detail) return;
    status = next;
    writeAttrs();
    onStatus(next);
  };
  const backendStatus = (r: WasmRenderer): CanvasRendererStatus => ({
    backend: r.backend === "webgpu" ? "webgpu" : "cpu",
    detail: r.adapterInfo + (r.fallbackReason ? ` · ${r.fallbackReason}` : ""),
  });

  /** The layer is (or is not) the one that paints: `data-wasm-active` on the world says it to whoever watches the handover. */
  const markActive = (on: boolean) => {
    const w = world();
    if (w) w.dataset.wasmActive = on ? "1" : "0";
  };

  const setPainted = (next: ReadonlySet<string>) => {
    markActive(true);
    if (sameIds(painted, next)) return;
    painted = next.size === 0 ? NO_PAINTED : next;
    rt.store.actions.setPainted(painted);
  };

  /** Gives every node back to the DOM. */
  const handBack = () => {
    markActive(false);
    painted = NO_PAINTED;
    rt.store.actions.setPainted(NO_PAINTED);
  };

  /** The canvas takes the pixel size of the viewport. Returns whether it changed (a resize clears a canvas: draw again at once). */
  const sizeCanvas = (): boolean => {
    const vp = rt.viewport();
    if (!canvas || !vp) return false;
    const rect = vp.getBoundingClientRect();
    const k = dpr();
    const width = Math.max(1, Math.round(rect.width * k));
    const height = Math.max(1, Math.round(rect.height * k));
    if (width === canvas.width && height === canvas.height) return false;
    canvas.width = width;
    canvas.height = height;
    renderer?.resize(width, height);
    return true;
  };

  const release = () => {
    renderer?.free();
    renderer = null;
    rendererMode = null;
  };

  const fail = (message: string) => {
    if (failed) return;
    const mode = requested;
    failed = true;
    epoch += 1;
    booting = false;
    detach();
    release();
    handBack();
    setStatus({ backend: "error", detail: message });
    if (mode) onError(message, mode);
  };

  const draw = (): boolean => {
    const r = renderer;
    if (!r) return false;
    const v = rt.view.get();
    const k = dpr();
    try {
      r.render(v.x * k, v.y * k, v.zoom * k);
      if (r.backend === "webgpu") {
        // The device may be lost after the call returned; the layer finds out here and gives the nodes back.
        void r.finish().then(
          () => {
            if (renderer === r && r.deviceError) fail(r.deviceError);
          },
          (e: unknown) => {
            if (renderer === r) fail(messageOf(e));
          },
        );
      }
      return true;
    } catch (e) {
      fail(messageOf(e));
      return false;
    }
  };

  /** The document as the gestures show it: a node being moved, resized, turned or edited is drawn where the pointer put it. */
  const shownDocument = () => {
    const doc = rt.index.doc();
    const preview = rt.store.state.preview;
    const linked: (string | (typeof preview)[string])[] = [];
    for (const id in preview) linked.push(id, preview[id]!);
    return linked.length === 0 ? doc : patchedDocument(doc, linked);
  };

  const refresh = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    const el = world();
    if (!live || !requested || failed || !renderer || !canvas || !el) return;
    sizeCanvas();
    const t0 = performance.now();
    const boxes = measureBoxes(el, rt.view.get().zoom);
    el.__paprikaBoxes = boxes;
    el.__paprikaMeasureMs = performance.now() - t0;
    el.__paprikaMeasures = (el.__paprikaMeasures ?? 0) + 1;
    el.__paprikaMeasure = () => measureBoxes(el, rt.view.get().zoom);
    let list: ReturnType<typeof displayList>;
    try {
      list = displayList(shownDocument(), boxes, rt.pageId() ?? undefined);
      renderer.setScene(list.data, list.paths);
    } catch (e) {
      fail(messageOf(e));
      return;
    }
    // Only after the scene is on the canvas do the nodes stop painting it.
    if (!draw()) return;
    setPainted(list.painted);
    if (status.backend === "loading" || status.backend === "error") setStatus(backendStatus(renderer));
  };

  const schedule = () => {
    if (frame || !live || !requested || failed || !renderer) return;
    frame = requestAnimationFrame(refresh);
  };

  /** What keeps the scene current while WASM is on: the camera, the document, a gesture's preview, the viewport's size, the fonts. */
  const attach = () => {
    if (attached) return;
    const offs: (() => void)[] = [];
    offs.push(rt.view.onFrame(() => void draw()));
    offs.push(rt.index.subscribeDoc(schedule));
    let preview = rt.store.state.preview;
    const sub = rt.store.subscribe(() => {
      if (rt.store.state.preview === preview) return;
      preview = rt.store.state.preview;
      schedule();
    });
    offs.push(() => sub.unsubscribe());
    const vp = rt.viewport();
    if (vp && typeof ResizeObserver !== "undefined") {
      // Drawn inside the callback, never in the next frame: a resized canvas is blank until it is drawn, and a frame would show it.
      const observer = new ResizeObserver(() => {
        if (sizeCanvas()) draw();
      });
      observer.observe(vp);
      offs.push(() => observer.disconnect());
    }
    if (typeof document !== "undefined" && document.fonts?.addEventListener) {
      document.fonts.addEventListener("loadingdone", schedule);
      offs.push(() => document.fonts.removeEventListener("loadingdone", schedule));
    }
    attached = () => offs.forEach((off) => off());
  };

  function detach() {
    attached?.();
    attached = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  const activate = () => {
    attach();
    refresh();
  };

  const boot = () => {
    if (!live || !requested || failed || booting || renderer || !canvas) return;
    // The canvas is of the other backend (the owner swapped modes and React has not mounted the new one yet): `setCanvas` boots again.
    if (canvas.dataset.mode !== requested) return;
    const mode = requested;
    const load = loader();
    if (!load) {
      // Said once per request, even if it was already the status: the owner must take the choice back.
      if (toldUnavailable) return;
      toldUnavailable = true;
      status = { backend: "unavailable", detail: "" };
      writeAttrs();
      onStatus(status);
      return;
    }
    const target = canvas;
    const mine = ++epoch;
    booting = true;
    setStatus({ backend: "loading", detail: "" });
    sizeCanvas();
    load()
      .then((mod) => mod.createRenderer(target, mode))
      .then((r) => {
        if (mine !== epoch || canvas !== target) {
          r.free();
          return;
        }
        booting = false;
        if (mode === "gpu" && r.backend !== "webgpu") {
          r.free();
          fail(r.fallbackReason || "WebGPU is not available");
          return;
        }
        rendererMode = mode;
        r.setBackground(0, 0, 0, 0);
        renderer = r;
        creates += 1;
        writeAttrs();
        setStatus(backendStatus(r));
        if (requested) activate();
      })
      .catch((e: unknown) => {
        if (mine !== epoch) return;
        booting = false;
        fail(messageOf(e));
      });
  };

  return {
    setRequested: (mode) => {
      if (mode === requested) return;
      requested = mode;
      if (canvas) canvas.dataset.requested = mode ?? "dom";
      if (mode) {
        failed = false;
        toldUnavailable = false;
        if (renderer && rendererMode !== mode) {
          // The other backend: the DOM paints while it boots, and the nodes are handed over again after its first frame.
          epoch += 1;
          booting = false;
          detach();
          release();
          handBack();
        }
        if (renderer) activate();
        else boot();
        return;
      }
      // Off: the nodes paint again, the renderer (and its device) and the canvas stay for the next time.
      detach();
      handBack();
    },
    setCanvas: (next) => {
      if (next === canvas) return;
      canvas = next;
      writeAttrs();
      if (next) boot();
    },
    start: () => {
      live = true;
      if (requested) {
        if (renderer) activate();
        else boot();
      }
    },
    stop: () => {
      live = false;
      epoch += 1;
      booting = false;
      detach();
      release();
      handBack();
    },
    status: () => status,
    refresh,
  };
}
