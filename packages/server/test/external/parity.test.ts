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
      "document "doc" v3 · 6 nodes
      tokens: (none)

      frame#btn "Botão" 100×40 @10,10 fill=#3355ff row gap=4 component
        text#lbl 50×20 @0,0 "OK" 16/400 color=#ffffff
        path#ico 8×8 @0,0 d="M0 0 L8 8" stroke=#ffffff/1.5
      frame#i1 "Botão" 150×60 @150,10 fill=#3355ff row gap=6 instanceOf=btn scale=1.5 overrides=1
        text#i1-0bzyiqi0vw20y4 75×30 @0,0 from=lbl "Enviar" 24/400 color=#ffffff
        path#i1-1qrxohh1a842nx 12×12 @0,0 from=ico d="M0 0 L8 8" stroke=#ffffff/2.25 viewBox=0,0,8,8"
    `);
    const bad = await call(c, "update_nodes", { updates: [{ id: JSON.parse(textOf(inst)).copies.lbl, props: { x: 3 } }] });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatchInlineSnapshot(`"op[0]: "i1-0bzyiqi0vw20y4" is a copy inside the instance "i1": only fill, color, text, src, alt, visible, opacity can change (they become overrides); edit the component or detach it (got x)"`);
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
      "document "doc" v6 · 6 nodes
      tokens: (none)

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
    expect(textOf(await call(c, "group_nodes", { ids: ["g", "f"] }))).toMatch(/same parent/);
    expect(JSON.parse(textOf(await call(c, "ungroup_nodes", { ids: ["g"] }))).released).toEqual(["a", "b"]);
    expect(JSON.parse(textOf(await call(c, "create_page", { id: "p2", name: "Variações" }))).page).toBe("p2");
    expect(textOf(await call(c, "create_nodes", { nodes: [{ type: "rect" }] }))).toMatch(/has pages/);
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
    expect(hist.map((h: { label: string }) => h.label)).toEqual(["group 2 node(s)", "ungroup 1 group(s)", "create page", "create 1 node(s)"]);
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
    expect(hist[1]).toMatchObject({ label: "create 1 node(s)", ops: 1 });
    expect(hist[1].actor).toMatch(/^agent:/);
  });

  it("erros voltam como isError com mensagem acionável e sem efeito colateral", async () => {
    const before = await srv.version();
    const r = await call(client, "create_nodes", { nodes: [{ type: "text", txt: "oops" }] });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe("op[0]: unknown fields for text: txt");
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
    expect(textOf(bad)).toMatch(/invalid d: number expected at position \d+/);
    expect(textOf(await call(c, "lint_design", {}))).not.toMatch(/invisible-path/);
    const tsx = textOf(await call(c, "export_code", { rootId: "wave", format: "react" }));
    expect(tsx).toContain('<path d="M0 40 C 30 -10 70 90 100 40" fill="none"');
    expect(tsx).toContain("strokeWidth={4}");
    await call(c, "undo");
    expect((await srv.doc()).nodes.wave).toBeUndefined();
  });

  it("diagramas: draw_diagram, setas que seguem a forma, export SVG medido e undo", async () => {
    const c = client;
    const r = (await c.callTool({
      name: "draw_diagram",
      arguments: {
        nodes: [{ id: "start", text: "Start", shape: "ellipse" }, { id: "ok", text: "OK?", shape: "diamond" }, { id: "memo", text: "Note", shape: "note", x: 500, y: 0 }],
        edges: [{ from: "start", to: "ok" }, { from: "memo", to: "ok", route: "straight", dashed: true, startArrow: "arrow" }],
      },
    })) as ToolResult & { structuredContent?: unknown };
    expect(r.structuredContent).toEqual({ nodes: ["start", "ok", "memo"], edges: ["start-to-ok", "memo-to-ok"], created: ["start", "ok", "memo", "start-to-ok", "memo-to-ok"], version: 1 });
    await call(c, "update_nodes", { updates: [{ id: "ok", props: { x: 200.5 } }] });
    const doc = await srv.doc();
    expect(doc.nodes["start-to-ok"]).toMatchObject({ x: 158, y: 38, d: "M2 2 L22.25 2 L22.25 146 L42.5 146 M30.5 152 L42.5 146 L30.5 140" });
    expect(textOf(await call(c, "get_document_outline"))).toContain("connector#memo-to-ok");
    const svg = textOf(await call(c, "export_code", { rootId: "memo", format: "svg" }));
    expect(svg).toContain(">Note</tspan>");
    const bad = await call(c, "draw_diagram", { nodes: [{ id: "x" }], edges: [{ from: "x", to: "nope" }] });
    expect(textOf(bad)).toBe('edges[0]: "nope" is neither a diagram node nor an existing node');
    await call(c, "undo");
    await call(c, "undo");
    expect(Object.keys((await srv.doc()).nodes)).toEqual([]);
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

  it("importar SVG/HTML e exportar SVG", async () => {
    const c = client;
    const svg = await call(c, "import_svg", {
      svg: '<svg viewBox="0 0 24 24" width="48" height="48"><title>Ícone</title><g fill="#c43d27" transform="rotate(10 12 12)"><rect x="2" y="2" width="20" height="20" rx="4"/><circle cx="12" cy="12" r="4" fill="#fff"/></g><style>a{}</style></svg>',
      x: 10,
      y: 10,
    });
    const svgOut = JSON.parse(textOf(svg));
    expect(svgOut.created).toHaveLength(3);
    expect(svgOut).toMatchObject({ version: 1, warnings: ['CSS in <style> is not applied; use attributes or style="" on the elements'] });
    const anon = (t: string) => t.replace(/#[0-9a-z]{10}\b/g, "#…").replace(/data-paprika-id="[^"]+"/g, 'data-paprika-id="…"');
    expect(anon(textOf(await call(c, "get_document_outline", { rootId: svgOut.created[0] })))).toMatchInlineSnapshot(`
      "document "doc" v1 · 3 nodes
      tokens: (none)

      group#… "Ícone" 44×44 @12.0972,12.0972
        path#… 44×44 @0,0 fill=#c43d27 d="M13.56 0.12 L37.19 4.29 C41.54 5.06 44.45 9.2..."
        path#… 17×17 @13.9015,13.9015 fill=#fff d="M15.88 9.39 C15.11 13.74 10.96 16.65 6.61 15....""
    `);
    const html = await call(c, "import_html", {
      html: '<div style="display:flex; gap:8px; padding:12px; background:#fbf8f4; width:200px"><div style="width:40px; height:40px; background:#c43d27; border-radius:8px"></div><div style="flex:1; height:40px; border:2px solid #1d1a1f"></div></div>',
      x: 0,
      y: 100,
      label: "colar HTML",
    });
    expect(textOf(html)).toMatch(/"created": \[/);
    const root = JSON.parse(textOf(html)).created[0];
    expect(anon(textOf(await call(c, "get_document_outline", { rootId: root })))).toMatchInlineSnapshot(`
      "document "doc" v2 · 6 nodes
      tokens: (none)

      frame#… 200×hug @0,100 fill=#fbf8f4 row gap=8
        frame#… 40×40 @0,0 fill=#c43d27
        frame#… fill×40 @0,0"
    `);
    const out = await call(c, "export_code", { rootId: root, format: "svg" });
    expect(out.isError, textOf(out)).toBeFalsy();
    expect(anon(out.content[0]!.text!)).toMatchInlineSnapshot(`"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="64" viewBox="0 0 200 64"><g data-paprika-id="…" transform="translate(0 0)"><rect x="0" y="0" width="200" height="64" fill="#fbf8f4"/><g data-paprika-id="…" transform="translate(12 12)"><rect x="0" y="0" width="40" height="40" rx="8" fill="#c43d27"/></g><g data-paprika-id="…" transform="translate(60 12)"><rect x="1" y="1" width="126" height="38" fill="none" stroke="#1d1a1f" stroke-width="2"/></g></g></svg>"`);
    const icon = await call(c, "export_code", { rootId: svgOut.created[0], format: "svg" });
    expect(anon(icon.content[0]!.text!)).toMatchInlineSnapshot(`"<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><g data-paprika-id="…" data-name="Ícone" transform="translate(0 0)"><g data-paprika-id="…" transform="translate(0 0)"><svg width="44" height="44" overflow="visible"><path d="M13.56 0.12 L37.19 4.29 C41.54 5.06 44.45 9.21 43.68 13.56 L39.52 37.19 C38.75 41.54 34.6 44.45 30.25 43.68 L6.61 39.52 C2.26 38.75 -0.64 34.6 0.12 30.25 L4.29 6.61 C5.06 2.26 9.21 -0.64 13.56 0.12 Z" fill="#c43d27" fill-rule="nonzero" stroke-linecap="round" stroke-linejoin="round"/></svg></g><g data-paprika-id="…" transform="translate(13.89 13.89)"><svg width="17" height="17" overflow="visible"><path d="M15.88 9.39 C15.11 13.74 10.96 16.65 6.61 15.88 C2.26 15.11 -0.64 10.96 0.12 6.61 C0.89 2.26 5.04 -0.64 9.39 0.12 C13.74 0.89 16.65 5.04 15.88 9.39 Z" fill="#fff" fill-rule="nonzero" stroke-linecap="round" stroke-linejoin="round"/></svg></g></g></svg>"`);
    const bad = await call(c, "import_html", { html: "<!-- nada -->" });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toBe("the HTML has no elements to import");
  }, 30_000);

  it("modos de tema: set_tokens com mode, frame com mode, export com variáveis CSS", async () => {
    const c = client;
    expect((await call(c, "set_tokens", { tokens: { tela: "#ffffff", tinta: "#1e2336", corpo: 16 } })).isError).toBeFalsy();
    expect((await call(c, "set_tokens", { mode: "escuro", tokens: { tela: "#14161f", tinta: "#f2f2f2" }, label: "modo escuro" })).isError).toBeFalsy();
    const bad = await call(c, "set_tokens", { mode: "sem espaço", tokens: { tela: "#000" } });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toContain("mode name must be");
    const created = await call(c, "create_nodes", {
      nodes: [
        { type: "frame", id: "claro", name: "Claro", x: 600, y: 0, width: 120, height: 60, fill: "$tela", children: [{ type: "text", id: "claroT", text: "Aa", color: "$tinta", fontSize: "$corpo" }] },
        { type: "frame", id: "escuro", name: "Escuro", mode: "escuro", x: 760, y: 0, width: 120, height: 60, fill: "$tela", children: [{ type: "text", id: "escuroT", text: "Aa", color: "$tinta", fontSize: "$corpo" }] },
      ],
    });
    expect(created.isError, textOf(created)).toBeFalsy();
    const outline = textOf(await call(c, "get_document_outline", { rootId: "escuro" }));
    expect(outline).toContain("modes: escuro($tela=#14161f $tinta=#f2f2f2)");
    expect(outline).toContain('frame#escuro "Escuro" 120×60 @760,0 fill=$tela mode=escuro');
    const html = textOf(await call(c, "export_code", { rootId: "escuroT", format: "html", cssVariables: true }));
    expect(html).toContain(':root{--tela:#ffffff;--tinta:#1e2336;--corpo:16px}[data-paprika-mode="escuro"]{--tela:#14161f;--tinta:#f2f2f2}');
    expect(html).toContain('<body data-paprika-mode="escuro">');
    expect(html).toContain("color:var(--tinta)");
    const react = textOf(await call(c, "export_code", { rootId: "escuro", format: "react" }));
    expect(react).toContain('<div data-name="Escuro" data-paprika-mode="escuro" style={{');
    expect(react).toContain('background: "#14161f"');
    const lint = JSON.parse(textOf(await call(c, "lint_design", { rootId: "escuro" })));
    expect(lint.issues.filter((i: { rule: string }) => i.rule === "unknown-token")).toEqual([]);
  });

  it("agent layer: structuredContent, undo batch, actor from clientInfo over HTTP sessions, pt-BR guide", async () => {
    const c = client;
    const r = (await c.callTool({ name: "create_nodes", arguments: { nodes: [{ type: "rect", id: "b1" }], batch: "draw 3" } })) as ToolResult & { structuredContent?: unknown };
    expect(r.structuredContent).toEqual({ created: ["b1"], version: 1 });
    await call(c, "set_tokens", { tokens: { ink: "#111111" }, batch: "draw 3" });
    const g = (await c.callTool({ name: "group_nodes", arguments: { ids: ["b1"], id: "gb", batch: "draw 3" } })) as ToolResult & { structuredContent?: unknown };
    expect(g.structuredContent).toEqual({ group: "gb", created: ["gb"], version: 3 });
    const nodes = (await c.callTool({ name: "get_nodes", arguments: { ids: ["gb"] } })) as ToolResult & { structuredContent?: { nodes: unknown[] } };
    expect(JSON.parse(textOf(nodes))).toEqual(nodes.structuredContent?.nodes);
    const hist = (await c.callTool({ name: "get_history", arguments: {} })) as ToolResult & { structuredContent?: { entries: { actor: string; label: string; ops: number }[] } };
    expect(hist.structuredContent?.entries.map(({ actor, label, ops }) => ({ actor, label, ops }))).toEqual([{ actor: "agent:parity", label: "draw 3", ops: 3 }]);
    const lint = (await c.callTool({ name: "lint_design", arguments: {} })) as ToolResult & { structuredContent?: { ok: boolean } };
    expect(lint.structuredContent).toEqual(JSON.parse(textOf(lint)));
    const path = (await c.callTool({ name: "path_info", arguments: { d: "M0 0 C 0 10 10 10 10 0" } })) as ToolResult & { structuredContent?: unknown };
    expect(path.structuredContent).toEqual(JSON.parse(textOf(path)));
    const undo = (await c.callTool({ name: "undo", arguments: {} })) as ToolResult & { structuredContent?: unknown };
    expect(undo.structuredContent).toEqual({ undone: true, version: 4, canUndo: false, canRedo: true });
    expect(textOf(await call(c, "get_document_outline", {}))).toContain("tokens: (none)");
    expect(textOf(await call(c, "get_design_guide", { language: "pt-BR" }))).toMatch(/^# Paprika: guia para agentes/);
    const bad = await call(c, "delete_nodes", { ids: ["nope"] });
    expect(textOf(bad)).toBe('op[0]: node "nope" does not exist');
  });

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
    expect(messages.find((m) => m.type === "error")).toEqual({ type: "error", reqId: "2", message: 'op[0]: node "nao-existe" does not exist' });

    ws.send(JSON.stringify({ type: "undo", reqId: "3" }));
    await waitFor(() => messages.some((m) => m.type === "ack" && m.reqId === "3"));
    expect(messages.filter((m) => m.type === "doc").at(-1)?.kind).toBe("undo");
    ws.close();
  });

  it("presença do agente: cada chamada MCP vira cursor no canvas, com replay para quem conecta depois", async () => {
    type Msg = { type: string; agent?: string; actor?: string; tool?: string; nodes?: string[]; idle?: number };
    const open = async () => {
      const ws = new WebSocket(`${srv.url.replace("http", "ws")}/ws`, { headers: { origin: srv.url } });
      const msgs: Msg[] = [];
      ws.on("message", (m) => msgs.push(JSON.parse(String(m))));
      await new Promise((ok) => ws.once("open", ok));
      return { ws, msgs, presences: () => msgs.filter((m) => m.type === "presence") };
    };
    const live = await open();
    const other = new Client({ name: "parity", version: "0" });
    await other.connect(new StreamableHTTPClientTransport(new URL(`${srv.url}/mcp`)));
    try {
      await call(client, "create_nodes", { nodes: [{ type: "rect", id: "p1" }, { type: "rect", id: "p2" }] });
      await call(other, "get_nodes", { ids: ["p2", "zz"] });
      await call(client, "update_nodes", { updates: [{ id: "p1", props: { name: "x" } }] });
      await call(client, "undo");
      await waitFor(() => live.presences().length === 4);
      const [a, b, c, d] = live.presences();
      expect(a).toEqual({ type: "presence", agent: expect.stringMatching(/^s:[0-9a-f]{12}$/), actor: "agent:parity", tool: "create_nodes", nodes: ["p1", "p2"], idle: 0 });
      expect(b).toMatchObject({ actor: "agent:parity", tool: "get_nodes", nodes: ["p2"], idle: 0 });
      expect(b!.agent).not.toBe(a!.agent);
      expect(c).toMatchObject({ agent: a!.agent, tool: "update_nodes", nodes: ["p1"] });
      expect(d).toMatchObject({ agent: a!.agent, tool: "undo", nodes: [] });

      const late = await open();
      await waitFor(() => late.msgs.length === 3);
      expect(late.msgs.map((m) => [m.type, m.agent, m.tool])).toEqual([
        ["doc", undefined, undefined],
        ["presence", b!.agent, "get_nodes"],
        ["presence", a!.agent, "undo"],
      ]);
      expect(late.msgs[1]!.idle).toBeGreaterThanOrEqual(0);
      late.ws.close();
    } finally {
      await other.close();
      live.ws.close();
    }
  });

  it("API HTTP: documento, ops, render e erros", async () => {
    const post = (body: unknown) =>
      fetch(`${srv.url}/api/ops`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const ok = await post({ ops: [{ op: "create", node: { type: "rect", id: "api1" } }], actor: "script" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ created: ["api1"] });
    const bad = await post({ ops: [{ op: "delete", id: "nope" }] });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toEqual({ error: 'op[0]: node "nope" does not exist' });
    const invalid = await post({ ops: [] });
    expect(invalid.status).toBe(400);
    expect(JSON.parse((await invalid.json()).error)[0].message).toBe("Too small: expected array to have >=1 items");
    const html = await (await fetch(`${srv.url}/api/render?root=api1`)).text();
    expect(html).toContain('data-paprika-id="api1"');
    expect((await srv.doc()).nodes.api1).toBeDefined();
    const health = await (await fetch(`${srv.url}/api/health`)).json();
    expect(health.ok).toBe(true);
  });

  it("workspaces: criar e abrir por MCP e HTTP; canvas e ferramentas seguem o ativo", async () => {
    const ws = new WebSocket(`${srv.url.replace("http", "ws")}/ws`, { headers: { origin: srv.url } });
    const messages: { type: string; kind?: string; doc?: { id: string; name: string } }[] = [];
    ws.on("message", (m) => messages.push(JSON.parse(String(m))));
    await new Promise((ok) => ws.once("open", ok));
    const first = (await srv.doc()).id;
    await client.callTool({ name: "create_nodes", arguments: { nodes: [{ type: "rect", id: "r1" }] } });

    type Info = { id: string; name: string; nodes: number; updatedAt: number; active: boolean };
    const created = (await call(client, "create_workspace", { name: "  Landing  " })) as ToolResult & { structuredContent: { workspace: Info } };
    const landing = created.structuredContent.workspace;
    expect(Object.keys(landing)).toEqual(["id", "name", "nodes", "updatedAt", "active"]);
    expect(landing).toMatchObject({ name: "Landing", nodes: 0, active: false });

    const post = (path: string, body?: unknown) =>
      fetch(`${srv.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const viaHttp = await post("/api/workspaces", { name: "Outro" });
    expect(viaHttp.status).toBe(201);
    const outro = ((await viaHttp.json()) as { workspace: Info }).workspace;
    expect((await post("/api/workspaces", { name: 3 })).status).toBe(400);

    const list = (await (await fetch(`${srv.url}/api/workspaces`)).json()) as { active: string; workspaces: Info[] };
    expect(list.active).toBe(first);
    expect(list.workspaces.map((w) => w.id).sort()).toEqual([first, landing.id, outro.id].sort());
    expect(list.workspaces.find((w) => w.id === first)).toMatchObject({ active: true, nodes: 1 });
    const mcpList = (await call(client, "list_workspaces")) as ToolResult & { structuredContent: { active: string; workspaces: Info[] } };
    expect(mcpList.structuredContent.active).toBe(first);

    const opened = await post(`/api/workspaces/${landing.id}/open`);
    expect(opened.status).toBe(200);
    expect(((await opened.json()) as { workspace: Info }).workspace).toMatchObject({ id: landing.id, active: true });
    await waitFor(() => messages.some((m) => m.type === "doc" && m.kind === "open" && m.doc?.id === landing.id));
    expect(textOf(await call(client, "get_document_outline"))).toMatch(/^document "Landing" v\d+ · 0 nodes/);
    await client.callTool({ name: "create_nodes", arguments: { nodes: [{ type: "rect", id: "r2" }] } });
    expect(Object.keys((await srv.doc()).nodes)).toEqual(["r2"]);

    const back = await call(client, "open_workspace", { id: first });
    expect(back.isError, textOf(back)).toBeFalsy();
    await waitFor(() => messages.some((m) => m.type === "doc" && m.kind === "open" && m.doc?.id === first));
    expect(Object.keys((await srv.doc()).nodes)).toEqual(["r1"]);

    const bad = await call(client, "open_workspace", { id: "nope" });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toBe('workspace "nope" does not exist (see list_workspaces)');
    const missing = await post("/api/workspaces/nope/open");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'workspace "nope" não existe' });
    expect((await fetch(`${srv.url}/api/workspaces/${first}/open`)).status).toBe(405);
    ws.close();
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
