import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import WebSocket from "ws";
import { DocumentStore, closeBrowser, createMcpServer, startHttpServer, type RunningServer } from "../src/index.js";

type ToolResult = { isError?: boolean; content: { type: string; text?: string; data?: string; mimeType?: string }[] };

let dir: string;
let store: DocumentStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "paprika-"));
  store = await DocumentStore.open(join(dir, "t.paprika.json"));
});

afterEach(async () => {
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

afterAll(async () => {
  await closeBrowser();
});

async function connect(): Promise<Client> {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(store, { actor: "agent:test" });
  await server.connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  return client;
}

const call = async (c: Client, name: string, args: Record<string, unknown> = {}) =>
  (await c.callTool({ name, arguments: args })) as ToolResult;
const textOf = (r: ToolResult) => r.content.map((c) => c.text ?? "").join("\n");

describe("MCP", () => {
  it("expõe as ferramentas esperadas com JSON Schema válido", async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "apply_ops",
        "create_nodes",
        "delete_nodes",
        "export_code",
        "find_nodes",
        "get_design_guide",
        "get_document_outline",
        "get_history",
        "get_nodes",
        "lint_design",
        "move_nodes",
        "redo",
        "render_screenshot",
        "set_tokens",
        "undo",
        "update_nodes",
      ].sort(),
    );
    for (const t of tools) expect(t.inputSchema.type).toBe("object");
  });

  it("fluxo completo: tokens → criar → lint → corrigir → exportar → desfazer", async () => {
    const c = await connect();
    await call(c, "set_tokens", { tokens: { bg: "#ffffff", ink: "#111111", faint: "#dddddd" } });
    const created = JSON.parse(
      textOf(
        await call(c, "create_nodes", {
          nodes: [
            {
              type: "frame",
              id: "login",
              name: "Login",
              width: 360,
              height: 240,
              fill: "$bg",
              layout: { mode: "column", gap: 12, padding: 24 },
              children: [
                { type: "text", id: "h", text: "Entrar", fontSize: 24, fontWeight: 700, color: "$ink", width: "fill", height: "hug" },
                { type: "text", id: "sub", text: "Use seu e-mail", color: "$faint", width: "fill", height: "hug" },
              ],
            },
          ],
        }),
      ),
    );
    expect(created.created).toEqual(["login", "h", "sub"]);

    const lint1 = JSON.parse(textOf(await call(c, "lint_design")));
    expect(lint1.ok).toBe(false);
    expect(lint1.issues.find((i: { rule: string }) => i.rule === "contrast").nodeId).toBe("sub");

    await call(c, "update_nodes", { updates: [{ id: "sub", props: { color: "$ink" } }] });
    expect(JSON.parse(textOf(await call(c, "lint_design"))).ok).toBe(true);

    const outline = textOf(await call(c, "get_document_outline"));
    expect(outline).toContain('frame#login "Login" 360×240');
    expect(outline).toContain("$ink=#111111");

    const tsx = textOf(await call(c, "export_code", { rootId: "login", format: "react" }));
    expect(tsx).toContain("export function Login()");

    await call(c, "undo");
    expect(store.doc.nodes.sub?.type === "text" && store.doc.nodes.sub.color).toBe("$faint");

    const saved = JSON.parse(await readFile(store.file, "utf8"));
    expect(saved.nodes.login.name).toBe("Login");
  });

  it("erros voltam como isError com mensagem acionável e sem efeito colateral", async () => {
    const c = await connect();
    const before = store.version;
    const r = await call(c, "create_nodes", { nodes: [{ type: "text", txt: "oops" }] });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/campos desconhecidos para text: txt/);
    expect(store.version).toBe(before);
  });

  it("render_screenshot devolve PNG", async () => {
    const c = await connect();
    await call(c, "create_nodes", { nodes: [{ type: "rect", id: "r", width: 50, height: 40, fill: "#ff278c" }] });
    const r = await call(c, "render_screenshot", { rootId: "r", scale: 2 });
    expect(r.isError).toBeFalsy();
    const img = r.content.find((x) => x.type === "image");
    expect(img?.mimeType).toBe("image/png");
    const png = Buffer.from(img!.data!, "base64");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(100);
    expect(png.readUInt32BE(20)).toBe(80);
  }, 30_000);
});

describe("HTTP + WebSocket", () => {
  let http: RunningServer;
  beforeEach(async () => {
    http = await startHttpServer(store, { host: "127.0.0.1", port: 0 });
  });
  afterEach(async () => {
    await http.close();
  });

  it("agente via MCP HTTP e canvas via WS veem as mesmas mudanças", async () => {
    const ws = new WebSocket(`${http.url.replace("http", "ws")}/ws`, { headers: { origin: http.url } });
    const messages: { type: string; doc?: { nodes: Record<string, unknown> }; actor?: string }[] = [];
    ws.on("message", (m) => messages.push(JSON.parse(String(m))));
    await new Promise((ok) => ws.once("open", ok));

    const client = new Client({ name: "http-test", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${http.url}/mcp`)));
    await client.callTool({ name: "create_nodes", arguments: { nodes: [{ type: "rect", id: "fromAgent" }] } });

    await waitFor(() => messages.some((m) => m.type === "doc" && m.doc?.nodes.fromAgent));
    expect(messages.at(-1)?.actor).toMatch(/^agent:/);

    ws.send(JSON.stringify({ type: "ops", reqId: "1", ops: [{ op: "update", id: "fromAgent", props: { name: "Movido pelo humano" } }] }));
    await waitFor(() => messages.some((m) => m.type === "ack"));
    const r = (await client.callTool({ name: "get_nodes", arguments: { ids: ["fromAgent"] } })) as ToolResult;
    expect(textOf(r)).toContain("Movido pelo humano");

    ws.send(JSON.stringify({ type: "ops", reqId: "2", ops: [{ op: "delete", id: "nao-existe" }] }));
    await waitFor(() => messages.some((m) => m.type === "error"));

    await client.close();
    ws.close();
  });

  it("bloqueia Host/Origin externos (DNS rebinding / CSRF)", async () => {
    const port = Number(new URL(http.url).port);
    expect(await status(port, { host: `evil.example:${port}` })).toBe(403);
    expect(await status(port, { host: `127.0.0.1:${port}`, origin: "https://evil.example" })).toBe(403);
    expect(await status(port, { host: `127.0.0.1:${port}` })).toBe(200);
  });

  it("recarrega quando o arquivo é alterado externamente", async () => {
    const raw = JSON.parse(await readFile(store.file, "utf8"));
    raw.name = "Editado à mão";
    await writeFile(store.file, JSON.stringify(raw));
    await store.reloadIfChanged();
    expect(store.doc.name).toBe("Editado à mão");
  });
});

function status(port: number, headers: Record<string, string>): Promise<number> {
  return new Promise((ok, fail) => {
    const req = request({ host: "127.0.0.1", port, path: "/api/health", headers }, (res) => {
      res.resume();
      ok(res.statusCode ?? 0);
    });
    req.on("error", fail);
    req.end();
  });
}

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("timeout esperando condição");
    await new Promise((r) => setTimeout(r, 20));
  }
}
