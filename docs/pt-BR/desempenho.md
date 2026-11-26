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
| Tempo do servidor por escrita de 1 prop | 50 ms | 1,08 s | PAP-A-060 |
| Tempo de script na aba numa escrita recebida | 50 ms | 2,6 s (pior caso sintético) | PAP-A-061 |
| Quadro p95 em scroll, zoom e pan | 20 ms | cumprido (17 ms; antes 33–83 ms) | PAP-A-062 |
| Passo de redimensionar painel | 20 ms | cumprido (17 ms sobre o documento pequeno; antes 750 ms) | PAP-A-063 |
| Tempo até um nó criado pelo agente ficar visível | 1 s | até 28,6 s | PAP-A-064 |
| A aba lenta termina sempre na última versão | sempre | não (481 de 485) | PAP-A-058 |

Os orçamentos de contagem (bytes, mensagens, snapshots, versões) são exatos. Os de tempo são relativos: a suíte mede a mesma ação num documento pequeno na mesma execução e o orçamento vale para a diferença, então uma máquina lenta ou ocupada não a reprova. O tempo de montagem do agente é a exceção: é um limite de produto, medido como está.

Cada orçamento começa só como relatório (`enforce: false`): ao ser excedido aparece como `known-failing` com o ticket e a execução continua passando. O PR que cumpre um orçamento muda para `enforce: true`; daí em diante um excesso reprova a suíte. Uma feature que adiciona um caminho quente adiciona, no mesmo PR, o cenário e o orçamento dele.

## Rodar a suíte

```sh
pnpm build
pnpm test:perf
```

Precisa do build da web (`apps/web/dist`) e do Chromium do Playwright para os cenários de navegador (veja [desenvolvimento](desenvolvimento.md); `PAPRIKA_CHROMIUM` aponta outro Chrome). Sem o build da web só os cenários do servidor rodam. Imprime uma tabela `cenário | orçamento | medido | limite | status` e grava os mesmos dados em JSON em `$PAPRIKA_PERF_REPORT` (padrão `report.json` num diretório novo `paprika-perf-report-*` dentro do diretório temporário do sistema; o caminho é impresso). Não faz parte do `pnpm check`.

## Como fazer profiling

- Servidor: um teste ou benchmark em Go com `go test -cpuprofile cpu.out`, depois `go tool pprof -top cpu.out`; ou cronometrar a chamada MCP contra o pior caso. Informe as funções do topo antes e depois.
- Canvas: guie a página com o Playwright e leia `Performance.getMetrics` pelo CDP (`ScriptDuration`, `LayoutDuration`, `RecalcStyleDuration`) antes e depois do gesto, colete entradas `longtask` com um `PerformanceObserver` e registre os tempos de quadro com deltas de `requestAnimationFrame` durante pan com a roda, zoom, arraste de painel ou uma escrita recebida. O `packages/e2e/test/perf/helpers.ts` tem esses helpers.
- Ponha os números (antes e depois, no pior caso) na descrição do PR.
