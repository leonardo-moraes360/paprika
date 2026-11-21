import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  NodeInputSchema,
  copyId,
  importHTML,
  importSVG,
  type ImportResult,
  isContainer,
  type NodeInput,
  NodeType,
  newId,
  ungroupOps,
  parsePath,
  pathBounds,
  serializePath,
  Op,
  OpError,
  exportReact,
  lintDocument,
  outline,
  queryNodes,
  renderHTML,
  type Op as OpT,
} from "@paprika/core";
import type { DocumentStore } from "./store.js";
import { presenceKey, presenceTargets } from "./presence.js";
import { screenshot, svgExport } from "./screenshot.js";

export const VERSION = "0.1.0";

export const DESIGN_GUIDE = `# Paprika: guide for agents

Document = flat map of nodes + rootIds (top-level screens/frames, in canvas coordinates).
Types: frame (container with style and layout), group (groups without painting), page (separate canvas), rect, ellipse,
text, image, path (vector with bezier curves). Only frame, group and page have children.

Common fields: name, x, y, width, height (number | "hug" | "fill"), rotation, opacity (0..1),
visible, locked, fill (color), stroke {color,width}, radius, shadow {x,y,blur,spread,color}, notes.
frame: clip (bool), layout {mode: none|row|column, gap, padding (n | [t,r,b,l]), align: start|center|end|stretch,
  justify: start|center|end|between, wrap}, mode (theme mode, see below). With row/column layout, children's x/y are ignored.
text: text, color, fontFamily, fontSize (n | "$token"), fontWeight (100..900), lineHeight, letterSpacing, textAlign.
image: src (https:// or data:image/), fit (cover|contain|fill), alt.
group: name, x, y, opacity, visible, locked, notes, children. The box (x, y, width, height) is computed from the
  children at the end of each write; children's coordinates are relative to the group. Use group_nodes/ungroup_nodes.
page: name, fill (canvas background), mode, notes, children. Top level only; once there are pages, every top-level node
  is a page and frames go in parentId = the page id (canvas coordinates). create_page creates the first one and moves
  the current content to "Página 1". Screens of another page: get_document_outline {rootId: page id}.
Components: a frame with component: true is a component (create_component). An instance is a frame with
  instanceOf = the component id and an optional scale (create_instance): its children are generated copies, with
  derived ids and sourceId = the id of the source node; changing the component changes every instance. On a copy,
  update only changes fill, color, text, src, alt, visible and opacity (stored as an instance override; null goes back
  to the component); on the root, fill becomes an override and width/height/layout/stroke/radius/shadow/clip come from
  the component (use scale). Copies cannot be moved, deleted or given children: edit the component or detach_instance.
path: d (SVG path data: M L H V C S Q T A Z, absolute or relative), fill (no fill = outline only),
  stroke {color,width}, fillRule (nonzero|evenodd), strokeCap (butt|round|square), strokeJoin (miter|round|bevel),
  optional viewBox [x,y,w,h]. Without viewBox, d's coordinates are px from the node's (x,y) corner; with viewBox,
  the drawing is scaled to fit width×height (good for icons on a 24×24 grid). Without width/height, the node
  gets the drawing's box. Curves: "C c1x c1y c2x c2y x y" (cubic), "Q cx cy x y" (quadratic), S/T mirror the
  previous control point (smooth curves). Use path_info to check bounds before positioning.

Colors: #hex, rgb(), rgba() or "$token" (see set_tokens). Prefer tokens for recurring colors and sizes.
Theme modes: set_tokens with mode ("dark", "compact"…) writes only the tokens that change; "mode" on a frame or page applies the mode to its subtree (the same screen can sit light and dark side by side). export_code with cssVariables: true writes var(--token) and one rule per mode.
"fill" in width/height takes the remaining space on the main axis of a parent with layout, or stretches on the cross axis.

Recommended flow:
1. get_document_outline to get your bearings (cheap).
2. set_tokens with the palette and the type scale.
3. create_nodes with nested trees (children) in one call; prefer frames with layout over absolute positioning.
4. lint_design and fix whatever comes back as error/warning.
5. render_screenshot to check visually; export_code to take it to code.
To bring in a ready icon or a piece of a page, use import_svg or import_html (they become editable nodes); export_code with format "svg" returns vector SVG.
Every write is atomic (all or nothing) and can be undone with undo. To make several calls one undo step (e.g. "draw proposal 3"), pass the same batch to each of them; the batch closes when anyone else writes or undoes in between.
Results: JSON tools also return structuredContent that matches their outputSchema; read it instead of parsing the text.
The human sees your edits live on the canvas. Unknown fields are rejected with an error: read the message and adjust.
This guide in Brazilian Portuguese: get_design_guide {language: "pt-BR"}.`;

/** The guide in Brazilian Portuguese (get_design_guide {language: "pt-BR"}). */
export const DESIGN_GUIDE_PT_BR = `# Paprika: guia para agentes

Documento = mapa plano de nós + rootIds (telas/frames de topo, em coordenadas do canvas).
Tipos: frame (contêiner com estilo e layout), group (agrupa sem pintar), page (canvas separado), rect, ellipse,
text, image, path (vetor com curvas bezier). Só frame, group e page têm filhos.

Campos comuns: name, x, y, width, height (número | "hug" | "fill"), rotation, opacity (0..1),
visible, locked, fill (cor), stroke {color,width}, radius, shadow {x,y,blur,spread,color}, notes.
frame: clip (bool), layout {mode: none|row|column, gap, padding (n | [t,r,b,l]), align: start|center|end|stretch,
  justify: start|center|end|between, wrap}. Com layout row/column, x/y dos filhos são ignorados.
text: text, color, fontFamily, fontSize (n | "$token"), fontWeight (100..900), lineHeight, letterSpacing, textAlign.
image: src (https:// ou data:image/), fit (cover|contain|fill), alt.
group: name, x, y, opacity, visible, locked, notes, children. A caixa (x, y, width, height) é calculada a partir
  dos filhos ao fim de cada escrita; coordenadas dos filhos são relativas ao grupo. Use group_nodes/ungroup_nodes.
page: name, fill (fundo do canvas), notes, children. Só no topo; com páginas, todo nó de topo é página e os
  frames vão em parentId = id da página (coordenadas do canvas). create_page cria a primeira já levando o
  conteúdo atual para "Página 1". Telas de outra página: get_document_outline {rootId: id da página}.
Componentes: um frame com component: true é um componente (create_component). Uma instância é um frame com
  instanceOf = id do componente e scale opcional (create_instance): os filhos são cópias geradas, com ids
  derivados e sourceId = id do nó de origem; mudar o componente muda todas as instâncias. Numa cópia, update só
  troca fill, color, text, src, alt, visible e opacity (vira override da instância; null volta ao componente);
  na raiz, fill vira override e width/height/layout/stroke/radius/shadow/clip vêm do componente (use scale).
  Cópias não podem ser movidas, apagadas nem receber filhos: edite o componente ou detach_instance.
path: d (dados de caminho SVG: M L H V C S Q T A Z, absolutos ou relativos), fill (preenchimento; sem fill = vazado),
  stroke {color,width} (traço), fillRule (nonzero|evenodd), strokeCap (butt|round|square), strokeJoin (miter|round|bevel),
  viewBox [x,y,w,h] opcional. Sem viewBox, as coordenadas de d são px a partir do canto (x,y) do nó; com viewBox,
  o desenho é escalado para caber em width×height (bom para ícones num grid 24×24). Sem width/height, o nó
  ganha a caixa do desenho. Curvas: "C c1x c1y c2x c2y x y" (cúbica), "Q cx cy x y" (quadrática), S/T espelham
  o controle anterior (curvas suaves). Use path_info para conferir bounds antes de posicionar.

Cores: #hex, rgb(), rgba() ou "$token" (ver set_tokens). Prefira tokens para cores e tamanhos recorrentes.
Modos de tema: set_tokens com mode ("dark", "compact"…) grava só os tokens que mudam; "mode" num frame ou página aplica o modo ao subtree (dá para pôr a mesma tela clara e escura lado a lado). export_code com cssVariables: true sai com var(--token) e uma regra por modo.
"fill" em width/height ocupa o espaço restante no eixo principal do pai com layout, ou estica no eixo cruzado.

Fluxo recomendado:
1. get_document_outline para se orientar (barato).
2. set_tokens com a paleta e a escala tipográfica.
3. create_nodes com árvores aninhadas (children) numa só chamada; prefira frames com layout a posicionamento absoluto.
4. lint_design e corrija o que vier como error/warning.
5. render_screenshot para conferir visualmente; export_code para levar ao código.
Para trazer um ícone ou um trecho de página pronto, use import_svg ou import_html (viram nós editáveis); export_code com format "svg" devolve SVG vetorial.
Toda escrita é atômica (tudo ou nada) e pode ser desfeita com undo. Para várias chamadas virarem um passo só de undo (ex.: "desenhar a proposta 3"), passe o mesmo batch em cada uma; o batch fecha quando outra pessoa escreve ou desfaz no meio.
Resultados: as ferramentas que devolvem JSON também devolvem structuredContent conforme o outputSchema; leia esse campo em vez de interpretar o texto.
O humano vê suas edições ao vivo no canvas. Campos desconhecidos são rejeitados com erro: leia a mensagem e ajuste.
Erros e mensagens das ferramentas são em inglês.`;

const text = (s: string): CallToolResult => ({ content: [{ type: "text", text: s }] });
/** JSON result: the same object as text (older clients) and as structuredContent (outputSchema). */
const json = (v: Record<string, unknown>, shown: unknown = v): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(shown, null, 2) }],
  structuredContent: v,
});

function fail(e: unknown): CallToolResult {
  const msg = e instanceof OpError || e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: "text", text: msg }] };
}

function guard(fn: () => Promise<CallToolResult> | CallToolResult): Promise<CallToolResult> {
  return Promise.resolve()
    .then(fn)
    .catch((e: unknown) => fail(e));
}

const NodeInputArray = z.array(NodeInputSchema).min(1).max(500);

const batchField = z
  .string()
  .min(1)
  .max(200)
  .optional()
  .describe("Undo batch: consecutive writes from this agent with the same batch become one undo step (and one history entry, labeled with the batch)");

// Output schemas (structuredContent). Keep them in sync with the handlers' JSON.
const Written = { created: z.array(z.string()), version: z.number().int() };
const Bounds = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
const Step = { version: z.number().int(), canUndo: z.boolean(), canRedo: z.boolean() };

/** Actor name from the MCP clientInfo: "agent:<name>", trimmed to something printable. */
export function actorFromClient(name: string | undefined): string | undefined {
  const clean = (name ?? "").replace(/[^\p{L}\p{N} ._@:/+-]/gu, "").trim().slice(0, 64);
  return clean ? `agent:${clean}` : undefined;
}

export interface McpOptions {
  /** Actor in the history when the client sent no clientInfo name (e.g. "agent:stdio"). */
  actor?: string;
  /** clientInfo.name known from an earlier initialize (stateless HTTP: looked up by session id). */
  clientName?: string;
  /** Mcp-Session-Id of the HTTP request: tells apart two agents with the same name on the canvas. */
  sessionId?: string;
}

/** Cria o servidor MCP do Paprika sobre um DocumentStore. Uma instância por conexão/sessão. */
export function createMcpServer(store: DocumentStore, opts: McpOptions = {}): McpServer {
  const server = new McpServer({ name: "paprika", version: VERSION }, { instructions: DESIGN_GUIDE });
  // The client's own name (initialize clientInfo) wins over the transport's guess (User-Agent, "stdio").
  const actorOf = () => actorFromClient(server.server.getClientVersion()?.name ?? opts.clientName) ?? opts.actor ?? "agent";

  // Every tool call reports the agent's presence (tool + nodes it acted on) for the canvas cursor.
  const register = server.registerTool.bind(server) as (name: string, config: unknown, cb: (...a: unknown[]) => unknown) => unknown;
  server.registerTool = ((name: string, config: unknown, cb: (...a: unknown[]) => unknown) =>
    register(name, config, async (...a: unknown[]) => {
      let result: CallToolResult | undefined;
      try {
        result = (await cb(...a)) as CallToolResult;
        return result;
      } finally {
        const actor = actorOf();
        // Tools without an inputSchema get only `extra`.
        const args = a.length > 1 ? a[0] : undefined;
        store.presence.report(presenceKey(opts.sessionId, actor), actor, name, presenceTargets(args, result?.structuredContent, store.doc));
      }
    })) as typeof server.registerTool;

  // Answers the agent only after the transaction is on disk.
  const write = async (ops: OpT[], label: string, batch?: string) => {
    const r = store.apply(ops, actorOf(), label, batch);
    await store.flush();
    return { created: r.created, version: store.version };
  };

  server.registerTool(
    "get_design_guide",
    {
      title: "Format guide",
      description: "Explains the node model, the accepted fields and the recommended flow. Read it before the first edit. language: \"pt-BR\" returns the Brazilian Portuguese version.",
      inputSchema: { language: z.enum(["en", "pt-BR"]).default("en") },
      annotations: { readOnlyHint: true },
    },
    ({ language }) => text(language === "pt-BR" ? DESIGN_GUIDE_PT_BR : DESIGN_GUIDE),
  );

  server.registerTool(
    "get_document_outline",
    {
      title: "Document outline",
      description: "Compact tree (one line per node: type#id, name, size, position, key style), tokens, theme modes and version. Cheap in tokens.",
      inputSchema: {
        rootId: z.string().optional().describe("Only this node's subtree"),
        depth: z.number().int().min(0).max(50).optional().describe("Maximum depth (0 = just the node)"),
      },
      annotations: { readOnlyHint: true },
    },
    ({ rootId, depth }) =>
      guard(() => {
        const d = store.doc;
        if (rootId && !d.nodes[rootId]) throw new Error(`node "${rootId}" does not exist`);
        const tokens = Object.entries(d.tokens)
          .map(([k, v]) => `$${k}=${v}`)
          .join(" ");
        const modes = Object.entries(d.modes ?? {})
          .map(([m, t]) => `${m}(${Object.entries(t).map(([k, v]) => `$${k}=${v}`).join(" ")})`)
          .join(" ");
        return text(
          `document "${d.name}" v${store.version} · ${Object.keys(d.nodes).length} nodes\n` +
            `tokens: ${tokens || "(none)"}\n${modes ? `modes: ${modes}\n` : ""}\n${outline(d, { rootId, depth })}`,
        );
      }),
  );

  server.registerTool(
    "get_nodes",
    {
      title: "Read nodes",
      description: "Full JSON of the requested nodes (every field, with defaults). The text result is the array; structuredContent is { nodes }.",
      inputSchema: { ids: z.array(z.string()).min(1).max(200) },
      outputSchema: { nodes: z.array(z.record(z.string(), z.unknown())) },
      annotations: { readOnlyHint: true },
    },
    ({ ids }) =>
      guard(() => {
        const missing = ids.filter((id) => !store.doc.nodes[id]);
        if (missing.length) throw new Error(`nodes do not exist: ${missing.join(", ")}`);
        const nodes = ids.map((id) => store.doc.nodes[id]);
        return json({ nodes }, nodes);
      }),
  );

  server.registerTool(
    "find_nodes",
    {
      title: "Find nodes",
      description: "Search by type, or by a substring of the name or the text, optionally inside a subtree.",
      inputSchema: {
        type: NodeType.optional(),
        name: z.string().optional(),
        text: z.string().optional(),
        within: z.string().optional(),
        limit: z.number().int().min(1).max(500).default(50),
      },
      annotations: { readOnlyHint: true },
    },
    (q) => guard(() => text(queryNodes(store.doc, q).map((n) => outline(store.doc, { rootId: n.id, depth: 0 }).split("\n")[0]).join("\n") || "(nothing found)")),
  );

  server.registerTool(
    "path_info",
    {
      title: "Path geometry",
      description:
        "Validates SVG path data (d) and returns the exact box of the drawing (including the extremes of bezier curves and arcs), the number of segments and d normalized to absolute commands. Pass `d` or the `id` of a path node.",
      inputSchema: {
        d: z.string().max(200_000).optional(),
        id: z.string().optional(),
      },
      outputSchema: {
        segments: z.number().int(),
        curves: z.number().int(),
        closed: z.boolean(),
        bounds: Bounds,
        canvasBounds: Bounds.optional().describe("With id: the box in canvas coordinates"),
        normalized: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ d, id }) =>
      guard(() => {
        let src = d;
        let origin = { x: 0, y: 0 };
        if (id) {
          const n = store.doc.nodes[id];
          if (!n) throw new Error(`node "${id}" does not exist`);
          if (n.type !== "path") throw new Error(`node "${id}" is ${n.type}, not a path`);
          src = n.d;
          origin = { x: n.x, y: n.y };
        }
        if (!src) throw new Error("pass d or id");
        const segs = parsePath(src);
        const b = pathBounds(segs);
        const round = (v: number) => Math.round(v * 100) / 100;
        return json({
          segments: segs.length,
          curves: segs.filter((s) => s.cmd === "C" || s.cmd === "Q" || s.cmd === "A").length,
          closed: segs.some((s) => s.cmd === "Z"),
          bounds: { x: round(b.x), y: round(b.y), width: round(b.width), height: round(b.height) },
          ...(id ? { canvasBounds: { x: round(origin.x + b.x), y: round(origin.y + b.y), width: round(b.width), height: round(b.height) } } : {}),
          normalized: serializePath(segs),
        });
      }),
  );

  server.registerTool(
    "create_nodes",
    {
      title: "Create nodes",
      description:
        "Creates one or more nodes (with nested children in frames) under parentId (null/omitted = canvas). Atomic. Returns the created ids in order.",
      inputSchema: {
        parentId: z.string().nullable().optional(),
        index: z.number().int().min(0).optional().describe("Position among the siblings; default: at the end"),
        nodes: NodeInputArray,
        label: z.string().max(200).optional().describe("Short description for the history"),
        batch: batchField,
      },
      outputSchema: Written,
    },
    ({ parentId, index, nodes, label, batch }) =>
      guard(async () => {
        const ops: OpT[] = nodes.map((node, i) => ({
          op: "create",
          node,
          parentId: parentId ?? null,
          ...(index !== undefined ? { index: index + i } : {}),
        }));
        return json(await write(ops, label ?? `create ${nodes.length} node(s)`, batch));
      }),
  );

  server.registerTool(
    "update_nodes",
    {
      title: "Update nodes",
      description: "Changes fields of several nodes in one atomic transaction. null removes a field. Objects (layout, stroke, shadow) are replaced whole.",
      inputSchema: {
        updates: z.array(z.object({ id: z.string(), props: z.record(z.string(), z.unknown()) })).min(1).max(500),
        label: z.string().max(200).optional(),
        batch: batchField,
      },
      outputSchema: Written,
    },
    ({ updates, label, batch }) =>
      guard(async () => json(await write(updates.map((u) => ({ op: "update", id: u.id, props: u.props })), label ?? `update ${updates.length} node(s)`, batch))),
  );

  server.registerTool(
    "delete_nodes",
    {
      title: "Delete nodes",
      description: "Deletes nodes and their subtrees. Atomic, and undo brings them back.",
      inputSchema: { ids: z.array(z.string()).min(1).max(500), label: z.string().max(200).optional(), batch: batchField },
      outputSchema: Written,
      annotations: { destructiveHint: true },
    },
    ({ ids, label, batch }) => guard(async () => json(await write(ids.map((id) => ({ op: "delete", id })), label ?? `delete ${ids.length} node(s)`, batch))),
  );

  server.registerTool(
    "move_nodes",
    {
      title: "Move nodes",
      description: "Changes the parent and/or the order of nodes (parentId null = canvas). Does not change x/y.",
      inputSchema: {
        moves: z.array(z.object({ id: z.string(), parentId: z.string().nullable(), index: z.number().int().min(0).optional() })).min(1),
        label: z.string().max(200).optional(),
        batch: batchField,
      },
      outputSchema: Written,
    },
    ({ moves, label, batch }) => guard(async () => json(await write(moves.map((m) => ({ op: "move", ...m })), label ?? `move ${moves.length} node(s)`, batch))),
  );

  server.registerTool(
    "group_nodes",
    {
      title: "Group nodes",
      description:
        "Puts sibling nodes (same parent, no row/column layout) in a new group, in the place of the topmost one. The drawing does not move: the group's box follows its children. Returns the group id.",
      inputSchema: {
        ids: z.array(z.string()).min(1).max(500),
        name: z.string().max(200).optional(),
        id: z.string().optional().describe("Group id (default: generated)"),
        label: z.string().max(200).optional(),
        batch: batchField,
      },
      outputSchema: { group: z.string(), ...Written },
    },
    ({ ids, name, id, label, batch }) =>
      guard(async () => {
        const gid = id ?? newId();
        const r = await write([{ op: "group", ids, id: gid, ...(name !== undefined ? { name } : {}) }], label ?? `group ${ids.length} node(s)`, batch);
        return json({ group: gid, ...r });
      }),
  );

  server.registerTool(
    "ungroup_nodes",
    {
      title: "Ungroup",
      description: "Removes groups: their children go back to the group's parent, in its place, keeping position, opacity and visibility.",
      inputSchema: { ids: z.array(z.string()).min(1).max(500), label: z.string().max(200).optional(), batch: batchField },
      outputSchema: { released: z.array(z.string()), ...Written },
    },
    ({ ids, label, batch }) =>
      guard(async () => {
        const { released } = ungroupOps(store.doc, ids); // validates and says which children come back
        const r = await write([{ op: "ungroup", ids }], label ?? `ungroup ${ids.length} group(s)`, batch);
        return json({ released, ...r });
      }),
  );

  server.registerTool(
    "create_page",
    {
      title: "Create page",
      description:
        "Creates a page (a separate canvas in the same file). The first time, the current content first moves to a page named \"Página 1\". Create screens on it with create_nodes {parentId: page id}.",
      inputSchema: {
        name: z.string().max(200).optional(),
        id: z.string().optional().describe("Page id (default: generated)"),
        label: z.string().max(200).optional(),
        batch: batchField,
      },
      outputSchema: { page: z.string(), ...Written },
    },
    ({ name, id, label, batch }) =>
      guard(async () => {
        const pid = id ?? newId();
        const r = await write([{ op: "add_page", id: pid, ...(name !== undefined ? { name } : {}) }], label ?? "create page", batch);
        return json({ page: pid, ...r });
      }),
  );

  server.registerTool(
    "create_component",
    {
      title: "Create component",
      description: "Marks a frame as a component (component: true). Then create_instance makes copies of it that follow the changes to the component.",
      inputSchema: { id: z.string(), label: z.string().max(200).optional(), batch: batchField },
      outputSchema: { component: z.string(), ...Written },
    },
    ({ id, label, batch }) =>
      guard(async () => {
        const r = await write([{ op: "update", id, props: { component: true } }], label ?? "create component", batch);
        return json({ component: id, ...r });
      }),
  );

  server.registerTool(
    "create_instance",
    {
      title: "Create instance",
      description:
        "Creates an instance of a component (a frame with instanceOf). By default it goes in the component's parent, 40px to its right. Returns the instance id and, in copies, the id of the copy of each component node (for overrides with update_nodes).",
      inputSchema: {
        componentId: z.string(),
        parentId: z.string().nullable().optional().describe("Parent of the instance (default: the component's parent)"),
        x: z.number().optional(),
        y: z.number().optional(),
        scale: z.number().min(0.01).max(100).optional(),
        name: z.string().max(200).optional(),
        overrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional().describe("{ idOfTheComponentNode: { text: ..., fill: ... } }"),
        id: z.string().optional().describe("Instance id (default: generated)"),
        label: z.string().max(200).optional(),
        batch: batchField,
      },
      outputSchema: { instance: z.string(), copies: z.record(z.string(), z.string()), ...Written },
    },
    ({ componentId, parentId, x, y, scale, name, overrides, id, label, batch }) =>
      guard(async () => {
        const comp = store.doc.nodes[componentId];
        const iid = id ?? newId();
        const node: Record<string, unknown> = { type: "frame", id: iid, instanceOf: componentId };
        const cx = comp && comp.type !== "page" ? comp.x : 0;
        const cw = comp && comp.type !== "page" && typeof comp.width === "number" ? comp.width : 0;
        node.name = name ?? comp?.name ?? "";
        node.x = x ?? (comp && comp.type !== "page" ? cx + cw + 40 : 0);
        node.y = y ?? (comp && comp.type !== "page" ? comp.y : 0);
        if (scale !== undefined) node.scale = scale;
        if (overrides !== undefined) node.overrides = overrides;
        const parent = parentId !== undefined ? parentId : (comp?.parentId ?? null);
        const r = await write([{ op: "create", parentId: parent, node: node as NodeInput }], label ?? "create instance", batch);
        const copies: Record<string, string> = {};
        const walk = (nid: string) => {
          const n = store.doc.nodes[nid];
          if (!isContainer(n)) return;
          for (const c of n.children) {
            copies[c] = copyId(iid, c);
            walk(c);
          }
        };
        walk(componentId);
        return json({ instance: iid, copies, ...r });
      }),
  );

  server.registerTool(
    "detach_instance",
    {
      title: "Detach instance",
      description: "Turns instances into plain frames: the copies become normal nodes (same ids) and stop following the component.",
      inputSchema: { ids: z.array(z.string()).min(1).max(500), label: z.string().max(200).optional(), batch: batchField },
      outputSchema: { detached: z.array(z.string()), ...Written },
    },
    ({ ids, label, batch }) =>
      guard(async () => {
        const r = await write([{ op: "detach", ids }], label ?? `detach ${ids.length} instance(s)`, batch);
        return json({ detached: ids, ...r });
      }),
  );

  server.registerTool(
    "apply_ops",
    {
      title: "Operation transaction",
      description:
        "Applies a mixed list of operations (create, update, delete, move, set_tokens, rename_document, group, ungroup, add_page, detach) in one atomic transaction.",
      inputSchema: { ops: z.array(Op).min(1).max(1000), label: z.string().max(200).optional(), batch: batchField },
      outputSchema: Written,
    },
    ({ ops, label, batch }) => guard(async () => json(await write(ops as OpT[], label ?? `transaction of ${ops.length} op(s)`, batch))),
  );

  server.registerTool(
    "set_tokens",
    {
      title: "Set tokens",
      description:
        'Creates or updates design tokens (colors, sizes). Use them in nodes as "$name". null removes one. With `mode`, writes the values of that theme mode (e.g. "dark"), which apply in frames/pages with the same `mode` and their descendants; tokens the mode does not define use the base value.',
      inputSchema: {
        tokens: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
        mode: z.string().optional().describe("Theme mode ([A-Za-z0-9_-]{1,40}); without it, the base tokens"),
        label: z.string().max(200).optional(),
        batch: batchField,
      },
      outputSchema: Written,
    },
    ({ tokens, mode, label, batch }) =>
      guard(async () => json(await write([mode ? { op: "set_tokens", tokens, mode } : { op: "set_tokens", tokens }], label ?? "tokens", batch))),
  );

  server.registerTool(
    "undo",
    {
      title: "Undo",
      description: "Undoes the last transaction (from any author: agent or human). A batch is undone whole.",
      outputSchema: { undone: z.boolean(), ...Step },
    },
    () => guard(() => json({ undone: store.undo(actorOf()), version: store.version, canUndo: store.canUndo, canRedo: store.canRedo })),
  );

  server.registerTool(
    "redo",
    { title: "Redo", description: "Redoes the last undone transaction.", outputSchema: { redone: z.boolean(), ...Step } },
    () => guard(() => json({ redone: store.redo(actorOf()), version: store.version, canUndo: store.canUndo, canRedo: store.canRedo })),
  );

  server.registerTool(
    "get_history",
    {
      title: "History",
      description: "Latest transactions (author, label, time, number of ops). Shows what the human changed on the canvas. The text result is the array; structuredContent is { entries }.",
      inputSchema: { limit: z.number().int().min(1).max(200).default(20) },
      outputSchema: { entries: z.array(z.object({ actor: z.string(), label: z.string(), at: z.number(), ops: z.number().int() })) },
      annotations: { readOnlyHint: true },
    },
    ({ limit }) =>
      guard(() => {
        const entries = store.recentHistory(limit);
        return json({ entries }, entries);
      }),
  );

  server.registerTool(
    "lint_design",
    {
      title: "Review design",
      description: "Checks WCAG AA contrast, missing tokens and theme modes, overflow, small or empty text, images without alt and colors outside the tokens.",
      inputSchema: { rootId: z.string().optional() },
      outputSchema: {
        ok: z.boolean().describe("No errors (warnings and info allowed)"),
        counts: z.object({ error: z.number().int(), warning: z.number().int(), info: z.number().int() }),
        issues: z.array(z.object({ rule: z.string(), severity: z.enum(["error", "warning", "info"]), nodeId: z.string(), message: z.string() })),
      },
      annotations: { readOnlyHint: true },
    },
    ({ rootId }) =>
      guard(() => {
        const issues = lintDocument(store.doc, { rootId });
        const counts = { error: 0, warning: 0, info: 0 };
        for (const i of issues) counts[i.severity]++;
        return json({ ok: counts.error === 0, counts, issues });
      }),
  );

  server.registerTool(
    "render_screenshot",
    {
      title: "Screenshot",
      description: "PNG of a node (a page: its canvas; without rootId: the canvas, or the first page), rendered by the same engine as the canvas and the export.",
      inputSchema: { rootId: z.string().optional(), scale: z.number().min(0.1).max(4).default(1) },
      outputSchema: { width: z.number().int(), height: z.number().int() },
      annotations: { readOnlyHint: true },
    },
    ({ rootId, scale }) =>
      guard(async () => {
        const shot = await screenshot(store.doc, { rootId, scale });
        return {
          content: [
            { type: "image", data: shot.png.toString("base64"), mimeType: "image/png" },
            { type: "text", text: `${shot.width}×${shot.height}px` },
          ],
          structuredContent: { width: shot.width, height: shot.height },
        };
      }),
  );

  server.registerTool(
    "export_code",
    {
      title: "Export code",
      description:
        "Exports a node as standalone HTML, a React (TSX) component with inline styles, or vector SVG (svg: the layout is measured in headless Chromium, like render_screenshot; a page rootId exports the page).",
      inputSchema: {
        rootId: z.string(),
        format: z.enum(["html", "react", "svg"]).default("react"),
        cssVariables: z
          .boolean()
          .default(false)
          .describe("html/react: tokens as var(--name), with one stylesheet rule per theme mode (react exports tokensCss)"),
      },
      annotations: { readOnlyHint: true },
    },
    ({ rootId, format, cssVariables }) =>
      guard(async () => {
        if (format === "html") return text(renderHTML(store.doc, { rootId, cssVariables }).html);
        if (format === "react") return text(exportReact(store.doc, rootId, { cssVariables }));
        const r = await svgExport(store.doc, rootId);
        const out: CallToolResult = { content: [{ type: "text", text: r.svg }] };
        if (r.warnings.length) out.content.push({ type: "text", text: `warnings: ${r.warnings.join("; ")}` });
        return out;
      }),
  );

  const importInput = {
    parentId: z.string().nullable().optional().describe("Parent of the nodes (default: top level; in a document with pages, pass the page id)"),
    x: z.number().optional(),
    y: z.number().optional(),
    label: z.string().max(200).optional(),
    batch: batchField,
  };
  const importOutput = { ...Written, warnings: z.array(z.string()) };
  const importWrite = async (r: ImportResult, parentId: string | null | undefined, label: string, batch: string | undefined) => {
    if (!r.nodes.length) throw new Error(r.warnings.join("; ") || "nothing to import");
    const w = await write(r.nodes.map((node) => ({ op: "create", parentId: parentId ?? null, node }) as OpT), label, batch);
    return json({ ...w, warnings: r.warnings });
  };

  server.registerTool(
    "import_svg",
    {
      title: "Import SVG",
      description:
        "Turns SVG into editable nodes: path/rect/circle/ellipse/line/polyline/polygon become path (or rect/ellipse without rotation), <g> becomes group; transforms and inherited paint are applied. Text, images, gradients and CSS in <style> are skipped and listed in warnings. x/y offset the SVG's origin.",
      inputSchema: { svg: z.string().min(1).max(2_000_000), name: z.string().max(200).optional(), ...importInput },
      outputSchema: importOutput,
    },
    ({ svg, name, parentId, x, y, label, batch }) =>
      guard(async () => importWrite(importSVG(svg, { x, y, name }), parentId, label ?? "import SVG", batch)),
  );

  server.registerTool(
    "import_html",
    {
      title: "Import HTML",
      description:
        "Turns HTML with inline styles into nodes (the inverse of the export: Paprika's own HTML comes back the same). From other sources: display:flex becomes row/column layout, blocks become column, text becomes text, <img> becomes image, <svg> goes through import_svg. Classes and <style> are not applied (warnings).",
      inputSchema: { html: z.string().min(1).max(2_000_000), ...importInput },
      outputSchema: importOutput,
    },
    ({ html, parentId, x, y, label, batch }) => guard(async () => importWrite(importHTML(html, { x, y }), parentId, label ?? "import HTML", batch)),
  );

  return server;
}
