🇺🇸 English | [🇧🇷 Português](../pt-BR/conectar-agente.md)

# Connect your agent

Paprika gives your agent its own set of tools over [MCP](https://modelcontextprotocol.io), the protocol most AI agents use to talk to other programs. Once connected, the agent draws on the same canvas you have open in the browser.

Start Paprika first: [Install with Docker](install.md).

## Claude Code

```bash
claude mcp add --transport http paprika http://localhost:4777/mcp
```

Start a new session if the tools don't show up right away.

## Other agents

Add an MCP server of type "HTTP" (sometimes called "streamable HTTP") with the address `http://localhost:4777/mcp`. For agents that only speak stdio, see [MCP tools and file format](mcp.md#connecting-an-agent).

## Ask for a first design

Try something like *"Use Paprika to design a sign-up screen for a coffee shop app."* You'll see the agent's cursor, with its name, moving on the canvas while it works. You can fix anything by hand, and undo works for both of you.

## Or let your agent set everything up

Copy this prompt into an agent that can run terminal commands, such as Claude Code. It installs Paprika, connects itself and draws a welcome frame.

```text
Please set up Paprika for me, a local design tool for AI agents
(https://github.com/leonardo-moraes360/paprika).

1. Check that Docker and Docker Compose are installed and running. If they
   aren't, stop and tell me how to install them; don't install anything
   without asking me first.
2. Clone the repository into a folder of my choice (ask me; default to
   ~/paprika) and run `docker compose up -d --build` inside it. The first
   build can take a few minutes.
3. Wait until http://localhost:4777/api/workspaces answers, then tell me to
   open http://localhost:4777 in my browser.
4. Add Paprika to yourself as an MCP server over HTTP at
   http://localhost:4777/mcp. In Claude Code:
   claude mcp add --transport http paprika http://localhost:4777/mcp
   If you need a restart or a new session to see the new tools, tell me.
5. Once the tools show up, call `get_design_guide`, then draw a small welcome
   frame on the canvas so I can see it working.

If something fails, show me the error and what you'd suggest. Keep host port
4777: the server only accepts that port.
```

## Next steps

- Every tool the agent gets, and the document format: [MCP tools and file format](mcp.md).
- Point at something on the canvas for the agent to fix: [Using the canvas](canvas.md).
