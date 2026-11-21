# Benchmarks: o quanto um agente projeta bem usando o Paprika

> English: [README.md](README.md)

São três tarefas que medem o que um agente faz com as ferramentas MCP do Paprika: montar um card de
login a partir de tokens que já existem, montar uma seção de preços em três colunas com auto-layout e
consertar um documento pronto que reprova no linter. Cada uma é pontuada por um verificador
determinístico sobre o `.paprika.json` resultante — sem modelo julgando modelo.

O `.toolbelt/config.yaml` já aponta para estas pastas (`bench.tasks_dir`, `bench.fixtures_dir`,
`bench.output_dir`), então o `tb bench` lê este diretório.

## Estrutura

```
bench/
  tasks/<id>/task.yaml      a tarefa: prompt, fixture, comando de verificação, timeout
  tasks/<id>/check.mjs      o verificador daquela tarefa (Node puro, sem dependências)
  tasks/lib.mjs             regras compartilhadas: tokens, contraste WCAG AA, limites, relatório
  fixtures/<id>/            o documento inicial que a tarefa copia para um diretório temporário
  fixtures/<id>-reference/  uma solução feita à mão, usada para provar que o verificador passa
                            quando o trabalho está certo
  results/                  scores em JSONL e relatórios (fora do git)
```

O `tb bench` copia `fixtures/<id>` para um diretório temporário, roda o agente ali com o prompt e
depois roda `verification.command` no mesmo diretório.

## Rodando uma tarefa na mão

Como o `tb bench` executa o comando de verificação a partir do diretório temporário, o verificador é
referenciado por `$PAPRIKA_BENCH`, que precisa apontar para este repositório:

```bash
cd ~/paprika
export PAPRIKA_BENCH="$PWD"

tb bench list                                  # as três tarefas
tb bench run --task login-card                 # contra o bench.default_agent
tb bench run --agent 'my-agent {prompt} {workdir}' --repetitions 5
tb bench report bench/results/<run>.jsonl
```

Sem `PAPRIKA_BENCH` a verificação falha com uma mensagem citando a variável — um score 0 com essa
linha na saída significa que a execução nem aconteceu de verdade.

Para conferir um documento só, pule o harness e rode o verificador direto:

```bash
node bench/tasks/login-card/check.mjs bench/fixtures/login-card-reference/document.paprika.json      # exit 0
node bench/tasks/login-card/check.mjs bench/fixtures/login-card/document.paprika.json                # exit 1
```

Cada regra imprime uma linha `PASS`/`FAIL` e a última linha é o score (`N/M checks passed`), que é o
que entra no relatório do `tb bench`.

## Rodando um agente contra uma tarefa

O fixture é um arquivo normal do Paprika, então o agente trabalha nele com as ferramentas documentadas:

```bash
node "$PAPRIKA_BENCH/packages/server/dist/cli.js" mcp --file "$PWD/document.paprika.json" --no-ui   # MCP em stdio
node "$PAPRIKA_BENCH/packages/server/dist/cli.js" serve --file "$PWD/document.paprika.json"          # canvas + MCP/HTTP
```

`pnpm --filter @paprika/server build` cria o `dist/`. O servidor grava o arquivo depois de cada
mutação, então o verificador consegue ler assim que o agente parar. Os prompts no `task.yaml`
listam as regras pontuadas exatamente como são, e é isso que torna uma falha explicável: a linha
`FAIL` do verificador diz o nó e o valor.

## O que os verificadores provam e o que não provam

- São autônomos: leem o JSON e implementam as regras de cor e geometria em `tasks/lib.mjs`, então o
  score não depende do `@paprika/core` compilado nem de um servidor no ar.
- Cobrem o mesmo terreno do `lint_design` (contraste WCAG AA, tamanho mínimo de texto, estouro do
  pai, alt em imagem, cor fixa que duplica um token), reimplementadas de propósito. Se os dois
  discordarem, o `lint_design` é a autoridade sobre o documento vivo e o verificador é a autoridade
  sobre o score.
- O contraste que mantém o verificador honesto: todo fixture carrega pelo `DocumentStore` do
  servidor (o mesmo caminho do `paprika serve`/`paprika mcp`), os três fixtures iniciais somam 8
  achados no `lint_design` (contraste, fonte pequena, falta de alt, estouro, cor literal) e os três
  `-reference` dão **zero** achados e passam no verificador.
- A tarefa de preços pontua a **configuração de layout** (`mode`, `gap`, `padding`, colunas da mesma
  largura) e não os `x`/`y` resultantes, porque o auto-layout posiciona os filhos no render.
- `render_screenshot` e `export_code` não são pontuados: comparar pixels amarraria o score a fontes e
  ao navegador, e a tarefa é sobre o documento que o agente produziu.
- Passar não significa "bom design", significa "o documento cumpre as regras listadas". Os fixtures
  `-reference` são o piso: se o verificador passa num deles e reprova o documento inicial, o
  verificador funciona; se as regras são as *certas* é uma discussão à parte, e vale discutir.

## Criando uma tarefa

Copie um diretório existente: escreva o prompt de forma que cada regra pontuada apareça nele, adicione
o fixture inicial e um `-reference` que precisa passar, e faça o `check.mjs` sair com 0 só quando
todas as regras valeram. Depois prove os dois lados:

```bash
node bench/tasks/<id>/check.mjs bench/fixtures/<id>-reference/document.paprika.json   # tem que ser 0
node bench/tasks/<id>/check.mjs bench/fixtures/<id>/document.paprika.json             # tem que ser != 0
```
