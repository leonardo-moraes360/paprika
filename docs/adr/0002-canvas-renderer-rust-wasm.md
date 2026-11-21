🇺🇸 English | [🇧🇷 Português](../pt-BR/adr/0002-renderizador-canvas-rust-wasm.md)

# ADR 0002: Canvas renderer in Rust/WASM (WebGPU with a CPU fallback)

- **Status:** Proposed. Feasibility proven by a prototype; **not adopted**, `main` keeps the DOM canvas.
- **Date:** 2026-11-21
- **Prototype:** [`experiments/canvas-wasm/`](../../experiments/canvas-wasm/README.md)

## Context

The canvas (`apps/web/src/Canvas.tsx`) renders one HTML element per node, styled by `nodeStyle`
(`packages/core/src/style.ts`). Pan and zoom are a CSS transform. The same `nodeStyle` produces the
HTML used by `render_screenshot` (Playwright) and the React/HTML export, so what an agent checks in
a PNG is what the human sees (architecture decision 4, invariant "nodeStyle is the single rendering
source"). Path nodes (bezier) are rendered as inline SVG built by `pathAttrs`.

The question: can the canvas and its drawing move to Rust compiled to WASM to draw faster, using
WebGPU when there is a GPU and falling back to the CPU when there is not?

## Options considered

| Option | GPU | CPU fallback | Paths (bezier) | Text | Notes |
|---|---|---|---|---|---|
| A. Keep DOM/CSS (today) | Browser compositor | Browser | SVG | Browser | One engine for canvas, screenshot and export. |
| B. Canvas2D renderer in TS | Browser (Skia, GPU when available) | Browser (Skia) | `Path2D` | `fillText` + manual layout | No new toolchain; the browser picks GPU/CPU by itself. |
| C. **vello (WebGPU) + vello_cpu, Rust/WASM** (prototyped) | WebGPU compute | vello_cpu (SIMD) | Native (`kurbo::BezPath`) | Needs parley/skrifa + font loading | Same scene model on both backends. vello requires compute shaders, so no WebGL2 tier. |
| D. Custom wgpu renderer (instanced SDF quads) | WebGPU, or WebGL2 through wgpu | None (or tiny-skia) | Needs tessellation (lyon) | Glyph atlas | Fast for boxes, much more code for paths and text. |
| E. tiny-skia only (Rust/WASM) | No | Yes | Yes | Needs a shaper | Mature, but CPU only; vello_cpu is the newer, faster CPU option. |
| F. CanvasKit (Skia WASM) | WebGL | Yes | Yes | Yes (full paragraph API) | ~6–7 MB, C++ not Rust, a second engine that diverges from CSS. |

## What the prototype does

`experiments/canvas-wasm` (Rust 2024, vello 0.12, vello_cpu 0.4, wgpu 30, wasm-bindgen 0.2.130):

- JS flattens the document into a packed `Float32Array` display list (16 floats per node: box,
  radius, rotation, opacity, fill, stroke) plus a path table (`viewBox`, fill rule, caps, joins, `d`).
  Layout stays in the browser: if a frame uses auto layout, boxes are measured once from a hidden DOM
  built with `nodeStyle`.
- `createRenderer(canvas, "auto")` tries WebGPU. Every step that can fail (adapter, device, vello
  shaders) runs before the canvas gets a `webgpu` context, so a failure leaves the same canvas free
  for the CPU path, which draws with vello_cpu and `putImageData`.
- **Software adapters count as "no GPU".** Headless Chromium exposes a SwiftShader WebGPU adapter;
  vello's compute shaders on it took 500–830 ms per frame, 45–220× slower than vello_cpu. `auto`
  rejects adapters with `DeviceType::Cpu` (`mode: "gpu"` still forces them).
- Rectangles, ellipses, rounded corners, inner borders, rotation around the center, frame clipping
  and **path nodes** (fill rule, caps, joins, `viewBox` with `xMidYMid meet`). Not implemented:
  text, images, shadows, gradients, group opacity.

### Verification

| Check | Result |
|---|---|
| `cargo test` (native, vello_cpu) | 4/4: rect/ellipse/clip, zoom, rotation pivot, path with `viewBox` + `evenodd` |
| `cargo clippy --all-targets`, `cargo fmt --check` | clean |
| `bench/gpu-readback-check.cjs` (vello on WebGPU, pixels read back from the GPU target) | PASS |
| GPU vs CPU still frames (pixels differing by more than 16/255) | demo 86, bezier 348, 1,000 shapes 4,087 of 1,024,000: antialiasing edges only |
| Fallback without WebGPU (headless Chromium, no adapter) | `auto` picks CPU with the reason in `fallbackReason` |
| `bench/tsconfig.json` (`tsc --strict`) | clean |

The bezier example renders the same in all four paths
([comparison](../../experiments/canvas-wasm/bench/results/compare-bezier.png)).

**Not verified:** presenting a WebGPU canvas. In this container (headless Chromium, no GPU) even a
plain-JS WebGPU canvas loses its device when presented (`bench/webgpu-canvas-probe.cjs`), so the GPU
path was checked offscreen. It needs a run on a machine with a real GPU.

## Benchmark

Chromium 1243 headless, 4 vCPU Xeon 2.1 GHz, **no GPU**, 1280×800 at DPR 1. Synthetic boards of
100 shapes (rects, ellipses, bezier blobs, strokes, rotation, translucency). "Zoom" animates zoom and
pan for 120 frames (a full re-raster every frame). "Edit" changes one node's fill per frame. Times in
ms, mean of main-thread work per frame; fps is the `requestAnimationFrame` cadence.
Raw data: [`bench-nogpu.jsonl`](../../experiments/canvas-wasm/bench/results/bench-nogpu.jsonl).

| Nodes | Mode | First frame | Zoom work | Zoom fps | Edit work |
|---:|---|---:|---:|---:|---:|
| 1,010 | DOM (today) | 18.9 | 0.03 | 60 | 0.05 |
| 1,010 | Canvas2D (JS) | 27.4 | 3.7 | 56 | 5.6 |
| 1,010 | vello_cpu (WASM) | 30.7 | 19.3 | 49 | 27.6 |
| 10,100 | DOM (today) | 181 | 0.03 | 56 | 0.05 |
| 10,100 | Canvas2D (JS) | 114 | 57.7 | 15.5 | 77.5 |
| 10,100 | vello_cpu (WASM) | 236 | 134 | 7.4 | 168 |
| 50,500 | DOM (today) | 1,021 | 0.04 | 17.6 | 0.09 |
| 50,500 | Canvas2D (JS) | 478 | 249 | 3.9 | 482 |
| 50,500 | vello_cpu (WASM) | 810 | 626 | 1.6 | 807 |

Reading the numbers:

1. **Without a GPU, WASM does not draw faster.** vello_cpu (single thread, SIMD128) is 2.3–5×
   slower than the browser's native Canvas2D, and both lose to the DOM, whose zoom runs on the
   compositor threads and leaves the main thread free. DOM raster time is not in "work"; the fps
   column shows it reaching the compositor at 50k nodes (17.6 fps).
2. **The DOM's real costs are building the tree** (1 s for 50k nodes) and React re-rendering every
   node on each document change (`RenderNode` is not memoized); the benchmark's DOM edit updates a
   single element, the best case.
3. **The GPU case is the open question.** vello on a real GPU is expected to be well ahead at 10k+
   shapes, but there is no measurement here. Below ~1,000 nodes (every current example) all modes
   hold 60 fps.

## Trade-offs against the HTML/CSS export

- **Two renderers.** The export and the screenshot stay HTML/CSS. A WASM canvas becomes a second
  engine that must match `nodeStyle`; it breaks the "single rendering source" invariant unless the
  display list is generated in `@paprika/core` next to `nodeStyle` and guarded by a pixel-parity test
  against the HTML screenshot.
- **Text is the expensive part.** Today the browser shapes, wraps and measures text. In WASM that
  means a shaper and line breaker (parley/skrifa), font loading and fallback, and CSS-compatible
  wrapping, or a hybrid where text stays in a DOM layer above the canvas.
- **Layout.** `hug`, `fill`, row/column, `wrap` are solved by CSS. Either the browser keeps solving
  them (the prototype measures a hidden DOM, which costs a layout per change) or Rust takes them over
  (taffy), and the export must reproduce the same result.
- **Interaction.** Selection boxes, frame labels and hit testing read `getBoundingClientRect` from
  the DOM today. A canvas needs its own hit testing (rotation-aware, paths).
- **Cost.** 1.9 MB WASM (≈600 KB gzip), a Rust toolchain plus `wasm-bindgen-cli` in the build, and
  no native accessibility tree.
- **What it buys.** Native bezier geometry, one scene model for GPU and CPU, and a path to
  screenshots without Chromium: the Go server could run the same WASM renderer through a WASM
  runtime (for example wazero) once text is solved (not tested).

## Decision

1. Keep the DOM canvas on `main`. The prototype stays in `experiments/canvas-wasm` as evidence and
   as a benchmark harness.
2. Measure on a machine with a real GPU (`bench/run.cjs` or the bench page) before any adoption.
3. Do the cheap DOM work first if large documents become a real use: memoize `RenderNode` per node,
   skip off-screen boards (`content-visibility: auto` on root frames), and avoid DOM measurements on
   every render.
4. Revisit (move to *Accepted*, hybrid design) only if real-GPU numbers show vello holding 60 fps
   where the DOM drops below 30 fps (10k+ nodes) **and** documents of that size exist. The hybrid
   design: a WASM layer draws shapes and paths, a DOM layer keeps text and selection, the display
   list is built in `@paprika/core`, and a parity test compares it with the HTML screenshot.

## Consequences

- No change to the product, the export or MCP behavior.
- `experiments/` is outside the pnpm workspace and `pnpm check`; building it needs Rust
  (`experiments/canvas-wasm/build.sh`).
- The display-list format, the software-adapter rule and the readback check can be reused if the
  hybrid design is adopted.
