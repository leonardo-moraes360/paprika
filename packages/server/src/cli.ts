#!/usr/bin/env node
import { parseArgs } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DocumentStore } from "./store.js";
import { createMcpServer, VERSION } from "./mcp.js";
import { startHttpServer, type RunningServer } from "./http.js";
import { closeBrowser } from "./screenshot.js";

const HELP = `paprika ${VERSION}: ferramenta de design local para agentes de IA, com MCP embutido.

Uso:
  paprika serve [--file design.paprika.json] [--port 4777] [--host 127.0.0.1]
      Canvas em http://host:port, MCP Streamable HTTP em /mcp, sync ao vivo em /ws.
  paprika mcp [--file design.paprika.json] [--port 4777] [--no-ui]
      MCP via stdio (para agentes que só falam stdio). Sobe o canvas na porta, se livre.

Opções:
  -f, --file    Arquivo do documento (criado se não existir). Padrão: ./design.paprika.json
                Os outros *.paprika.json da mesma pasta são os workspaces da página inicial.
  -p, --port    Porta HTTP. Padrão: 4777 (0 = aleatória)
      --host    Interface de bind. Padrão: 127.0.0.1. Expor fora do loopback não tem autenticação.
      --no-ui   (mcp) não sobe o canvas HTTP
  -h, --help
`;

function webRoot(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [process.env.PAPRIKA_WEB_ROOT, resolve(here, "../../../apps/web/dist"), resolve(here, "../web")];
  return candidates.find((c): c is string => !!c && existsSync(c));
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      file: { type: "string", short: "f", default: "design.paprika.json" },
      port: { type: "string", short: "p", default: "4777" },
      host: { type: "string", default: "127.0.0.1" },
      "no-ui": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });
  const cmd = positionals[0];
  if (values.version) return void console.log(VERSION);
  if (values.help || !cmd || !["serve", "mcp"].includes(cmd)) {
    process.stdout.write(HELP);
    process.exitCode = values.help ? 0 : 2;
    return;
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`porta inválida: ${values.port}`);
  // Em modo stdio, stdout é o canal MCP: todo log vai para stderr.
  const log = (m: string) => process.stderr.write(`[paprika] ${m}\n`);
  const file = resolve(values.file);
  const store = await DocumentStore.open(file);
  store.on("error", (e) => log(e.message));
  log(`documento: ${file}`);

  let http: RunningServer | undefined;
  const startUi = async () => {
    http = await startHttpServer(store, { host: values.host, port, webRoot: webRoot(), log });
    log(`canvas: ${http.url}  ·  MCP HTTP: ${http.url}/mcp`);
  };

  const shutdown = async () => {
    await http?.close();
    await closeBrowser();
    await store.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  if (cmd === "serve") {
    if (values.host !== "127.0.0.1" && values.host !== "localhost") log("AVISO: exposto fora do loopback e sem autenticação.");
    await startUi();
    return;
  }

  if (!values["no-ui"]) {
    await startUi().catch((e: NodeJS.ErrnoException) =>
      log(e.code === "EADDRINUSE" ? `porta ${port} ocupada; seguindo sem canvas (o arquivo continua sincronizado)` : `canvas indisponível: ${e.message}`),
    );
  }
  const mcp = createMcpServer(store, { actor: "agent:stdio" });
  await mcp.connect(new StdioServerTransport());
  process.stdin.on("close", () => void shutdown());
}

main().catch((e: Error) => {
  process.stderr.write(`[paprika] erro: ${e.message}\n`);
  process.exit(1);
});
