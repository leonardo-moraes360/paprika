// Black-box API suite for the Go server: it runs as a separate process and is reached only
// through MCP (HTTP and stdio), the WebSocket and the HTTP API (see server-go/README.md).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { request } from "node:http";
import { inflateSync } from "node:zlib";
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
const textBody = (r: ToolResult) =>
  textOf(r).replace(/,\n  "workspaceId": "[^"]+"/g, "").replace(/,\n  "workspaceName": "[^"]+"/g, "");
const outlineText = (r: ToolResult) => textOf(r).replace(/^workspace \S+/, "workspace ID");
const withWorkspace = async (body: Record<string, unknown>) => {
  const doc = await srv.doc();
  return { ...body, workspaceId: doc.id, workspaceName: doc.name };
};
const jsonOf = (r: ToolResult) => JSON.parse(r.content.find((c) => (c.text ?? "").trimStart().startsWith("{"))?.text ?? "null");
const routeHitsBox = (c: { x: number; y: number; d: string }, box: { x: number; y: number; w: number; h: number }) => {
  const body = c.d.split(" M")[0] ?? "";
  const pts = [...body.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: c.x + Number(m[1]), y: c.y + Number(m[2]) }));
  const x0 = box.x;
  const y0 = box.y;
  const x1 = box.x + box.w;
  const y1 = box.y + box.h;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (Math.abs(a.y - b.y) < 1e-6) {
      if (a.y <= y0 || a.y >= y1) continue;
      const lo = Math.min(a.x, b.x);
      const hi = Math.max(a.x, b.x);
      if (hi > x0 && lo < x1) return true;
    } else if (Math.abs(a.x - b.x) < 1e-6) {
      if (a.x <= x0 || a.x >= x1) continue;
      const lo = Math.min(a.y, b.y);
      const hi = Math.max(a.y, b.y);
      if (hi > y0 && lo < y1) return true;
    }
  }
  return false;
};

const outputSchema = (name: string) => {
  const contract = JSON.parse(readFileSync(join(repoRoot, "server-go/contract/mcp.json"), "utf8"));
  return contract.tools.find((t: { name: string }) => t.name === name).outputSchema;
};

const schemaErrors = (schema: any, value: unknown, path = ""): string[] => {
  if (!schema || typeof schema !== "object") return [];
  const errors: string[] = [];
  const types: string[] = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length) {
    const ok = types.some((t) => {
      if (t === "null") return value === null;
      if (t === "array") return Array.isArray(value);
      if (t === "integer") return typeof value === "number" && Number.isInteger(value);
      if (t === "number") return typeof value === "number" && !Number.isNaN(value);
      return typeof value === t;
    });
    if (!ok) errors.push(`${path || "/"} expected ${types.join("|")}`);
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} not in enum`);
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => errors.push(...schemaErrors(schema.items, item, `${path}/${i}`)));
  }
  if (value && typeof value === "object" && !Array.isArray(value) && schema.type === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) errors.push(`${path} missing ${key}`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!schema.properties?.[key]) errors.push(`${path} unexpected ${key}`);
      }
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in obj) errors.push(...schemaErrors(sub, obj[key], `${path}/${key}`));
    }
  }
  return errors;
};

const assertOutput = (name: string, value: unknown) => {
  expect(schemaErrors(outputSchema(name), value), JSON.stringify(value)).toEqual([]);
};

function pngPixel(png: Buffer, x: number, y: number): number[] {
  const idat: Buffer[] = [];
  let w = 0;
  let h = 0;
  let color = 6;
  for (let o = 8; o + 8 <= png.length; ) {
    const len = png.readUInt32BE(o);
    const type = png.subarray(o + 4, o + 8).toString();
    const data = png.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      color = data[9]!;
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    o += 12 + len;
  }
  const bpp = color === 6 ? 4 : color === 2 ? 3 : 4;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const rows: Buffer[] = [];
  let i = 0;
  for (let row = 0; row < h; row++) {
    const filter = raw[i++]!;
    const cur = Buffer.alloc(stride);
    for (let c = 0; c < stride; c++) {
      const left = c >= bpp ? cur[c - bpp]! : 0;
      const up = row > 0 ? rows[row - 1]![c]! : 0;
      const ul = row > 0 && c >= bpp ? rows[row - 1]![c - bpp]! : 0;
      const v = raw[i++]!;
      let pred = 0;
      if (filter === 1) pred = left;
      else if (filter === 2) pred = up;
      else if (filter === 3) pred = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - ul;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - ul);
        pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
      }
      cur[c] = (v + pred) & 255;
    }
    rows.push(cur);
  }
  const px = x * bpp;
  return [rows[y]![px]!, rows[y]![px + 1]!, rows[y]![px + 2]!];
}

describe("API: MCP", () => {
  it("serve o contrato MCP (server-go/contract/mcp.json) com JSON Schema de objeto", async () => {
    const { tools } = await client.listTools();
    const contract = JSON.parse(readFileSync(join(repoRoot, "server-go/contract/mcp.json"), "utf8"));
    expect(tools).toEqual(contract.tools);
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "apply_ops", "archive_workspace", "combine_paths", "convert_to_path", "create_component", "create_instance", "create_nodes", "create_page", "create_workspace",
        "delete_nodes", "delete_workspace", "detach_instance", "detach_tokens", "draw_diagram", "export_code", "export_image", "find_nodes", "get_design_guide",
        "get_document_outline", "get_history", "get_nodes", "group_nodes", "import_document", "import_html", "import_image", "import_svg",
        "align_nodes", "distribute_nodes", "wrap_nodes", "show_all", "unlock_all",
        "get_bounds",
        "create_folder", "rename_folder", "move_workspace", "place_reference",
        "lint_design", "list_workspace_ops", "list_workspaces", "move_nodes", "open_workspace", "path_info", "edit_path", "redo",
        "rename_workspace", "render_screenshot", "resize_image", "propose_tokens", "set_assets", "set_tokens", "set_workspace_cover", "unarchive_workspace", "undo", "ungroup_nodes", "update_nodes",
        "duplicate_nodes",
        "claim_pin", "list_pins", "reply_pin", "resolve_pin", "wait_for_pins",
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
    expect(textBody(inst)).toMatchInlineSnapshot(`
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
    expect(outlineText(outline)).toMatchInlineSnapshot(`
      "workspace ID "doc" v3 · 6 nodes
      tokens: (none)
      renderer: none

      frame#btn "Botão" 100×40 @10,10 fill=#3355ff row gap=4 component
        text#lbl 50×20 @0,0 "OK" 16/400 color=#ffffff
        path#ico 8×8 @0,0 d="M0 0 L8 8" stroke=#ffffff/1.5
      frame#i1 "Botão" 150×60 @150,10 fill=#3355ff row gap=6 instanceOf=btn scale=1.5 overrides=1
        text#i1-0bzyiqi0vw20y4 75×30 @0,0 from=lbl "Enviar" 24/400 color=#ffffff
        path#i1-1qrxohh1a842nx 12×12 @0,0 from=ico d="M0 0 L8 8" stroke=#ffffff/2.25 viewBox=0,0,8,8
      content: x=10 y=10 w=290 h=60
      next: x=380 y=10"
    `);
    const bad = await call(c, "update_nodes", { updates: [{ id: JSON.parse(textOf(inst)).copies.lbl, props: { x: 3 } }] });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatchInlineSnapshot(`"op[0]: "i1-0bzyiqi0vw20y4" is a copy inside the instance "i1": only fill, color, text, src, alt, visible, opacity, runs can change (they become overrides); edit the component or detach it (got x)"`);
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
    expect(textBody(d)).toMatchInlineSnapshot(`
      "{
        "detached": [
          "i1"
        ],
        "created": [],
        "version": 5
      }"
    `);
    await call(c, "undo");
    expect(outlineText(await call(c, "get_document_outline", { rootId: "i1" }))).toMatchInlineSnapshot(`
      "workspace ID "doc" v6 · 6 nodes
      tokens: (none)
      renderer: none

      frame#i1 "Botão" 150×60 @150,10 fill=#000000 row gap=6 instanceOf=btn scale=1.5 overrides=2
        text#i1-0bzyiqi0vw20y4 75×30 @0,0 from=lbl "Enviar" 30/400 color=#ffffff
        path#i1-1qrxohh1a842nx 12×12 @0,0 from=ico d="M0 0 L8 8" stroke=#ffffff/2.25 viewBox=0,0,8,8
      content: x=10 y=10 w=290 h=60
      next: x=380 y=10"
    `);
  });

  it("props, slots e instância aninhada", async () => {
    const c = client;
    await call(c, "create_nodes", {
      nodes: [
        { type: "ellipse", id: "gem", width: 12, height: 12, fill: "#ff278c" },
        {
          type: "frame", id: "btn", width: 120, height: 40,
          children: [
            { type: "text", id: "lbl", text: "OK", width: 40, height: 20 },
            { type: "ellipse", id: "dot", width: 8, height: 8 },
            { type: "rect", id: "sm", width: 8, height: 8 },
            { type: "frame", id: "icon", width: 16, height: 16, children: [{ type: "rect", id: "ph", width: 16, height: 16 }] },
          ],
        },
      ],
    });
    await call(c, "create_component", {
      id: "btn",
      props: [
        { name: "label", type: "text", default: "OK" },
        { name: "disabled", type: "boolean", default: false },
        { name: "size", type: "variant", default: "md", options: ["sm", "md"] },
      ],
    });
    await call(c, "update_nodes", {
      updates: [
        { id: "lbl", props: { bind: { text: "label" } } },
        { id: "dot", props: { bind: { visible: "disabled" } } },
        { id: "sm", props: { bind: { variant: { size: "sm" } } } },
        { id: "icon", props: { slot: "icon" } },
      ],
    });
    const inst = await call(c, "create_instance", {
      componentId: "btn",
      id: "i1",
      propValues: { label: "Enviar", disabled: false, size: "md" },
      slots: { icon: ["gem"] },
    });
    const body = JSON.parse(textBody(inst));
    expect(body.copies["icon/gem"]).toBeTruthy();
    const outline = outlineText(await call(c, "get_document_outline", { rootId: "i1" }));
    expect(outline).toContain("Enviar");
    expect(outline).toContain("from=icon/gem");
    expect(outline).not.toContain("from=sm");
    expect(outline).toContain("hidden");
    await call(c, "create_nodes", {
      nodes: [{
        type: "frame", id: "card", width: 200, height: 80,
        children: [{ type: "frame", id: "btnInst", instanceOf: "btn", width: 120, height: 40 }],
      }],
    });
    await call(c, "create_component", { id: "card" });
    await call(c, "create_instance", {
      componentId: "card",
      id: "c1",
      overrides: { "btnInst/lbl": { text: "Salvar" } },
    });
    expect(outlineText(await call(c, "get_document_outline", { rootId: "c1" }))).toContain("Salvar");
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
    expect(textBody(g)).toBe('{\n  "group": "g",\n  "created": [\n    "g"\n  ],\n  "version": 2\n}');
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
    await call(c, "create_nodes", {
      parentId: "f",
      nodes: [
        { type: "rect", id: "c1", x: 120, y: 20, width: 60, height: 60, fill: "#c43d27" },
        { type: "rect", id: "c2", x: 150, y: 50, width: 60, height: 60, fill: "#1e2336" },
      ],
    });
    const combined = JSON.parse(textOf(await call(c, "combine_paths", { ids: ["c1", "c2"], operation: "union", id: "cu" })));
    expect(combined.path).toBe("cu");
    expect(JSON.parse(textOf(await call(c, "get_nodes", { ids: ["cu"] })))[0]).toMatchObject({ type: "path", fill: "#c43d27", id: "cu" });
    expect(textOf(await call(c, "get_nodes", { ids: ["c1"] }))).toMatch(/do not exist/);
    expect(JSON.parse(textOf(await call(c, "create_page", { id: "p2", name: "Variações" }))).page).toBe("p2");
    expect(textOf(await call(c, "create_nodes", { nodes: [{ type: "rect", x: 1, y: 1 }] }))).toMatch(/has pages/);
    await call(c, "create_nodes", { parentId: "p2", nodes: [{ type: "rect", id: "r", width: 10, height: 10 }] });
    const outline = textOf(await call(c, "get_document_outline"));
    expect(outline.split("\n").slice(4).join("\n").replace(/page#\w+ "Page 1"/, "page#P1").replace(/page=\w+/, "page=P1")).toMatchInlineSnapshot(`
      "page#P1
        frame#f "Tela" 300×200 @0,0
          rect#a 30×30 @10,20
          rect#b 30×30 @60,40
          path#cu 90×90 @120,20 fill=#c43d27 d="M0 0 L60 0 L60 30 L90 30 L90 90 L30 90 L30 60..."
      page#p2 "Variações"
        rect#r 10×10 @0,0
      content: page=P1 x=0 y=0 w=300 h=200
      next: x=380 y=0"
    `);
    const hist = JSON.parse(textOf(await call(c, "get_history", { limit: 4 })));
    expect(hist.map((h: { label: string }) => h.label)).toEqual(["create 2 node(s)", "combine 2 path(s)", "create page", "create 1 node(s)"]);
  });

  it("semântica web e converter em caminho", async () => {
    const c = client;
    await call(c, "create_nodes", {
      nodes: [{
        type: "frame", id: "f", width: 320, height: 180,
        children: [
          { type: "rect", id: "r", x: 10, y: 10, width: 40, height: 24, radius: 4, fill: "#112233" },
          { type: "text", id: "t", x: 60, y: 12, text: "Docs" },
        ],
      }],
    });
    const converted = JSON.parse(textOf(await call(c, "convert_to_path", { ids: ["r"] })));
    expect(converted.created).toContain("r");
    expect(JSON.parse(textOf(await call(c, "get_nodes", { ids: ["r"] })))[0]).toMatchObject({ type: "path", id: "r", fill: "#112233" });
    expect(textOf(await call(c, "undo"))).toMatch(/"undone": true/);
    expect(JSON.parse(textOf(await call(c, "get_nodes", { ids: ["r"] })))[0].type).toBe("rect");
    expect((await call(c, "set_assets", { assets: { logo: "https://example.com/a.png" } })).isError).toBeFalsy();
    expect((await call(c, "create_nodes", { parentId: "f", nodes: [{ type: "image", id: "im", src: "$logo", width: 24, height: 24, decorative: true }] })).isError).toBeFalsy();
    const missing = await call(c, "create_nodes", { parentId: "f", nodes: [{ type: "image", id: "bad", src: "$nope", width: 10, height: 10 }] });
    expect(textOf(missing)).toMatch(/does not match an asset/);
    await call(c, "update_nodes", { updates: [
      { id: "f", props: { href: "https://example.com", minWidth: 200, maxWidth: 800 } },
      { id: "t", props: { href: "/docs" } },
    ] });
    const html = textOf(await call(c, "export_code", { rootId: "f", format: "html" }));
    expect(html).toMatch(/<a /);
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="/docs"');
    expect(html).toContain("min-width:200px");
    expect(html).toContain('src="https://example.com/a.png"');
    expect(html).toContain('data-paprika-decorative="true"');
    const badHref = await call(c, "update_nodes", { updates: [{ id: "f", props: { href: "javascript:alert(1)" } }] });
    expect(textOf(badHref)).toMatch(/href must be/);
    await call(c, "create_nodes", { parentId: "f", nodes: [{ type: "frame", id: "inner", width: 40, height: 40 }] });
    const badWidth = await call(c, "update_nodes", { updates: [{ id: "inner", props: { minWidth: 10 } }] });
    expect(textOf(badWidth)).toMatch(/only valid on a root frame/);
  });

  it("alinha, distribui, envolve e revela num desfazer cada", async () => {
    const c = client;
    await call(c, "create_nodes", {
      nodes: [{
        type: "frame", id: "f", width: 400, height: 200,
        children: [
          { type: "rect", id: "a", x: 10, y: 20, width: 40, height: 20, fill: "#c43d27" },
          { type: "rect", id: "b", x: 80, y: 50, width: 20, height: 40, fill: "#1e2336" },
          { type: "rect", id: "c", x: 140, y: 10, width: 30, height: 10, fill: "#3355ff", visible: false, locked: true },
        ],
      }],
    });
    const aligned = JSON.parse(textOf(await call(c, "align_nodes", { ids: ["a", "b", "c"], edge: "left" })));
    expect(aligned.created).toEqual([]);
    expect(JSON.parse(textOf(await call(c, "get_nodes", { ids: ["a", "b", "c"] }))).map((n: { x: number }) => n.x)).toEqual([10, 10, 10]);
    await call(c, "undo");
    expect(JSON.parse(textOf(await call(c, "get_nodes", { ids: ["b"] })))[0].x).toBe(80);
    expect((await call(c, "distribute_nodes", { ids: ["a", "b"], axis: "horizontal" })).isError).toBe(true);
    await call(c, "distribute_nodes", { ids: ["a", "b", "c"], axis: "horizontal" });
    const wrapped = JSON.parse(textOf(await call(c, "wrap_nodes", { ids: ["a", "b"], id: "wf", name: "Caixa" })));
    expect(wrapped.frame).toBe("wf");
    expect(JSON.parse(textOf(await call(c, "get_nodes", { ids: ["wf", "a"] })))).toMatchObject([
      { type: "frame", id: "wf", clip: false, fill: "transparent", name: "Caixa" },
      { parentId: "wf" },
    ]);
    expect(JSON.parse(textOf(await call(c, "show_all", {}))).ids).toEqual(["c"]);
    expect(JSON.parse(textOf(await call(c, "unlock_all", {}))).ids).toEqual(["c"]);
    await call(c, "undo");
    expect(JSON.parse(textOf(await call(c, "get_nodes", { ids: ["c"] })))[0].locked).toBe(true);
    expect(JSON.parse(textOf(await call(c, "show_all", {}))).ids).toEqual([]);
  });

  it("create_nodes devolve raízes e create_page ensure reaproveita a página", async () => {
    const c = client;
    const made = (await c.callTool({
      name: "create_nodes",
      arguments: {
        nodes: [{
          type: "frame", id: "board", name: "Board", x: 12, y: 8, width: 200, height: 80,
          children: [
            { type: "text", id: "title", name: "Title", text: "Oi", width: 40, height: 16 },
            { type: "rect", id: "swatch", width: 10, height: 10 },
          ],
        }],
      },
    })) as ToolResult & { structuredContent?: { ids: string[]; roots: { id: string; name: string; type: string; x: number; y: number; width: number; height: number }[]; created: { id: string; name: string; type: string; parentId: string | null }[]; version: number } };
    const sc = made.structuredContent!;
    assertOutput("create_nodes", sc);
    expect(sc.roots).toEqual([{ id: "board", name: "Board", type: "frame", x: 12, y: 8, width: 200, height: 80 }]);
    expect(sc.ids).toEqual(["board", "title", "swatch"]);
    expect(sc.created).toEqual([
      { id: "board", name: "Board", type: "frame", parentId: null },
      { id: "title", name: "Title", type: "text", parentId: "board" },
      { id: "swatch", name: "", type: "rect", parentId: "board" },
    ]);
    expect(textOf(made)).toContain('frame#board "Board" 200×80 @12,8');
    expect(textOf(made)).not.toContain("text#title");
    const first = jsonOf(await call(c, "create_page", { name: "Interfaces", ensure: true }));
    assertOutput("create_page", first);
    const second = jsonOf(await call(c, "create_page", { name: "Interfaces", ensure: true, id: "other" }));
    assertOutput("create_page", second);
    expect(second).toMatchObject({ page: first.page, created: [], ensured: true, version: first.version });
    const pages = textOf(await call(c, "get_document_outline")).match(/page#\S+ "Interfaces"/g) ?? [];
    expect(pages).toHaveLength(1);
    const missing = await call(c, "create_page", { ensure: true });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toBe("create_page ensure requires a name");
  });

  it("fluxo completo: tokens → criar → lint → corrigir → exportar → desfazer", async () => {
    const c = client;
    await call(c, "set_tokens", { tokens: { bg: "#ffffff", ink: "#111111", faint: "#dddddd" } });
    const created = jsonOf(
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
    );
    expect(created.ids).toEqual(["login", "h", "sub"]);
    expect(created.roots.map((n: { id: string }) => n.id)).toEqual(["login"]);
    expect(created.created.map((n: { id: string }) => n.id)).toEqual(["login", "h", "sub"]);
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

  it("runs de texto vão no create, no get e no HTML", async () => {
    const c = client;
    await call(c, "create_nodes", {
      nodes: [
        {
          type: "text", id: "rich", text: "Hello bold link", width: 280, height: 40,
          runs: [
            { start: 6, end: 10, fontWeight: 700, color: "#c43d27" },
            { start: 11, end: 15, italic: true, href: "https://paprika.dev", fontSize: 28 },
          ],
        },
      ],
    });
    const nodes = JSON.parse(textOf(await call(c, "get_nodes", { ids: ["rich"] })));
    expect(nodes[0].runs).toEqual([
      { start: 6, end: 10, fontWeight: 700, color: "#c43d27" },
      { start: 11, end: 15, italic: true, href: "https://paprika.dev", fontSize: 28 },
    ]);
    const html = textOf(await call(c, "export_code", { rootId: "rich", format: "html" }));
    expect(html).toContain("font-weight:700");
    expect(html).toContain('href="https://paprika.dev"');
    expect(html).toContain("font-style:italic");
    const bad = await call(c, "update_nodes", { updates: [{ id: "rich", props: { runs: [{ start: 0, end: 99, fontWeight: 700 }] } }] });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/run ends past the text/);
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
    const created = jsonOf(
      await call(c, "create_nodes", { nodes: [{ type: "path", id: "wave", d: "M0 40 C 30 -10 70 90 100 40", stroke: { color: "#c43d27", width: 4 } }] }),
    );
    expect(created.ids).toEqual(["wave"]);
    expect(created.roots).toHaveLength(1);
    expect(created.created[0]).toMatchObject({ id: "wave", type: "path", parentId: null });
    const node = (await srv.doc()).nodes.wave as PathNode;
    expect(node.width).toBe(100);
    expect(node.height).toBe(55);
    const info = JSON.parse(textOf(await call(c, "path_info", { id: "wave" })));
    expect(info).toMatchObject({ segments: 2, curves: 1, closed: false });
    expect(info.bounds.y).toBeGreaterThan(10);
    expect(info.origin).toEqual({ x: info.bounds.x, y: info.bounds.y });
    expect(info.transformOrigin).toEqual({ x: 50, y: (node.height as number) / 2 });
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

  it("edit_path move uma âncora e path_info lista os mesmos pontos", async () => {
    const c = client;
    await call(c, "create_nodes", { nodes: [{ type: "path", id: "wave2", x: 100, y: 50, d: "M0 0 L10 0 L10 10" }] });
    const info = JSON.parse(textOf(await call(c, "path_info", { id: "wave2" }))) as {
      anchors: { index: number; sub: number; at: number; x: number; y: number }[];
    };
    expect(info.anchors).toEqual([
      { index: 0, sub: 0, at: 0, x: 0, y: 0 },
      { index: 1, sub: 0, at: 1, x: 10, y: 0 },
      { index: 2, sub: 0, at: 2, x: 10, y: 10 },
    ]);
    const bare = JSON.parse(textOf(await call(c, "path_info", { d: "M0 0 C5 0 10 5 10 10" }))) as {
      anchors: { index: number; in?: { x: number; y: number } }[];
    };
    expect(bare.anchors.map((a) => a.index)).toEqual([0, 1]);
    expect(bare.anchors[1]?.in).toEqual({ x: 10, y: 5 });
    const edited = (await c.callTool({
      name: "edit_path",
      arguments: { id: "wave2", index: 0, position: { x: -5, y: -3 } },
    })) as ToolResult & { structuredContent?: { props: { d: string; x: number; y: number; width: number; height: number }; anchors: unknown; version: number } };
    expect(edited.isError).toBeFalsy();
    assertOutput("edit_path", edited.structuredContent);
    expect(edited.structuredContent?.props).toEqual({ d: "M0 0 L15 3 L15 13", x: 95, y: 47, width: 15, height: 13 });
    const again = JSON.parse(textOf(await call(c, "path_info", { id: "wave2" }))) as { anchors: unknown };
    expect(again.anchors).toEqual(edited.structuredContent?.anchors);
    const hist = JSON.parse(textOf(await call(c, "get_history", { limit: 1 }))) as { label: string }[];
    expect(hist[0]?.label).toBe("move point");
    const missing = await call(c, "edit_path", { id: "wave2", index: 0 });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toMatch(/pass position or handles/);
    const range = await call(c, "edit_path", { id: "wave2", index: 9, position: { x: 0, y: 0 } });
    expect(range.isError).toBe(true);
    expect(textOf(range)).toMatch(/out of range/);
    await call(c, "undo");
    expect(((await srv.doc()).nodes.wave2 as PathNode).d).toBe("M0 0 L10 0 L10 10");
  });

  it("get_bounds resolve auto-layout e cantos rotacionados", async () => {
    const c = client;
    await call(c, "create_nodes", {
      nodes: [{
        type: "frame", id: "outer", x: 0, y: 0, width: 320, height: 200,
        layout: { mode: "column", gap: 8, padding: 16 },
        children: [
          {
            type: "frame", id: "inner", width: "fill", height: "hug",
            layout: { mode: "row", gap: 4, padding: 8, align: "center" },
            children: [
              { type: "rect", id: "a", width: 40, height: 20, fill: "#111" },
              { type: "rect", id: "b", width: "fill", height: 20, fill: "#222" },
              { type: "rect", id: "spin", width: 24, height: 24, rotation: 90, fill: "#333" },
            ],
          },
          { type: "path", id: "gap", d: "M40 30 L80 30 L60 70 Z", normalize: true, fill: "#c43d27" },
        ],
      }],
    });
    const bounds = JSON.parse(textOf(await call(c, "get_bounds", { ids: ["inner", "b", "spin", "gap"] })));
    expect(bounds.boxes.inner.width).toBeCloseTo(288, 0);
    expect(bounds.boxes.b.width).toBeCloseTo(288 - 16 - 40 - 24 - 8, 0);
    expect(bounds.boxes.spin.corners).toHaveLength(4);
    expect(bounds.boxes.spin.origin).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    const gap = (await srv.doc()).nodes.gap as PathNode;
    expect(gap).toMatchObject({ x: 40, y: 30, width: 40, height: 40 });
    expect(gap.d.startsWith("M0 0") || gap.d.startsWith("M0 0 ")).toBe(true);
  });

  it("layoutPositioning absolute sai do fluxo, do gap e do hug", async () => {
    const bad = await call(client, "create_nodes", { nodes: [{ type: "rect", id: "nope", layoutPositioning: "pinned" }] });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/layoutPositioning/);
    await call(client, "create_nodes", {
      place: "none",
      nodes: [{
        type: "frame", id: "arow", x: 0, y: 0, width: "hug", height: "hug",
        layout: { mode: "row", gap: 8, padding: 0 },
        children: [
          { type: "rect", id: "aa", width: 40, height: 20, fill: "#111111" },
          { type: "rect", id: "apin", width: 16, height: 16, x: 100, y: 4, fill: "#c43d27", layoutPositioning: "absolute" },
          { type: "rect", id: "ab", width: 30, height: 20, fill: "#222222" },
        ],
      }],
    });
    expect((await srv.doc()).nodes.apin).toMatchObject({ layoutPositioning: "absolute", x: 100, y: 4 });
    const bounds = JSON.parse(textOf(await call(client, "get_bounds", { ids: ["arow", "aa", "ab", "apin"] })));
    expect(bounds.boxes.arow.width).toBeCloseTo(78, 0);
    expect(bounds.boxes.arow.height).toBeCloseTo(20, 0);
    expect(bounds.boxes.aa).toMatchObject({ x: 0, y: 0 });
    expect(bounds.boxes.ab.x).toBeCloseTo(48, 0);
    expect(bounds.boxes.apin).toMatchObject({ x: 100, y: 4, width: 16, height: 16 });
    const html = textOf(await call(client, "export_code", { rootId: "arow", format: "html" }));
    expect(html).toContain('data-paprika-id="apin"');
    expect(html).toContain("left:100px");
    expect(html).toContain("position:absolute");
    await call(client, "update_nodes", { updates: [{ id: "apin", props: { layoutPositioning: null } }] });
    expect((await srv.doc()).nodes.apin).not.toHaveProperty("layoutPositioning");
    const back = JSON.parse(textOf(await call(client, "get_bounds", { ids: ["arow"] })));
    expect(back.boxes.arow.width).toBeCloseTo(102, 0);
  });

  it("constraints reposicionam o filho fora do fluxo quando o pai muda de tamanho", async () => {
    const bad = await call(client, "create_nodes", { nodes: [{ type: "rect", id: "badc", constraints: { horizontal: "stretch" } }] });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/constraints/);
    await call(client, "create_nodes", {
      place: "none",
      nodes: [{
        type: "frame", id: "cboard", x: 0, y: 0, width: 200, height: 100,
        layout: { mode: "column", gap: 0, padding: 0 },
        children: [
          { type: "rect", id: "cflow", x: 4, y: 4, width: 20, height: 10, constraints: { horizontal: "right" } },
          { type: "rect", id: "cpin", x: 140, y: 70, width: 40, height: 16, layoutPositioning: "absolute", constraints: { horizontal: "right", vertical: "bottom" } },
        ],
      }],
    });
    await call(client, "update_nodes", { updates: [{ id: "cboard", props: { width: 300, height: 160 } }] });
    const nodes = (await srv.doc()).nodes;
    expect(nodes.cpin).toMatchObject({ x: 240, y: 130, width: 40, height: 16 });
    expect(nodes.cflow).toMatchObject({ x: 4, y: 4, width: 20 });
    await call(client, "update_nodes", { updates: [{ id: "cpin", props: { constraints: null } }] });
    expect((await srv.doc()).nodes.cpin).not.toHaveProperty("constraints");
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
    expect(r.structuredContent).toEqual(await withWorkspace({ nodes: ["start", "ok", "memo"], edges: ["start-to-ok", "memo-to-ok"], created: ["start", "ok", "memo", "start-to-ok", "memo-to-ok"], version: 1 }));
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
    const tri = (await c.callTool({
      name: "draw_diagram",
      arguments: {
        nodes: [{ id: "tip", text: "Go", shape: "triangle" }, { id: "box", text: "Next" }],
        edges: [{ from: "tip", to: "box" }],
      },
    })) as ToolResult & { structuredContent?: { nodes: string[]; edges: string[] } };
    expect(tri.isError).toBeFalsy();
    expect(tri.structuredContent?.nodes).toEqual(["tip", "box"]);
    const after = await srv.doc();
    expect(after.nodes.tip).toMatchObject({ type: "shape", shape: "triangle" });
    await call(c, "create_nodes", {
      nodes: [
        { type: "shape", id: "cyl", shape: "cylinder", x: 0, y: 400 },
        { type: "shape", id: "para", shape: "parallelogram", x: 220, y: 400 },
        { type: "shape", id: "cld", shape: "cloud", x: 440, y: 400 },
      ],
    });
    const more = await srv.doc();
    expect(more.nodes.cyl).toMatchObject({ type: "shape", shape: "cylinder", fill: "#ffffff" });
    expect(more.nodes.para).toMatchObject({ shape: "parallelogram" });
    expect(more.nodes.cld).toMatchObject({ shape: "cloud" });
    expect(after.nodes["tip-to-box"]).toMatchObject({ type: "connector", from: { nodeId: "tip" }, to: { nodeId: "box" } });
    expect((after.nodes["tip-to-box"] as { d: string }).d.startsWith("M")).toBe(true);
  });

  it("diagramas: rotas rounded e curve (PAP-B-045)", async () => {
    const c = client;
    const r = (await c.callTool({
      name: "draw_diagram",
      arguments: {
        nodes: [{ id: "a", text: "A", x: 0, y: 0 }, { id: "b", text: "B", x: 240, y: 120 }],
        edges: [
          { from: "a", to: "b", id: "round", route: "rounded", radius: 12 },
          { from: "a", to: "b", id: "bend", route: "curve", control: { x: 120, y: -40 } },
        ],
      },
    })) as ToolResult & { structuredContent?: unknown };
    expect(r.isError).toBeFalsy();
    const doc = await srv.doc();
    expect(doc.nodes.round).toMatchObject({ route: "rounded", radius: 12 });
    expect((doc.nodes.round as { d: string }).d).toContain("A");
    expect(doc.nodes.bend).toMatchObject({ route: "curve", control: { x: 120, y: -40 } });
    expect((doc.nodes.bend as { d: string }).d).toMatch(/ C/);
  });

  it("diagramas: cotovelo desvia de uma forma e relayout recalcula ids existentes (PAP-B-077)", async () => {
    const c = client;
    const drawn = await call(c, "draw_diagram", {
      nodes: [
        { id: "a", text: "A", x: 0, y: 0, width: 160, height: 80 },
        { id: "b", text: "B", x: 0, y: 300, width: 160, height: 80 },
        { id: "block", text: "X", x: 40, y: 160, width: 80, height: 40 },
      ],
      edges: [
        { from: "a", to: "b", id: "ab" },
        { from: "a", to: "b", id: "st", route: "straight" },
      ],
    });
    expect(drawn.isError).toBeFalsy();
    const box = { x: 40, y: 160, w: 80, h: 40 };
    const doc = await srv.doc();
    const elbow = doc.nodes.ab as { x: number; y: number; d: string; route: string };
    const straight = doc.nodes.st as { x: number; y: number; d: string };
    expect(elbow.route).toBe("elbow");
    expect(routeHitsBox(elbow, box)).toBe(false);
    expect(routeHitsBox(straight, box)).toBe(true);
    const before = (JSON.parse(textOf(await call(c, "get_history", { limit: 10 }))) as unknown[]).length;
    const again = await call(c, "draw_diagram", { relayout: true, nodes: [{ id: "a", x: 0, y: 12 }] });
    expect(again.isError).toBeFalsy();
    expect(jsonOf(again).nodes).toEqual(["a"]);
    expect((await srv.doc()).nodes.a).toMatchObject({ x: 0, y: 12 });
    expect(routeHitsBox((await srv.doc()).nodes.ab as { x: number; y: number; d: string }, box)).toBe(false);
    expect((JSON.parse(textOf(await call(c, "get_history", { limit: 10 }))) as unknown[]).length).toBe(before + 1);
    await call(c, "undo");
    expect((await srv.doc()).nodes.a).toMatchObject({ x: 0, y: 0 });
    const bad = await call(c, "draw_diagram", { relayout: true, nodes: [{ id: "ab" }] });
    expect(textOf(bad)).toContain('id "ab" is a connector; relayout only updates existing shapes');
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

  it("pastas, referência travada e render_screenshot compare lado a lado", async () => {
    const folder = (await call(client, "create_folder", { name: "Produto" })) as ToolResult & { structuredContent: { folder: { id: string; name: string } } };
    expect(folder.isError, textOf(folder)).toBeFalsy();
    assertOutput("create_folder", folder.structuredContent);
    const folderId = folder.structuredContent.folder.id;
    const renamed = (await call(client, "rename_folder", { id: folderId, name: "Marca" })) as ToolResult & { structuredContent: { folder: { name: string } } };
    assertOutput("rename_folder", renamed.structuredContent);
    expect(renamed.structuredContent.folder.name).toBe("Marca");
    const made = (await call(client, "create_workspace", { name: "Na pasta" })) as ToolResult & { structuredContent: { workspace: { id: string } } };
    const moved = (await call(client, "move_workspace", { id: made.structuredContent.workspace.id, folderId })) as ToolResult & {
      structuredContent: { workspace: { folderId: string; preview: unknown[] } };
    };
    assertOutput("move_workspace", moved.structuredContent);
    expect(moved.structuredContent.workspace.folderId).toBe(folderId);
    const listed = (await call(client, "list_workspaces")) as ToolResult & {
      structuredContent: { folders: { id: string; name: string }[]; workspaces: { id: string; folderId: string }[] };
    };
    assertOutput("list_workspaces", listed.structuredContent);
    expect(listed.structuredContent.folders.some((f) => f.id === folderId && f.name === "Marca")).toBe(true);
    expect(listed.structuredContent.workspaces.find((w) => w.id === made.structuredContent.workspace.id)?.folderId).toBe(folderId);
    const back = (await call(client, "move_workspace", { id: made.structuredContent.workspace.id, folderId: null })) as ToolResult & {
      structuredContent: { workspace: { folderId: string } };
    };
    expect(back.structuredContent.workspace.folderId).toBe("");
    expect((await call(client, "move_workspace", { id: made.structuredContent.workspace.id, folderId: "nope" })).isError).toBe(true);
    expect((await call(client, "rename_folder", { id: "nope", name: "x" })).isError).toBe(true);

    await call(client, "create_nodes", {
      nodes: [{
        type: "frame", id: "screen", width: 80, height: 40, fill: "#ffffff",
        children: [{ type: "rect", id: "dot", x: 8, y: 8, width: 12, height: 12, fill: "#111111" }],
      }],
    });
    const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const ref = (await call(client, "place_reference", { src: pixel, frameId: "screen" })) as ToolResult & {
      structuredContent: { locked: boolean; opacity: number; frameId: string; id: string };
    };
    expect(ref.isError, textOf(ref)).toBeFalsy();
    assertOutput("place_reference", ref.structuredContent);
    expect(ref.structuredContent).toMatchObject({ locked: true, opacity: 0.5, frameId: "screen" });
    const nodes = JSON.parse(textOf(await call(client, "get_nodes", { ids: ["screen"] }))) as { children?: string[] }[];
    expect(nodes[0]?.children?.[0]).toBe(ref.structuredContent.id);

    const plain = await call(client, "render_screenshot", { rootId: "screen" });
    const side = (await call(client, "render_screenshot", { rootId: "screen", compare: pixel })) as ToolResult & {
      structuredContent: { width: number; height: number; compare: boolean };
    };
    expect(side.isError, textOf(side)).toBeFalsy();
    assertOutput("render_screenshot", side.structuredContent);
    const size = (r: ToolResult) => {
      const buf = Buffer.from(r.content.find((c) => c.type === "image")!.data!, "base64");
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    };
    expect(size(side).w).toBeGreaterThan(size(plain).w);
    expect(size(side).h).toBe(size(plain).h);
    expect(side.structuredContent.compare).toBe(true);
    expect(textOf(side)).toContain("side by side");
  }, 30_000);

  it("render_screenshot grava path, recusa travessia, baixa por url e pinta o modo herdado", async () => {
    await call(client, "set_tokens", { tokens: { bg: "#111111" } });
    await call(client, "set_tokens", { mode: "light", tokens: { bg: "#ffffff" } });
    await call(client, "set_tokens", { mode: "dark", tokens: { bg: "#111111" } });
    await call(client, "create_nodes", { nodes: [{ type: "page", id: "pg", mode: "dark", fill: "$bg" }] });
    await call(client, "create_nodes", {
      parentId: "pg",
      nodes: [
        {
          type: "frame", id: "light", mode: "light", width: 40, height: 20, fill: "$bg",
          children: [{ type: "rect", id: "sub", width: 40, height: 20, fill: "$bg" }],
        },
        {
          type: "frame", id: "darkf", width: 40, height: 20, fill: "$bg",
          children: [{ type: "rect", id: "subdark", width: 40, height: 20, fill: "$bg" }],
        },
      ],
    });
    const outside = await call(client, "render_screenshot", { rootId: "sub", path: "../secret.png" });
    expect(outside.isError).toBe(true);
    expect(textOf(outside)).toContain("outside");
    const abs = await call(client, "render_screenshot", { rootId: "sub", path: "/tmp/paprika-shot.png" });
    expect(abs.isError).toBe(true);
    expect(textOf(abs)).toContain("outside");

    const saved = JSON.parse(textOf(await call(client, "render_screenshot", { rootId: "sub", path: "boards/shot.png" }))) as {
      path: string; width: number; height: number; url: string;
    };
    expect(saved.width).toBe(40);
    expect(saved.height).toBe(20);
    expect(saved.url).toMatch(/^\/api\/screenshot\/[0-9a-f]{16}$/);
    expect(saved.path.startsWith(srv.dir)).toBe(true);
    const file = readFileSync(saved.path);
    expect(statSync(saved.path).size).toBe(file.length);
    expect(file.subarray(1, 4).toString()).toBe("PNG");
    expect(file.readUInt32BE(16)).toBe(saved.width);
    expect(file.readUInt32BE(20)).toBe(saved.height);
    const downloaded = Buffer.from(await (await fetch(`${srv.url}${saved.url}`)).arrayBuffer());
    expect(downloaded.equals(file)).toBe(true);

    const inherited = await call(client, "render_screenshot", { rootId: "sub" });
    expect(inherited.isError, textOf(inherited)).toBeFalsy();
    expect(inherited.content.some((c) => c.type === "image")).toBe(true);
    const forced = await call(client, "render_screenshot", { rootId: "subdark", mode: "light" });
    const plain = await call(client, "render_screenshot", { rootId: "subdark" });
    const pngOf = (r: ToolResult) => Buffer.from(r.content.find((c) => c.type === "image")!.data!, "base64");
    const lightPx = pngPixel(pngOf(forced), 20, 10);
    const darkPx = pngPixel(pngOf(plain), 20, 10);
    const inheritedPx = pngPixel(pngOf(inherited), 20, 10);
    expect(lightPx.every((v) => v > 250)).toBe(true);
    expect(inheritedPx.every((v) => v > 250)).toBe(true);
    expect(darkPx.every((v) => v < 40)).toBe(true);
  }, 60_000);

  it("importar SVG/HTML e exportar SVG", async () => {
    const c = client;
    const svg = await call(c, "import_svg", {
      svg: '<svg viewBox="0 0 24 24" width="48" height="48"><title>Ícone</title><g fill="#c43d27" transform="rotate(10 12 12)"><rect x="2" y="2" width="20" height="20" rx="4"/><circle cx="12" cy="12" r="4" fill="#fff"/></g><style>a{}</style></svg>',
      x: 10,
      y: 10,
    });
    const svgOut = jsonOf(svg);
    expect(svgOut.created).toHaveLength(3);
    expect(svgOut.roots).toHaveLength(1);
    assertOutput("import_svg", svgOut);
    expect(svgOut).toMatchObject({ version: 1, warnings: ['CSS in <style> is not applied; use attributes or style="" on the elements'] });
    const anon = (t: string) => t.replace(/#[0-9a-z]{10}\b/g, "#…").replace(/data-paprika-id="[^"]+"/g, 'data-paprika-id="…"');
    expect(anon(outlineText(await call(c, "get_document_outline", { rootId: svgOut.ids[0] })))).toMatchInlineSnapshot(`
      "workspace ID "doc" v1 · 3 nodes
      tokens: (none)
      renderer: none

      group#… "Ícone" 44×44 @12.0972,12.0972
        path#… 44×44 @0,0 fill=#c43d27 d="M13.56 0.12 L37.19 4.29 C41.54 5.06 44.45 9.2..."
        path#… 17×17 @13.9015,13.9015 fill=#fff d="M15.88 9.39 C15.11 13.74 10.96 16.65 6.61 15...."
      content: x=12.0972 y=12.0972 w=44 h=44
      next: x=136.0972 y=12.0972"
    `);
    const html = await call(c, "import_html", {
      html: '<div style="display:flex; gap:8px; padding:12px; background:#fbf8f4; width:200px"><div style="width:40px; height:40px; background:#c43d27; border-radius:8px"></div><div style="flex:1; height:40px; border:2px solid #1d1a1f"></div></div>',
      x: 0,
      y: 100,
      label: "colar HTML",
    });
    expect(textOf(html)).toMatch(/"created": \[/);
    const htmlOut = jsonOf(html);
    assertOutput("import_html", htmlOut);
    const root = htmlOut.ids[0];
    expect(anon(outlineText(await call(c, "get_document_outline", { rootId: root })))).toMatchInlineSnapshot(`
      "workspace ID "doc" v2 · 6 nodes
      tokens: (none)
      renderer: none

      frame#… 200×hug @0,100 fill=#fbf8f4 row gap=8
        frame#… 40×40 @0,0 fill=#c43d27
        frame#… fill×40 @0,0
      content: x=0 y=12.0972 w=200 h=151.9028
      next: x=280 y=12.0972"
    `);
    const out = await call(c, "export_code", { rootId: root, format: "svg" });
    expect(out.isError, textOf(out)).toBeFalsy();
    expect(anon(out.content[0]!.text!)).toMatchInlineSnapshot(`"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="64" viewBox="0 0 200 64"><g data-paprika-id="…" transform="translate(0 0)"><rect x="0" y="0" width="200" height="64" fill="#fbf8f4"/><g data-paprika-id="…" transform="translate(12 12)"><rect x="0" y="0" width="40" height="40" rx="8" fill="#c43d27"/></g><g data-paprika-id="…" transform="translate(60 12)"><rect x="1" y="1" width="126" height="38" fill="none" stroke="#1d1a1f" stroke-width="2"/></g></g></svg>"`);
    const icon = await call(c, "export_code", { rootId: svgOut.ids[0], format: "svg" });
    expect(anon(icon.content[0]!.text!)).toMatchInlineSnapshot(`"<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><g data-paprika-id="…" data-name="Ícone" transform="translate(0 0)"><g data-paprika-id="…" transform="translate(0 0)"><svg width="44" height="44" overflow="visible"><path d="M13.56 0.12 L37.19 4.29 C41.54 5.06 44.45 9.21 43.68 13.56 L39.52 37.19 C38.75 41.54 34.6 44.45 30.25 43.68 L6.61 39.52 C2.26 38.75 -0.64 34.6 0.12 30.25 L4.29 6.61 C5.06 2.26 9.21 -0.64 13.56 0.12 Z" fill="#c43d27" fill-rule="nonzero" stroke-linecap="round" stroke-linejoin="round"/></svg></g><g data-paprika-id="…" transform="translate(13.9 13.9)"><svg width="17" height="17" overflow="visible"><path d="M15.88 9.39 C15.11 13.74 10.96 16.65 6.61 15.88 C2.26 15.11 -0.64 10.96 0.12 6.61 C0.89 2.26 5.04 -0.64 9.39 0.12 C13.74 0.89 16.65 5.04 15.88 9.39 Z" fill="#fff" fill-rule="nonzero" stroke-linecap="round" stroke-linejoin="round"/></svg></g></g></svg>"`);
    const bad = await call(c, "import_html", { html: "<!-- nada -->" });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toBe("the HTML has no elements to import");

    const sprite = await call(c, "import_svg", {
      svg: `<svg xmlns="http://www.w3.org/2000/svg"><defs><symbol id="box" viewBox="0 0 10 10"><rect width="10" height="10" fill="#c43d27"/></symbol></defs><use href="#box" x="0" y="0" width="10" height="10"/><text x="0" y="20" font-size="14" fill="#112233">Oi</text></svg>`,
      place: "none",
    });
    expect(sprite.isError, textOf(sprite)).toBeFalsy();
    type Got = { type: string; text?: string; fill?: string; color?: string; children?: string[]; layout?: { mode?: string; gap?: number } };
    const walk = async (ids: string[]): Promise<Got[]> => {
      const nodes = JSON.parse(textOf(await call(c, "get_nodes", { ids }))) as Got[];
      const kids = nodes.flatMap((n) => n.children ?? []);
      return kids.length ? nodes.concat(await walk(kids)) : nodes;
    };
    const drawn = await walk((jsonOf(sprite) as { ids: string[] }).ids);
    expect(drawn.some((n) => n.type === "text" && n.text === "Oi" && n.color === "#112233")).toBe(true);
    expect(drawn.some((n) => n.type === "rect" && n.fill === "#c43d27")).toBe(true);

    const computed = await call(c, "import_html", {
      html: `<style>.card{display:flex;gap:8px;background:#abcdef;width:120px;color:#112233}</style><div class="card"><span>Estilo</span></div>`,
      computed: true,
      place: "none",
    });
    if (computed.isError && /Chromium/.test(textOf(computed))) {
      expect(textOf(computed)).toMatch(/playwright install chromium|PAPRIKA_CHROMIUM/);
    } else {
      expect(computed.isError, textOf(computed)).toBeFalsy();
      expect(textOf(computed)).toMatch(/Chromium computed style/);
      const styled = await walk((jsonOf(computed) as { ids: string[] }).ids);
      const label = styled.find((n) => n.type === "text" && n.text === "Estilo");
      expect(label?.color === "#112233" || label?.color === "rgb(17, 34, 51)").toBe(true);
      expect(styled.some((n) => n.type === "frame" && n.layout?.mode === "row" && n.layout.gap === 8)).toBe(true);
    }

    const fig = await call(c, "import_image", { src: "nope.fig" });
    expect(fig.isError).toBe(true);
    expect(textOf(fig)).toMatch(/\.fig is not imported/);
    const pdf = await call(c, "import_image", { src: "data:application/pdf;base64,JVBERi0xLjQK" });
    expect(pdf.isError).toBe(true);
    expect(textOf(pdf)).toMatch(/PDF is not imported/);
  }, 30_000);

  it("export_image: PNG/JPEG/WebP/PDF sem Chromium a partir do SVG do core", async () => {
    const previousChromium = process.env.PAPRIKA_CHROMIUM;
    delete process.env.PAPRIKA_CHROMIUM;
    const own = await startServer();
    if (previousChromium === undefined) delete process.env.PAPRIKA_CHROMIUM;
    else process.env.PAPRIKA_CHROMIUM = previousChromium;
    const c = new Client({ name: "parity", version: "0" });
    try {
      await c.connect(new StreamableHTTPClientTransport(new URL(`${own.url}/mcp`)));
      await call(c, "create_nodes", {
        parentId: null,
        nodes: [{ type: "frame", id: "shot", width: 80, height: 40, fill: "#c43d27", children: [] }],
      });
      for (const format of ["png", "jpeg", "webp", "pdf"] as const) {
        const out = (await call(c, "export_image", { rootId: "shot", format, scale: 1 })) as ToolResult & {
          structuredContent?: { width: number; height: number; format: string; mimeType: string };
        };
        expect(out.isError, textOf(out)).toBeFalsy();
        const sc = out.structuredContent!;
        expect(sc.width).toBe(80);
        expect(sc.height).toBe(40);
        expect(sc.format).toBe(format);
        expect(sc.mimeType.length).toBeGreaterThan(3);
        const img = out.content.find((b) => b.type === "image");
        expect(img?.data?.length ?? 0).toBeGreaterThan(40);
      }
    } finally {
      await c.close();
      await own.stop();
    }
  }, 60_000);

  it("entradas estritas: padding de 2 valores, argumentos desconhecidos, get_nodes parcial, export_image svg", async () => {
    const c = client;
    // padding [vertical, horizontal] normalizes like CSS; other lengths name the accepted shapes.
    const ok = await call(c, "create_nodes", {
      nodes: [{ type: "frame", id: "strict-pad", width: 100, height: 60, layout: { mode: "row", padding: [8, 16] } }],
    });
    expect(ok.isError, textOf(ok)).toBeFalsy();
    const got = (await call(c, "get_nodes", { ids: ["strict-pad"] })) as ToolResult & {
      structuredContent?: { nodes: { layout: { padding: unknown } }[]; missing?: string[] };
    };
    expect(got.structuredContent!.nodes[0]!.layout.padding).toEqual([8, 16, 8, 16]);
    expect(got.structuredContent!.missing).toBeUndefined();
    const three = await call(c, "create_nodes", { nodes: [{ type: "frame", id: "strict-pad3", layout: { padding: [1, 2, 3] } }] });
    expect(three.isError).toBe(true);
    expect(textOf(three)).toMatch(/\[vertical, horizontal\] or \[top, right, bottom, left\]/);

    // Gradient strings in a color point at the structured gradient field; width tokens name the accepted shapes.
    const grad = await call(c, "create_nodes", { nodes: [{ type: "path", id: "strict-g", d: "M0 0 L10 10", fill: "linear-gradient(90deg, #fff, #000)" }] });
    expect(grad.isError).toBe(true);
    expect(textOf(grad)).toMatch(/structured gradient field/);
    const tok = await call(c, "create_nodes", { nodes: [{ type: "rect", id: "strict-w", width: "$space.8" }] });
    expect(tok.isError).toBe(true);
    expect(textOf(tok)).toMatch(/number \(0\.\.100000\), "hug" or "fill"/);
    const lh = await call(c, "create_nodes", { nodes: [{ type: "text", id: "strict-t", text: "a", lineHeight: 22 }] });
    expect(lh.isError).toBe(true);
    expect(textOf(lh)).toMatch(/multiplier.*1\.375/);

    // Unknown top-level arguments are rejected with the valid keys and a hint.
    for (const [tool, args, hint] of [
      ["render_screenshot", { id: "strict-pad" }, "rootId"],
      ["render_screenshot", { nodeId: "strict-pad" }, "rootId"],
      ["export_image", { id: "strict-pad" }, "rootId"],
      ["export_code", { nodeId: "strict-pad", format: "html" }, "rootId"],
      ["lint_design", { ids: ["strict-pad"] }, "rootIds"],
    ] as const) {
      const bad = await call(c, tool, args);
      expect(bad.isError, tool).toBe(true);
      expect(textOf(bad)).toContain(`did you mean "${hint}"`);
      expect(textOf(bad)).toMatch(/valid arguments: /);
    }

    // get_nodes returns the nodes that exist plus `missing`; it fails only when none exist.
    const part = (await call(c, "get_nodes", { ids: ["strict-pad", "strict-gone"] })) as ToolResult & {
      structuredContent?: { nodes: { id: string }[]; missing?: string[] };
    };
    expect(part.isError, textOf(part)).toBeFalsy();
    expect(part.structuredContent!.nodes.map((n) => n.id)).toEqual(["strict-pad"]);
    expect(part.structuredContent!.missing).toEqual(["strict-gone"]);
    expect(textOf(part)).toContain("strict-gone");
    const none = await call(c, "get_nodes", { ids: ["strict-gone"] });
    expect(none.isError).toBe(true);

    // export_image accepts svg (same vector SVG as export_code).
    const svg = (await call(c, "export_image", { rootId: "strict-pad", format: "svg" })) as ToolResult & {
      structuredContent?: { format: string; mimeType: string };
    };
    expect(svg.isError, textOf(svg)).toBeFalsy();
    expect(textOf(svg)).toMatch(/^<svg/);
    expect(svg.structuredContent).toMatchObject({ format: "svg", mimeType: "image/svg+xml" });
  }, 30_000);

  it("resize_image: presets, fit, upscale/downscale, GIF primeiro frame, sem Chromium", async () => {
    const previousChromium = process.env.PAPRIKA_CHROMIUM;
    delete process.env.PAPRIKA_CHROMIUM;
    const fixtures = join(repoRoot, "server-go/internal/server/testdata/images");
    const previous = process.env.PAPRIKA_IMPORT_DIRS;
    process.env.PAPRIKA_IMPORT_DIRS = fixtures;
    const own = await startServer();
    if (previous === undefined) delete process.env.PAPRIKA_IMPORT_DIRS;
    else process.env.PAPRIKA_IMPORT_DIRS = previous;
    if (previousChromium === undefined) delete process.env.PAPRIKA_CHROMIUM;
    else process.env.PAPRIKA_CHROMIUM = previousChromium;
    const c = new Client({ name: "parity", version: "0" });
    try {
      await c.connect(new StreamableHTTPClientTransport(new URL(`${own.url}/mcp`)));
      const presets: { preset: string | { width: number; height: number }; tw: number; th: number }[] = [
        { preset: "qhd", tw: 960, th: 540 },
        { preset: "hd", tw: 1280, th: 720 },
        { preset: "2k", tw: 2560, th: 1440 },
        { preset: "4k", tw: 3840, th: 2160 },
        { preset: { width: 64, height: 48 }, tw: 64, th: 48 },
      ];
      for (const p of presets) {
        for (const fit of ["contain", "cover", "fill"] as const) {
          const r = await call(c, "resize_image", { src: join(fixtures, "pixel.png"), preset: p.preset, fit });
          expect(r.isError, textOf(r)).toBeFalsy();
          const out = JSON.parse(textOf(r));
          expect(out).toMatchObject({ targetWidth: p.tw, targetHeight: p.th, fit, format: "png", sourceFormat: "png" });
          if (fit === "contain") {
            expect(out.width).toBeLessThanOrEqual(p.tw);
            expect(out.height).toBeLessThanOrEqual(p.th);
          } else {
            expect(out).toMatchObject({ width: p.tw, height: p.th });
          }
        }
      }
      const up = await call(c, "resize_image", { src: join(fixtures, "pixel.png"), preset: "hd", fit: "fill" });
      expect(up.isError, textOf(up)).toBeFalsy();
      expect(JSON.parse(textOf(up))).toMatchObject({ width: 1280, height: 720 });
      const gif = await call(c, "resize_image", { src: join(fixtures, "animated.gif"), preset: "qhd", fit: "contain" });
      expect(gif.isError, textOf(gif)).toBeFalsy();
      const gifOut = JSON.parse(textOf(gif));
      expect(gifOut.format).toBe("gif");
      expect(gifOut.warnings.join(" ")).toMatch(/first frame/i);
      const created = await call(c, "resize_image", { src: join(fixtures, "pixel.png"), preset: { width: 20, height: 15 }, fit: "fill" });
      const id = JSON.parse(textOf(created)).created[0] as string;
      const before = JSON.parse(textOf(await call(c, "get_nodes", { ids: [id] })))[0].src as string;
      const resized = await call(c, "resize_image", { nodeId: id, preset: { width: 40, height: 30 }, fit: "fill" });
      expect(resized.isError, textOf(resized)).toBeFalsy();
      expect(JSON.parse(textOf(resized))).toMatchObject({ id, width: 40, height: 30 });
      const after = JSON.parse(textOf(await call(c, "get_nodes", { ids: [id] })))[0].src as string;
      expect(after).not.toBe(before);
      const undo = await call(c, "undo", {});
      expect(undo.isError).toBeFalsy();
      expect(JSON.parse(textOf(await call(c, "get_nodes", { ids: [id] })))[0].src).toBe(before);
      const avif = await call(c, "resize_image", { src: join(fixtures, "pixel.avif"), preset: "hd", fit: "cover" });
      expect(avif.isError).toBe(true);
      expect(textOf(avif)).toMatch(/AVIF/);
    } finally {
      await c.close();
      await own.stop();
    }
  }, 60_000);

  it("importar imagem raster: formatos, GIF animado, path traversal e arquivo grande demais", async () => {
    const fixtures = join(repoRoot, "server-go/internal/server/testdata/images");
    const base = mkdtempSync(join(tmpdir(), "paprika-img-"));
    const allowed = join(base, "allowed");
    const outside = join(base, "outside");
    mkdirSync(allowed);
    mkdirSync(outside);
    for (const f of ["pixel.png", "pixel.jpg", "pixel.gif", "animated.gif", "pixel.webp", "pixel.avif"]) copyFileSync(join(fixtures, f), join(allowed, f));
    copyFileSync(join(fixtures, "pixel.png"), join(outside, "secret.png"));
    symlinkSync(join(outside, "secret.png"), join(allowed, "escape.png"));
    writeFileSync(join(allowed, "big.png"), Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), Buffer.alloc(3_500_000)]));
    const previous = process.env.PAPRIKA_IMPORT_DIRS;
    process.env.PAPRIKA_IMPORT_DIRS = allowed;
    const own = await startServer();
    if (previous === undefined) delete process.env.PAPRIKA_IMPORT_DIRS;
    else process.env.PAPRIKA_IMPORT_DIRS = previous;
    const c = new Client({ name: "parity", version: "0" });
    try {
      await c.connect(new StreamableHTTPClientTransport(new URL(`${own.url}/mcp`)));
      const expected: Record<string, { format: string; animated: boolean }> = {
        "pixel.png": { format: "png", animated: false },
        "pixel.jpg": { format: "jpeg", animated: false },
        "pixel.gif": { format: "gif", animated: false },
        "animated.gif": { format: "gif", animated: true },
        "pixel.webp": { format: "webp", animated: false },
        "pixel.avif": { format: "avif", animated: false },
      };
      for (const [file, want] of Object.entries(expected)) {
        const r = await call(c, "import_image", { src: join(allowed, file) });
        expect(r.isError, textOf(r)).toBeFalsy();
        const out = jsonOf(r);
        expect(out).toMatchObject({ format: want.format, naturalWidth: 4, naturalHeight: 3, animated: want.animated });
        expect(out.warnings).toHaveLength(want.animated ? 1 : 0);
        expect(out.roots).toHaveLength(1);
        assertOutput("import_image", out);
        const [node] = JSON.parse(textOf(await call(c, "get_nodes", { ids: out.ids })));
        expect(node).toMatchObject({ type: "image", width: 4, height: 3 });
        expect(node.src).toBe(`data:image/${want.format};base64,${readFileSync(join(allowed, file)).toString("base64")}`);
      }
      const shrunk = await call(c, "import_image", { src: "pixel.png", width: 2, fit: "contain", x: 5, y: 6, label: "logo" });
      expect(shrunk.isError, textOf(shrunk)).toBeFalsy();
      const [small] = JSON.parse(textOf(await call(c, "get_nodes", { ids: jsonOf(shrunk).ids })));
      expect(small).toMatchObject({ width: 2, height: 1.5, fit: "contain", x: 5, y: 6 });
      const version = await own.version();
      for (const src of ["../outside/secret.png", join(outside, "secret.png"), "escape.png", "../../../../../../../../etc/passwd"]) {
        const r = await call(c, "import_image", { src });
        expect(r.isError, src).toBe(true);
        expect(textOf(r)).toMatch(/outside the allowed directories|file not found/);
      }
      const big = await call(c, "import_image", { src: join(allowed, "big.png") });
      expect(big.isError).toBe(true);
      expect(textOf(big)).toContain("too large");
      expect(textOf(big)).toContain("limit 3500000 bytes");
      expect(await own.version()).toBe(version);
    } finally {
      await c.close();
      await own.stop();
    }
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

  it("propose_tokens: CSS, Tailwind e JSON viram set_tokens sem gravar e sem ler caminho (PAP-B-083)", async () => {
    const c = client;
    const before = textOf(await call(c, "get_document_outline", {}));
    const css = `:root { --color-bg: #ffffff; --space-md: 16px; --font-sans: Inter, sans-serif; --color-ink: var(--color-bg); }
.dark { --color-bg: #111111; }`;
    const proposed = await call(c, "propose_tokens", { content: css });
    expect(proposed.isError, textOf(proposed)).toBeFalsy();
    const out = jsonOf(proposed);
    assertOutput("propose_tokens", out);
    expect(out.format).toBe("css");
    expect(out.proposals[0]).toEqual({ op: "set_tokens", tokens: { "color-bg": "#ffffff", "space-md": 16, "color-ink": "$color-bg" } });
    expect(out.proposals[1]).toEqual({ op: "set_tokens", mode: "dark", tokens: { "color-bg": "#111111" } });
    expect(out.skipped).toEqual([{ name: "font-sans", reason: "not a color or a length" }]);
    expect(textOf(await call(c, "get_document_outline", {}))).toBe(before);
    for (const content of ["/etc/passwd", "../secrets.css", "tokens.json"]) {
      const refused = await call(c, "propose_tokens", { content });
      expect(refused.isError, content).toBe(true);
      expect(textOf(refused)).toContain("not a path");
    }
    const tailwind = await call(c, "propose_tokens", {
      format: "tailwind",
      content: `module.exports = { theme: { extend: { colors: { brand: '#c43d27' }, borderRadius: { md: '12px' } } } }`,
    });
    expect(tailwind.isError, textOf(tailwind)).toBeFalsy();
    const tw = jsonOf(tailwind);
    assertOutput("propose_tokens", tw);
    expect(tw).toMatchObject({ format: "tailwind", proposals: [{ op: "set_tokens", tokens: { "color.brand": "#c43d27", "radius.md": 12 } }] });
    const json = await call(c, "propose_tokens", {
      content: JSON.stringify({ color: { bg: { $value: "#000000" } }, size: 16 }),
    });
    expect(json.isError, textOf(json)).toBeFalsy();
    expect(jsonOf(json).proposals[0].tokens).toEqual({ "color.bg": "#000000", size: 16 });
    const applied = await call(c, "apply_ops", { ops: out.proposals, label: "tokens from css" });
    expect(applied.isError, textOf(applied)).toBeFalsy();
    const outline = textOf(await call(c, "get_document_outline", {}));
    expect(outline).toContain("$color-bg=#ffffff");
    expect(outline).toContain("$space-md=16");
    expect(outline).toContain("$color-ink=$color-bg");
    expect(outline).toContain("modes: dark($color-bg=#111111)");
  });

  it("tokens tipados, coleção e detach_tokens", async () => {
    const c = client;
    const typed = await call(c, "set_tokens", { tokens: { ink: "#111111" }, type: "color", collection: "brand" });
    expect(typed.isError, textOf(typed)).toBeFalsy();
    const weight = await call(c, "set_tokens", { tokens: { peso: 600 }, type: "fontWeight" });
    expect(weight.isError, textOf(weight)).toBeFalsy();
    const bad = await call(c, "set_tokens", { tokens: { ink: 12 }, type: "color" });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toContain("type color expects a color");
    const created = await call(c, "create_nodes", {
      nodes: [{ type: "text", id: "tok", text: "Aa", color: "$ink", fontWeight: "$peso" }],
    });
    expect(created.isError, textOf(created)).toBeFalsy();
    const outline = textOf(await call(c, "get_document_outline", {}));
    expect(outline).toContain("$ink=#111111 color @brand");
    expect(outline).toContain("$peso=600 fontWeight");
    const one = await call(c, "detach_tokens", { ids: ["tok"], fields: ["fontWeight"] });
    expect(one.isError, textOf(one)).toBeFalsy();
    expect((await srv.doc()).nodes.tok).toMatchObject({ fontWeight: 600, color: "$ink" });
    const all = await call(c, "detach_tokens", { ids: ["tok"] });
    expect(all.isError, textOf(all)).toBeFalsy();
    expect((await srv.doc()).nodes.tok).toMatchObject({ color: "#111111" });
  });

  it("export_code: tailwind, tailwind-html, css-modules, angular e svelte saem do mesmo estilo do canvas", async () => {
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
    const angular = (await call(c, "export_code", { rootId: "tw", format: "angular", cssVariables: true })).content.map((x) => x.text ?? "");
    expect(angular).toHaveLength(3);
    expect(angular[0]).toContain("// CardTailwind.component.ts");
    expect(angular[0]).toContain('selector: "app-card-tailwind"');
    expect(angular[0]).toContain("standalone: true");
    expect(angular[1]).toContain('class="cardTailwind"');
    expect(angular[1]).not.toContain(' style="');
    expect(angular[2]).toContain("/* CardTailwind.component.css */");
    expect(angular[2]).toContain(".cardTailwind{box-sizing:border-box;");
    const svelte = textOf(await call(c, "export_code", { rootId: "tw", format: "svelte" }));
    expect(svelte).toContain("<!-- CardTailwind.svelte -->");
    expect(svelte).toContain("<style>");
    expect(svelte).toContain('class="cardTailwind"');
    expect(svelte).not.toContain(' style="');
    for (const format of ["css-modules", "angular", "svelte"] as const) {
      const missing = await call(c, "export_code", { rootId: "nope", format });
      expect(missing.isError).toBe(true);
    }
  });

  it("duplicate_nodes: light/dark pair in one call, connectors re-pointed, one undo step", async () => {
    const c = client;
    await call(c, "set_tokens", { tokens: { bg: "#ffffff", fg: "#1e2336" } });
    await call(c, "set_tokens", { mode: "dark", tokens: { bg: "#14161f", fg: "#f2f2f2" } });
    await call(c, "create_nodes", {
      nodes: [
        {
          type: "frame", id: "board", name: "Board", x: 0, y: 0, width: 300, height: 120, fill: "$bg",
          children: [
            { type: "shape", id: "a", x: 10, y: 10, width: 80, height: 40, text: "A", color: "$fg", fill: "$bg" },
            { type: "shape", id: "b", x: 150, y: 10, width: 80, height: 40, text: "B", color: "$fg", fill: "$bg" },
            { type: "connector", id: "ab", from: { nodeId: "a" }, to: { nodeId: "b" } },
          ],
        },
      ],
    });
    const r = (await c.callTool({ name: "duplicate_nodes", arguments: { ids: ["board"], offset: 340, props: { mode: "dark", name: "Board dark" } } })) as ToolResult & {
      structuredContent?: { copies: string[]; map: Record<string, string>; ids: string[]; roots: { id: string }[]; created: { id: string }[]; version: number };
    };
    const sc = r.structuredContent!;
    expect(JSON.parse(r.content[0]!.text!)).toEqual(sc);
    assertOutput("duplicate_nodes", sc);
    expect(sc.copies).toHaveLength(1);
    expect(Object.keys(sc.map).sort()).toEqual(["a", "ab", "b", "board"]);
    expect(sc.ids).toHaveLength(4);
    expect(sc.created).toHaveLength(4);
    expect(sc.roots).toHaveLength(1);
    expect(textOf(r)).toContain(`frame#${sc.roots[0]!.id}`);
    const copy = JSON.parse(textOf(await call(c, "get_nodes", { ids: [sc.copies[0]!, sc.map.ab!] }))) as {
      id: string; mode?: string; name: string; x: number; from?: { nodeId: string }; to?: { nodeId: string };
    }[];
    expect(copy[0]).toMatchObject({ id: sc.copies[0], mode: "dark", name: "Board dark", x: 340 });
    expect(copy[1]!.from?.nodeId).toBe(sc.map.a);
    expect(copy[1]!.to?.nodeId).toBe(sc.map.b);
    expect(JSON.parse(textOf(await call(c, "lint_design", {}))).issues).toEqual([]);
    expect(textOf(await call(c, "duplicate_nodes", { ids: ["board"], props: { id: "x" } }))).toMatch(/props cannot set id/);
    expect(textOf(await call(c, "duplicate_nodes", { ids: ["nope"] }))).toBe("nodes do not exist: nope");
    await call(c, "undo");
    expect(textOf(await call(c, "get_nodes", { ids: [sc.copies[0]!] }))).toMatch(/nodes do not exist/);
    expect(textOf(await call(c, "get_document_outline"))).toContain("4 nodes");
  });

  it("agent layer: structuredContent, undo batch, actor from clientInfo over HTTP sessions, pt-BR guide", async () => {
    const c = client;
    const r = (await c.callTool({ name: "create_nodes", arguments: { nodes: [{ type: "rect", id: "b1" }], batch: "draw 3" } })) as ToolResult & { structuredContent?: unknown };
    expect(r.structuredContent).toEqual(await withWorkspace({
      ids: ["b1"],
      roots: [{ id: "b1", name: "", type: "rect", x: 0, y: 0, width: 100, height: 100 }],
      created: [{ id: "b1", name: "", type: "rect", parentId: null }],
      version: 1,
    }));
    assertOutput("create_nodes", r.structuredContent);
    expect(textOf(r)).toContain("rect#b1 100×100 @0,0");
    await call(c, "set_tokens", { tokens: { ink: "#111111" }, batch: "draw 3" });
    const g = (await c.callTool({ name: "group_nodes", arguments: { ids: ["b1"], id: "gb", batch: "draw 3" } })) as ToolResult & { structuredContent?: unknown };
    expect(g.structuredContent).toEqual(await withWorkspace({ group: "gb", created: ["gb"], version: 3 }));
    const nodes = (await c.callTool({ name: "get_nodes", arguments: { ids: ["gb"] } })) as ToolResult & { structuredContent?: { nodes: unknown[] } };
    expect(JSON.parse(textOf(nodes))).toEqual(nodes.structuredContent?.nodes);
    const hist = (await c.callTool({ name: "get_history", arguments: {} })) as ToolResult & { structuredContent?: { entries: { actor: string; label: string; ops: number }[] } };
    expect(hist.structuredContent?.entries.map(({ actor, label, ops }) => ({ actor, label, ops }))).toEqual([{ actor: "agent:parity", label: "draw 3", ops: 3 }]);
    const lint = (await c.callTool({ name: "lint_design", arguments: {} })) as ToolResult & { structuredContent?: { ok: boolean } };
    expect(lint.structuredContent).toEqual(JSON.parse(textOf(lint)));
    const path = (await c.callTool({ name: "path_info", arguments: { d: "M0 0 C 0 10 10 10 10 0" } })) as ToolResult & { structuredContent?: unknown };
    expect(path.structuredContent).toEqual(JSON.parse(textOf(path)));
    const undo = (await c.callTool({ name: "undo", arguments: {} })) as ToolResult & { structuredContent?: unknown };
    expect(undo.structuredContent).toEqual(await withWorkspace({ undone: true, version: 4, canUndo: false, canRedo: true }));
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
      const body = (s: string) => tree(s).split("\n").filter((l) => !l.startsWith("content:") && !l.startsWith("next:")).join("\n");
      const dropped = (s: string) => body(s).split("\n").filter((l) => !l.includes("#fora") && !l.includes("#k-out")).join("\n");
      expect(body(textOf(await call(b, "get_document_outline", {})))).toBe(dropped(outlineA));
      // Same document again: a copy with a new workspace id, not an error.
      const again = (await call(b, "import_document", { document: exported })) as ToolResult & { structuredContent?: { workspace: { id: string } } };
      expect(again.structuredContent!.workspace.id).not.toBe(sc.workspace.id);
    } finally {
      await b.close();
      await srvB.stop();
    }
  }, 60_000);

  it("tokens de comprimento: create, reflow, recusa de cor e var() no export", async () => {
    const c = client;
    const guide = textOf(await call(c, "get_design_guide", {}));
    expect(guide).toMatch(/\[vertical, horizontal\]/);
    expect(guide).toMatch(/\[top, right, bottom, left\]/);
    await call(c, "set_tokens", { tokens: { "space.md": 8, "radius.md": 12, brand: "#ff0000" } });
    await call(c, "create_nodes", {
      nodes: [
        {
          type: "frame", id: "la", width: 120, height: 100, radius: "$radius.md",
          layout: { mode: "column", gap: "$space.md", padding: "$space.md" },
          children: [
            { type: "rect", id: "la1", width: 20, height: 20 },
            { type: "rect", id: "la2", width: 20, height: 20 },
          ],
        },
        {
          type: "frame", id: "lb", x: 200, width: 80, height: 80,
          layout: { mode: "column", gap: "$space.md", padding: ["$space.md", 4, "$space.md", 4] },
          children: [{ type: "rect", id: "lb1", width: 20, height: 20 }],
        },
      ],
    });
    const before = JSON.parse(textOf(await call(c, "get_bounds", { ids: ["la1", "la2", "lb1"] })));
    expect(before.boxes.la1.y).toBeCloseTo(8, 5);
    expect(before.boxes.la2.y).toBeCloseTo(36, 5);
    expect(before.boxes.lb1.y).toBeCloseTo(8, 5);
    await call(c, "set_tokens", { tokens: { "space.md": 24 } });
    const after = JSON.parse(textOf(await call(c, "get_bounds", { ids: ["la1", "la2", "lb1"] })));
    expect(after.boxes.la1.y).toBeCloseTo(24, 5);
    expect(after.boxes.la2.y).toBeCloseTo(68, 5);
    expect(after.boxes.lb1.y).toBeCloseTo(24, 5);
    const bad = (await c.callTool({ name: "create_nodes", arguments: { nodes: [{ type: "rect", id: "bad", radius: "$brand" }] } })) as ToolResult;
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toContain('token "$brand" resolved to "#ff0000", expected a length');
    const html = textOf(await call(c, "export_code", { rootId: "la", format: "html", cssVariables: true }));
    expect(html).toContain("gap:var(--space\\.md)");
    expect(html).toContain("border-radius:var(--radius\\.md)");
  });
  it("apontamentos: o humano aponta pelo canvas, o agente lista, pega e resolve", async () => {
    type WithStruct = ToolResult & { structuredContent: Record<string, unknown> };
    expect(client.getInstructions()).toContain("list_pins");
    const post = await fetch(`${srv.url}/api/pins`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ region: { x: 10, y: 20, width: 120, height: 40 }, text: "Aumente este título" }),
    });
    expect(post.status).toBe(201);
    const { pin } = (await post.json()) as { pin: { id: string; n: number; status: string } };
    expect(pin.status).toBe("open");

    // A write result tells the agent there are open pins (outputSchema allows openPins).
    const wrote = await call(client, "create_nodes", { nodes: [{ type: "rect", name: "pin-probe", width: 10, height: 10 }] });
    expect(wrote.isError, textOf(wrote)).toBeFalsy();
    expect((wrote as WithStruct).structuredContent.openPins).toBeGreaterThanOrEqual(1);
    expect(textOf(wrote)).toContain("call list_pins");

    const listed = (await call(client, "list_pins", {})) as WithStruct;
    const mine = (listed.structuredContent.pins as { id: string; text: string; region: { width: number } }[]).find((p) => p.id === pin.id)!;
    expect(mine.text).toBe("Aumente este título");
    expect(mine.region.width).toBe(120);

    const claimed = (await call(client, "claim_pin", { id: pin.id })) as WithStruct;
    expect((claimed.structuredContent.pin as { status: string }).status).toBe("claimed");
    const resolved = (await call(client, "resolve_pin", { id: pin.id, reply: "Título em 32px" })) as WithStruct;
    expect(resolved.structuredContent.pin).toMatchObject({ status: "resolved", reply: "Título em 32px" });
    expect((resolved.structuredContent.pin as { replies: { author: string; text: string }[] }).replies).toEqual([
      expect.objectContaining({ author: expect.stringMatching(/^agent:/), text: "Título em 32px" }),
    ]);
    const replied = (await call(client, "reply_pin", { id: pin.id, text: "Pode ser semibold?" })) as WithStruct;
    expect((replied.structuredContent.pin as { status: string; replies: { text: string }[] }).status).toBe("resolved");
    expect((replied.structuredContent.pin as { replies: { text: string }[] }).replies.map((r) => r.text)).toEqual([
      "Título em 32px",
      "Pode ser semibold?",
    ]);

    const waited = (await call(client, "wait_for_pins", { timeoutMs: 0, since: listed.structuredContent.rev as number })) as WithStruct;
    expect(waited.structuredContent.timedOut).toBe(true);
    const missing = await client.callTool({ name: "claim_pin", arguments: { id: "nope" } });
    expect(missing.isError).toBe(true);
  });

  it("radius aceita um valor ou [tl, tr, br, bl] em frame, rect e image", async () => {
    const c = client;
    expect(textOf(await call(c, "get_design_guide", {}))).toMatch(/\[tl, tr, br, bl\]/);
    expect(textOf(await call(c, "get_design_guide", { language: "pt-BR" }))).toMatch(/\[tl, tr, br, bl\]/);
    await call(c, "set_tokens", { tokens: { "radius.md": 10 } });
    const created = await call(c, "create_nodes", {
      nodes: [
        { type: "rect", id: "rc", width: 80, height: 40, fill: "#c8401f", radius: [24, "$radius.md", 0, 4] },
        { type: "image", id: "ri", width: 40, height: 40, src: "data:image/png;base64,aaaa", radius: [0, 8, 8, 0], alt: "a" },
      ],
    });
    expect(created.isError, textOf(created)).toBeFalsy();
    const html = textOf(await call(c, "export_code", { rootId: "rc", format: "html" }));
    expect(html).toContain("border-radius:24px 10px 0px 4px");
    const svg = textOf(await call(c, "export_code", { rootId: "rc", format: "svg" }));
    expect(svg).toContain("<path");
    expect(svg).not.toContain("rx=");
    const badShape = (await c.callTool({ name: "create_nodes", arguments: { nodes: [{ type: "ellipse", id: "re", radius: [1, 2, 3, 4] }] } })) as ToolResult;
    expect(badShape.isError).toBe(true);
    const short = (await c.callTool({ name: "create_nodes", arguments: { nodes: [{ type: "rect", id: "rs", radius: [1, 2] }] } })) as ToolResult;
    expect(short.isError).toBe(true);
  });

  it("posiciona frames de topo sem sobreposição (PAP-B-061)", async () => {
    expect(client.getInstructions()).toContain("Placement:");
    expect(textOf(await call(client, "get_design_guide", { language: "pt-BR" }))).toContain("Posicionamento:");
    const { tools } = await client.listTools();
    for (const name of ["create_nodes", "duplicate_nodes", "import_svg", "import_html", "import_image", "import_document"]) {
      expect(tools.find((t) => t.name === name)?.description).toContain("place");
    }
    const other = new Client({ name: "parity-place", version: "0" });
    await other.connect(new StreamableHTTPClientTransport(new URL(`${srv.url}/mcp`)));
    try {
      const make = (c: Client, name: string) =>
        call(c, "create_nodes", { nodes: [{ type: "frame", name, width: 200, height: 100 }] });
      await Promise.all([0, 1, 2].flatMap((i) => [make(client, `A${i}`), make(other, `B${i}`)]));
    } finally {
      await other.close();
    }
    const doc = await srv.doc();
    const frames = doc.rootIds.map((id) => doc.nodes[id]).filter((n) => n?.type === "frame");
    expect(frames).toHaveLength(6);
    expect(frames.map((n) => `${n.x},${n.y}`).sort()).toEqual(["0,0", "1120,0", "1400,0", "280,0", "560,0", "840,0"]);
    expect(new Set(frames.map((n) => n.parentId))).toEqual(new Set([null]));
    const src = frames.find((n) => n.x === 1400 && n.y === 0)!;
    const dup = await call(client, "duplicate_nodes", { ids: [src.id], props: { mode: "dark", name: "Board dark" } });
    expect(dup.isError, textOf(dup)).toBeFalsy();
    const copyId = (jsonOf(dup) as { copies: string[] }).copies[0]!;
    const copy = (await srv.doc()).nodes[copyId]!;
    expect(copy.type).toBe("frame");
    if (copy.type !== "frame") return;
    expect(copy.x).toBe(1680);
    expect(copy.y).toBe(0);
    expect(copy.mode).toBe("dark");
    await call(client, "create_nodes", { nodes: [{ type: "rect", id: "pin", x: 12, y: 34, width: 10, height: 10 }] });
    const pin = (await srv.doc()).nodes.pin!;
    expect(pin.type).toBe("rect");
    if (pin.type !== "rect") return;
    expect([pin.x, pin.y]).toEqual([12, 34]);
    const warn = await call(client, "create_nodes", {
      place: "none",
      nodes: [{ type: "frame", id: "over", name: "Over", x: 0, y: 0, width: 200, height: 100, fill: "#111111" }],
    });
    expect(textOf(warn)).toContain("overlaps");
    expect(textOf(warn)).toContain("nearest free spot");
    const outline = textOf(await call(client, "get_document_outline", {}));
    expect(outline).toContain("content: x=");
    expect(outline).toContain("next: x=");
    const bounds = jsonOf(await call(client, "get_bounds", {})) as { content: { width: number }; next: { x: number } };
    expect(bounds.content.width).toBeGreaterThan(0);
    expect(typeof bounds.next.x).toBe("number");
    await call(client, "create_nodes", {
      nodes: [
        {
          type: "frame", id: "card", name: "Card", x: 0, y: 4000, width: 220, height: 140, fill: "#f4f1ea",
          children: [{ type: "text", id: "label", name: "Landing page", text: "Landing page", x: 16, y: 16, width: 120, height: 24 }],
        },
        { type: "frame", id: "modal", name: "Delete", x: 8, y: 4008, width: 200, height: 100, fill: "#ffffff" },
      ],
    });
    await call(client, "update_nodes", { updates: [{ id: "modal", props: { index: "back" } }] });
    const lint = textOf(await call(client, "lint_design", {}));
    expect(lint).toContain("overlapping-boards");
    expect(lint).toContain("covered-by-overlay");
  }, 30_000);

  it("lint_design agrupa, limita por rootIds e aponta estouro, hug e geometria", async () => {
    const c = client;
    const created = await call(c, "create_nodes", {
      nodes: [
        {
          type: "frame", id: "board", name: "Board", width: 1000, height: 80, fill: "#ffffff",
          layout: { mode: "row", gap: 16 },
          children: [
            { type: "rect", id: "a", name: "A", width: 400, height: 40, fill: "#111111" },
            { type: "rect", id: "b", name: "B", width: 400, height: 40, fill: "#111111" },
            { type: "rect", id: "c", name: "C", width: 400, height: 40, fill: "#111111" },
          ],
        },
        {
          type: "frame", id: "mock", name: "Mock", x: 0, y: 500, width: 160, height: 40, fill: "#ffffff", scaledMock: true,
          children: [{ type: "text", id: "cap", text: "Cap", fontSize: 9, color: "#111111" }],
        },
        {
          type: "frame", id: "hug", name: "Hug", x: 0, y: 200, layout: { mode: "row", gap: 8 },
          children: [{ type: "rect", id: "wide", name: "Wide", width: 180, height: 40, fill: "#111111" }],
        },
        {
          type: "frame", id: "pair", name: "Pair", x: 0, y: 700, width: 200, height: 40, fill: "#ffffff",
          children: [
            { type: "rect", id: "left", name: "Left", x: 0, y: 0, width: 40, height: 40, fill: "#111111" },
            { type: "rect", id: "right", name: "Right", x: 42, y: 0, width: 40, height: 40, fill: "#222222" },
          ],
        },
      ],
    });
    expect(created.isError, textOf(created)).toBeFalsy();
    const lint = JSON.parse(textOf(await call(c, "lint_design", { rootIds: ["board"], maxIds: 2 })));
    assertOutput("lint_design", lint);
    expect(lint.issues.some((i: { nodeId: string }) => i.nodeId === "cap")).toBe(false);
    const group = lint.groups.find((g: { rule: string }) => g.rule === "layout-overflow");
    expect(group).toMatchObject({ severity: "warning", count: 1, nodeIds: ["board"] });
    expect(group.message).toContain("on width");
    const quiet = JSON.parse(textOf(await call(c, "lint_design", { rootIds: ["board"], minSeverity: "error" })));
    expect(quiet.issues).toEqual([]);
    expect(quiet.groups).toEqual([]);
    const mock = JSON.parse(textOf(await call(c, "lint_design", { rootIds: ["mock"] })));
    expect(mock.issues.filter((i: { rule: string }) => i.rule === "small-text")).toEqual([]);
    const hug = JSON.parse(textOf(await call(c, "lint_design", { rootIds: ["hug"] })));
    expect(hug.groups.map((g: { rule: string }) => g.rule)).toContain("hug-was-meant");
    expect(hug.groups.map((g: { rule: string }) => g.rule)).not.toContain("layout-overflow");
    const pair = JSON.parse(textOf(await call(c, "lint_design", { rootIds: ["pair"] })));
    expect(pair.issues.some((i: { rule: string; nodeId: string }) => i.rule === "near-gap" && i.nodeId === "right")).toBe(true);
    expect(textOf(await call(c, "lint_design", { rootIds: ["missing"] }))).toBe('node "missing" does not exist');
  }, 30_000);
});

describe("API: HTTP + WebSocket", () => {

  /**
   * PAP-B-015: an agent deleting a workspace goes through a summary and a short-lived token, and every
   * workspace operation (its own and the human's) stays readable afterwards.
   */
  it("delete_workspace exige dois passos e o log de operações mostra quem fez o quê", async () => {
    type WithStruct = ToolResult & { structuredContent: Record<string, unknown> };
    const workspaces = async () =>
      (((await call(client, "list_workspaces")) as WithStruct).structuredContent.workspaces as { id: string; name: string; active: boolean }[]);
    const active = (await workspaces()).find((w) => w.active)!.id;
    const post = (path: string, body?: unknown) =>
      fetch(`${srv.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

    const created = await post("/api/workspaces", { name: "Sobra" });
    expect(created.status).toBe(201);
    const spare = ((await created.json()) as { workspace: { id: string } }).workspace.id;

    // First call: nothing is deleted, and what would be lost comes back with the token.
    const ask = (await call(client, "delete_workspace", { id: active })) as WithStruct;
    expect(ask.isError).toBeFalsy();
    expect(ask.structuredContent?.needsConfirmation).toBe(true);
    const summary = ask.structuredContent?.summary as { name: string; nodes: number; active: boolean; undoable: boolean; successor: string };
    expect(summary).toMatchObject({ active: true, undoable: false, successor: spare });
    const token = String(ask.structuredContent?.confirmToken ?? "");
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect((await workspaces()).length).toBe(2);

    // The token belongs to one workspace: pointing it at the other is refused with an actionable message.
    const wrong = await call(client, "delete_workspace", { id: spare, confirmToken: token });
    expect(wrong.isError).toBe(true);
    expect(textOf(wrong)).toContain("not valid");
    expect((await workspaces()).length).toBe(2);

    // Second call with the right token: it deletes, and the same token cannot be spent twice.
    const gone = await call(client, "delete_workspace", { id: active, confirmToken: token });
    expect(gone.isError, textOf(gone)).toBeFalsy();
    expect((await workspaces()).map((w) => w.id)).toEqual([spare]);
    // The token was spent: the reuse is refused before the workspace is even looked up, and the message
    // points back at the first call (which then answers "does not exist").
    const again = await call(client, "delete_workspace", { id: active, confirmToken: token });
    expect(again.isError).toBe(true);
    expect(textOf(again)).toContain("confirmToken is not valid");
    expect(textOf(await call(client, "delete_workspace", { id: active }))).toContain("does not exist");

    // The log: the human's create says "user", the agent's delete keeps the summary of what was lost.
    const ops = (await call(client, "list_workspace_ops", { limit: 20 })) as WithStruct;
    const entries = ops.structuredContent?.entries as { op: string; actor: string; workspaceId: string; detail: Record<string, unknown> }[];
    // The delete logs the successor opening before the delete itself: newest first is the delete.
    expect(entries[0]).toMatchObject({ op: "delete", workspaceId: active });
    expect(entries.some((e) => e.op === "open" && e.workspaceId === spare)).toBe(true);
    expect(entries.some((e) => e.op === "create" && e.actor === "user" && e.workspaceId === spare)).toBe(true);
    const deleted = entries.find((e) => e.op === "delete" && e.workspaceId === active);
    expect(deleted).toBeTruthy();
    expect(deleted!.actor).not.toBe("user");
    expect(deleted!.detail).toMatchObject({ undoable: false, successor: spare });
    // Narrowing to a workspace that no longer exists still reads its entries.
    const narrowed = (await call(client, "list_workspace_ops", { workspaceId: active })) as WithStruct;
    expect((narrowed.structuredContent?.entries as unknown[]).length).toBeGreaterThan(0);
  });

  it("hello do WebSocket informa o renderizador ativo, e o outline lista cada aba (ou none)", async () => {
    const line = async () =>
      textOf(await call(client, "get_document_outline"))
        .split("\n")
        .find((l) => l.startsWith("renderer:"));
    expect(await line()).toBe("renderer: none");

    const open = async () => {
      const ws = new WebSocket(`${srv.url.replace("http", "ws")}/ws`, { headers: { origin: srv.url } });
      const msgs: { type: string; renderer?: string; reqId?: string; message?: string; kind?: string }[] = [];
      ws.on("message", (m) => msgs.push(JSON.parse(String(m))));
      await new Promise((ok) => ws.once("open", ok));
      await waitFor(() => msgs.some((m) => m.type === "doc" && m.kind === "reload"));
      return { ws, msgs };
    };
    const a = await open();
    expect(a.msgs[0]?.type).toBe("doc");
    a.ws.send(JSON.stringify({ type: "hello", renderer: "wasm", reqId: "h1" }));
    await waitFor(() => a.msgs.some((m) => m.type === "hello" && m.reqId === "h1"));
    expect(a.msgs.find((m) => m.type === "hello")).toEqual({ type: "hello", renderer: "wasm", reqId: "h1" });
    await waitFor(async () => (await line()) === "renderer: wasm");

    a.ws.send(JSON.stringify({ type: "hello", renderer: "cpu", reqId: "bad" }));
    await waitFor(() => a.msgs.some((m) => m.type === "error"));
    expect(a.msgs.find((m) => m.type === "error")?.message).toContain("renderer");
    expect(await line()).toBe("renderer: wasm");

    a.ws.send(JSON.stringify({ type: "hello", renderer: "dom", reqId: "h1b" }));
    await waitFor(() => a.msgs.some((m) => m.type === "hello" && m.renderer === "dom"));
    expect(await line()).toBe("renderer: dom");

    const b = await open();
    b.ws.send(JSON.stringify({ type: "hello", renderer: "wasm", reqId: "h2" }));
    await waitFor(() => b.msgs.some((m) => m.type === "hello" && m.reqId === "h2"));
    expect(await line()).toBe("renderer: dom, wasm");

    a.ws.close();
    await waitFor(async () => (await line()) === "renderer: wasm");
    b.ws.close();
    await waitFor(async () => (await line()) === "renderer: none");
  });

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
    expect(Object.keys(landing)).toEqual(["id", "name", "nodes", "updatedAt", "active", "cover", "archived", "folderId", "preview"]);
    expect(landing).toMatchObject({ archived: false });
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
    expect(textOf(await call(client, "get_document_outline"))).toMatch(/^workspace \S+ "Landing" v\d+ · 0 nodes/);
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
    expect(await missing.json()).toEqual({ error: 'workspace "nope" does not exist' });
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
    expect(Object.keys(info)).toEqual(["id", "name", "nodes", "updatedAt", "active", "cover", "archived", "folderId", "preview"]);
    expect(info).toMatchObject({ id: a.id, name: "A2", active: false });
    expect((await list()).workspaces.find((w) => w.id === a.id)?.name).toBe("A2");
    expect((await req("PATCH", `/api/workspaces/${a.id}`, { name: "  " })).status).toBe(400);
    expect((await req("PATCH", `/api/workspaces/${a.id}`, { name: 3 })).status).toBe(400);
    const missing = await req("PATCH", "/api/workspaces/nope", { name: "x" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'workspace "nope" does not exist' });
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
    // PAP-B-015: over MCP the delete is two calls; the summary is what the human is shown.
    const ask = (await call(client, "delete_workspace", { id: b.id })) as ToolResult & {
      structuredContent: { needsConfirmation: boolean; confirmToken: string; summary: { name: string; undoable: boolean } };
    };
    expect(ask.structuredContent).toMatchObject({ needsConfirmation: true, summary: { name: "B", undoable: false } });
    expect((await list()).workspaces.some((w) => w.id === b.id)).toBe(true);
    const mcpDel = (await call(client, "delete_workspace", { id: b.id, confirmToken: ask.structuredContent.confirmToken })) as ToolResult & {
      structuredContent: { deleted: string; active: string; notice: string };
    };
    expect(mcpDel.isError, textOf(mcpDel)).toBeFalsy();
    expect(mcpDel.structuredContent).toMatchObject({ deleted: b.id, active: after.active });
    expect(mcpDel.structuredContent.notice).toContain("list_workspace_ops");
    expect(textOf(await call(client, "delete_workspace", { id: "nope" }))).toBe('workspace "nope" does not exist (see list_workspaces)');
    await call(client, "open_workspace", { id: start });
  });

  it("workspaces: arquivar esconde da lista e restaurar devolve, sem apagar", async () => {
    type Info = { id: string; name: string; archived: boolean; active: boolean };
    type WithStruct = ToolResult & { structuredContent: { workspace: Info; active: string; workspaces: Info[] } };
    const list = async (q = "") => (await (await fetch(`${srv.url}/api/workspaces${q}`)).json()) as { active: string; workspaces: Info[] };
    const start = (await list()).active;
    expect((await fetch(`${srv.url}/api/workspaces/${start}/archive`, { method: "POST" })).status).toBe(409);
    const made = await fetch(`${srv.url}/api/workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Para arquivar" }),
    });
    const spare = ((await made.json()) as { workspace: Info }).workspace;
    expect(spare.archived).toBe(false);

    const archived = (await call(client, "archive_workspace", { id: spare.id })) as WithStruct;
    expect(archived.isError, textOf(archived)).toBeFalsy();
    assertOutput("archive_workspace", archived.structuredContent);
    expect(archived.structuredContent.workspace).toMatchObject({ id: spare.id, archived: true, active: false });
    expect(archived.structuredContent.active).toBe(start);
    expect((await list()).workspaces.some((w) => w.id === spare.id)).toBe(false);
    expect((await list("?archived=1")).workspaces.map((w) => w.id)).toEqual([spare.id]);
    const included = (await call(client, "list_workspaces", { includeArchived: true })) as WithStruct;
    assertOutput("list_workspaces", included.structuredContent);
    expect(included.structuredContent.workspaces.find((w) => w.id === spare.id)?.archived).toBe(true);
    expect((await call(client, "list_workspaces") as WithStruct).structuredContent.workspaces.some((w) => w.id === spare.id)).toBe(false);

    const restored = (await call(client, "unarchive_workspace", { id: spare.id })) as WithStruct;
    expect(restored.isError, textOf(restored)).toBeFalsy();
    assertOutput("unarchive_workspace", restored.structuredContent);
    expect(restored.structuredContent.workspace.archived).toBe(false);
    expect((await list()).workspaces.some((w) => w.id === spare.id)).toBe(true);

    const switched = await fetch(`${srv.url}/api/workspaces/${start}/archive`, { method: "POST" });
    expect(switched.status).toBe(200);
    const body = (await switched.json()) as { workspace: Info; active: string };
    expect(body.workspace.archived).toBe(true);
    expect(body.active).toBe(spare.id);
    expect((await list()).active).toBe(spare.id);
    expect((await list()).workspaces.some((w) => w.id === start)).toBe(false);

    const opened = await fetch(`${srv.url}/api/workspaces/${start}/open`, { method: "POST" });
    expect(opened.status).toBe(200);
    expect(((await opened.json()) as { workspace: Info }).workspace).toMatchObject({ id: start, archived: false, active: true });
    expect((await list()).workspaces.some((w) => w.id === start)).toBe(true);

    expect(textOf(await call(client, "archive_workspace", { id: "nope" }))).toBe('workspace "nope" does not exist (see list_workspaces)');
    expect((await fetch(`${srv.url}/api/workspaces/nope/archive`, { method: "POST" })).status).toBe(404);
    expect((await fetch(`${srv.url}/api/workspaces/${spare.id}/archive`, { method: "GET" })).status).toBe(405);
    const ops = (await call(client, "list_workspace_ops", { workspaceId: spare.id })) as ToolResult & { structuredContent: { entries: { op: string }[] } };
    assertOutput("list_workspace_ops", ops.structuredContent);
    expect(ops.structuredContent.entries.map((e) => e.op)).toContain("archive");
    expect(ops.structuredContent.entries.map((e) => e.op)).toContain("unarchive");
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

  it("workspaceId desenha em outro workspace sem mover o canvas, e o undo de lá não toca o ativo", async () => {
    const ws = new WebSocket(`${srv.url.replace("http", "ws")}/ws`, { headers: { origin: srv.url } });
    const docs: { id?: string; kind?: string }[] = [];
    ws.on("message", (m) => {
      const msg = JSON.parse(String(m)) as { type: string; kind?: string; doc?: { id: string } };
      if (msg.type === "doc") docs.push({ id: msg.doc?.id, kind: msg.kind });
    });
    await new Promise((ok) => ws.once("open", ok));
    await waitFor(() => docs.length > 0);

    const active = await srv.doc();
    const drawn = (await call(client, "create_nodes", { nodes: [{ type: "rect", id: "on-a" }] })) as ToolResult & {
      structuredContent?: { workspaceId: string; workspaceName: string; created: string[] };
    };
    expect(drawn.structuredContent).toMatchObject({
      workspaceId: active.id,
      workspaceName: active.name,
      ids: ["on-a"],
      created: [{ id: "on-a", name: "", type: "rect", parentId: null }],
    });

    const created = (await call(client, "create_workspace", { name: "Board" })) as ToolResult & {
      structuredContent: { workspace: { id: string; name: string; active: boolean } };
    };
    const board = created.structuredContent.workspace;
    expect(board.active).toBe(false);

    const there = (await call(client, "create_nodes", {
      workspaceId: board.id,
      nodes: [{ type: "rect", id: "on-b", name: "No canvas" }],
    })) as ToolResult & { structuredContent?: { workspaceId: string; workspaceName: string; version: number; created: string[] } };
    expect(there.isError).toBeFalsy();
    expect(there.structuredContent).toEqual({
      ids: ["on-b"],
      roots: [{ id: "on-b", name: "No canvas", type: "rect", x: 0, y: 0, width: 100, height: 100 }],
      created: [{ id: "on-b", name: "No canvas", type: "rect", parentId: null }],
      version: 1,
      workspaceId: board.id,
      workspaceName: "Board",
    });

    expect((await srv.doc()).id).toBe(active.id);
    expect(Object.keys((await srv.doc()).nodes)).toEqual(["on-a"]);
    await waitFor(() => docs.some((d) => d.kind === "apply" && d.id === active.id));
    expect(docs.every((d) => d.id === active.id)).toBe(true);

    const home = textOf(await call(client, "get_document_outline", {}));
    expect(home.startsWith(`workspace ${active.id} "${active.name}"`)).toBe(true);
    expect(home).not.toContain("on-b");
    const away = textOf(await call(client, "get_document_outline", { workspaceId: board.id }));
    expect(away.startsWith(`workspace ${board.id} "Board"`)).toBe(true);
    expect(away).toContain("on-b");
    const found = textOf(await call(client, "find_nodes", { workspaceId: board.id, name: "No canvas" }));
    expect(found).toContain("rect#on-b");

    const undone = (await call(client, "undo", { workspaceId: board.id })) as ToolResult & {
      structuredContent?: { undone: boolean; workspaceId: string; canUndo: boolean };
    };
    expect(undone.structuredContent).toMatchObject({ undone: true, workspaceId: board.id, canUndo: false });
    expect(textOf(await call(client, "get_document_outline", { workspaceId: board.id }))).not.toContain("on-b");
    expect(Object.keys((await srv.doc()).nodes)).toEqual(["on-a"]);
    expect((await srv.doc()).id).toBe(active.id);

    const back = (await call(client, "undo", {})) as ToolResult & { structuredContent?: { undone: boolean; workspaceId: string } };
    expect(back.structuredContent).toMatchObject({ undone: true, workspaceId: active.id });
    expect(Object.keys((await srv.doc()).nodes)).toEqual([]);

    const missing = await call(client, "create_nodes", { workspaceId: "nope", nodes: [{ type: "rect", id: "z" }] });
    expect(missing.isError).toBe(true);
    const err = textOf(missing);
    expect(err).toContain("workspace \"nope\" does not exist");
    expect(err).toContain(active.id);
    expect(err).toContain("Board");
    expect((await srv.doc()).id).toBe(active.id);
    ws.close();
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
