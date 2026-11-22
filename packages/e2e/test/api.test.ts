// Black-box API suite for the Go server: it runs as a separate process and is reached only
// through MCP (HTTP and stdio), the WebSocket and the HTTP API (see server-go/README.md).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { request } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import WebSocket from "ws";
import type { PathNode } from "@paprika/core";
import { repoRoot, startServer, waitFor, type ExternalServer } from "./harness.js";

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

describe("API: MCP", () => {
  it("serve o contrato MCP (server-go/contract/mcp.json) com JSON Schema de objeto", async () => {
    const { tools } = await client.listTools();
    const contract = JSON.parse(readFileSync(join(repoRoot, "server-go/contract/mcp.json"), "utf8"));
    expect(tools).toEqual(contract.tools);
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "apply_ops", "create_component", "create_instance", "create_nodes", "create_page", "create_workspace",
        "delete_nodes", "delete_workspace", "detach_instance", "draw_diagram", "export_code", "find_nodes", "get_design_guide",
        "get_document_outline", "get_history", "get_nodes", "group_nodes", "import_document", "import_html", "import_svg",
        "lint_design", "list_workspaces", "move_nodes", "open_workspace", "path_info", "redo",
        "rename_workspace", "render_screenshot", "set_tokens", "set_workspace_cover", "undo", "ungroup_nodes", "update_nodes",
      ].sort(),
    );
    for (const t of tools) expect(t.inputSchema.type).toBe("object");
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
    const node = (await srv.doc()).nodes.wave as PathNode;
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
    // Labels (fb#57): on draw_diagram edges and on any connector, drawn halfway along the route.
    await call(c, "update_nodes", { updates: [{ id: "start-to-ok", props: { label: "sim" } }] });
    expect(textOf(await call(c, "get_document_outline"))).toContain('label="sim"');
    const html = textOf(await call(c, "export_code", { rootId: "start-to-ok", format: "html" }));
    expect(html).toContain('paint-order="stroke"');
    expect(html).toMatch(/<text x="22.25" y="74"[^>]*>sim<\/text>/);
    const svg = textOf(await call(c, "export_code", { rootId: "memo", format: "svg" }));
    expect(svg).toContain(">Note</tspan>");
    const bad = await call(c, "draw_diagram", { nodes: [{ id: "x" }], edges: [{ from: "x", to: "nope" }] });
    expect(textOf(bad)).toBe('edges[0]: "nope" is neither a diagram node nor an existing node');
    await call(c, "undo");
    await call(c, "undo");
    await call(c, "undo");
    expect(Object.keys((await srv.doc()).nodes)).toEqual([]);
  });

  it("Z-order numa chamada: update/move com index, um passo de desfazer, frente/fundo no pai (PAP-B-014)", async () => {
    const c = client;
    await call(c, "create_nodes", {
      nodes: [{ type: "frame", id: "box", name: "Box", width: 300, height: 200, fill: "#ffffff", children: [
        { type: "rect", id: "z1", x: 10, y: 10, width: 50, height: 50 },
        { type: "rect", id: "z2", x: 70, y: 10, width: 50, height: 50 },
        { type: "rect", id: "z3", x: 130, y: 10, width: 50, height: 50 },
      ] }],
    });
    const box = async () => (await srv.doc()).nodes.box;
    expect(await box()).toMatchObject({ children: ["z1", "z2", "z3"] });
    // index junto de campos: mesma chamada, um único passo de desfazer que restaura os dois.
    await call(c, "update_nodes", { updates: [{ id: "z1", props: { index: "front", name: "top" } }] });
    expect(await box()).toMatchObject({ children: ["z2", "z3", "z1"] });
    expect((await srv.doc()).nodes.z1).toMatchObject({ name: "top" });
    const nEntries = async () => (JSON.parse(textOf(await call(c, "get_history", { limit: 10 }))) as unknown[]).length;
    const before = await nEntries();
    await call(c, "undo");
    expect(await nEntries()).toBe(before - 1);
    expect(await box()).toMatchObject({ children: ["z1", "z2", "z3"] });
    expect((await srv.doc()).nodes.z1).not.toMatchObject({ name: "top" });
    // move aceita os mesmos nomes; back/forward/backward no pai.
    await call(c, "move_nodes", { moves: [{ id: "z3", parentId: "box", index: "back" }] });
    expect(await box()).toMatchObject({ children: ["z3", "z1", "z2"] });
    await call(c, "move_nodes", { moves: [{ id: "z3", parentId: "box", index: "forward" }] });
    expect(await box()).toMatchObject({ children: ["z1", "z3", "z2"] });
    await call(c, "update_nodes", { updates: [{ id: "z2", props: { index: 0 } }] });
    expect(await box()).toMatchObject({ children: ["z2", "z1", "z3"] });
    // frente/fundo respeitam o pai: o nível do canvas não muda.
    expect((await srv.doc()).rootIds).toEqual(["box"]);
    // índice que não é posição: erro acionável, nada é aplicado.
    const bad = await call(c, "update_nodes", { updates: [{ id: "z1", props: { index: "up" } }] });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toContain('props.index must be a number (0 is the back) or "front", "back", "forward" or "backward" (got "up")');
    const badMove = await call(c, "move_nodes", { moves: [{ id: "z1", parentId: "box", index: "up" }] });
    expect(badMove.isError).toBe(true);
    expect(await box()).toMatchObject({ children: ["z2", "z1", "z3"] });
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

  it("export_code: tailwind, tailwind-html e css-modules saem do mesmo estilo do canvas", async () => {
    const c = client;
    const created = await call(c, "create_nodes", {
      nodes: [
        { type: "frame", id: "tw", name: "Card Tailwind", x: 0, y: 900, width: 200, height: 80, fill: "#ffffff", radius: 8, children: [{ type: "text", id: "twT", text: "Oi", color: "#111111", fontSize: 14 }] },
      ],
    });
    expect(created.isError, textOf(created)).toBeFalsy();
    const react = textOf(await call(c, "export_code", { rootId: "tw", format: "react" }));
    const tailwind = textOf(await call(c, "export_code", { rootId: "tw", format: "tailwind" }));
    expect(tailwind).toContain("export function CardTailwind()");
    expect(tailwind).toContain('className="');
    expect(tailwind).toContain("bg-[color:#ffffff]");
    expect(tailwind).toContain("rounded-[8px]");
    expect(tailwind).not.toContain("style={{");
    expect(tailwind).not.toBe(react);
    const page = textOf(await call(c, "export_code", { rootId: "tw", format: "tailwind-html" }));
    expect(page).toContain("@tailwindcss/browser");
    expect(page).toContain('data-paprika-id="tw"');
    expect(page).not.toContain(' style="');
    const modules = (await call(c, "export_code", { rootId: "tw", format: "css-modules", cssVariables: true })).content.map((x) => x.text ?? "");
    expect(modules).toHaveLength(2);
    expect(modules[0]).toContain('import styles from "./CardTailwind.module.css";');
    expect(modules[0]).toContain("className={styles.cardTailwind}");
    expect(modules[1]).toContain("/* CardTailwind.module.css */");
    expect(modules[1]).toContain(".cardTailwind{box-sizing:border-box;");
    const missing = await call(c, "export_code", { rootId: "nope", format: "css-modules" });
    expect(missing.isError).toBe(true);
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
    // fb#65 + fb#67: a text without a size hugs; delete_nodes says what went away (subtree and arrows).
    await call(c, "create_nodes", {
      nodes: [
        { type: "frame", id: "box", layout: { mode: "column" }, children: [{ type: "text", id: "lbl", text: "Olá" }] },
        { type: "shape", id: "far", x: 400, y: 0 },
        { type: "connector", id: "arrow", from: { nodeId: "box" }, to: { nodeId: "far" } },
      ],
    });
    const lbl = JSON.parse(textOf(await call(c, "get_nodes", { ids: ["lbl"] })))[0];
    expect([lbl.width, lbl.height]).toEqual(["hug", "hug"]);
    const del = (await c.callTool({ name: "delete_nodes", arguments: { ids: ["box"] } })) as ToolResult & { structuredContent?: { deleted: string[] } };
    expect(del.structuredContent?.deleted).toEqual(["box", "lbl", "arrow"]);
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

  it("mover um board entre servidores: export --root no A, import_document no B, outline igual (PAP-B-013)", async () => {
    const c = client;
    await call(c, "set_tokens", { tokens: { ink: "#111111", paper: "#fbf8f4", accent: "$ink", unused: "#123456" } });
    await call(c, "create_nodes", { nodes: [
      { type: "frame", id: "chip", name: "Chip", component: true, x: 500, y: 0, width: 60, height: 60, fill: "$ink", children: [
        { type: "rect", id: "ck", x: 5, y: 5, width: 20, height: 20 },
      ] },
      { type: "rect", id: "fora", x: 900, y: 0, width: 30, height: 30 },
      { type: "frame", id: "board", name: "Board", x: 0, y: 0, width: 300, height: 200, fill: "$paper", children: [
        { type: "shape", id: "a", shape: "rect", x: 10, y: 10, width: 80, height: 40, fill: "$accent" },
        { type: "shape", id: "b", shape: "rect", x: 150, y: 60, width: 80, height: 40, color: "$ink" },
        { type: "connector", id: "k-in", from: { nodeId: "a" }, to: { nodeId: "b" } },
        { type: "connector", id: "k-out", from: { nodeId: "a" }, to: { nodeId: "fora" } },
        { type: "frame", id: "inst", instanceOf: "chip", x: 20, y: 120 },
      ] },
    ] });
    const outlineA = textOf(await call(c, "get_document_outline", {}));
    // CLI on server A: only the board and what it needs; the dangling arrow is dropped with a warning.
    const out = join(srv.dir, "board.json");
    const cli = spawnSync(srv.stdioCommand().command, ["export", "--root", "board", "--db", join(srv.dir, "doc.db"), "-o", out], { encoding: "utf8" });
    expect(cli.status, cli.stderr).toBe(0);
    expect(cli.stderr).toContain('conector "k-out"');
    const exported = JSON.parse(readFileSync(out, "utf8")) as { nodes: Record<string, unknown>; tokens: Record<string, unknown> };
    expect(exported.nodes.fora).toBeUndefined();
    expect(exported.tokens).toEqual({ paper: "#fbf8f4", ink: "#111111", accent: "$ink" });
    // MCP into a second server: a new workspace, the active one untouched, ids kept.
    const srvB = await startServer();
    const b = new Client({ name: "parity-b", version: "0" });
    try {
      await b.connect(new StreamableHTTPClientTransport(new URL(`${srvB.url}/mcp`)));
      const before = JSON.parse(textOf(await call(b, "list_workspaces", {})));
      const r = (await call(b, "import_document", { document: exported })) as ToolResult & { structuredContent?: { workspace: { id: string; name: string; active: boolean; nodes: number }; active: string } };
      expect(r.isError, textOf(r)).toBeFalsy();
      const sc = r.structuredContent!;
      expect(sc.workspace).toMatchObject({ name: "Board", active: false, nodes: Object.keys(exported.nodes).length });
      expect(sc.active).toBe(before.active);
      const after = JSON.parse(textOf(await call(b, "list_workspaces", {})));
      expect(after.active).toBe(before.active); // the human's canvas did not move
      expect(after.workspaces).toHaveLength(2);
      expect(textOf(await call(b, "get_document_outline", {}))).not.toContain("board");
      await call(b, "open_workspace", { id: sc.workspace.id });
      const tree = (s: string) => s.slice(s.indexOf("\n\n") + 2);
      const dropped = (s: string) => tree(s).split("\n").filter((l) => !l.includes("#fora") && !l.includes("#k-out")).join("\n");
      expect(tree(textOf(await call(b, "get_document_outline", {})))).toBe(dropped(outlineA));
      // Same document again: a copy with a new workspace id, not an error.
      const again = (await call(b, "import_document", { document: exported })) as ToolResult & { structuredContent?: { workspace: { id: string } } };
      expect(again.structuredContent!.workspace.id).not.toBe(sc.workspace.id);
    } finally {
      await b.close();
      await srvB.stop();
    }
  }, 60_000);
});

describe("API: HTTP + WebSocket", () => {
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
    expect(Object.keys(landing)).toEqual(["id", "name", "nodes", "updatedAt", "active", "cover"]);
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

  it("workspaces: capa por HTTP (PNG, JPEG, WebP, GIF; nunca SVG) e por MCP (imagem ou screenshot de um frame)", async () => {
    type Info = { id: string; name: string; cover: string | null };
    const list = async () => (await (await fetch(`${srv.url}/api/workspaces`)).json()) as { active: string; workspaces: Info[] };
    const ws = ((await (await fetch(`${srv.url}/api/workspaces`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Com capa" }) })).json()) as { workspace: Info }).workspace;
    expect(ws.cover).toBeNull();
    const url = `${srv.url}/api/workspaces/${ws.id}/cover`;
    expect((await fetch(url)).status).toBe(404);

    // 1×1 PNG.
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const put = await fetch(url, { method: "PUT", body: png });
    expect(put.status).toBe(200);
    const withCover = ((await put.json()) as { workspace: Info }).workspace;
    expect(withCover.cover).toMatch(new RegExp(`^/api/workspaces/${ws.id}/cover\\?v=\\d+$`));
    expect((await list()).workspaces.find((w) => w.id === ws.id)?.cover).toBe(withCover.cover);
    const got = await fetch(`${srv.url}${withCover.cover}`);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect(got.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(Buffer.from(await got.arrayBuffer()).equals(png)).toBe(true);

    const svg = await fetch(url, { method: "PUT", body: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' });
    expect(svg.status).toBe(415);
    expect((await fetch(`${srv.url}/api/workspaces/nope/cover`, { method: "PUT", body: png })).status).toBe(404);
    expect((await fetch(url, { method: "POST" })).status).toBe(405);

    const cleared = await fetch(url, { method: "DELETE" });
    expect(((await cleared.json()) as { workspace: Info }).workspace.cover).toBeNull();
    expect((await fetch(url)).status).toBe(404);

    // MCP: an image as a data: URL, then a screenshot of the active workspace's frame, then clear.
    const viaImage = (await call(client, "set_workspace_cover", { id: ws.id, image: `data:image/png;base64,${png.toString("base64")}` })) as ToolResult & { structuredContent: { workspace: Info } };
    expect(viaImage.isError, textOf(viaImage)).toBeFalsy();
    expect(viaImage.structuredContent.workspace.cover).not.toBeNull();
    const active = (await list()).active;
    await client.callTool({ name: "create_nodes", arguments: { nodes: [{ type: "frame", id: "capa", width: 240, height: 128, fill: "#e04a2b" }] } });
    const shot = (await call(client, "set_workspace_cover", { id: active, rootId: "capa" })) as ToolResult & { structuredContent: { workspace: Info } };
    expect(shot.isError, textOf(shot)).toBeFalsy();
    const shotRes = await fetch(`${srv.url}${shot.structuredContent.workspace.cover}`);
    expect(shotRes.headers.get("content-type")).toBe("image/png");
    expect((await call(client, "set_workspace_cover", { id: ws.id, image: "não é base64" })).isError).toBe(true);
    expect(textOf(await call(client, "set_workspace_cover", { id: ws.id, image: png.toString("base64"), clear: true }))).toBe("pass only one of rootId, image or clear");
    const clear = (await call(client, "set_workspace_cover", { id: ws.id, clear: true })) as ToolResult & { structuredContent: { workspace: Info } };
    expect(clear.structuredContent.workspace.cover).toBeNull();
    expect(textOf(await call(client, "set_workspace_cover", { id: "nope", clear: true }))).toBe('workspace "nope" does not exist (see list_workspaces)');
    await client.callTool({ name: "delete_nodes", arguments: { ids: ["capa"] } });
  });

  it("workspaces: renomear e excluir por MCP e HTTP; excluir o ativo troca para o mais recente", async () => {
    type Info = { id: string; name: string; nodes: number; updatedAt: number; active: boolean };
    const req = (method: string, path: string, body?: unknown) =>
      fetch(`${srv.url}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const list = async () => (await (await fetch(`${srv.url}/api/workspaces`)).json()) as { active: string; workspaces: Info[] };
    const start = (await list()).active;
    const a = ((await (await req("POST", "/api/workspaces", { name: "A" })).json()) as { workspace: Info }).workspace;

    const renamed = await req("PATCH", `/api/workspaces/${a.id}`, { name: "  A2  " });
    expect(renamed.status).toBe(200);
    const info = ((await renamed.json()) as { workspace: Info }).workspace;
    expect(Object.keys(info)).toEqual(["id", "name", "nodes", "updatedAt", "active", "cover"]);
    expect(info).toMatchObject({ id: a.id, name: "A2", active: false });
    expect((await list()).workspaces.find((w) => w.id === a.id)?.name).toBe("A2");
    expect((await req("PATCH", `/api/workspaces/${a.id}`, { name: "  " })).status).toBe(400);
    expect((await req("PATCH", `/api/workspaces/${a.id}`, { name: 3 })).status).toBe(400);
    const missing = await req("PATCH", "/api/workspaces/nope", { name: "x" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'workspace "nope" não existe' });
    expect((await req("GET", `/api/workspaces/${a.id}`)).status).toBe(405);

    const mcp = (await call(client, "rename_workspace", { id: a.id, name: "A3" })) as ToolResult & { structuredContent: { workspace: Info } };
    expect(mcp.isError, textOf(mcp)).toBeFalsy();
    expect(mcp.structuredContent.workspace).toMatchObject({ id: a.id, name: "A3" });
    expect(textOf(await call(client, "rename_workspace", { id: "nope", name: "x" }))).toBe('workspace "nope" does not exist (see list_workspaces)');

    // Renaming the active workspace is an undoable document write.
    const activeName = (await srv.doc()).name;
    await call(client, "rename_workspace", { id: start, name: "Ativo" });
    expect((await srv.doc()).name).toBe("Ativo");
    await call(client, "undo");
    expect((await srv.doc()).name).toBe(activeName);

    // Delete the active one: the server opens the most recently updated other workspace.
    await call(client, "open_workspace", { id: a.id });
    const del = await req("DELETE", `/api/workspaces/${a.id}`);
    expect(del.status).toBe(200);
    const after = (await del.json()) as { deleted: string; active: string };
    expect(after.deleted).toBe(a.id);
    expect(after.active).not.toBe(a.id);
    expect((await list()).active).toBe(after.active);
    expect((await srv.doc()).id).toBe(after.active);
    expect((await list()).workspaces.some((w) => w.id === a.id)).toBe(false);
    expect((await req("DELETE", `/api/workspaces/${a.id}`)).status).toBe(404);

    const b = ((await (await req("POST", "/api/workspaces", { name: "B" })).json()) as { workspace: Info }).workspace;
    const mcpDel = (await call(client, "delete_workspace", { id: b.id })) as ToolResult & { structuredContent: { deleted: string; active: string } };
    expect(mcpDel.isError, textOf(mcpDel)).toBeFalsy();
    expect(mcpDel.structuredContent).toEqual({ deleted: b.id, active: after.active });
    expect(textOf(await call(client, "delete_workspace", { id: "nope" }))).toBe('workspace "nope" does not exist (see list_workspaces)');
    await call(client, "open_workspace", { id: start });
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
