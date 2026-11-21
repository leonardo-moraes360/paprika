[🇺🇸 English](README.md) | 🇧🇷 Português

# canvas-wasm (experimento)

Harness de benchmark do [ADR 0002](../../docs/pt-BR/adr/0002-renderizador-canvas-rust-wasm.md): o canvas do Paprika
desenhado por Rust/WASM, com **vello no WebGPU** e fallback **vello_cpu**. O bench em si fica
fora do workspace pnpm e do `pnpm check`.

## Estrutura

O renderizador agora fica em [`crates/render`](../../crates/render) e a display list em
[`packages/core/src/displayList.ts`](../../packages/core/src/displayList.ts); o canvas usa os dois
atrás da chave DOM/WASM. Esta pasta guarda o harness de benchmark.

| Caminho | O quê |
|---|---|
| `bench/` | Página Vite + runner Playwright comparando DOM, Canvas2D, vello_cpu e vello WebGPU |
| `bench/gpu-readback-check.cjs` | Renderiza no WebGPU offscreen e confere os pixels lidos da GPU |
| `bench/webgpu-canvas-probe.cjs` | Mostra que o Chromium headless sem GPU não apresenta um canvas WebGPU |
| `bench/results/` | JSON do benchmark e frames estáticos usados no ADR |

## Rodar

```bash
pnpm install && pnpm build      # compila crates/render em apps/web/src/wasm (exige Rust)
apps/web/node_modules/.bin/vite --config experiments/canvas-wasm/bench/vite.config.mjs
# abra http://localhost:5199, ou rode headless:
node experiments/canvas-wasm/bench/run.cjs demo,1000,10000 auto,canvas2d,dom
node experiments/canvas-wasm/bench/run.cjs bezier,1000 webgpu --stills --gpu-flags  # GPU offscreen
node experiments/canvas-wasm/bench/gpu-readback-check.cjs
```

Numa máquina com GPU de verdade, abra a página no Chrome ou Edge e escolha `webgpu`: o JSON do
resultado mostra o nome do adapter, que é a medição que ainda falta no ADR.

## Lacunas conhecidas

O renderizador não desenha texto, imagens, gradientes nem opacidade de grupo do CSS (o app deixa isso para o DOM). O Chromium headless
sem GPU não consegue apresentar um canvas WebGPU (`bench/webgpu-canvas-probe.cjs` mostra isso com JS
puro), então o caminho de GPU é conferido offscreen com `?offscreen=1` e leitura de pixels.
