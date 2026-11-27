import type { WasmLoader, WasmRenderer } from "@/components/frontends/canvas";

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
  backend: "cpu" as "cpu" | "webgpu",
  /** `createRenderer` rejects with this. */
  failCreate: null as string | null,
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
    this.backend = "cpu";
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
      createRenderer: async (canvas: HTMLCanvasElement) => {
        if (fakeWasm.hold) await new Promise<void>((resolve) => (fakeWasm.releaseHeld = resolve));
        if (fakeWasm.failCreate) throw new Error(fakeWasm.failCreate);
        const backend = fakeWasm.backend;
        const renderer: FakeRenderer = {
          canvas,
          backend,
          adapterInfo: backend === "webgpu" ? "fake adapter" : "no adapter",
          fallbackReason: backend === "cpu" ? "no hardware adapter" : "",
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
