import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  NodeInputSchema,
  NodeType,
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
import { screenshot } from "./screenshot.js";

export const VERSION = "0.1.0";

export const DESIGN_GUIDE = `# Paprika: guia para agentes

Documento = mapa plano de nós + rootIds (telas/frames de topo, em coordenadas do canvas).
Tipos: frame (contêiner, único com filhos), rect, ellipse, text, image.

Campos comuns: name, x, y, width, height (número | "hug" | "fill"), rotation, opacity (0..1),
visible, locked, fill (cor), stroke {color,width}, radius, shadow {x,y,blur,spread,color}, notes.
frame: clip (bool), layout {mode: none|row|column, gap, padding (n | [t,r,b,l]), align: start|center|end|stretch,
  justify: start|center|end|between, wrap}. Com layout row/column, x/y dos filhos são ignorados.
text: text, color, fontFamily, fontSize (n | "$token"), fontWeight (100..900), lineHeight, letterSpacing, textAlign.
image: src (https:// ou data:image/), fit (cover|contain|fill), alt.

Cores: #hex, rgb(), rgba() ou "$token" (ver set_tokens). Prefira tokens para cores e tamanhos recorrentes.
"fill" em width/height ocupa o espaço restante no eixo principal do pai com layout, ou estica no eixo cruzado.

Fluxo recomendado:
1. get_document_outline para se orientar (barato).
2. set_tokens com a paleta e a escala tipográfica.
3. create_nodes com árvores aninhadas (children) numa só chamada; prefira frames com layout a posicionamento absoluto.
4. lint_design e corrija o que vier como error/warning.
5. render_screenshot para conferir visualmente; export_code para levar ao código.
Toda escrita é atômica (tudo ou nada) e pode ser desfeita com undo. O humano vê suas edições ao vivo no canvas.
Campos desconhecidos são rejeitados com erro: leia a mensagem e ajuste.`;

const text = (s: string): CallToolResult => ({ content: [{ type: "text", text: s }] });
const json = (v: unknown): CallToolResult => text(JSON.stringify(v, null, 2));

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

export interface McpOptions {
  /** Identifica o agente no histórico (ex.: "agent:claude"). */
  actor?: string;
}

/** Cria o servidor MCP do Paprika sobre um DocumentStore. Uma instância por conexão/sessão. */
export function createMcpServer(store: DocumentStore, opts: McpOptions = {}): McpServer {
  const actor = opts.actor ?? "agent";
  const server = new McpServer({ name: "paprika", version: VERSION }, { instructions: DESIGN_GUIDE });

  // Só responde ao agente depois que a transação está no disco.
  const write = async (ops: OpT[], label: string) => {
    const r = store.apply(ops, actor, label);
    await store.flush();
    return { created: r.created, version: store.version };
  };

  server.registerTool(
    "get_design_guide",
    { title: "Guia do formato", description: "Explica o modelo de nós, campos aceitos e o fluxo recomendado. Leia antes da primeira edição.", annotations: { readOnlyHint: true } },
    () => text(DESIGN_GUIDE),
  );

  server.registerTool(
    "get_document_outline",
    {
      title: "Estrutura do documento",
      description: "Árvore compacta (uma linha por nó: tipo#id, nome, tamanho, posição, estilo-chave), tokens e versão. Barato em tokens.",
      inputSchema: {
        rootId: z.string().optional().describe("Só a subárvore deste nó"),
        depth: z.number().int().min(0).max(50).optional().describe("Profundidade máxima (0 = só o nó)"),
      },
      annotations: { readOnlyHint: true },
    },
    ({ rootId, depth }) =>
      guard(() => {
        const d = store.doc;
        if (rootId && !d.nodes[rootId]) throw new Error(`nó "${rootId}" não existe`);
        const tokens = Object.entries(d.tokens)
          .map(([k, v]) => `$${k}=${v}`)
          .join(" ");
        return text(
          `documento "${d.name}" v${store.version} · ${Object.keys(d.nodes).length} nós\n` +
            `tokens: ${tokens || "(nenhum)"}\n\n${outline(d, { rootId, depth })}`,
        );
      }),
  );

  server.registerTool(
    "get_nodes",
    {
      title: "Ler nós",
      description: "Retorna o JSON completo dos nós pedidos (todos os campos, com defaults).",
      inputSchema: { ids: z.array(z.string()).min(1).max(200) },
      annotations: { readOnlyHint: true },
    },
    ({ ids }) =>
      guard(() => {
        const missing = ids.filter((id) => !store.doc.nodes[id]);
        if (missing.length) throw new Error(`nós inexistentes: ${missing.join(", ")}`);
        return json(ids.map((id) => store.doc.nodes[id]));
      }),
  );

  server.registerTool(
    "find_nodes",
    {
      title: "Buscar nós",
      description: "Busca por tipo, substring do nome ou do texto, opcionalmente dentro de uma subárvore.",
      inputSchema: {
        type: NodeType.optional(),
        name: z.string().optional(),
        text: z.string().optional(),
        within: z.string().optional(),
        limit: z.number().int().min(1).max(500).default(50),
      },
      annotations: { readOnlyHint: true },
    },
    (q) => guard(() => text(queryNodes(store.doc, q).map((n) => outline(store.doc, { rootId: n.id, depth: 0 }).split("\n")[0]).join("\n") || "(nada encontrado)")),
  );

  server.registerTool(
    "create_nodes",
    {
      title: "Criar nós",
      description:
        "Cria um ou mais nós (com children aninhados em frames) sob parentId (null/omitido = canvas). Atômico. Retorna os ids criados na ordem.",
      inputSchema: {
        parentId: z.string().nullable().optional(),
        index: z.number().int().min(0).optional().describe("Posição entre os irmãos; padrão: no fim"),
        nodes: NodeInputArray,
        label: z.string().max(200).optional().describe("Descrição curta para o histórico"),
      },
    },
    ({ parentId, index, nodes, label }) =>
      guard(async () => {
        const ops: OpT[] = nodes.map((node, i) => ({
          op: "create",
          node,
          parentId: parentId ?? null,
          ...(index !== undefined ? { index: index + i } : {}),
        }));
        return json(await write(ops, label ?? `criar ${nodes.length} nó(s)`));
      }),
  );

  server.registerTool(
    "update_nodes",
    {
      title: "Alterar nós",
      description: "Altera campos de vários nós numa transação atômica. null remove o campo. Objetos (layout, stroke, shadow) são substituídos inteiros.",
      inputSchema: {
        updates: z.array(z.object({ id: z.string(), props: z.record(z.string(), z.unknown()) })).min(1).max(500),
        label: z.string().max(200).optional(),
      },
    },
    ({ updates, label }) =>
      guard(async () => json(await write(updates.map((u) => ({ op: "update", id: u.id, props: u.props })), label ?? `alterar ${updates.length} nó(s)`))),
  );

  server.registerTool(
    "delete_nodes",
    {
      title: "Apagar nós",
      description: "Apaga nós e suas subárvores. Atômico e reversível com undo.",
      inputSchema: { ids: z.array(z.string()).min(1).max(500), label: z.string().max(200).optional() },
      annotations: { destructiveHint: true },
    },
    ({ ids, label }) => guard(async () => json(await write(ids.map((id) => ({ op: "delete", id })), label ?? `apagar ${ids.length} nó(s)`))),
  );

  server.registerTool(
    "move_nodes",
    {
      title: "Mover nós",
      description: "Muda o pai e/ou a ordem de nós (parentId null = canvas). Não altera x/y.",
      inputSchema: {
        moves: z.array(z.object({ id: z.string(), parentId: z.string().nullable(), index: z.number().int().min(0).optional() })).min(1),
        label: z.string().max(200).optional(),
      },
    },
    ({ moves, label }) => guard(async () => json(await write(moves.map((m) => ({ op: "move", ...m })), label ?? `mover ${moves.length} nó(s)`))),
  );

  server.registerTool(
    "apply_ops",
    {
      title: "Transação de operações",
      description:
        "Aplica uma lista mista de operações (create, update, delete, move, set_tokens, rename_document) numa única transação atômica.",
      inputSchema: { ops: z.array(Op).min(1).max(1000), label: z.string().max(200).optional() },
    },
    ({ ops, label }) => guard(async () => json(await write(ops as OpT[], label ?? `transação de ${ops.length} op(s)`))),
  );

  server.registerTool(
    "set_tokens",
    {
      title: "Definir tokens",
      description: 'Cria/atualiza design tokens (cores, tamanhos). Use nos nós como "$nome". null remove.',
      inputSchema: { tokens: z.record(z.string(), z.union([z.string(), z.number(), z.null()])), label: z.string().max(200).optional() },
    },
    ({ tokens, label }) => guard(async () => json(await write([{ op: "set_tokens", tokens }], label ?? "tokens"))),
  );

  server.registerTool(
    "undo",
    { title: "Desfazer", description: "Desfaz a última transação (de qualquer autor: agente ou humano)." },
    () => guard(() => json({ undone: store.undo(actor), version: store.version, canUndo: store.canUndo, canRedo: store.canRedo })),
  );

  server.registerTool(
    "redo",
    { title: "Refazer", description: "Refaz a última transação desfeita." },
    () => guard(() => json({ redone: store.redo(actor), version: store.version, canUndo: store.canUndo, canRedo: store.canRedo })),
  );

  server.registerTool(
    "get_history",
    {
      title: "Histórico",
      description: "Últimas transações (autor, rótulo, horário). Mostra o que o humano mudou no canvas.",
      inputSchema: { limit: z.number().int().min(1).max(200).default(20) },
      annotations: { readOnlyHint: true },
    },
    ({ limit }) => guard(() => json(store.recentHistory(limit))),
  );

  server.registerTool(
    "lint_design",
    {
      title: "Revisar design",
      description: "Checa contraste WCAG AA, tokens inexistentes, overflow, texto pequeno/vazio, imagens sem alt e cores fora dos tokens.",
      inputSchema: { rootId: z.string().optional() },
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
      description: "PNG de um nó (ou do canvas inteiro), renderizado pelo mesmo motor do canvas e do export.",
      inputSchema: { rootId: z.string().optional(), scale: z.number().min(0.1).max(4).default(1) },
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
        };
      }),
  );

  server.registerTool(
    "export_code",
    {
      title: "Exportar código",
      description: "Exporta um nó como HTML autocontido ou componente React (TSX) com estilos inline.",
      inputSchema: { rootId: z.string(), format: z.enum(["html", "react"]).default("react") },
      annotations: { readOnlyHint: true },
    },
    ({ rootId, format }) =>
      guard(() => text(format === "html" ? renderHTML(store.doc, { rootId }).html : exportReact(store.doc, rootId))),
  );

  return server;
}
