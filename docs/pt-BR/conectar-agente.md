[🇺🇸 English](../en-US/connect-agent.md) | 🇧🇷 Português

# Conectar o seu agente

O Paprika dá ao seu agente um conjunto de ferramentas próprio pelo [MCP](https://modelcontextprotocol.io), o protocolo que a maioria dos agentes de IA usa para conversar com outros programas. Depois de conectado, o agente desenha no mesmo canvas que você tem aberto no navegador.

Suba o Paprika antes: [Instalar com Docker](instalar.md).

## Claude Code

```bash
claude mcp add --transport http paprika http://localhost:4777/mcp
```

Abra uma sessão nova se as ferramentas não aparecerem na hora.

## Outros agentes

Adicione um servidor MCP do tipo "HTTP" (às vezes chamado de "streamable HTTP") com o endereço `http://localhost:4777/mcp`. Para agentes que só falam stdio, veja [Ferramentas MCP e formato](mcp.md#conectar-um-agente).

## Peça um primeiro design

Tente algo como *"Use o Paprika para desenhar uma tela de cadastro para um app de cafeteria."* Você vai ver o cursor do agente, com o nome dele, se mexendo no canvas enquanto ele trabalha. Você pode ajustar qualquer coisa com as próprias mãos, e o desfazer vale para os dois.

## Ou deixe o agente configurar tudo

Cole este prompt num agente que consiga rodar comandos no terminal, como o Claude Code. Ele instala o Paprika, se conecta e desenha um frame de boas-vindas.

```text
Por favor, configure o Paprika para mim, uma ferramenta de design local para
agentes de IA (https://github.com/leonardo-moraes360/paprika).

1. Confira se o Docker e o Docker Compose estão instalados e rodando. Se não
   estiverem, pare e me diga como instalar; não instale nada sem me perguntar
   antes.
2. Clone o repositório numa pasta que eu escolher (me pergunte; o padrão é
   ~/paprika) e rode `docker compose up -d --build` dentro dela. O primeiro
   build pode levar alguns minutos.
3. Espere até http://localhost:4777/api/workspaces responder e então me diga
   para abrir http://localhost:4777 no navegador.
4. Adicione o Paprika a você mesmo como servidor MCP por HTTP em
   http://localhost:4777/mcp. No Claude Code:
   claude mcp add --transport http paprika http://localhost:4777/mcp
   Se precisar reiniciar ou abrir uma sessão nova para ver as ferramentas,
   me avise.
5. Quando as ferramentas aparecerem, chame `get_design_guide` com
   `language: "pt-BR"` e desenhe um pequeno frame de boas-vindas no canvas
   para eu ver funcionando.

Se algo falhar, me mostre o erro e o que você sugere. Mantenha a porta 4777 no
host: o servidor só aceita essa porta.
```

## Próximos passos

- Todas as ferramentas que o agente ganha e o formato do documento: [Ferramentas MCP e formato](mcp.md).
- Aponte algo no canvas para o agente corrigir: [Usando o canvas](canvas.md).
