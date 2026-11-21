import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import WebSocket from "ws";
import { DocumentStore, PresenceHub, closeBrowser, createMcpServer, presenceTargets, startHttpServer, workspaceSlug, type RunningServer } from "../src/index.js";
import { copyId } from "@paprika/core";

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
        "create_component",
        "create_instance",
        "create_nodes",
        "create_page",
        "create_workspace",
        "delete_nodes",
        "detach_instance",
        "export_code",
        "find_nodes",
        "get_design_guide",
        "get_document_outline",
        "get_history",
        "get_nodes",
        "group_nodes",
        "import_html",
        "import_svg",
        "lint_design",
        "list_workspaces",
        "move_nodes",
        "open_workspace",
        "path_info",
        "redo",
        "render_screenshot",
        "set_tokens",
        "undo",
        "ungroup_nodes",
        "update_nodes",
      ].sort(),
    );
    for (const t of tools) expect(t.inputSchema.type).toBe("object");
  });

  it("grupos e páginas: agrupar, desagrupar, criar página, uma entrada de histórico por chamada", async () => {
    const c = await connect();
    await call(c, "create_nodes", {
      nodes: [
        {
          type: "frame",
          id: "f",
          name: "Tela",
          width: 300,
          height: 200,
          children: [
            { type: "rect", id: "a", x: 10, y: 20, width: 30, height: 30 },
            { type: "rect", id: "b", x: 60, y: 40, width: 30, height: 30 },
          ],
        },
      ],
    });
    const g = JSON.parse(textOf(await call(c, "group_nodes", { ids: ["a", "b"], id: "g", name: "Par" })));
    expect(g).toMatchObject({ group: "g", created: ["g"] });
    expect(store.doc.nodes.g).toMatchObject({ x: 10, y: 20, width: 80, height: 50, children: ["a", "b"] });
    const bad = await call(c, "group_nodes", { ids: ["g", "f"] });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/same parent/);

    const u = JSON.parse(textOf(await call(c, "ungroup_nodes", { ids: ["g"] })));
    expect(u.released).toEqual(["a", "b"]);
    expect(store.doc.nodes.a).toMatchObject({ x: 10, y: 20, parentId: "f" });

    const p = JSON.parse(textOf(await call(c, "create_page", { id: "p2", name: "Variações" })));
    expect(p.page).toBe("p2");
    expect(store.doc.rootIds).toHaveLength(2);
    const first = store.doc.rootIds[0]!;
    expect(store.doc.nodes[first]).toMatchObject({ type: "page", name: "Página 1", children: ["f"] });
    const loose = await call(c, "create_nodes", { nodes: [{ type: "rect" }] });
    expect(textOf(loose)).toMatch(/has pages/);
    await call(c, "create_nodes", { parentId: "p2", nodes: [{ type: "rect", id: "r", width: 10, height: 10, fill: "#000000" }] });
    expect(textOf(await call(c, "get_document_outline", { rootId: "p2" }))).toContain("rect#r 10×10");
    const shot = await call(c, "render_screenshot", { rootId: "p2" });
    expect(textOf(shot)).toContain("10×10px");
    const hist = JSON.parse(textOf(await call(c, "get_history", { limit: 3 })));
    expect(hist.map((h: { label: string }) => h.label)).toEqual(["ungroup 1 group(s)", "create page", "create 1 node(s)"]);
  });

  it("componentes: criar, instanciar com escala e overrides, propagar, desanexar", async () => {
    const c = await connect();
    await call(c, "create_nodes", {
      nodes: [
        {
          type: "frame", id: "btn", name: "Botão", x: 10, y: 10, width: 100, height: 40, fill: "#3355ff",
          children: [{ type: "text", id: "lbl", text: "OK", color: "#ffffff", width: 50, height: 20 }],
        },
      ],
    });
    const bad = await call(c, "create_instance", { componentId: "btn" });
    expect(textOf(bad)).toMatch(/is not a component/);
    expect(JSON.parse(textOf(await call(c, "create_component", { id: "btn" })))).toMatchObject({ component: "btn" });
    const inst = JSON.parse(textOf(await call(c, "create_instance", { componentId: "btn", id: "i1", scale: 2, overrides: { lbl: { text: "Enviar" } } })));
    expect(inst).toMatchObject({ instance: "i1", copies: { lbl: copyId("i1", "lbl") }, created: ["i1"] });
    expect(store.doc.nodes.i1).toMatchObject({ x: 150, y: 10, width: 200, height: 80, name: "Botão", parentId: null });
    expect(store.doc.nodes[copyId("i1", "lbl")]).toMatchObject({ text: "Enviar", width: 100, fontSize: 32 });
    await call(c, "update_nodes", { updates: [{ id: "btn", props: { fill: "#000000" } }] });
    expect(store.doc.nodes.i1).toMatchObject({ fill: "#000000" });
    const moved = await call(c, "move_nodes", { moves: [{ id: copyId("i1", "lbl"), parentId: null }] });
    expect(textOf(moved)).toMatch(/a copy inside the instance "i1"/);
    expect(textOf(await call(c, "get_document_outline", {}))).toContain("instanceOf=btn scale=2 overrides=1");
    const d = JSON.parse(textOf(await call(c, "detach_instance", { ids: ["i1"] })));
    expect(d.detached).toEqual(["i1"]);
    expect(store.doc.nodes.i1).not.toHaveProperty("instanceOf");
    const hist = JSON.parse(textOf(await call(c, "get_history", { limit: 4 })));
    expect(hist.map((h: { label: string }) => h.label)).toEqual(["create component", "create instance", "update 1 node(s)", "detach 1 instance(s)"]);
  });

  it("importar SVG/HTML como nós e exportar SVG medido no navegador", async () => {
    const c = await connect();
    const svg = JSON.parse(textOf(await call(c, "import_svg", { svg: '<svg viewBox="0 0 10 10" width="20" height="20"><path d="M0 0 L10 0 L5 8 Z" fill="#c43d27"/><text>x</text></svg>', x: 5, y: 5, name: "Seta" })));
    expect(svg).toMatchObject({ created: [expect.any(String)], warnings: ["<text> is not imported"] });
    expect(store.doc.nodes[svg.created[0]]).toMatchObject({ type: "path", name: "Seta", x: 5, y: 5, d: "M0 0 L20 0 L10 16 Z", fill: "#c43d27" });
    expect(textOf(await call(c, "import_svg", { svg: "<svg></svg>" }))).toBe("the SVG has no shapes to import");
    const html = JSON.parse(
      textOf(await call(c, "import_html", { html: '<div style="display:flex; gap:8px; padding:12px; background:#fff"><span>Olá</span><span>mundo</span></div>', x: 100, y: 0 })),
    );
    const f = store.doc.nodes[html.created[0]]!;
    expect(f).toMatchObject({ type: "frame", x: 100, layout: { mode: "row", gap: 8, padding: 12 } });
    const out = await call(c, "export_code", { rootId: f.id, format: "svg" });
    expect(out.isError).toBeFalsy();
    const svgText = out.content[0]!.text!;
    expect(svgText).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="[\d.]+" height="[\d.]+"/);
    expect(svgText).toContain('<tspan x="0" y="');
    expect(svgText).toContain(">mundo</tspan>");
    const hist = JSON.parse(textOf(await call(c, "get_history", { limit: 2 })));
    expect(hist.map((h: { label: string }) => h.label)).toEqual(["import SVG", "import HTML"]);
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

  it("path com bezier: cria só com d, valida, mede, renderiza e exporta", async () => {
    const c = await connect();
    const created = JSON.parse(
      textOf(
        await call(c, "create_nodes", {
          nodes: [{ type: "path", id: "wave", d: "M0 40 C 30 -10 70 90 100 40", stroke: { color: "#c43d27", width: 4 } }],
        }),
      ),
    );
    expect(created.created).toEqual(["wave"]);
    const node = store.doc.nodes.wave!;
    expect(node.width).toBe(100);
    // A curva passa de y=40: a caixa vem dos extremos da bezier, não dos pontos de controle (-10..90).
    expect(node.height).toBe(55); // ceil(≈54,4); os controles iriam até 90

    const info = JSON.parse(textOf(await call(c, "path_info", { id: "wave" })));
    expect(info).toMatchObject({ segments: 2, curves: 1, closed: false });
    expect(info.bounds.y).toBeGreaterThan(10);

    const bad = await call(c, "create_nodes", { nodes: [{ type: "path", d: "M0 0 C 10 10 20" }] });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/invalid d: number expected at position \d+/);

    const lint = textOf(await call(c, "lint_design", {}));
    expect(lint).not.toMatch(/invisible-path/);
    const tsx = textOf(await call(c, "export_code", { rootId: "wave", format: "react" }));
    expect(tsx).toContain('<path d="M0 40 C 30 -10 70 90 100 40" fill="none"');
    expect(tsx).toContain('strokeWidth={4}');
    await call(c, "undo");
    expect(store.doc.nodes.wave).toBeUndefined();
  });

  it("agent layer: structuredContent per outputSchema, undo batches, actor from clientInfo, English guide", async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer(store, { actor: "agent:fallback" }).connect(a);
    const c = new Client({ name: "claude-code", version: "1" });
    await c.connect(b);

    const { tools } = await c.listTools();
    const withOutput = tools.filter((t) => t.outputSchema).map((t) => t.name);
    expect(withOutput).toEqual(expect.arrayContaining(["create_nodes", "get_nodes", "lint_design", "undo", "get_history", "import_svg", "path_info"]));
    expect(withOutput).not.toContain("export_code");

    const created = (await c.callTool({ name: "create_nodes", arguments: { nodes: [{ type: "rect", id: "r1" }], batch: "proposal 3" } })) as ToolResult & { structuredContent?: unknown };
    expect(created.structuredContent).toEqual({ created: ["r1"], version: 1 });
    expect(JSON.parse(textOf(created))).toEqual(created.structuredContent);
    await call(c, "set_tokens", { tokens: { brand: "#c43d27" }, batch: "proposal 3" });
    await call(c, "update_nodes", { updates: [{ id: "r1", props: { fill: "$brand" } }], batch: "proposal 3" });
    const nodes = (await c.callTool({ name: "get_nodes", arguments: { ids: ["r1"] } })) as ToolResult & { structuredContent?: { nodes: { fill: string }[] } };
    expect(nodes.structuredContent?.nodes[0]?.fill).toBe("$brand");
    expect(JSON.parse(textOf(nodes))).toEqual(nodes.structuredContent?.nodes); // text stays the plain array

    const hist = (await c.callTool({ name: "get_history", arguments: {} })) as ToolResult & { structuredContent?: { entries: unknown[] } };
    expect(hist.structuredContent?.entries).toEqual([{ actor: "agent:claude-code", label: "proposal 3", at: expect.any(Number), ops: 3 }]);

    // A write from someone else closes the batch: the next call with the same name starts a new entry.
    store.apply([{ op: "update", id: "r1", props: { x: 5 } }], "user", "move");
    await call(c, "create_nodes", { nodes: [{ type: "rect", id: "r2" }], batch: "proposal 3" });
    expect(store.recentHistory(10).map((h) => h.label)).toEqual(["proposal 3", "move", "create 1 node(s)"]);

    const undo = (await c.callTool({ name: "undo", arguments: {} })) as ToolResult & { structuredContent?: unknown };
    expect(undo.structuredContent).toMatchObject({ undone: true, canUndo: true });
    await call(c, "undo");
    await call(c, "undo"); // the whole batch at once
    expect(store.doc.nodes.r1).toBeUndefined();
    expect(store.doc.tokens).toEqual({});
    await call(c, "redo");
    expect(store.doc.nodes.r1).toMatchObject({ fill: "$brand" });

    expect(textOf(await call(c, "get_design_guide"))).toMatch(/^# Paprika: guide for agents/);
    expect(textOf(await call(c, "get_design_guide", { language: "pt-BR" }))).toMatch(/^# Paprika: guia para agentes/);
    const bad = await call(c, "update_nodes", { updates: [{ id: "nope", props: {} }] });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toBe('op[0]: node "nope" does not exist');
    expect((bad as { structuredContent?: unknown }).structuredContent).toBeUndefined();
    await c.close();
  });

  it("erros voltam como isError com mensagem acionável e sem efeito colateral", async () => {
    const c = await connect();
    const before = store.version;
    const r = await call(c, "create_nodes", { nodes: [{ type: "text", txt: "oops" }] });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/unknown fields for text: txt/);
    expect(store.version).toBe(before);
  });

  it("workspaces: listar, criar, abrir; as ferramentas seguem o ativo e cada um grava no seu arquivo", async () => {
    const c = await connect();
    await call(c, "create_nodes", { nodes: [{ type: "rect", id: "r1" }] });
    await store.flush();
    // Not workspaces: a JSON that is not a Paprika document, a hidden temp file, a copy with the same id.
    await writeFile(join(dir, "lixo.paprika.json"), "{}");
    await writeFile(join(dir, ".t.paprika.json.1.tmp"), "{}");
    await writeFile(join(dir, "copia.paprika.json"), await readFile(store.file, "utf8"));

    const created = await call(c, "create_workspace", { name: "  Landing Page  " });
    const ws = (created as { structuredContent: { workspace: { id: string; name: string; active: boolean } } }).structuredContent.workspace;
    expect(ws).toMatchObject({ name: "Landing Page", nodes: 0, active: false });
    expect(JSON.parse(await readFile(join(dir, "landing-page.paprika.json"), "utf8")).id).toBe(ws.id);
    await call(c, "create_workspace", { name: "Landing page" });
    expect(JSON.parse(await readFile(join(dir, "landing-page-2.paprika.json"), "utf8")).name).toBe("Landing page");

    const list = (await call(c, "list_workspaces")) as ToolResult & { structuredContent: { active: string; workspaces: { id: string; active: boolean; nodes: number }[] } };
    expect(list.structuredContent.active).toBe(store.doc.id);
    expect(list.structuredContent.workspaces).toHaveLength(3);
    expect(list.structuredContent.workspaces.filter((w) => w.active)).toEqual([expect.objectContaining({ id: store.doc.id, nodes: 1 })]);

    const first = store.doc.id;
    const events: string[] = [];
    store.on("change", (e) => events.push(e.kind));
    const opened = await call(c, "open_workspace", { id: ws.id });
    expect(opened.isError, textOf(opened)).toBeFalsy();
    expect(store.doc.id).toBe(ws.id);
    expect(store.file).toBe(join(dir, "landing-page.paprika.json"));
    expect(store.canUndo).toBe(false);
    expect(events).toEqual(["open"]);
    expect(textOf(await call(c, "get_document_outline"))).toMatch(/^document "Landing Page"/);
    await call(c, "create_nodes", { nodes: [{ type: "rect", id: "r2" }] });
    expect(Object.keys(JSON.parse(await readFile(join(dir, "landing-page.paprika.json"), "utf8")).nodes)).toEqual(["r2"]);
    expect(Object.keys(JSON.parse(await readFile(join(dir, "t.paprika.json"), "utf8")).nodes)).toEqual(["r1"]);

    await call(c, "open_workspace", { id: first });
    expect(store.doc.nodes.r1).toBeDefined();
    const bad = await call(c, "open_workspace", { id: "nope" });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toBe('workspace "nope" does not exist (see list_workspaces)');
  });

  it("nome de arquivo do workspace: sem acento, minúsculo, palavras com hífen, até 60 caracteres", () => {
    expect(workspaceSlug("  Marca · Ícones  ")).toBe("marca-icones");
    expect(workspaceSlug("--a--b--")).toBe("a-b");
    expect(workspaceSlug("!!!")).toBe("workspace");
    expect(workspaceSlug("aaa ".repeat(30))).toHaveLength(59);
    expect(workspaceSlug("x".repeat(80))).toHaveLength(60);
    expect(workspaceSlug("-".repeat(100_000) + "a")).toBe("a");
  });

  it("render_screenshot devolve PNG", async () => {
    const c = await connect();
    await call(c, "create_nodes", { nodes: [{ type: "rect", id: "r", width: 50, height: 40, fill: "#ff278c" }] });
    const r = await call(c, "render_screenshot", { rootId: "r", scale: 2 });
    expect(r.isError, textOf(r)).toBeFalsy();
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
    // Stateless HTTP: the name comes from initialize's clientInfo, remembered by Mcp-Session-Id.
    expect(messages.at(-1)?.actor).toBe("agent:http-test");

    ws.send(JSON.stringify({ type: "ops", reqId: "1", ops: [{ op: "update", id: "fromAgent", props: { name: "Movido pelo humano" } }] }));
    await waitFor(() => messages.some((m) => m.type === "ack"));
    const r = (await client.callTool({ name: "get_nodes", arguments: { ids: ["fromAgent"] } })) as ToolResult;
    expect(textOf(r)).toContain("Movido pelo humano");

    ws.send(JSON.stringify({ type: "ops", reqId: "2", ops: [{ op: "delete", id: "nao-existe" }] }));
    await waitFor(() => messages.some((m) => m.type === "error"));

    await client.close();
    ws.close();
  });

  it("presença do agente: cada chamada MCP vira cursor no canvas, com replay para quem conecta depois", async () => {
    const ws = new WebSocket(`${http.url.replace("http", "ws")}/ws`, { headers: { origin: http.url } });
    type Msg = { type: string; agent?: string; actor?: string; tool?: string; nodes?: string[]; idle?: number };
    const messages: Msg[] = [];
    ws.on("message", (m) => messages.push(JSON.parse(String(m))));
    await new Promise((ok) => ws.once("open", ok));
    const presences = () => messages.filter((m) => m.type === "presence");

    const a = new Client({ name: "agent-a", version: "0" });
    await a.connect(new StreamableHTTPClientTransport(new URL(`${http.url}/mcp`)));
    const b = new Client({ name: "agent-a", version: "0" });
    await b.connect(new StreamableHTTPClientTransport(new URL(`${http.url}/mcp`)));

    await a.callTool({ name: "create_nodes", arguments: { nodes: [{ type: "rect", id: "p1" }, { type: "rect", id: "p2" }] } });
    await waitFor(() => presences().length === 1);
    const first = presences()[0]!;
    expect(first).toEqual({ type: "presence", agent: expect.stringMatching(/^s:[0-9a-f]{12}$/), actor: "agent:agent-a", tool: "create_nodes", nodes: ["p1", "p2"], idle: 0 });

    // Reads move the cursor too; unknown ids are dropped; a second session with the same name is another agent.
    await b.callTool({ name: "get_nodes", arguments: { ids: ["p2"] } });
    await a.callTool({ name: "update_nodes", arguments: { updates: [{ id: "p1", props: { name: "x" } }] } });
    await a.callTool({ name: "get_document_outline", arguments: {} });
    await waitFor(() => presences().length === 4);
    const [, second, third, fourth] = presences();
    expect(second).toMatchObject({ actor: "agent:agent-a", tool: "get_nodes", nodes: ["p2"] });
    expect(second!.agent).not.toBe(first.agent);
    expect(third).toMatchObject({ agent: first.agent, tool: "update_nodes", nodes: ["p1"] });
    expect(fourth).toMatchObject({ agent: first.agent, tool: "get_document_outline", nodes: [] });

    // A canvas that connects later gets the last presence of each agent right after the document.
    const late = new WebSocket(`${http.url.replace("http", "ws")}/ws`, { headers: { origin: http.url } });
    const lateMsgs: Msg[] = [];
    late.on("message", (m) => lateMsgs.push(JSON.parse(String(m))));
    await waitFor(() => lateMsgs.length === 3);
    expect(lateMsgs.map((m) => m.type)).toEqual(["doc", "presence", "presence"]);
    expect(lateMsgs.slice(1).map((m) => [m.agent, m.tool])).toEqual([
      [second!.agent, "get_nodes"],
      [first.agent, "get_document_outline"],
    ]);
    expect(lateMsgs[1]!.idle).toBeGreaterThanOrEqual(0);

    await a.close();
    await b.close();
    late.close();
    ws.close();
  });

  it("presenceTargets: criados primeiro, senão os ids dos argumentos, só os que existem", () => {
    const doc = { nodes: { a: {}, b: {}, c: {} } } as never;
    expect(presenceTargets({ ids: ["a"] }, { created: ["c", "zz"] }, doc)).toEqual(["c"]);
    expect(presenceTargets({ ids: ["a", "zz", "a"], rootId: "b" }, { created: [] }, doc)).toEqual(["a", "b"]);
    expect(presenceTargets({ moves: [{ id: "b", parentId: "c" }], ops: [{ op: "ungroup", ids: ["a"] }] }, undefined, doc)).toEqual(["b", "c", "a"]);
    expect(presenceTargets(undefined, undefined, doc)).toEqual([]);
  });

  it("PresenceHub: replay só até o TTL e no máximo 64 agentes", () => {
    let now = 1000;
    const hub = new PresenceHub(() => now);
    for (let i = 0; i < 70; i++) hub.report(`k${i}`, "agent:x", "get_nodes", []);
    expect(hub.recent()).toHaveLength(64);
    expect(hub.recent()[0]!.agent).toBe("k6");
    now += 120_000;
    expect(hub.recent()).toEqual([]);
  });

  it("bloqueia Host/Origin externos (DNS rebinding / CSRF)", async () => {
    const port = Number(new URL(http.url).port);
    expect(await status(port, { host: `evil.example:${port}` })).toBe(403);
    expect(await status(port, { host: `127.0.0.1:${port}`, origin: "https://evil.example" })).toBe(403);
    expect(await status(port, { host: `127.0.0.1:${port}` })).toBe(200);
  });

  it("API de workspaces: listar, criar, abrir; o canvas recebe a troca pelo WS", async () => {
    const ws = new WebSocket(`${http.url.replace("http", "ws")}/ws`, { headers: { origin: http.url } });
    const messages: { type: string; kind?: string; doc?: { id: string } }[] = [];
    ws.on("message", (m) => messages.push(JSON.parse(String(m))));
    await new Promise((ok) => ws.once("open", ok));

    const post = (path: string, body?: unknown) =>
      fetch(`${http.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const created = await post("/api/workspaces", { name: "Novo" });
    expect(created.status).toBe(201);
    const { workspace } = (await created.json()) as { workspace: { id: string; name: string } };
    expect(workspace.name).toBe("Novo");
    expect(((await (await post("/api/workspaces")).json()) as { workspace: { name: string } }).workspace.name).toBe("Sem título");
    expect((await post("/api/workspaces", { name: 3 })).status).toBe(400);

    const list = (await (await fetch(`${http.url}/api/workspaces`)).json()) as { active: string; workspaces: { id: string }[] };
    expect(list.active).toBe(store.doc.id);
    expect(list.workspaces.map((w) => w.id)).toContain(workspace.id);

    const opened = await post(`/api/workspaces/${encodeURIComponent(workspace.id)}/open`);
    expect(opened.status).toBe(200);
    expect(((await opened.json()) as { workspace: { active: boolean } }).workspace.active).toBe(true);
    await waitFor(() => messages.some((m) => m.type === "doc" && m.kind === "open" && m.doc?.id === workspace.id));
    expect(store.doc.id).toBe(workspace.id);

    const missing = await post("/api/workspaces/nope/open");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'workspace "nope" não existe' });
    expect((await fetch(`${http.url}/api/workspaces/${workspace.id}/open`)).status).toBe(405);
    ws.close();
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
