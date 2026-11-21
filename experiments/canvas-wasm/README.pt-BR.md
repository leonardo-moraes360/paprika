[🇺🇸 English](README.md) | 🇧🇷 Português

# canvas-wasm (experimento)

Protótipo do [ADR 0002](../../docs/pt-BR/adr/0002-renderizador-canvas-rust-wasm.md): o canvas do Paprika
desenhado por Rust/WASM, com **vello no WebGPU** e fallback **vello_cpu**. Não está ligado ao app; fica
fora do workspace pnpm e do `pnpm check`.

## Estrutura

| Caminho | O quê |
|---|---|
| `src/scene.rs` | Display list (16 `f32` por nó) + tabela de paths, codificação para o vello na GPU |
| `src/cpu.rs` | Backend vello_cpu e os testes nativos |
| `src/web.rs` | API wasm-bindgen: `createRenderer(canvas, "auto" \| "gpu" \| "cpu")`, `setScene`, `render`, `finish`, `readPixels` |
| `bench/` | Página Vite + runner Playwright comparando DOM (hoje), Canvas2D, vello_cpu e vello WebGPU |
| `bench/results/` | JSON do benchmark e frames estáticos usados no ADR |

## Compilar e rodar

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.130
cd experiments/canvas-wasm
cargo test                      # testes nativos (vello_cpu)
./build.sh                      # -> pkg/ (WASM + cola JS, com SIMD128)

# na raiz do repositório, depois de `pnpm install`:
apps/web/node_modules/.bin/vite --config experiments/canvas-wasm/bench/vite.config.mjs
# abra http://localhost:5199 e escolha documento e modo, ou rode headless:
node experiments/canvas-wasm/bench/run.cjs demo,1000,10000 auto,canvas2d,dom
node experiments/canvas-wasm/bench/run.cjs bezier,1000 webgpu --stills --gpu-flags  # GPU offscreen
node experiments/canvas-wasm/bench/gpu-readback-check.cjs                           # pixels da GPU
```

Numa máquina com GPU de verdade, abra a página no Chrome ou Edge e escolha `webgpu`: o JSON do resultado
mostra o nome do adapter, que é a medição que ainda falta no ADR.

## Display list

`[kind, x, y, w, h, raio, rotação°, opacidade, fill r, g, b, a, larguraStroke, stroke r, g, b]`, cores de
0 a 1. `kind`: 0 rect, 1 elipse, 2 abre clip (frame com `clip`), 3 fecha clip, 4 path (`raio` = índice na
tabela de paths). Tabela de paths: uma linha por path, `vx vy vw vh regra cap join|d`.

## Lacunas conhecidas

Texto, imagens, sombras, gradientes e opacidade de grupo do CSS não são desenhados. O Chromium headless
sem GPU não consegue apresentar um canvas WebGPU (`bench/webgpu-canvas-probe.cjs` mostra isso com JS
puro), então o caminho de GPU é conferido offscreen com `?offscreen=1` e leitura de pixels.
