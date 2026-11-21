🇺🇸 English | [🇧🇷 Português](README.pt-BR.md)

# canvas-wasm (experiment)

Prototype for [ADR 0002](../../docs/adr/0002-canvas-renderer-rust-wasm.md): the Paprika canvas drawn by
Rust/WASM, with **vello on WebGPU** and a **vello_cpu** fallback. Not wired into the app; outside the
pnpm workspace and `pnpm check`.

## Layout

| Path | What |
|---|---|
| `src/scene.rs` | Display list (16 `f32` per node) + path table, vello GPU encoding |
| `src/cpu.rs` | vello_cpu backend and the native tests |
| `src/web.rs` | wasm-bindgen API: `createRenderer(canvas, "auto" \| "gpu" \| "cpu")`, `setScene`, `render`, `finish`, `readPixels` |
| `bench/` | Vite page + Playwright runner comparing DOM (today), Canvas2D, vello_cpu and vello WebGPU |
| `bench/results/` | Benchmark JSON and still frames used in the ADR |

## Build and run

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.130
cd experiments/canvas-wasm
cargo test                      # native tests (vello_cpu)
./build.sh                      # -> pkg/ (WASM + JS glue, SIMD128 enabled)

# from the repository root, after `pnpm install`:
apps/web/node_modules/.bin/vite --config experiments/canvas-wasm/bench/vite.config.mjs
# open http://localhost:5199 and pick a document and a mode, or run headless:
node experiments/canvas-wasm/bench/run.cjs demo,1000,10000 auto,canvas2d,dom
node experiments/canvas-wasm/bench/run.cjs bezier,1000 webgpu --stills --gpu-flags  # offscreen GPU
node experiments/canvas-wasm/bench/gpu-readback-check.cjs                           # GPU pixel check
```

On a machine with a real GPU, open the page in Chrome or Edge and choose `webgpu`: the results JSON
shows the adapter name, which is the measurement the ADR is still missing.

## Display list

`[kind, x, y, w, h, radius, rotation°, opacity, fill r, g, b, a, strokeWidth, stroke r, g, b]`, colors
in 0..1. `kind`: 0 rect, 1 ellipse, 2 push clip (frame with `clip`), 3 pop clip, 4 path (`radius` =
index into the path table). Path table: one line per path, `vx vy vw vh rule cap join|d`.

## Known gaps

Text, images, shadows, gradients and CSS group opacity are not drawn. Headless Chromium without a GPU
cannot present a WebGPU canvas (`bench/webgpu-canvas-probe.cjs` shows it with plain JS), so the GPU
path is checked offscreen with `?offscreen=1` and pixel readback.
