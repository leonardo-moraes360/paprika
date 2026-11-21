import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Op, renderHTML } from "@paprika/core";
import { z } from "zod";
import type { DocumentStore, ChangeEvent } from "./store.js";
import { createMcpServer } from "./mcp.js";
import { screenshot } from "./screenshot.js";

export interface HttpOptions {
  host: string;
  port: number;
  /** Diretório com o build do canvas (apps/web/dist). */
  webRoot?: string;
  log?: (msg: string) => void;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

const MAX_BODY = 8 * 1024 * 1024;

/** Mensagens do canvas para o servidor via WebSocket. */
const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ops"), ops: z.array(Op).min(1), label: z.string().max(200).optional(), reqId: z.string().optional() }),
  z.object({ type: z.literal("undo"), reqId: z.string().optional() }),
  z.object({ type: z.literal("redo"), reqId: z.string().optional() }),
]);

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/**
 * Proteção contra DNS rebinding e CSRF: com bind em loopback, só aceita Host/Origin locais.
 * Ao expor em outra interface (--host), o próprio host configurado também é aceito.
 */
export function allowedRequest(req: IncomingMessage, bindHost: string, port: number): boolean {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  if (!isLoopbackHost(bindHost)) allowedHosts.add(`${bindHost}:${port}`);
  const host = req.headers.host;
  if (!host || !allowedHosts.has(host)) return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (!allowedHosts.has(new URL(origin).host)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw Object.assign(new Error("corpo excede 8 MiB"), { status: 413 });
    chunks.push(c as Buffer);
  }
  if (!size) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("JSON inválido"), { status: 400 });
  }
}

function send(res: ServerResponse, status: number, body: unknown, type = "application/json"): void {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(payload);
}

export interface RunningServer {
  server: Server;
  url: string;
  close(): Promise<void>;
}

export async function startHttpServer(store: DocumentStore, opts: HttpOptions): Promise<RunningServer> {
  const log = opts.log ?? (() => {});
  const webRoot = opts.webRoot && existsSync(opts.webRoot) ? resolve(opts.webRoot) : undefined;
  const sockets = new Set<WebSocket>();

  const broadcast = (e: ChangeEvent) => {
    const msg = JSON.stringify({ type: "doc", doc: e.doc, version: e.version, actor: e.actor, label: e.label, kind: e.kind, canUndo: store.canUndo, canRedo: store.canRedo });
    for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(msg);
  };
  store.on("change", broadcast);

  const handleMcp = async (req: IncomingMessage, res: ServerResponse) => {
    // Modo stateless: um servidor MCP + transporte por requisição (sem sessão a vazar).
    const body = req.method === "POST" ? await readBody(req) : undefined;
    const mcp = createMcpServer(store, { actor: `agent:${String(req.headers["user-agent"] ?? "http").split("/")[0]}` });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  };

  const serveStatic = async (pathname: string, res: ServerResponse) => {
    if (!webRoot) {
      send(res, 200, `<!doctype html><meta charset="utf-8"><title>Paprika</title><p>Canvas não compilado. Rode <code>pnpm build</code>. MCP ativo em <code>/mcp</code>.</p>`, MIME[".html"]);
      return;
    }
    const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
    let file = resolve(webRoot, rel || "index.html");
    if (file !== webRoot && !file.startsWith(webRoot + sep)) return send(res, 403, { error: "caminho proibido" });
    if (!existsSync(file) || (await stat(file)).isDirectory()) file = join(webRoot, "index.html");
    const data = await readFile(file);
    send(res, 200, data, MIME[extname(file)] ?? "application/octet-stream");
  };

  const server = createServer((req, res) => {
    void (async () => {
      if (!allowedRequest(req, opts.host, opts.port)) return send(res, 403, { error: "Host/Origin não permitido" });
      const url = new URL(req.url ?? "/", "http://local");
      const p = url.pathname;
      if (p === "/mcp") return handleMcp(req, res);
      if (p === "/api/health") return send(res, 200, { ok: true, version: store.version, file: store.file });
      if (p === "/api/document" && req.method === "GET") return send(res, 200, { doc: store.doc, version: store.version });
      if (p === "/api/ops" && req.method === "POST") {
        const body = z.object({ ops: z.array(Op).min(1), label: z.string().optional(), actor: z.string().max(100).optional() }).safeParse(await readBody(req));
        if (!body.success) return send(res, 400, { error: body.error.message });
        try {
          const r = store.apply(body.data.ops, body.data.actor ?? "api", body.data.label ?? "");
          return send(res, 200, { created: r.created, version: store.version });
        } catch (e) {
          return send(res, 422, { error: (e as Error).message });
        }
      }
      if (p === "/api/render" && req.method === "GET") {
        const rootId = url.searchParams.get("root") ?? undefined;
        return send(res, 200, renderHTML(store.doc, { rootId }).html, MIME[".html"]);
      }
      if (p === "/api/screenshot" && req.method === "GET") {
        const rootId = url.searchParams.get("root") ?? undefined;
        const shot = await screenshot(store.doc, { rootId, scale: Number(url.searchParams.get("scale") ?? 1) || 1 });
        return send(res, 200, shot.png, "image/png");
      }
      if (req.method === "GET") return serveStatic(p, res);
      send(res, 405, { error: "método não permitido" });
    })().catch((e: Error & { status?: number }) => {
      log(`erro HTTP: ${e.message}`);
      if (!res.headersSent) send(res, e.status ?? 500, { error: e.message });
      else res.end();
    });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (url.pathname !== "/ws" || !allowedRequest(req, opts.host, opts.port)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      ws.on("close", () => sockets.delete(ws));
      ws.send(JSON.stringify({ type: "doc", doc: store.doc, version: store.version, actor: "server", label: "", kind: "reload", canUndo: store.canUndo, canRedo: store.canRedo }));
      ws.on("message", (raw) => {
        let reqId: string | undefined;
        try {
          const msg = ClientMessage.parse(JSON.parse(String(raw)));
          reqId = msg.reqId;
          if (msg.type === "ops") store.apply(msg.ops, "user", msg.label ?? "");
          else if (msg.type === "undo") store.undo("user");
          else store.redo("user");
          if (reqId) ws.send(JSON.stringify({ type: "ack", reqId, version: store.version }));
        } catch (e) {
          ws.send(JSON.stringify({ type: "error", reqId, message: (e as Error).message }));
        }
      });
    });
  });

  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(opts.port, opts.host, () => {
      server.off("error", fail);
      ok();
    });
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : opts.port;
  opts.port = port;
  const hostForUrl = opts.host.includes(":") ? `[${opts.host}]` : opts.host;
  return {
    server,
    url: `http://${hostForUrl}:${port}`,
    close: async () => {
      store.off("change", broadcast);
      for (const ws of sockets) ws.terminate();
      wss.close();
      await new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}
