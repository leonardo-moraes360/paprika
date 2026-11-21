🇺🇸 English | [🇧🇷 Português](README.pt-BR.md)

# canvas-wasm (experiment)

Benchmark harness for [ADR 0002](../../docs/adr/0002-canvas-renderer-rust-wasm.md): the Paprika canvas drawn by
Rust/WASM, with **vello on WebGPU** and a **vello_cpu** fallback. The bench itself is outside the
pnpm workspace and `pnpm check`.

## Layout

The renderer itself now lives in [`crates/render`](../../crates/render) and the display list in
[`packages/core/src/displayList.ts`](../../packages/core/src/displayList.ts); the canvas uses them
behind the DOM/WASM switch. This folder keeps the benchmark harness.

| Path | What |
|---|---|
| `bench/` | Vite page + Playwright runner comparing DOM, Canvas2D, vello_cpu and vello WebGPU |
| `bench/gpu-readback-check.cjs` | Renders on WebGPU offscreen and checks pixels read back from the GPU |
| `bench/webgpu-canvas-probe.cjs` | Shows headless Chromium without a GPU cannot present a WebGPU canvas |
| `bench/results/` | Benchmark JSON and still frames used in the ADR |

## Run

```bash
pnpm install && pnpm build      # builds crates/render into apps/web/src/wasm (needs Rust)
apps/web/node_modules/.bin/vite --config experiments/canvas-wasm/bench/vite.config.mjs
# open http://localhost:5199, or run headless:
node experiments/canvas-wasm/bench/run.cjs demo,1000,10000 auto,canvas2d,dom
node experiments/canvas-wasm/bench/run.cjs bezier,1000 webgpu --stills --gpu-flags  # offscreen GPU
node experiments/canvas-wasm/bench/gpu-readback-check.cjs
```

On a machine with a real GPU, open the page in Chrome or Edge and choose `webgpu`: the results JSON
shows the adapter name, which is the measurement the ADR is still missing.

## Known gaps

The renderer does not draw text, images, gradients or CSS group opacity (the app leaves those to the DOM). Headless Chromium without a GPU
cannot present a WebGPU canvas (`bench/webgpu-canvas-probe.cjs` shows it with plain JS), so the GPU
path is checked offscreen with `?offscreen=1` and pixel readback.
