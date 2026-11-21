[🇺🇸 English](../../adr/0002-canvas-renderer-rust-wasm.md) | 🇧🇷 Português

# ADR 0002: Renderizador do canvas em Rust/WASM (WebGPU com fallback para CPU)

- **Status:** Proposto. Viabilidade comprovada por protótipo; **não adotado**, a `main` mantém o canvas DOM.
- **Data:** 2026-11-21
- **Protótipo:** [`experiments/canvas-wasm/`](../../../experiments/canvas-wasm/README.pt-BR.md)

## Contexto

O canvas (`apps/web/src/Canvas.tsx`) renderiza um elemento HTML por nó, com estilo vindo de
`nodeStyle` (`packages/core/src/style.ts`). Pan e zoom são um transform CSS. O mesmo `nodeStyle` gera
o HTML usado pelo `render_screenshot` (Playwright) e pelo export React/HTML, então o que o agente
confere no PNG é o que o humano vê (decisão 4 da arquitetura, invariante "nodeStyle é a única fonte
de renderização"). Nós path (bezier) viram SVG inline montado por `pathAttrs`.

A pergunta: dá para levar o canvas e o desenho para Rust compilado em WASM, para desenhar mais rápido,
usando WebGPU quando houver GPU e caindo para a CPU quando não houver?

## Opções avaliadas

| Opção | GPU | Fallback CPU | Paths (bezier) | Texto | Observações |
|---|---|---|---|---|---|
| A. Manter DOM/CSS (hoje) | Compositor do navegador | Navegador | SVG | Navegador | Um motor para canvas, screenshot e export. |
| B. Renderizador Canvas2D em TS | Navegador (Skia, GPU quando houver) | Navegador (Skia) | `Path2D` | `fillText` + layout manual | Sem toolchain nova; o navegador escolhe GPU/CPU sozinho. |
| C. **vello (WebGPU) + vello_cpu, Rust/WASM** (prototipado) | Compute no WebGPU | vello_cpu (SIMD) | Nativo (`kurbo::BezPath`) | Exige parley/skrifa + carregamento de fontes | Mesmo modelo de cena nos dois backends. O vello exige compute shaders, então não há nível WebGL2. |
| D. Renderizador próprio em wgpu (quads SDF instanciados) | WebGPU, ou WebGL2 via wgpu | Nenhum (ou tiny-skia) | Exige tesselação (lyon) | Atlas de glifos | Rápido para caixas, muito mais código para paths e texto. |
| E. Só tiny-skia (Rust/WASM) | Não | Sim | Sim | Exige shaper | Maduro, mas só CPU; o vello_cpu é a opção de CPU mais nova e mais rápida. |
| F. CanvasKit (Skia em WASM) | WebGL | Sim | Sim | Sim (API de parágrafo completa) | ~6–7 MB, C++ e não Rust, um segundo motor que diverge do CSS. |

## O que o protótipo faz

`experiments/canvas-wasm` (Rust 2024, vello 0.12, vello_cpu 0.4, wgpu 30, wasm-bindgen 0.2.130):

- O JS achata o documento numa display list empacotada em `Float32Array` (16 floats por nó: caixa,
  raio, rotação, opacidade, fill, stroke) mais uma tabela de paths (`viewBox`, regra de preenchimento,
  caps, joins, `d`). O layout continua no navegador: se um frame usa auto layout, as caixas são
  medidas uma vez num DOM oculto montado com `nodeStyle`.
- `createRenderer(canvas, "auto")` tenta o WebGPU. Tudo o que pode falhar (adapter, device, shaders do
  vello) roda antes de o canvas ganhar um contexto `webgpu`, então uma falha deixa o mesmo canvas livre
  para o caminho de CPU, que desenha com vello_cpu e `putImageData`.
- **Adapter por software conta como "sem GPU".** O Chromium headless expõe um adapter WebGPU do
  SwiftShader; os compute shaders do vello nele levaram de 500 a 830 ms por frame, de 45 a 220× mais
  lento que o vello_cpu. O modo `auto` rejeita adapters com `DeviceType::Cpu` (`mode: "gpu"` ainda força).
- Retângulos, elipses, cantos arredondados, borda interna, rotação pelo centro, clip de frame e **nós
  path** (regra de preenchimento, caps, joins, `viewBox` com `xMidYMid meet`). Fora do protótipo:
  texto, imagens, sombras, gradientes, opacidade de grupo.

### Verificação

| Verificação | Resultado |
|---|---|
| `cargo test` (nativo, vello_cpu) | 4/4: rect/elipse/clip, zoom, pivô da rotação, path com `viewBox` + `evenodd` |
| `cargo clippy --all-targets`, `cargo fmt --check` | limpo |
| `bench/gpu-readback-check.cjs` (vello no WebGPU, pixels lidos de volta do alvo na GPU) | PASS |
| Frames estáticos GPU vs CPU (pixels com diferença acima de 16/255) | demo 86, bezier 348, 1.000 formas 4.087 de 1.024.000: só bordas de antialiasing |
| Fallback sem WebGPU (Chromium headless, sem adapter) | `auto` escolhe CPU e informa o motivo em `fallbackReason` |
| `bench/tsconfig.json` (`tsc --strict`) | limpo |

O exemplo bezier sai igual nos quatro caminhos
([comparação](../../../experiments/canvas-wasm/bench/results/compare-bezier.png)).

**Não verificado:** apresentar um canvas WebGPU na tela. Neste container (Chromium headless, sem GPU)
até um canvas WebGPU em JS puro perde o device ao apresentar (`bench/webgpu-canvas-probe.cjs`), então o
caminho de GPU foi conferido offscreen. Falta rodar numa máquina com GPU de verdade.

## Benchmark

Chromium 1243 headless, Xeon 2,1 GHz com 4 vCPUs, **sem GPU**, 1280×800 com DPR 1. Boards sintéticos
de 100 formas (retângulos, elipses, blobs bezier, strokes, rotação, transparência). "Zoom" anima zoom
e pan por 120 frames (re-raster completo a cada frame). "Edição" troca o fill de um nó por frame.
Tempos em ms, média do trabalho na main thread por frame; fps é a cadência do `requestAnimationFrame`.
Dados brutos: [`bench-nogpu.jsonl`](../../../experiments/canvas-wasm/bench/results/bench-nogpu.jsonl).

| Nós | Modo | Primeiro frame | Zoom (trabalho) | Zoom fps | Edição (trabalho) |
|---:|---|---:|---:|---:|---:|
| 1.010 | DOM (hoje) | 18,9 | 0,03 | 60 | 0,05 |
| 1.010 | Canvas2D (JS) | 27,4 | 3,7 | 56 | 5,6 |
| 1.010 | vello_cpu (WASM) | 30,7 | 19,3 | 49 | 27,6 |
| 10.100 | DOM (hoje) | 181 | 0,03 | 56 | 0,05 |
| 10.100 | Canvas2D (JS) | 114 | 57,7 | 15,5 | 77,5 |
| 10.100 | vello_cpu (WASM) | 236 | 134 | 7,4 | 168 |
| 50.500 | DOM (hoje) | 1.021 | 0,04 | 17,6 | 0,09 |
| 50.500 | Canvas2D (JS) | 478 | 249 | 3,9 | 482 |
| 50.500 | vello_cpu (WASM) | 810 | 626 | 1,6 | 807 |

Como ler os números:

1. **Sem GPU, o WASM não desenha mais rápido.** O vello_cpu (uma thread, SIMD128) é de 2,3 a 5× mais
   lento que o Canvas2D nativo do navegador, e os dois perdem para o DOM, cujo zoom roda nas threads do
   compositor e deixa a main thread livre. O tempo de raster do DOM não entra em "trabalho"; a coluna
   de fps mostra o compositor no limite com 50 mil nós (17,6 fps).
2. **Os custos reais do DOM são montar a árvore** (1 s para 50 mil nós) e o React re-renderizar todos
   os nós a cada mudança no documento (`RenderNode` não é memoizado); a edição DOM do benchmark atualiza
   um único elemento, o melhor caso.
3. **O caso com GPU é a pergunta em aberto.** O vello numa GPU real deve ficar bem à frente a partir de
   10 mil formas, mas não há medição aqui. Abaixo de ~1.000 nós (todos os exemplos atuais) todos os modos
   mantêm 60 fps.

## Trade-offs em relação ao export HTML/CSS

- **Dois renderizadores.** Export e screenshot continuam em HTML/CSS. Um canvas em WASM vira um segundo
  motor que precisa bater com o `nodeStyle`; isso quebra o invariante de "fonte única de renderização",
  a menos que a display list seja gerada no `@paprika/core`, ao lado do `nodeStyle`, e protegida por um
  teste de paridade de pixels contra o screenshot HTML.
- **Texto é a parte cara.** Hoje o navegador faz shaping, quebra e medição. Em WASM isso exige shaper e
  quebra de linha (parley/skrifa), carregamento e fallback de fontes e quebra compatível com o CSS, ou um
  híbrido em que o texto fica numa camada DOM acima do canvas.
- **Layout.** `hug`, `fill`, linha/coluna e `wrap` são resolvidos pelo CSS. Ou o navegador continua
  resolvendo (o protótipo mede um DOM oculto, o que custa um layout por mudança), ou o Rust assume
  (taffy), e o export precisa reproduzir o mesmo resultado.
- **Interação.** Caixa de seleção, rótulos de frame e hit testing leem `getBoundingClientRect` do DOM
  hoje. Um canvas precisa de hit testing próprio (com rotação e paths).
- **Custo.** WASM de 1,9 MB (≈600 KB com gzip), toolchain Rust e `wasm-bindgen-cli` no build, e sem
  árvore de acessibilidade nativa.
- **O que se ganha.** Geometria bezier nativa, um modelo de cena para GPU e CPU, e um caminho para
  screenshots sem Chromium: o servidor em Go poderia rodar o mesmo renderizador WASM num runtime WASM
  (por exemplo, wazero) quando o texto estiver resolvido (não testado).

## Decisão

1. Manter o canvas DOM na `main`. O protótipo fica em `experiments/canvas-wasm` como evidência e como
   harness de benchmark.
2. Medir numa máquina com GPU de verdade (`bench/run.cjs` ou a página do bench) antes de qualquer adoção.
3. Fazer primeiro o trabalho barato no DOM se documentos grandes virarem uso real: memoizar `RenderNode`
   por nó, pular boards fora da tela (`content-visibility: auto` nos frames raiz) e evitar medições do DOM
   a cada render.
4. Reavaliar (passar a *Aceito*, com desenho híbrido) só se os números com GPU real mostrarem o vello a
   60 fps onde o DOM cai abaixo de 30 fps (10 mil nós ou mais) **e** existirem documentos desse tamanho. O
   desenho híbrido: uma camada WASM desenha formas e paths, uma camada DOM mantém texto e seleção, a
   display list é montada no `@paprika/core` e um teste de paridade a compara com o screenshot HTML.

## Consequências

- Nenhuma mudança no produto, no export ou no comportamento do MCP.
- `experiments/` fica fora do workspace pnpm e do `pnpm check`; compilar exige Rust
  (`experiments/canvas-wasm/build.sh`).
- O formato da display list, a regra do adapter por software e a verificação por readback podem ser
  reaproveitados se o desenho híbrido for adotado.
