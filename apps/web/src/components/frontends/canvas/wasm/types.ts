/**
 * What the canvas needs of the renderer module of `crates/render` (a `wasm-bindgen` build). The frontend never imports it: its
 * owner hands a loader in (`CanvasProps.wasm`), so a build without the artifact still builds and the canvas paints with the DOM.
 */
export interface WasmRenderer {
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

/** What `createRenderer` is asked for: the CPU rasteriser forced, or WebGPU (an error when there is none; never a silent fallback). */
export type WasmMode = "cpu" | "gpu";

export interface WasmModule {
  createRenderer(canvas: HTMLCanvasElement, mode: WasmMode): Promise<WasmRenderer>;
}

/** Resolves the module with its binary already instantiated. A rejection means the module cannot run here. */
export type WasmLoader = () => Promise<WasmModule>;

/**
 * Where the WASM renderer stands. `idle`: nobody asked for it yet. `loading`: the module, the adapter and the device are
 * being made. `webgpu` / `cpu`: the backend that draws. `unavailable`: this build has no renderer. `error`: it failed (the DOM paints again).
 */
export type CanvasRendererStatus = { backend: "idle" | "loading" | "webgpu" | "cpu" | "unavailable" | "error"; detail: string };
