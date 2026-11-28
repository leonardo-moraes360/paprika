import type { WasmLoader, WasmMode, WasmRenderer } from "@/components/frontends/canvas";

/** A renderer that records what the canvas asks of it (the real one needs a GPU or a CPU rasteriser and the built artifact). */
export type FakeRenderer = WasmRenderer & {
  readonly canvas: HTMLCanvasElement;
  scenes: { data: Float32Array; paths: string }[];
  renders: [number, number, number][];
  resizes: [number, number][];
  freed: boolean;
};

/**
 * The module of the renderer as the tests have it: one object per test file, reset after every test (`setup.ts`), and the
 * stand-in for `editor/wasm-module` (also in `setup.ts`), so no test depends on the artifact being built.
 */
export const fakeWasm = {
  /** Whether this "build" carries the renderer. */
  available: true,
  /** The modes `createRenderer` was asked for, in order (React's dev double effect boots a first one that is freed at once: `asked` folds repeats). The backend follows the mode: `cpu` is the CPU, `gpu` is WebGPU. */
  modes: [] as WasmMode[],
  /** `createRenderer` rejects with this. */
  failCreate: null as string | null,
  /** `createRenderer` rejects with this only for `gpu` (no WebGPU, or only a software adapter). */
  failGpu: null as string | null,
  /** `modes` without consecutive repeats. */
  get asked(): WasmMode[] {
    return this.modes.filter((m, i) => m !== this.modes[i - 1]);
  },
  /** `render` throws this. */
  failRender: null as string | null,
  /** What `deviceError` reports after a frame (a lost WebGPU device). */
  deviceError: "",
  /** Holds `createRenderer` until `release()` (to see the loading state). */
  hold: false,
  /** Called at the start of every `render` (to see what the DOM looked like when the frame was drawn). */
  onRender: null as (() => void) | null,
  loads: 0,
  renderers: [] as FakeRenderer[],
  releaseHeld: null as (() => void) | null,
  release() {
    this.releaseHeld?.();
  },
  reset() {
    this.available = true;
    this.modes = [];
    this.failGpu = null;
    this.failCreate = null;
    this.failRender = null;
    this.deviceError = "";
    this.hold = false;
    this.onRender = null;
    this.loads = 0;
    this.renderers = [];
    this.releaseHeld = null;
  },
  get last(): FakeRenderer | undefined {
    return this.renderers.at(-1);
  },
  loader: (async () => {
    fakeWasm.loads += 1;
    return {
      createRenderer: async (canvas: HTMLCanvasElement, mode: WasmMode) => {
        fakeWasm.modes.push(mode);
        if (fakeWasm.hold) await new Promise<void>((resolve) => (fakeWasm.releaseHeld = resolve));
        if (fakeWasm.failCreate) throw new Error(fakeWasm.failCreate);
        if (mode === "gpu" && fakeWasm.failGpu) throw new Error(fakeWasm.failGpu);
        const backend = mode === "gpu" ? "webgpu" : "cpu";
        const renderer: FakeRenderer = {
          canvas,
          backend,
          adapterInfo: backend === "webgpu" ? "fake adapter" : "no adapter",
          fallbackReason: backend === "cpu" ? "forced by mode=cpu" : "",
          get deviceError() {
            return fakeWasm.deviceError;
          },
          scenes: [],
          renders: [],
          resizes: [],
          freed: false,
          finish: async () => undefined,
          setBackground: () => undefined,
          setScene: (data, paths) => void renderer.scenes.push({ data, paths }),
          resize: (w, h) => void renderer.resizes.push([w, h]),
          render: (tx, ty, zoom) => {
            if (fakeWasm.failRender) throw new Error(fakeWasm.failRender);
            fakeWasm.onRender?.();
            renderer.renders.push([tx, ty, zoom]);
          },
          free: () => {
            renderer.freed = true;
          },
        };
        fakeWasm.renderers.push(renderer);
        return renderer;
      },
    };
  }) as WasmLoader,
};
