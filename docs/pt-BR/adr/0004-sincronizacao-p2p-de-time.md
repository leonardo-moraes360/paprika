[🇺🇸 English](../../adr/0004-p2p-team-sync.md) | 🇧🇷 Português

# ADR 0004: Sincronização P2P de time (transporte Iroh, CRDT Loro, sidecar em Rust)

- **Status:** Aceito
- **Data:** 2026-11-21
- **Código:** `crates/sync` (sidecar `paprika-sync`), `server-go/internal/team` (supervisor, diff e aplicação)
- **Especificação:** [protocolo de sincronização de time](../sincronizacao-time.md)

## Contexto

Um time pequeno quer que cada pessoa rode o próprio Paprika local, com os próprios agentes, e veja todo o
resto (pessoas e agentes) editando os mesmos workspaces, **sem servidor central**. O mantenedor já escolheu as
peças:

1. **Transporte: [Iroh](https://www.iroh.computer/)**: conexões QUIC discadas pela chave pública, hole
   punching, relays como fallback, identidades ed25519.
2. **Convergência por CRDT**, sem árbitro. O undo e os lotes precisam virar operações CRDT.
3. **Segurança:** allowlist das chaves públicas do time (arquivo de time), operações assinadas pelo autor
   (pessoa ou agente) e convite por link ou QR que expira. Papéis de aprovação ficam para depois.

Dois fatos definem como isso entra no Paprika:

- O servidor é Go (ADR 0001) e guarda as invariantes: toda mutação passa por `applyOps`, campos desconhecidos
  são recusados, dados derivados (cópias de instância, geometria de conectores, caixa de grupos) são
  recalculados pelo core.
- O Iroh é uma biblioteca Rust. Não há implementação em Go com suporte nem binding oficial para Go.

## Decisão

### 1. Ponte: um sidecar em Rust, `paprika-sync`, falando por stdio

O `paprika serve` sobe o `paprika-sync` como processo filho quando a instância pertence a um time e conversa
com ele em JSON delimitado por linha no stdin/stdout. O sidecar cuida da rede, dos documentos CRDT e das
chaves; o servidor Go continua sendo o único que escreve no SQLite e o único lugar onde `applyOps` roda.

| Opção | Por que não |
| --- | --- |
| **Processo sidecar (escolhida)** | Dois binários para compilar e distribuir. Em troca: o build Go continua Go puro (`CGO_ENABLED=0`, `modernc.org/sqlite`), uma falha na pilha de rede não derruba o canvas e o sidecar é testável sozinho. |
| Bindings iroh-ffi | Os alvos oficiais são Python, Swift, Kotlin e JavaScript. Go exigiria `uniffi-bindgen-go` (de terceiros) **e** cgo, e a superfície FFI fica atrás da API Rust. |
| Biblioteca estática Rust via cgo | Abre mão do build Go puro e da compilação cruzada, coloca um runtime Tokio dentro do processo Go e transforma todo panic do Rust em queda do servidor. |
| Reescrever o transporte em Go (quic-go) | O valor do Iroh é hole punching, relays e busca de endereço pela chave; reimplementar isso é o projeto, não uma ponte. |

Sem o binário do sidecar o servidor funciona como antes (só local); os recursos de time respondem
`sidecar not found`.

### 2. CRDT: Loro, com a árvore de nós num `LoroTree`

| | Loro 1.x | Automerge 0.12 |
| --- | --- | --- |
| Linguagem | Núcleo Rust (bindings JS/WASM, Swift) | Núcleo Rust (JS, C) |
| Árvore com movimentos concorrentes | **`LoroTree` nativo**: mover é operação CRDT, ciclos são impossíveis por construção, irmãos ordenados por índice fracionário | Sem tipo árvore; mover é apagar + inserir, então movimentos concorrentes duplicam nós e o app precisa consertar ciclos |
| Merge por campo | `LoroMap` por nó (último a escrever vence por chave) | Map por nó (igual) |
| Exportação incremental | `export(updates a partir de um version vector)`; `import` guarda mudanças fora de ordem | Equivalente |
| Metadados do blob sem importar | `decode_import_blob_meta` (quais peers o blob traz) | Precisa carregar as mudanças |

O documento do Paprika é uma árvore cuja estrutura muda o tempo todo (mover, agrupar, desagrupar, páginas),
então a árvore móvel nativa decide. Mapeamento:

- um `LoroTree` (`nodes`): um nó da árvore por nó do Paprika; pai = `parentId`, ordem entre irmãos =
  `children` / `rootIds`; o mapa de metadados do nó guarda os campos gravados (`id`, `type`, `name`,
  `fill`…), cada um uma chave separada em que o último a escrever vence;
- `LoroMap`s para o nome do documento, `tokens` e `modes`;
- **fora da sincronização:** dados derivados. Cópias de instância, `x`/`y`/`width`/`height`/`d` de conectores
  e `width`/`height` de grupos são recalculados por `applyOps` em cada peer, exatamente como localmente.

### 3. O servidor Go continua sendo a autoridade sobre a validade

- **Mudança local:** depois de cada commit (canvas, MCP, HTTP; aplicar, desfazer ou refazer) o pacote de time
  compara o documento anterior com o novo e manda os campos alterados, movimentos, criações e remoções como
  **um conjunto de mudanças**. O sidecar grava isso como **um commit Loro**. Um lote (várias chamadas MCP com
  o mesmo `batch`) já é uma transação, então vira um commit; um undo é a transação inversa, então vira um
  commit comum para frente e chega a todos os peers. O undo continua local no alcance: reverte transações
  feitas nesta instância, nunca a de um peer.
- **Mudança remota:** o sidecar importa mudanças verificadas e devolve o estado materializado do workspace.
  O Go transforma a diferença em ops `delete`, `create`, `move`, `update`, `set_tokens` e `rename_document` e
  as passa por `applyOps` numa transação, fora da pilha local de undo. Os dados derivados são recalculados
  ali, então canvas, screenshots e exportações ficam idênticos em todos os peers.
- **Merges inválidos:** duas edições concorrentes válidas podem se juntar em algo que o core recusa (por
  exemplo, um frame movido para uma página enquanto outro peer transformou o documento em frames soltos). O Go
  aplica o que dá, op por op, e informa o resto como aviso de sync; o CRDT guarda as duas edições, então a
  próxima edição que tornar o merge válido conserta. Um merge que conheça o esquema fica para depois.

### 4. Identidade, assinaturas e arquivo de time

- Cada instância tem uma chave ed25519, guardada na pasta de dados do sidecar (modo `0600`). Ela é ao mesmo
  tempo o id do endpoint Iroh e a chave de **membro** da pessoa que roda a instância.
- Cada agente local (nome do cliente MCP) recebe a própria chave, derivada da chave do membro, e um
  **certificado de delegação** assinado pelo membro. Cada conjunto de mudanças é um **envelope** `{workspace,
  autor, seq, cert?, update Loro, assinatura}` assinado pelo autor. O peer id Loro do commit vem da chave do
  autor, e quem recebe confere com `decode_import_blob_meta` que o blob só traz mudanças daquele peer, então
  um membro não consegue assinar mudanças em nome de outro.
- Os envelopes são guardados e repassados **como foram assinados**, então um peer que estava offline recebe
  a assinatura do autor original de quem a tiver. Na conexão, a anti-entropia compara números de sequência
  por autor.
- O **arquivo de time** é um conjunto que só cresce de entradas de membro, cada uma assinada por um membro
  existente (a do fundador, por ele mesmo). Ele é a allowlist: conexões Iroh de chaves fora dele são fechadas
  antes de qualquer sync, e envelopes cujo autor não se liga a ele são descartados e contados.
- **Convites:** um link `paprika://join/<time>?…` (também em QR) leva o endereço de quem convida, um segredo
  aleatório de uso único e a expiração escolhida. Quem entra disca para quem convidou num ALPN separado; quem
  convidou confere o segredo, a validade e que ele não foi usado, e assina a entrada de membro de quem entra.
  Revogar um convite apaga o segredo.

### 5. Descoberta e relays

O endpoint padrão usa os relays públicos do Iroh e a busca de endereço por DNS, que só ajudam os peers a se
acharem e levam QUIC cifrado ponta a ponta quando o hole punching falha: nunca veem o conteúdo dos documentos
e não têm autoridade. Um time pode apontar para o próprio relay. Os testes rodam com relays e busca
desligados, pelo loopback.

## Consequências

- **Trade-off material:** dois binários. Compilar o recurso de time exige o toolchain Rust; a imagem Docker e
  as releases levam o `paprika-sync` ao lado do `paprika`. Uma instância sem ele continua funcionando sozinha.
- O documento passa a existir duas vezes numa instância em time: SQLite (o que o Go serve) e o estado Loro
  com o log de envelopes (onde os peers convergem). O estado do sidecar sempre pode ser refeito a partir do
  SQLite mais o log.
- A semântica do undo só muda em time: ele reverte transações locais, e uma reversão pode falhar em parte se
  um peer apagou os nós que ela toca (informado, não silencioso).
- Remover membro e trocar chaves vieram depois (2026-11-22), como `removals`/`rotations` assinadas no arquivo
  de time com um corte por autor (`upto`), ver docs/pt-BR/sincronizacao-time.md. Papéis de aprovação ainda não
  estão cobertos.
- Presença (cursores dos agentes, pessoas online) viaja como mensagens efêmeras nas mesmas conexões e nunca é
  gravada.
