# Desempenho

> English: [docs/en-US/performance.md](../en-US/performance.md)

O Paprika precisa continuar rápido num workspace real, não só no demo. Esta página define o pior caso, os orçamentos que a suíte `perf` confere e como fazer profiling. As regras estão na regra 7 do [AGENTS.md](../../AGENTS.md); o trabalho que põe cada número dentro do orçamento está na seção W do [backlog](backlog.md).

## Pior caso

Medido no workspace real do mantenedor (14.752 nós, 7,2 MB, main `17c9fac`). A suíte nunca usa esse export (é privado): ela monta, em código, um documento sintético com a mesma forma (`packages/e2e/test/perf/synthetic.ts`, determinístico):

- cerca de 15.000 nós em 7 páginas;
- uma página com cerca de 3.500 nós (a página pesada, aberta primeiro), feita de frames aninhados com auto-layout e bordas, textos, paths e elipses;
- 1.000 instâncias de componente;
- vários agentes escrevendo ao mesmo tempo;
- uma aba lenta (um consumidor do WebSocket que para de ler).

## Orçamentos

Os números ficam num só arquivo, `packages/e2e/test/perf/budgets.ts`.

| Orçamento | Limite | Hoje | Ticket |
|---|---|---|---|
| Bytes no WS por escrita de 1 prop | 2 KB | 608 B (exigido; eram 7,23 MB) | PAP-A-057 |
| Snapshots do documento ao abrir | 1 | 1 (exigido; eram 2) | PAP-A-057 |
| Bytes no fio do snapshot de abertura, em % do JSON | 25% | 9% no pior caso (exigido; era 100%: o `/ws` não tinha permessage-deflate). O workspace real do mantenedor (17.139 nós) cai de 8,4 MB para 1,25 MB | PAP-A-070 |
| Tempo do servidor por escrita de 1 prop | 50 ms | 2 a 7 ms acima de um documento pequeno (imposto; era 1,08 s) em um nó comum | PAP-A-060 |
| Tempo do servidor por escrita de 1 prop em um componente-mestre com 1.000 instâncias | 50 ms | 0,4 s (só relatório; era 2,2 s). O piso é cerca de 0,35 s: as 1.000 cópias são reconstruídas e cerca de 4.000 linhas são gravadas | PAP-A-060 |
| Tempo do servidor para criar um frame com 200 filhos | 50 ms | 31 ms acima de um documento pequeno (só relatório; era cerca de 450 ms) | PAP-A-060 |
| Tempo do servidor para apagar um frame com 200 filhos | 50 ms | 14 ms acima de um documento pequeno (imposto; era cerca de 430 ms) | PAP-A-060 |
| Tempo de script na aba numa escrita recebida | 50 ms | cerca de 0,1 s acima do documento pequeno (48–173 ms em 10 execuções, mediana perto de 100 ms; só relatório; era 2,5 s: o inspetor rodava o lint do documento inteiro na thread principal a cada versão) | PAP-A-068 |
| Quadro p95 em scroll, zoom e pan | 20 ms | cumprido (17 ms; antes 33–83 ms) | PAP-A-062 |
| Passo de redimensionar painel | 20 ms | cumprido (17 ms sobre o documento pequeno; antes 750 ms) | PAP-A-063 |
| Tempo até um frame de 200 nós criado pelo agente ficar visível, documento pequeno | 1 s | 180 ms (aplicado; era um replay de 200 passos) | PAP-A-064 |
| O mesmo, na página pesada do pior caso | 1 s | 0,7–0,97 s em 10 execuções (só relatório: perto demais do limite para aplicar; era 25 s) | PAP-A-068 |
| A aba lenta termina sempre na última versão | sempre | não (481 de 485) | PAP-A-058 |

Os orçamentos de contagem (bytes, mensagens, snapshots, versões) são exatos. Os de tempo são relativos: a suíte mede a mesma ação num documento pequeno na mesma execução e o orçamento vale para a diferença, então uma máquina lenta ou ocupada não a reprova. Os tempos de montagem do agente são a exceção: são um limite de produto, medido como está. Os nós criados nunca ficam escondidos enquanto o contorno do agente os percorre, então o que sobra na página pesada é a aba renderizando a escrita, não o passeio.

Cada orçamento começa só como relatório (`enforce: false`): ao ser excedido aparece como `known-failing` com o ticket e a execução continua passando. O PR que cumpre um orçamento muda para `enforce: true`; daí em diante um excesso reprova a suíte. Uma feature que adiciona um caminho quente adiciona, no mesmo PR, o cenário e o orçamento dele.

## Rodar a suíte

```sh
pnpm build
pnpm test:perf
```

Precisa do build da web (`web-legacy/dist`) e do Chromium do Playwright para os cenários de navegador (veja [desenvolvimento](desenvolvimento.md); `PAPRIKA_CHROMIUM` aponta outro Chrome). Sem o build da web só os cenários do servidor rodam. Imprime uma tabela `cenário | orçamento | medido | limite | status` e grava os mesmos dados em JSON em `$PAPRIKA_PERF_REPORT` (padrão `report.json` num diretório novo `paprika-perf-report-*` dentro do diretório temporário do sistema; o caminho é impresso). Não faz parte do `pnpm check`.

## O app novo (`apps/web`)

A suíte acima ainda não cobre o app novo. O que existe hoje:

- Contagem de commits no Vitest: `apps/web/src/perf/*.perf.test.tsx` renderizam o editor e o overview no jsdom sobre um documento gerado de N nós e verificam quantas vezes cada região faz commit para uma ação (rodam com `pnpm --filter @paprika/web test`). Conferem que uma ação não re-renderiza regiões que não deveria tocar. Não são orçamentos de tempo, e os tempos que imprimem são do jsdom, que não dizem nada sobre um navegador.
- Uma medição manual: `?perf=1` num build de desenvolvimento (`vite dev`) liga o `RegionProfiler` (`apps/web/src/perf`), que registra os commits e o `actualDuration` de cada região e os expõe em `window.__paprikaPerf` (leia pelo console ou por um script). Fica desligado no build de produção. Números obtidos assim são de build de desenvolvimento.

O que falta: um cenário e um orçamento do app novo em `packages/e2e/test/perf` (regra 7(b) do [AGENTS.md](../../AGENTS.md)). Essa suíte guia o app legado a partir de `web-legacy/dist`, e o servidor Go ainda não serve o app novo, então não há o que ela guiar. Os testes de commits do Vitest não são esse orçamento.

## Como fazer profiling

- Servidor: um teste ou benchmark em Go com `go test -cpuprofile cpu.out`, depois `go tool pprof -top cpu.out`; ou cronometrar a chamada MCP contra o pior caso. Informe as funções do topo antes e depois.
- Canvas: guie a página com o Playwright e leia `Performance.getMetrics` pelo CDP (`ScriptDuration`, `LayoutDuration`, `RecalcStyleDuration`) antes e depois do gesto, colete entradas `longtask` com um `PerformanceObserver` e registre os tempos de quadro com deltas de `requestAnimationFrame` durante pan com a roda, zoom, arraste de painel ou uma escrita recebida. O `packages/e2e/test/perf/helpers.ts` tem esses helpers.
- Ponha os números (antes e depois, no pior caso) na descrição do PR.
