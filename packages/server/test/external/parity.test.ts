// Same scenarios as server.test.ts, but black-box: the server runs as a separate process and is
// reached only through MCP (HTTP and stdio), the WebSocket and the HTTP API. Run against the Go
// server with PAPRIKA_SERVER_BIN=server-go/bin/paprika (see server-go/README.md).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { request } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import WebSocket from "ws";
import { impl, repoRoot, startServer, waitFor, type ExternalServer } from "./harness.js";

type ToolResult = { isError?: boolean; content: { type: string; text?: string; data?: string; mimeType?: string }[] };

let srv: ExternalServer;
let client: Client;

beforeEach(async () => {
  srv = await startServer();
  client = new Client({ name: "parity", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${srv.url}/mcp`)));
});

afterEach(async () => {
  await client?.close();
  await srv?.stop();
});

const call = async (c: Client, name: string, args: Record<string, unknown> = {}) =>
  (await c.callTool({ name, arguments: args })) as ToolResult;
const textOf = (r: ToolResult) => r.content.map((c) => c.text ?? "").join("\n");

describe(`paridade (${impl}): MCP`, () => {
  it("serve o contrato MCP do servidor de referência", async () => {
    const { tools } = await client.listTools();
    const contract = JSON.parse(readFileSync(join(repoRoot, "server-go/contract/mcp.json"), "utf8"));
    expect(tools).toEqual(contract.tools);
    expect(client.getServerVersion()).toEqual(contract.serverInfo);
    expect(client.getInstructions()).toBe(contract.instructions);
  });

  it("componentes e instâncias", async () => {
    const c = client;
    await call(c, "create_nodes", {
      nodes: [
        {
          type: "frame", id: "btn", name: "Botão", x: 10, y: 10, width: 100, height: 40, fill: "#3355ff", radius: 6,
          layout: { mode: "row", gap: 4, padding: 8 },
          children: [
            { type: "text", id: "lbl", text: "OK", color: "#ffffff", width: 50, height: 20 },
            { type: "path", id: "ico", d: "M0 0 L8 8", stroke: { color: "#ffffff", width: 1.5 } },
          ],
        },
      ],
    });
    await call(c, "create_component", { id: "btn" });
    const inst = await call(c, "create_instance", { componentId: "btn", id: "i1", scale: 1.5, overrides: { lbl: { text: "Enviar" } } });
    expect(textOf(inst)).toMatchInlineSnapshot(`
      "{
        "instance": "i1",
        "copies": {
          "lbl": "i1-0bzyiqi0vw20y4",
          "ico": "i1-1qrxohh1a842nx"
        },
        "created": [
          "i1"
        ],
        "version": 3
      }"
    `);
    const outline = await call(c, "get_document_outline", {});
    expect(textOf(outline)).toMatchInlineSnapshot(`
      "documento "doc" v3 · 6 nós
      tokens: (nenhum)

      frame#btn "Botão" 100×40 @10,10 fill=#3355ff row gap=4 component
        text#lbl 50×20 @0,0 "OK" 16/400 color=#ffffff
        path#ico 8×8 @0,0 d="M0 0 L8 8" stroke=#ffffff/1.5
      frame#i1 "Botão" 150×60 @150,10 fill=#3355ff row gap=6 instanceOf=btn scale=1.5 overrides=1
        text#i1-0bzyiqi0vw20y4 75×30 @0,0 from=lbl "Enviar" 24/400 color=#ffffff
        path#i1-1qrxohh1a842nx 12×12 @0,0 from=ico d="M0 0 L8 8" stroke=#ffffff/2.25 viewBox=0,0,8,8"
    `);
    const bad = await call(c, "update_nodes", { updates: [{ id: JSON.parse(textOf(inst)).copies.lbl, props: { x: 3 } }] });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatchInlineSnapshot(`"op[0]: "i1-0bzyiqi0vw20y4" é cópia dentro da instância "i1": só fill, color, text, src, alt, visible, opacity podem ser trocados (viram overrides); edite o componente ou desanexe (detach) (recebido x)"`);
    await call(c, "update_nodes", { updates: [{ id: "lbl", props: { fontSize: 20 } }, { id: "i1", props: { fill: "#000000" } }] });
    const nodes = JSON.parse(textOf(await call(c, "get_nodes", { ids: ["i1", JSON.parse(textOf(inst)).copies.lbl] })));
    expect(nodes).toMatchInlineSnapshot(`
      [
        {
          "children": [
            "i1-0bzyiqi0vw20y4",
            "i1-1qrxohh1a842nx",
          ],
          "clip": true,
          "fill": "#000000",
          "height": 60,
          "id": "i1",
          "instanceOf": "btn",
          "layout": {
            "align": "start",
            "gap": 6,
            "justify": "start",
            "mode": "row",
            "padding": 12,
            "wrap": false,
          },
          "locked": false,
          "name": "Botão",
          "opacity": 1,
          "overrides": {
            "btn": {
              "fill": "#000000",
            },
            "lbl": {
              "text": "Enviar",
            },
          },
          "parentId": null,
          "radius": 9,
          "rotation": 0,
          "scale": 1.5,
          "type": "frame",
          "visible": true,
          "width": 150,
          "x": 150,
          "y": 10,
        },
        {
          "color": "#ffffff",
          "fontFamily": "Inter, system-ui, sans-serif",
          "fontSize": 30,
          "fontWeight": 400,
          "height": 30,
          "id": "i1-0bzyiqi0vw20y4",
          "letterSpacing": 0,
          "lineHeight": 1.4,
          "locked": false,
          "name": "",
          "opacity": 1,
          "parentId": "i1",
          "radius": 0,
          "rotation": 0,
          "sourceId": "lbl",
          "text": "Enviar",
          "textAlign": "left",
          "type": "text",
          "visible": true,
          "width": 75,
          "x": 0,
          "y": 0,
        },
      ]
    `);
    const d = await call(c, "detach_instance", { ids: ["i1"] });
    expect(textOf(d)).toMatchInlineSnapshot(`
      "{
        "detached": [
          "i1"
        ],
        "created": [],
        "version": 5
      }"
    `);
    await call(c, "undo");
    expect(textOf(await call(c, "get_document_outline", { rootId: "i1" }))).toMatchInlineSnapshot(`
      "documento "doc" v6 · 6 nós
      tokens: (nenhum)

      frame#i1 "Botão" 150×60 @150,10 fill=#000000 row gap=6 instanceOf=btn scale=1.5 overrides=2
        text#i1-0bzyiqi0vw20y4 75×30 @0,0 from=lbl "Enviar" 30/400 color=#ffffff
        path#i1-1qrxohh1a842nx 12×12 @0,0 from=ico d="M0 0 L8 8" stroke=#ffffff/2.25 viewBox=0,0,8,8"
    `);
  });

  it("grupos e páginas", async () => {
    const c = client;
    await call(c, "create_nodes", {
      nodes: [
        {
          type: "frame", id: "f", name: "Tela", width: 300, height: 200,
          children: [
            { type: "rect", id: "a", x: 10, y: 20, width: 30, height: 30, rotation: 30 },
            { type: "rect", id: "b", x: 60, y: 40, width: 30, height: 30 },
          ],
        },
      ],
    });
    const g = await call(c, "group_nodes", { ids: ["b", "a"], id: "g", name: "Par" });
    expect(textOf(g)).toBe('{\n  "group": "g",\n  "created": [\n    "g"\n  ],\n  "version": 2\n}');
    const nodes = JSON.parse(textOf(await call(c, "get_nodes", { ids: ["g", "a", "b"] })));
    expect(nodes).toMatchInlineSnapshot(`
      [
        {
          "children": [
            "a",
            "b",
          ],
          "height": 55.4904,
          "id": "g",
          "locked": false,
          "name": "Par",
          "opacity": 1,
          "parentId": "f",
          "type": "group",
          "visible": true,
          "width": 85.4904,
          "x": 4.5096,
          "y": 14.5096,
        },
        {
          "height": 30,
          "id": "a",
          "locked": false,
          "name": "",
          "opacity": 1,
          "parentId": "g",
          "radius": 0,
          "rotation": 30,
          "type": "rect",
          "visible": true,
          "width": 30,
          "x": 5.4904,
          "y": 5.4904,
        },
        {
          "height": 30,
          "id": "b",
          "locked": false,
          "name": "",
          "opacity": 1,
          "parentId": "g",
          "radius": 0,
          "rotation": 0,
          "type": "rect",
          "visible": true,
          "width": 30,
          "x": 55.4904,
          "y": 25.4904,
        },
      ]
    `);
    expect(textOf(await call(c, "group_nodes", { ids: ["g", "f"] }))).toMatch(/mesmo pai/);
    expect(JSON.parse(textOf(await call(c, "ungroup_nodes", { ids: ["g"] }))).released).toEqual(["a", "b"]);
    expect(JSON.parse(textOf(await call(c, "create_page", { id: "p2", name: "Variações" }))).page).toBe("p2");
    expect(textOf(await call(c, "create_nodes", { nodes: [{ type: "rect" }] }))).toMatch(/tem páginas/);
    await call(c, "create_nodes", { parentId: "p2", nodes: [{ type: "rect", id: "r", width: 10, height: 10 }] });
    const outline = textOf(await call(c, "get_document_outline"));
    expect(outline.split("\n").slice(3).join("\n").replace(/page#\w+ "Página 1"/, "page#P1")).toMatchInlineSnapshot(`
      "page#P1
        frame#f "Tela" 300×200 @0,0
          rect#a 30×30 @10,20
          rect#b 30×30 @60,40
      page#p2 "Variações"
        rect#r 10×10 @0,0"
    `);
    const hist = JSON.parse(textOf(await call(c, "get_history", { limit: 4 })));
    expect(hist.map((h: { label: string }) => h.label)).toEqual(["agrupar 2 nó(s)", "desagrupar 1 grupo(s)", "criar página", "criar 1 nó(s)"]);
  });

  it("fluxo completo: tokens → criar → lint → corrigir → exportar → desfazer", async () => {
    const c = client;
    await call(c, "set_tokens", { tokens: { bg: "#ffffff", ink: "#111111", faint: "#dddddd" } });
    const created = JSON.parse(
      textOf(
        await call(c, "create_nodes", {
          nodes: [
            {
              type: "frame", id: "login", name: "Login", width: 360, height: 240, fill: "$bg",
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
    expect(textOf(await call(c, "export_code", { rootId: "login", format: "react" }))).toContain("export function Login()");
    expect(textOf(await call(c, "export_code", { rootId: "login", format: "html" }))).toContain('data-paprika-id="login"');
    const undo = JSON.parse(textOf(await call(c, "undo")));
    expect(undo).toMatchObject({ undone: true, canUndo: true, canRedo: true });
    const sub = (await srv.doc()).nodes.sub!;
    expect(sub.type === "text" && sub.color).toBe("$faint");
    const hist = JSON.parse(textOf(await call(c, "get_history", { limit: 2 })));
    expect(hist).toHaveLength(2);
    expect(hist[1]).toMatchObject({ label: "criar 1 nó(s)", ops: 1 });
    expect(hist[1].actor).toMatch(/^agent:/);
  });

  it("erros voltam como isError com mensagem acionável e sem efeito colateral", async () => {
    const before = await srv.version();
    const r = await call(client, "create_nodes", { nodes: [{ type: "text", txt: "oops" }] });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe("op[0]: campos desconhecidos para text: txt");
    expect(await srv.version()).toBe(before);
    const v = await call(client, "get_nodes", { ids: [] });
    expect(textOf(v)).toBe("MCP error -32602: Input validation error: Invalid arguments for tool get_nodes: Too small: expected array to have >=1 items at ids");
    const nf = await call(client, "nope");
    expect(textOf(nf)).toBe("MCP error -32602: Tool nope not found");
    const ops = await call(client, "apply_ops", { ops: [{ op: "move", id: "x" }] });
    expect(textOf(ops)).toBe(
      "MCP error -32602: Input validation error: Invalid arguments for tool apply_ops: Invalid input: expected string, received undefined at ops[0].parentId",
    );
  });

  it("path com bezier: cria só com d, valida, mede, renderiza e exporta", async () => {
    const c = client;
    const created = JSON.parse(
      textOf(await call(c, "create_nodes", { nodes: [{ type: "path", id: "wave", d: "M0 40 C 30 -10 70 90 100 40", stroke: { color: "#c43d27", width: 4 } }] })),
    );
    expect(created.created).toEqual(["wave"]);
    const node = (await srv.doc()).nodes.wave!;
    expect(node.width).toBe(100);
    expect(node.height).toBe(55);
    const info = JSON.parse(textOf(await call(c, "path_info", { id: "wave" })));
    expect(info).toMatchObject({ segments: 2, curves: 1, closed: false });
    expect(info.bounds.y).toBeGreaterThan(10);
    const bad = await call(c, "create_nodes", { nodes: [{ type: "path", d: "M0 0 C 10 10 20" }] });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/d inválido: número esperado na posição \d+/);
    expect(textOf(await call(c, "lint_design", {}))).not.toMatch(/invisible-path/);
    const tsx = textOf(await call(c, "export_code", { rootId: "wave", format: "react" }));
    expect(tsx).toContain('<path d="M0 40 C 30 -10 70 90 100 40" fill="none"');
    expect(tsx).toContain("strokeWidth={4}");
    await call(c, "undo");
    expect((await srv.doc()).nodes.wave).toBeUndefined();
  });

  it("render_screenshot devolve PNG no tamanho pedido", async () => {
    await call(client, "create_nodes", { nodes: [{ type: "rect", id: "r", width: 50, height: 40, fill: "#ff278c" }] });
    const r = await call(client, "render_screenshot", { rootId: "r", scale: 2 });
    expect(r.isError, textOf(r)).toBeFalsy();
    const img = r.content.find((x) => x.type === "image");
    expect(img?.mimeType).toBe("image/png");
    const png = Buffer.from(img!.data!, "base64");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(100);
    expect(png.readUInt32BE(20)).toBe(80);
    expect(textOf(r)).toContain("100×80px");
  }, 30_000);

  it("MCP via stdio enxerga as mudanças do servidor HTTP", async () => {
    await call(client, "create_nodes", { nodes: [{ type: "rect", id: "viaHttp", name: "do HTTP" }] });
    const stdio = new Client({ name: "parity-stdio", version: "0" });
    await stdio.connect(new StdioClientTransport({ ...srv.stdioCommand(), stderr: "pipe" }));
    try {
      expect(textOf(await call(stdio, "find_nodes", { name: "do http" }))).toContain("rect#viaHttp");
      await call(stdio, "update_nodes", { updates: [{ id: "viaHttp", props: { name: "do stdio" } }] });
      // Each process reloads what the other one committed (file watch in TS, SQLite in Go).
      await waitFor(async () => (await srv.doc()).nodes.viaHttp?.name === "do stdio");
    } finally {
      await stdio.close();
    }
  }, 30_000);
});

describe(`paridade (${impl}): HTTP + WebSocket`, () => {
  it("agente via MCP HTTP e canvas via WS veem as mesmas mudanças", async () => {
    const ws = new WebSocket(`${srv.url.replace("http", "ws")}/ws`, { headers: { origin: srv.url } });
    const messages: { type: string; doc?: { nodes: Record<string, unknown> }; actor?: string; kind?: string; reqId?: string; message?: string }[] = [];
    ws.on("message", (m) => messages.push(JSON.parse(String(m))));
    await new Promise((ok) => ws.once("open", ok));
    await waitFor(() => messages.length > 0);
    expect(messages[0]).toMatchObject({ type: "doc", actor: "server", kind: "reload", canUndo: false, canRedo: false });

    await client.callTool({ name: "create_nodes", arguments: { nodes: [{ type: "rect", id: "fromAgent" }] } });
    await waitFor(() => messages.some((m) => m.type === "doc" && !!m.doc?.nodes.fromAgent));
    expect(messages.at(-1)?.actor).toMatch(/^agent:/);

    ws.send(JSON.stringify({ type: "ops", reqId: "1", ops: [{ op: "update", id: "fromAgent", props: { name: "Movido pelo humano" } }] }));
    await waitFor(() => messages.some((m) => m.type === "ack" && m.reqId === "1"));
    const r = (await client.callTool({ name: "get_nodes", arguments: { ids: ["fromAgent"] } })) as ToolResult;
    expect(textOf(r)).toContain("Movido pelo humano");

    ws.send(JSON.stringify({ type: "ops", reqId: "2", ops: [{ op: "delete", id: "nao-existe" }] }));
    await waitFor(() => messages.some((m) => m.type === "error"));
    expect(messages.find((m) => m.type === "error")).toEqual({ type: "error", reqId: "2", message: 'op[0]: nó "nao-existe" não existe' });

    ws.send(JSON.stringify({ type: "undo", reqId: "3" }));
    await waitFor(() => messages.some((m) => m.type === "ack" && m.reqId === "3"));
    expect(messages.filter((m) => m.type === "doc").at(-1)?.kind).toBe("undo");
    ws.close();
  });

  it("API HTTP: documento, ops, render e erros", async () => {
    const post = (body: unknown) =>
      fetch(`${srv.url}/api/ops`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const ok = await post({ ops: [{ op: "create", node: { type: "rect", id: "api1" } }], actor: "script" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ created: ["api1"] });
    const bad = await post({ ops: [{ op: "delete", id: "nope" }] });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toEqual({ error: 'op[0]: nó "nope" não existe' });
    const invalid = await post({ ops: [] });
    expect(invalid.status).toBe(400);
    expect(JSON.parse((await invalid.json()).error)[0].message).toBe("Too small: expected array to have >=1 items");
    const html = await (await fetch(`${srv.url}/api/render?root=api1`)).text();
    expect(html).toContain('data-paprika-id="api1"');
    expect((await srv.doc()).nodes.api1).toBeDefined();
    const health = await (await fetch(`${srv.url}/api/health`)).json();
    expect(health.ok).toBe(true);
  });

  it("bloqueia Host/Origin externos (DNS rebinding / CSRF)", async () => {
    const port = Number(new URL(srv.url).port);
    expect(await status(port, { host: `evil.example:${port}` })).toBe(403);
    expect(await status(port, { host: `127.0.0.1:${port}`, origin: "https://evil.example" })).toBe(403);
    expect(await status(port, { host: `127.0.0.1:${port}` })).toBe(200);
    const ws = new WebSocket(`${srv.url.replace("http", "ws")}/ws`, { headers: { origin: "https://evil.example" } });
    const code = await new Promise<number>((ok) => ws.once("unexpected-response", (_req, res) => ok(res.statusCode ?? 0)));
    expect(code).toBe(403);
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
