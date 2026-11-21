[🇺🇸 English](SECURITY.md) | 🇧🇷 Português

# Política de segurança

## Versões suportadas

O Paprika está antes da 1.0 (`0.x`). Só o commit mais recente da `main` recebe correções de segurança; ainda não há branches de release mantidas.

| Versão | Suportada |
|---|---|
| `main` | ✅ |
| qualquer anterior | ❌ |

## Como reportar uma vulnerabilidade

**Não abra issue, discussão ou pull request público para um problema de segurança.**

Reporte de forma privada pelo **Private Vulnerability Reporting** do GitHub:

1. Abra a [aba Security](https://github.com/leonardo-moraes360/paprika/security) do repositório.
2. Clique em **Report a vulnerability** (ou abra [um novo rascunho de advisory](https://github.com/leonardo-moraes360/paprika/security/advisories/new) direto).
3. Preencha o formulário. O relato fica visível só para você e para o mantenedor.

Um bom relato traz:

- o componente afetado (`packages/server`, `server-go`, `packages/core`, `apps/web`, `experiments/…`) e o commit;
- como o Paprika foi iniciado (comando, flags como `--host`, MCP por stdio ou HTTP);
- passos para reproduzir ou uma prova de conceito;
- o impacto esperado (o que o atacante ganha e de onde: mesma máquina, rede local, uma página aberta no navegador, um documento malicioso, um cliente MCP).

## O que esperar

Este é um projeto open source pessoal, mantido no melhor esforço. As metas são:

- confirmação de recebimento em até **7 dias**;
- avaliação inicial (aceito, precisa de mais informação ou fora do escopo) em até **14 dias**;
- correção, ou mitigação documentada, assim que possível para relatos aceitos, combinada com você antes de qualquer publicação.

Depois da correção, o problema é divulgado por um GitHub Security Advisory. Você recebe o crédito, a menos que prefira o contrário.

## Modelo de ameaça e escopo

O Paprika é uma ferramenta **local**. As premissas do design são:

- O servidor faz bind em `127.0.0.1` por padrão e valida os cabeçalhos `Host` e `Origin` para bloquear DNS rebinding e CSRF de páginas abertas no navegador.
- **Não há autenticação**. Quem alcança a porta lê e edita o documento.
- Clientes MCP (agentes) são confiáveis para editar o documento, mas a entrada deles é validada (schemas zod no TypeScript, checagens equivalentes no Go) e toda escrita é uma transação atômica.
- O screenshot roda um Chromium headless que baixa as imagens `https://` referenciadas no documento.

**Dentro do escopo**, por exemplo:

- contornar as checagens de Host/Origin, ou alcançar o servidor a partir de uma página web ou de outra origem;
- um `.paprika.json`, chamada MCP ou mensagem WebSocket forjada que leve a execução de código, acesso a arquivos fora do documento/banco, injeção de script no canvas ou no HTML/TSX exportado, ou a um crash que corrompa dados;
- path traversal ou escrita arbitrária de arquivos na CLI, no `import`/`export` ou no store;
- SSRF ou leitura de arquivos locais pelo pipeline de screenshot além do download documentado de imagens `https://`;
- SQL injection ou corrupção de dados no armazenamento SQLite do servidor Go.

**Fora do escopo**:

- qualquer coisa que exija rodar com `--host 0.0.0.0` (ou outro endereço fora do loopback) em rede não confiável: isso está documentado como inseguro;
- um atacante que já controla sua conta de usuário, a configuração do cliente MCP ou os arquivos em disco;
- negação de serviço por documentos enormes enviados por um cliente local confiável;
- código em `experiments/`, que não é distribuído nem ligado ao app (relatos são bem-vindos, tratados no melhor esforço);
- vulnerabilidades em dependências de terceiros sem impacto demonstrado no Paprika: reporte essas no projeto de origem.

## Porto seguro

Pesquisa de boa-fé que siga esta política, fique na sua própria máquina e nos seus dados e dê um prazo razoável para correção antes da divulgação não será perseguida nem denunciada pelo mantenedor.
